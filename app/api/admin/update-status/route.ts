// app/api/admin/update-status/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ADMIN_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const { orderId, status } = body;

    const numericId = Number(orderId);
    if (!Number.isFinite(numericId) || !status) {
      return NextResponse.json(
        { success: false, message: 'orderId и status обязательны' },
        { status: 400 },
      );
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('referred_by, volume, status, id')
      .eq('id', numericId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ success: false, message: 'Заказ не найден' }, { status: 404 });
    }

    const bonusPoints = order.volume ? Math.round(Number(order.volume) * 100) : 0;

    if (order.status === 'completed' || order.status === 'cancelled') {
      return NextResponse.json(
        { success: false, message: `Статус "${order.status}" финальный.` },
        { status: 400 },
      );
    }

    const { error: updateError } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', numericId);

    if (updateError) {
      console.error('Ошибка обновления статуса:', updateError);
      throw updateError;
    }

    if (order.referred_by) {
      const newTransactionStatus = status === 'completed' ? 'completed' : 'cancelled';
      const { error: txError } = await supabase
        .from('referral_transactions')
        .update({
          status: newTransactionStatus,
          processed_at: new Date().toISOString(),
        })
        .eq('order_id', numericId)
        .eq('referrer_id', order.referred_by);

      if (txError) {
        console.error('Не удалось обновить referral_transactions:', txError);
      }
    }

    if (order.referred_by && bonusPoints > 0 && status === 'completed') {
      const { error: incError } = await supabase.rpc('increment_balance', {
        user_id: order.referred_by,
        points: bonusPoints,
      });
      if (incError) console.error('Ошибка increment_balance:', incError);
    } else if (order.referred_by && status === 'cancelled') {
      await supabase
        .from('referral_transactions')
        .update({ status: 'cancelled' })
        .eq('order_id', numericId)
        .eq('referrer_id', order.referred_by);
    }

    try {
      const { maybeAutoFulfillLeadByOrderId } = await import('@/lib/leadShipments');
      await maybeAutoFulfillLeadByOrderId(numericId);
    } catch (e) {
      console.error('maybeAutoFulfillLeadByOrderId:', e);
    }

    return NextResponse.json({ success: true, message: 'Статус обновлён' });
  } catch (error: any) {
    console.error('Критическая ошибка update-status:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
