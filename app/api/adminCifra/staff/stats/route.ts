import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceKey) throw new Error('SUPABASE credentials not set');
  return createClient(supabaseUrl, supabaseServiceKey);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseClient();
    const { searchParams } = new URL(request.url);
    const staffId = searchParams.get('staffId');

    console.log("📥 Запрос staff stats, staffId =", staffId);

    if (staffId) {
      console.log(`[API] Запрос для staffId: ${staffId}`);

      const { data: staff } = await supabase
        .from('users')
        .select('user_id, full_name, phone, role')
        .eq('user_id', staffId)
        .single();

      if (!staff) return NextResponse.json({ error: 'Не найден' }, { status: 404 });

      const { data: clientsRaw } = await supabase
        .from('users')
        .select('user_id, full_name, organization_name, phone, created_at')
        .eq('curator_id', staffId)
        .eq('role', 'client')
        .order('organization_name', { ascending: true })
        .order('user_id');

      console.log(`[API] Найдено записей: ${clientsRaw?.length || 0}`);

      const clientMap = new Map();

      let newClients30d = 0;

      if (clientsRaw && clientsRaw.length > 0) {
        const clientIds = [...new Set(clientsRaw.map((c: any) => c.user_id))];

        const { data: orders } = await supabase
          .from('orders')
          .select('user_id, volume, created_at')
          .in('user_id', clientIds);

        const volumeMap = new Map();
        const orderCountMap = new Map();

        orders?.forEach((o: any) => {
          const uid = o.user_id;
          const currentVol = volumeMap.get(uid) || 0;
          volumeMap.set(uid, currentVol + parseFloat(o.volume || 0));

          const currentCount = orderCountMap.get(uid) || 0;
          orderCountMap.set(uid, currentCount + 1);
        });

        // Новые клиенты за 30 дней
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        clientsRaw.forEach((c: any) => {
          const createdAt = new Date(c.created_at);
          if (createdAt >= thirtyDaysAgo) newClients30d++;

          const key = `${c.organization_name || c.full_name}-${c.phone}`;
          if (!clientMap.has(key)) {
            const orderCount = orderCountMap.get(c.user_id) || 0;
            clientMap.set(key, {
              ...c,
              total_volume: Math.round(volumeMap.get(c.user_id) || 0),
              order_count: orderCount
            });
          }
        });
      }

      const finalClients = Array.from(clientMap.values());

      // Расчёт повторных заказов
      let totalOrders = 0;
      let repeatOrders = 0;

      finalClients.forEach(client => {
        const orders = client.order_count || 0;
        totalOrders += orders;
        if (orders > 1) repeatOrders += (orders - 1);
      });

      const repeatPercent = totalOrders > 0 
        ? Math.round((repeatOrders / totalOrders) * 100) 
        : 0;

      console.log(`[API] Финальных уникальных клиентов: ${finalClients.length}`);

      return NextResponse.json({
        ...staff,
        clients_count: finalClients.length,
        total_volume: finalClients.reduce((sum, c) => sum + (c.total_volume || 0), 0),
        clients: finalClients,
        
        // Динамические метрики
        new_clients_30d: newClients30d,
        repeat_order_percent: repeatPercent,
        attracted_clients: finalClients.length
      });
    }

    // === СПИСОК ВСЕХ СОТРУДНИКОВ ===
    const { data: staffList } = await supabase
      .from('users')
      .select('user_id, full_name, phone, role')
      .in('role', ['admin', 'manager', 'dispatcher', 'operator', 'guest'])
      .order('full_name', { ascending: true });

    if (!staffList) return NextResponse.json([]);

    const enrichedStaff = await Promise.all(
      staffList.map(async (staff: any) => {
        const { data: clientsRaw } = await supabase
          .from('users')
          .select('user_id')
          .eq('curator_id', staff.user_id)
          .eq('role', 'client');

        const clientIds = clientsRaw?.map((c: any) => c.user_id) || [];
        let totalVolume = 0;
        if (clientIds.length > 0) {
          const { data: orders } = await supabase
            .from('orders')
            .select('volume')
            .in('user_id', clientIds);
          totalVolume = orders?.reduce((sum: number, o: any) => sum + parseFloat(o.volume || 0), 0) || 0;
        }

        return {
          user_id: staff.user_id,
          full_name: staff.full_name || 'Без имени',
          phone: staff.phone,
          role: staff.role,
          clients_count: clientsRaw?.length || 0,
          total_volume: Math.round(totalVolume)
        };
      })
    );

    

    return NextResponse.json(enrichedStaff);

  } catch (error: any) {
    console.error('Staff stats error:', error);
    return NextResponse.json([], { status: 500 });
  }
}