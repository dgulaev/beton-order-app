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
    let search = searchParams.get('search')?.trim() || '';

    const from = (page - 1) * limit;

    console.log(`🚀 [Загрузка] Страница ${page} | Поиск: "${search}"`);

    let query = supabase
      .from('users')
      .select('*')
      .eq('role', 'client')
      .order('created_at', { ascending: false });

    if (search.length > 0) {
      search = search.replace(/,/g, ' ');
      const searchTerm = `%${search}%`;
      query = query.or(
        `full_name.ilike.${searchTerm},organization_name.ilike.${searchTerm},phone.ilike.${searchTerm},inn.ilike.${searchTerm}`
      );
    }

    // Загружаем ВСЕХ подходящих клиентов — группировка должна происходить
    // по всей базе, а не по срезу страницы. Иначе клиенты одной компании
    // (одинаковый ИНН) могут оказаться на разных страницах и не будут
    // сгруппированы; также totalPages будет считаться по числу физических
    // записей, а не по числу групп.
    const { data: clients, error } = await query;

    if (error) throw error;

    const createdByIds = [...new Set(clients?.map((c: any) => c.created_by).filter(Boolean) || [])];
    const clientUserIds = [...new Set(clients?.map((c: any) => c.user_id).filter(Boolean) || [])];

    const [curatorsRes, ordersRes] = await Promise.all([
      createdByIds.length > 0
        ? supabase.from('users').select('user_id, full_name').in('user_id', createdByIds)
        : Promise.resolve({ data: [] as any[] }),
      clientUserIds.length > 0
        ? supabase.from('orders').select('user_id, volume').in('user_id', clientUserIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const curatorsMap = new Map();
    curatorsRes.data?.forEach((c: any) => curatorsMap.set(c.user_id, c.full_name));

    const ordersByUser = new Map<number, { volume: number; count: number }>();
    ordersRes.data?.forEach((o: any) => {
      const entry = ordersByUser.get(o.user_id) || { volume: 0, count: 0 };
      entry.volume += Number(o.volume || 0);
      entry.count += 1;
      ordersByUser.set(o.user_id, entry);
    });

    const grouped = new Map();

    for (const client of clients || []) {
      const key = client.inn
        ? `${client.inn}_${(client.organization_name || '').toLowerCase().replace(/[^a-zа-я0-9]/g, '')}`
        : `no-inn_${client.user_id}`;

      if (!grouped.has(key)) {
        const curatorName = curatorsMap.get(client.created_by) || null;

        grouped.set(key, {
          groupId: key,
          inn: client.inn,
          organization_name: client.organization_name,
          full_name: client.full_name || client.organization_name,
          phones: [],
          total_volume: 0,
          total_orders: 0,
          last_contact: client.last_contact,
          next_contact: client.next_contact,
          predicted_next_order: client.predicted_next_order,
          created_by: client.created_by,
          curator_name: curatorName,
          clients: [],
        });
      }

      const group = grouped.get(key)!;

      if (client.phone) group.phones.push(client.phone);

      const orderAgg = client.user_id ? ordersByUser.get(client.user_id) : undefined;
      if (orderAgg) {
        group.total_volume += orderAgg.volume;
        group.total_orders += orderAgg.count;
      }

      group.clients.push({
        ...client,
        curator_name: curatorsMap.get(client.created_by) || null,
      });
    }

    // Пагинируем группы, а не индивидуальных клиентов
    const allGroups = Array.from(grouped.values());
    const totalGroups = allGroups.length;
    const paginatedGroups = allGroups.slice(from, from + limit);

    console.log(`✅ Всего групп: ${totalGroups}, страница ${page}: ${paginatedGroups.length} групп`);

    return NextResponse.json({
      clients: paginatedGroups,
      totalPages: Math.ceil(totalGroups / limit),
      total: totalGroups,
      currentPage: page,
    });

  } catch (error: any) {
    console.error('Grouped clients API error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
