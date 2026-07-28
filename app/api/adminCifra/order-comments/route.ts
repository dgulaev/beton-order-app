import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ORDER_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { notifyManagers } from '@/lib/notifyManagers';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Комментарии сотрудников к заявке — те же роли, что работают с заявками.
 *  Лаборант сюда не входит: у него только «Лаборатория», модалок заявок нет. */
const COMMENT_ROLES = ORDER_MUTATION_ROLES;

export type CommentReader = {
  user_id: number;
  user_name: string;
  read_at: string;
};

/** Прочитавшие по comment_id — имена из users.full_name */
async function loadReadersByCommentIds(
  commentIds: number[]
): Promise<Map<number, CommentReader[]>> {
  const map = new Map<number, CommentReader[]>();
  if (commentIds.length === 0) return map;

  const { data: reads } = await supabase
    .from('order_comment_reads')
    .select('comment_id, user_id, read_at')
    .in('comment_id', commentIds)
    .order('read_at', { ascending: true });

  if (!reads || reads.length === 0) return map;

  const userIds = [...new Set(reads.map((r) => Number(r.user_id)).filter((n) => n > 0))];
  const nameById = new Map<number, string>();

  if (userIds.length > 0) {
    const { data: users } = await supabase
      .from('users')
      .select('user_id, full_name')
      .in('user_id', userIds);
    for (const u of users || []) {
      const name = String(u.full_name || '').trim() || 'Сотрудник';
      nameById.set(Number(u.user_id), name);
    }
  }

  for (const r of reads) {
    const cid = Number(r.comment_id);
    const uid = Number(r.user_id);
    const list = map.get(cid) || [];
    list.push({
      user_id: uid,
      user_name: nameById.get(uid) || 'Сотрудник',
      read_at: r.read_at,
    });
    map.set(cid, list);
  }

  return map;
}

// GET ?orderId= — список комментариев заявки (+ is_read + read_by)
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, COMMENT_ROLES);
  if (auth.error) return auth.error;

  const orderId = request.nextUrl.searchParams.get('orderId');
  if (!orderId) {
    return NextResponse.json({ error: 'orderId required' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('order_comments')
    .select('id, order_id, user_id, user_name, user_role, body, created_at, is_deleted')
    .eq('order_id', parseInt(orderId, 10))
    .eq('is_deleted', false)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (error) {
    console.error('order-comments GET:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const comments = data || [];
  const ids = comments.map((c) => Number(c.id));
  const readersMap = await loadReadersByCommentIds(ids);

  const readSet = new Set<number>();
  for (const [cid, list] of readersMap) {
    if (list.some((r) => r.user_id === auth.user.user_id)) readSet.add(cid);
  }

  const enriched = comments.map((c) => ({
    ...c,
    is_read: Number(c.user_id) === auth.user.user_id || readSet.has(Number(c.id)),
    read_by: readersMap.get(Number(c.id)) || [],
  }));

  return NextResponse.json({ success: true, data: enriched });
}

// POST — добавить комментарий
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, COMMENT_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const orderId = Number(body.order_id);
    const text = String(body.body || '').trim();

    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ success: false, message: 'order_id обязателен' }, { status: 400 });
    }
    if (!text) {
      return NextResponse.json({ success: false, message: 'Текст комментария пуст' }, { status: 400 });
    }
    if (text.length > 4000) {
      return NextResponse.json({ success: false, message: 'Комментарий слишком длинный' }, { status: 400 });
    }

    const userName =
      String(body.user_name || '').trim() ||
      auth.user.full_name ||
      'Сотрудник';
    const userRole = String(body.user_role || auth.user.role || '').trim() || null;

    const { data, error } = await supabase
      .from('order_comments')
      .insert([{
        order_id: orderId,
        user_id: auth.user.user_id,
        user_name: userName,
        user_role: userRole,
        body: text,
      }])
      .select()
      .single();

    if (error) throw error;

    const readAt = new Date().toISOString();
    await supabase.from('order_comment_reads').upsert({
      comment_id: data.id,
      user_id: auth.user.user_id,
      read_at: readAt,
    });

    const preview = text.length > 120 ? `${text.slice(0, 117)}…` : text;
    const title = `Комментарий к заявке #${orderId}`;
    const notifBody = `от: ${userName} — ${preview}`;

    void notifyManagers({
      type: 'order_comment',
      title,
      body: notifBody,
      entityId: orderId,
      orderId,
      priority: 'medium',
      mobile: false,
      admin: true,
    });

    void supabase.from('mobile_notifications').insert({
      type: 'order_comment',
      title,
      body: notifBody,
      entity_id: orderId,
      field_name: 'author_user_id',
      old_value: null,
      new_value: String(auth.user.user_id),
    });

    const authorReader: CommentReader = {
      user_id: auth.user.user_id,
      user_name: userName,
      read_at: readAt,
    };

    return NextResponse.json({
      success: true,
      data: { ...data, is_read: true, read_by: [authorReader] },
    });
  } catch (error: any) {
    console.error('order-comments POST:', error);
    return NextResponse.json({
      success: false,
      message: error.message || 'Не удалось добавить комментарий',
    }, { status: 500 });
  }
}
