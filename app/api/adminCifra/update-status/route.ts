// app/api/adminCifra/update-status/route.ts
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { pruneGhostTripsFromLogisticsPlan } from '@/lib/pruneLogisticsPlanGhosts';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabase = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ADMIN_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const { orderId, status } = await request.json();

    if (!orderId || !status) {
      return NextResponse.json({ error: 'orderId и status обязательны' }, { status: 400 });
    }

    const { data: before } = await supabase
      .from('orders')
      .select('id, status, delivery_date')
      .eq('id', orderId)
      .maybeSingle();

    const { error } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', orderId);

    if (error) {
      console.error('Supabase update error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    try {
      const { maybeAutoFulfillLeadByOrderId } = await import('@/lib/leadShipments');
      await maybeAutoFulfillLeadByOrderId(Number(orderId));
    } catch (e) {
      console.error('maybeAutoFulfillLeadByOrderId after order status:', e);
    }

    if (
      before &&
      (status === 'completed' || status === 'cancelled') &&
      String(before.status) !== String(status)
    ) {
      try {
        await pruneGhostTripsFromLogisticsPlan({
          supabase,
          orderIds: [orderId],
          deliveryDate: before.delivery_date,
          removeAllOrderIds: status === 'cancelled' ? [orderId] : undefined,
          actorName: auth.user.full_name || 'Система',
        });
      } catch (e) {
        console.warn('pruneGhostTrips after update-status:', e);
      }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Update status error:', e);
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}
