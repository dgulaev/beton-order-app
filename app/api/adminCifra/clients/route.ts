// app/api/adminCifra/clients/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (userId) {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('user_id', userId)
        .single();
      if (error) throw error;
      return NextResponse.json(data);
    }

    const { data: clientsRaw, error } = await supabase
      .from('users')
      .select('*')
      .eq('role', 'client')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const clients = clientsRaw || [];

    const clientsWithData = await Promise.all(
      clients.map(async (client: any) => {
        if (!client?.user_id) {
          return { ...client, total_volume: 0, total_orders: 0, predicted_next_order: null, client_status: 'cold' };
        }

        const { data: orders } = await supabase
          .from('orders')
          .select('volume, delivery_date, created_at')
          .eq('user_id', client.user_id);

        const total_volume = orders 
          ? orders.reduce((sum: number, o: any) => sum + Number(o.volume || 0), 0) 
          : 0;

        const total_orders = orders ? orders.length : 0;

        // ==================== ПРОГНОЗ ====================
        let predicted_next_order = null;
        if (orders && orders.length >= 2) {
          const dates = orders
            .map((o: any) => new Date(o.delivery_date || o.created_at))
            .filter(d => d && !isNaN(d.getTime()))
            .sort((a, b) => a.getTime() - b.getTime());

          if (dates.length >= 2) {
            let totalDays = 0;
            for (let i = 1; i < dates.length; i++) {
              totalDays += (dates[i].getTime() - dates[i-1].getTime()) / (1000 * 3600 * 24);
            }
            const avgInterval = totalDays / (dates.length - 1);
            const lastOrder = dates[dates.length - 1];
            const nextDate = new Date(lastOrder.getTime() + avgInterval * 1.2 * 86400000);
            predicted_next_order = nextDate.toISOString();
          }
        }

        // ==================== АВТОМАТИЧЕСКИЙ СТАТУС (МАКСИМАЛЬНО МЯГКИЙ) ====================
        let client_status = 'cold';

        if (total_orders >= 1) {
          const lastOrderDate = orders && orders.length > 0 
            ? new Date(Math.max(...orders.map((o: any) => new Date(o.delivery_date || o.created_at).getTime())))
            : new Date(0);

          const daysSinceLast = (Date.now() - lastOrderDate.getTime()) / (1000 * 3600 * 24);

          console.log(`[Status Debug] Клиент ${client.organization_name || client.full_name} | Заказов: ${total_orders} | Объём: ${total_volume} м³ | Дней с последнего: ${daysSinceLast.toFixed(0)}`);

          if (total_volume >= 30 || total_orders >= 5) {
            client_status = 'hot';
          } else if (total_volume >= 8 || total_orders >= 2) {
            client_status = 'warm';
          } else {
            client_status = 'cold';
          }
        }

        return {
          ...client,
          total_volume,
          total_orders,
          predicted_next_order,
          client_status
        };
      })
    );

    return NextResponse.json(clientsWithData);
  } catch (error: any) {
    console.error('Clients API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}