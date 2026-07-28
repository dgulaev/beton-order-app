import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ORDER_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';

/** Лаборант не работает с заявками — только «Лаборатория». */
const COMMENT_ROLES = ORDER_MUTATION_ROLES;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// POST — пометить все комментарии заявки прочитанными для текущего пользователя
// body: { order_id: number }
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, COMMENT_ROLES);
  if (auth.error) return auth.error;

  try {
    const { order_id } = await request.json();
    const orderId = Number(order_id);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return NextResponse.json({ success: false, message: 'order_id обязателен' }, { status: 400 });
    }

    const { data: comments, error } = await supabase
      .from('order_comments')
      .select('id')
      .eq('order_id', orderId)
      .eq('is_deleted', false);

    if (error) throw error;
    if (!comments || comments.length === 0) {
      return NextResponse.json({ success: true, marked: 0 });
    }

    const now = new Date().toISOString();
    const rows = comments.map((c) => ({
      comment_id: c.id,
      user_id: auth.user.user_id,
      read_at: now,
    }));

    const { error: upsertError } = await supabase
      .from('order_comment_reads')
      .upsert(rows, { onConflict: 'comment_id,user_id' });

    if (upsertError) throw upsertError;

    return NextResponse.json({ success: true, marked: rows.length });
  } catch (error: any) {
    console.error('order-comments/read POST:', error);
    return NextResponse.json({
      success: false,
      message: error.message || 'Не удалось отметить прочитанным',
    }, { status: 500 });
  }
}
