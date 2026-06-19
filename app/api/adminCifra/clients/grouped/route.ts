// app/api/adminCifra/clients/grouped/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '18');
    const search = searchParams.get('search')?.trim();

    const from = (page - 1) * limit;
    const to = from + limit - 1;

    console.log(`🚀 Запрос grouped clients... Страница ${page}, limit ${limit}, search: "${search}"`);

    let query = supabase
      .from('users')
      .select('*', { count: 'exact' })
      .eq('role', 'client')
      .order('created_at', { ascending: false });

    // Применяем поиск
    if (search) {
      query = query.or(`full_name.ilike.%${search}%,organization_name.ilike.%${search}%,phone.ilike.%${search}%,inn.ilike.%${search}%`);
    }

    const { data: clients, error, count } = await query.range(from, to);

    if (error) throw error;

    const grouped = new Map();

    for (const client of clients || []) {
      const key = client.inn 
        ? `${client.inn}_${(client.organization_name || '').toLowerCase().replace(/[^a-zа-я0-9]/g, '')}`
        : `no-inn_${client.user_id}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          groupId: key,
          inn: client.inn,
          organization_name: client.organization_name,
          full_name: client.full_name,
          phones: [],
          total_volume: 0,
          total_orders: 0,
          last_contact: client.last_contact,
          next_contact: client.next_contact,
          predicted_next_order: client.predicted_next_order,
          clients: []
        });
      }

      const group = grouped.get(key);

      if (client.phone) group.phones.push(client.phone);

      if (client.user_id) {
        const { data: orders } = await supabase
          .from('orders')
          .select('volume')
          .eq('user_id', client.user_id);

        if (orders) {
          const vol = orders.reduce((sum: number, o: any) => sum + Number(o.volume || 0), 0);
          group.total_volume += vol;
          group.total_orders += orders.length;
        }
      }

      group.clients.push(client);
    }

    const result = Array.from(grouped.values());

    console.log(`✅ Сформировано ${result.length} групп (страница ${page}). Всего: ${count}`);

    return NextResponse.json({
      clients: result,
      totalPages: Math.ceil((count || 0) / limit),
      total: count || 0,
      currentPage: page
    });

  } catch (error: any) {
    console.error('Grouped clients API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}