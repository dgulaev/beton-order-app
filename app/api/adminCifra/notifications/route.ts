import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  try {
    const type = request.nextUrl.searchParams.get('type');
    const unreadOnly = request.nextUrl.searchParams.get('unread') === 'true';
    const mine = request.nextUrl.searchParams.get('mine') === 'true';

    let query = supabase
      .from('admin_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (type) query = query.eq('type', type);
    if (unreadOnly) query = query.eq('is_read', false);
    if (mine) query = query.eq('user_id', auth.user.user_id);

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json({
      success: true,
      notifications: data || [],
    });
  } catch (error: any) {
    console.error('Notifications API error:', error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 },
    );
  }
}

/** Пометить свои уведомления прочитанными (one-shot сброс эпизода для этого админа). */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  try {
    const body = await request.json().catch(() => ({}));
    const idsRaw: unknown[] = Array.isArray(body?.ids)
      ? body.ids
      : body?.id != null
        ? [body.id]
        : [];
    const ids = idsRaw
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0);

    if (ids.length === 0) {
      return NextResponse.json({ error: 'Укажи id уведомления' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('admin_notifications')
      .update({ is_read: true })
      .in('id', ids)
      .eq('user_id', auth.user.user_id)
      .select('id');
    if (error) throw error;

    return NextResponse.json({
      success: true,
      acked: (data || []).map((r) => Number(r.id)),
    });
  } catch (error: any) {
    console.error('Notifications ack error:', error);
    return NextResponse.json(
      { success: false, message: error.message },
      { status: 500 },
    );
  }
}
