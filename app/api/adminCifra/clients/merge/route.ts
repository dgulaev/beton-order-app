import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { ADMIN_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminCifraStaff(request, ADMIN_MUTATION_ROLES);
    if (auth.error) return auth.error;

    const { sourceUserId, targetUserId } = await request.json();
    const sourceId = Number(sourceUserId);
    const targetId = Number(targetUserId);

    if (
      !Number.isFinite(sourceId) ||
      !Number.isFinite(targetId) ||
      sourceId === targetId
    ) {
      return NextResponse.json({ error: 'Неверные ID клиентов' }, { status: 400 });
    }

    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('user_id, role, inn')
      .in('user_id', [sourceId, targetId]);

    if (usersError) {
      return NextResponse.json({ error: usersError.message }, { status: 500 });
    }

    const source = users?.find((u) => u.user_id === sourceId);
    const target = users?.find((u) => u.user_id === targetId);

    if (!source || !target) {
      return NextResponse.json({ error: 'Один из клиентов не найден' }, { status: 404 });
    }
    if (source.role !== 'client' || target.role !== 'client') {
      return NextResponse.json({ error: 'Объединять можно только клиентов' }, { status: 400 });
    }
    if (source.inn && target.inn && source.inn.trim() !== target.inn.trim()) {
      return NextResponse.json(
        { error: 'ИНН клиентов не совпадают — объединение отменено' },
        { status: 400 }
      );
    }

    // 1. Заказы
    const { error: ordersError } = await supabase
      .from('orders')
      .update({ user_id: targetId })
      .eq('user_id', sourceId);

    if (ordersError) {
      return NextResponse.json({ error: ordersError.message }, { status: 500 });
    }

    // 2. История звонков (FK client_calls_client_id_fkey — иначе delete users падает)
    const { error: callsError } = await supabase
      .from('client_calls')
      .update({ client_id: targetId })
      .eq('client_id', sourceId);

    if (callsError) {
      return NextResponse.json({ error: callsError.message }, { status: 500 });
    }

    // 3. Удаляем исходную запись клиента
    const { error: deleteError } = await supabase
      .from('users')
      .delete()
      .eq('user_id', sourceId)
      .eq('role', 'client');

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: `Клиент ${sourceId} объединён с ${targetId}`,
    });
  } catch (error: any) {
    console.error('Merge error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
