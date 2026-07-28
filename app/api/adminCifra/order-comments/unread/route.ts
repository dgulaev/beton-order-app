import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ORDER_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';

/** Лаборант не работает с заявками — только «Лаборатория». */
const COMMENT_ROLES = ORDER_MUTATION_ROLES;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * GET — карта непрочитанных комментариев для текущего пользователя.
 *
 * ?orderIds=1,2,3 — только по этим заявкам (для списка дня/месяца)
 * без параметра — все непрочитанные (лёгкий агрегат)
 *
 * Ответ: { success, counts: { [orderId]: number }, total: number }
 */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, COMMENT_ROLES);
  if (auth.error) return auth.error;

  try {
    const raw = request.nextUrl.searchParams.get('orderIds');
    const orderIds = raw
      ? raw.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0)
      : null;

    let commentsQuery = supabase
      .from('order_comments')
      .select('id, order_id, user_id')
      .eq('is_deleted', false);

    if (orderIds && orderIds.length > 0) {
      commentsQuery = commentsQuery.in('order_id', orderIds);
    } else if (orderIds && orderIds.length === 0) {
      return NextResponse.json({ success: true, counts: {}, total: 0 });
    }

    const { data: comments, error } = await commentsQuery;
    if (error) throw error;

    const list = (comments || []).filter(
      (c) => Number(c.user_id) !== auth.user.user_id
    );
    if (list.length === 0) {
      return NextResponse.json({ success: true, counts: {}, total: 0 });
    }

    const commentIds = list.map((c) => c.id);
    const { data: reads, error: readsError } = await supabase
      .from('order_comment_reads')
      .select('comment_id')
      .eq('user_id', auth.user.user_id)
      .in('comment_id', commentIds);

    if (readsError) throw readsError;

    const readSet = new Set((reads || []).map((r) => Number(r.comment_id)));
    const counts: Record<string, number> = {};
    let total = 0;

    for (const c of list) {
      if (readSet.has(Number(c.id))) continue;
      const key = String(c.order_id);
      counts[key] = (counts[key] || 0) + 1;
      total += 1;
    }

    return NextResponse.json({ success: true, counts, total });
  } catch (error: any) {
    console.error('order-comments/unread GET:', error);
    return NextResponse.json({
      success: false,
      message: error.message,
      counts: {},
      total: 0,
    }, { status: 500 });
  }
}
