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
    const all = searchParams.get('all'); // Новый параметр: если true — возвращаем всех (включая стафф)

    // ==================== 1. ЗАГРУЗКА ОДНОГО КЛИЕНТА ====================
    if (userId) {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) throw error;
      return NextResponse.json(data);
    }

    // ==================== 2. ЗАГРУЗКА ВСЕХ ЗАПИСЕЙ ====================
    let query = supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    // Если ?all=true — возвращаем всех пользователей (клиенты + стафф)
    if (all === 'true') {
     // console.log('📋 [Clients API] Возвращаем ВСЕХ пользователей (all=true)');
    } else {
      // По умолчанию — только клиенты (как было раньше)
      query = query.eq('role', 'client');
    //  console.log('📋 [Clients API] Возвращаем только клиентов (role = client)');
    }

    const { data: usersRaw, error } = await query;

    if (error) throw error;

    const users = usersRaw || [];

    // ==================== 3. ОБОГАЩЕНИЕ КЛИЕНТОВ (объёмы, прогноз, статус) ====================
    const enrichedUsers = await Promise.all(
      users.map(async (user: any) => {
        // Если это стафф — возвращаем как есть, без обогащения
        if (['admin', 'manager', 'dispatcher', 'operator'].includes((user.role || '').toLowerCase())) {
          return { 
            ...user, 
            isStaff: true,
            total_volume: 0, 
            total_orders: 0 
          };
        }

        // ==================== Для клиентов — полное обогащение ====================
        if (!user?.user_id) {
          return { 
            ...user, 
            total_volume: 0, 
            total_orders: 0, 
            predicted_next_order: null, 
            client_status: 'cold' 
          };
        }

        const { data: orders } = await supabase
          .from('orders')
          .select('volume, delivery_date, created_at')
          .eq('user_id', user.user_id);

        const total_volume = orders 
          ? orders.reduce((sum: number, o: any) => sum + Number(o.volume || 0), 0) 
          : 0;

        const total_orders = orders ? orders.length : 0;

        // Прогноз следующего заказа
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

        // Автоматический статус
        let client_status = 'cold';
        if (total_orders >= 1) {
          const lastOrderDate = orders && orders.length > 0 
            ? new Date(Math.max(...orders.map((o: any) => new Date(o.delivery_date || o.created_at).getTime())))
            : new Date(0);

          const daysSinceLast = (Date.now() - lastOrderDate.getTime()) / (1000 * 3600 * 24);

          if (total_volume >= 30 || total_orders >= 5) {
            client_status = 'hot';
          } else if (total_volume >= 8 || total_orders >= 2) {
            client_status = 'warm';
          }
        }

        return {
          ...user,
          total_volume,
          total_orders,
          predicted_next_order,
          client_status
        };
      })
    );

  //  console.log(`📊 [Clients API] Возвращено записей: ${enrichedUsers.length}`);
    return NextResponse.json(enrichedUsers);
  } catch (error: any) {
    console.error('Clients API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ==================== POST — СОЗДАНИЕ НОВОГО КЛИЕНТА ====================
export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();

    // Генерируем user_id
    const userId = Date.now();

    const newClient = {
      user_id: userId,
      role: 'client',
      phone: payload.phone,
      full_name: payload.full_name || null,
      organization_name: payload.organization_name || null,
      inn: payload.inn || null,
      address: payload.address || null,
      balance: payload.balance || 0,
      referral_code: payload.referral_code || 'R' + Math.random().toString(36).substring(2, 8).toUpperCase(),
      created_by: payload.created_by || null,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('users')
      .insert(newClient)
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Создан новый клиент: ${data.organization_name || data.full_name} | user_id: ${data.user_id} | created_by: ${data.created_by}`);

    return NextResponse.json({ success: true, client: data });

  } catch (error: any) {
    console.error('Create client error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}