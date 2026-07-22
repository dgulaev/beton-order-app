// app/api/adminCifra/clients/grouped/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminCifraStaff(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '18', 10) || 18));
    let search = searchParams.get('search')?.trim() || '';
    const clientType = (searchParams.get('clientType') || 'all').toLowerCase();

    const from = (page - 1) * limit;

    console.log(`🚀 [Загрузка] Страница ${page} | Поиск: "${search}" | Тип: ${clientType}`);

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

    const curatorIds = [
      ...new Set(
        (clients || [])
          .map((c: any) => c.curator_id || c.created_by)
          .filter(Boolean)
      ),
    ];
    const clientUserIds = [...new Set(clients?.map((c: any) => c.user_id).filter(Boolean) || [])];

    const [curatorsRes, ordersRes] = await Promise.all([
      curatorIds.length > 0
        ? supabase.from('users').select('user_id, full_name').in('user_id', curatorIds)
        : Promise.resolve({ data: [] as any[] }),
      clientUserIds.length > 0
        ? supabase
            .from('orders')
            .select('user_id, volume, delivery_date, created_at')
            .in('user_id', clientUserIds)
            .neq('status', 'cancelled')
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const curatorsMap = new Map();
    curatorsRes.data?.forEach((c: any) => curatorsMap.set(c.user_id, c.full_name));

    // По user_id: сумма/кол-во + последняя заявка (по дате доставки, иначе created_at)
    const ordersByUser = new Map<
      number,
      { volume: number; count: number; lastVolume: number; lastAt: number }
    >();
    ordersRes.data?.forEach((o: any) => {
      const uid = o.user_id;
      const vol = Number(o.volume || 0);
      const at = new Date(o.delivery_date || o.created_at || 0).getTime() || 0;
      const entry = ordersByUser.get(uid) || {
        volume: 0,
        count: 0,
        lastVolume: 0,
        lastAt: -1,
      };
      entry.volume += vol;
      entry.count += 1;
      if (at >= entry.lastAt) {
        entry.lastAt = at;
        entry.lastVolume = vol;
      }
      ordersByUser.set(uid, entry);
    });

    const grouped = new Map();

    for (const client of clients || []) {
      const key = client.inn
        ? `${client.inn}_${(client.organization_name || '').toLowerCase().replace(/[^a-zа-я0-9]/g, '')}`
        : `no-inn_${client.user_id}`;

      const curatorKey = client.curator_id || client.created_by;
      const curatorName = curatorsMap.get(curatorKey) || null;

      if (!grouped.has(key)) {
        grouped.set(key, {
          groupId: key,
          inn: client.inn,
          organization_name: client.organization_name,
          full_name: client.full_name || client.organization_name,
          phones: [],
          total_volume: 0,
          total_orders: 0,
          avg_volume: 0,
          last_volume: 0,
          last_order_at: -1,
          last_contact: client.last_contact,
          predicted_next_order: client.predicted_next_order,
          created_by: client.created_by,
          curator_id: curatorKey || null,
          curator_name: curatorName,
          clients: [],
        });
      }

      const group = grouped.get(key)!;

      if (client.phone) group.phones.push(client.phone);

      // Куратор: берём первого непустого среди контактов группы
      if (!group.curator_name && curatorName) {
        group.curator_name = curatorName;
        group.curator_id = curatorKey || null;
      }

      const orderAgg = client.user_id ? ordersByUser.get(client.user_id) : undefined;
      if (orderAgg) {
        group.total_volume += orderAgg.volume;
        group.total_orders += orderAgg.count;
        if (orderAgg.lastAt >= group.last_order_at) {
          group.last_order_at = orderAgg.lastAt;
          group.last_volume = orderAgg.lastVolume;
        }
      }

      group.clients.push({
        ...client,
        curator_name: curatorName,
      });
    }

    // Средний объём по группе
    for (const group of grouped.values()) {
      group.avg_volume =
        group.total_orders > 0
          ? Math.round((group.total_volume / group.total_orders) * 10) / 10
          : 0;
      delete group.last_order_at;
    }

    // Фильтр физ/юр: юрлицо — есть организация или ИНН, иначе физлицо
    let allGroups = Array.from(grouped.values());
    if (clientType === 'legal') {
      allGroups = allGroups.filter(
        (g: any) => !!(g.organization_name || g.inn)
      );
    } else if (clientType === 'physical') {
      allGroups = allGroups.filter(
        (g: any) => !(g.organization_name || g.inn)
      );
    }

    // Пагинируем группы, а не индивидуальных клиентов
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
