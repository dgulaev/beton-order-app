// app/api/adminCifra/clients/grouped/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';

/** Как в calloutService.normalizeOrgKey — без ООО/кавычек, для устойчивого поиска. */
function normalizeOrgKey(name: string | null | undefined): string {
  let s = String(name || '').toLowerCase().replace(/["'«»„“]/g, ' ');
  const opf = [
    'публичное акционерное общество',
    'акционерное общество',
    'общество с ограниченной ответственностью',
    'индивидуальный предприниматель',
    'пао',
    'ооо',
    'зао',
    'оао',
    'ао',
    'ип',
  ];
  for (const w of opf) {
    s = s.replace(new RegExp(`(^|\\s+)${w.replace(/\s+/g, '\\s+')}(?=\\s+|$)`, 'gi'), ' ');
  }
  return s
    .replace(/[^a-zа-яё0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Токены поиска: без ООО/кавычек, порядок слов не важен. */
function clientSearchTokens(raw: string): string[] {
  const normalized = normalizeOrgKey(raw);
  const tokens = normalized.split(/\s+/).filter((t) => t.length >= 2);
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length >= 4) tokens.push(digits);
  return [...new Set(tokens)].slice(0, 8);
}

function groupMatchesSearch(group: any, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const nameHay = normalizeOrgKey(
    [
      group.organization_name,
      group.full_name,
      ...(Array.isArray(group.clients)
        ? group.clients.map((c: any) => `${c.organization_name || ''} ${c.full_name || ''}`)
        : []),
    ].join(' '),
  );
  const phoneDigits = [
    ...(Array.isArray(group.phones) ? group.phones : []),
    ...(Array.isArray(group.clients) ? group.clients.map((c: any) => c.phone) : []),
  ]
    .join(' ')
    .replace(/\D/g, '');
  const inn = String(group.inn || '');

  return tokens.every((t) => {
    if (/^\d+$/.test(t)) {
      return phoneDigits.includes(t) || inn.includes(t) || nameHay.includes(t);
    }
    return nameHay.includes(t);
  });
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAdminCifraStaff(request);
    if (auth.error) return auth.error;

    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '18', 10) || 18));
    const search = (searchParams.get('search') || '').trim().replace(/,/g, ' ');
    const clientType = (searchParams.get('clientType') || 'all').toLowerCase();
    // spam=hide (default) | only | all
    const spamMode = (searchParams.get('spam') || 'hide').toLowerCase();

    const from = (page - 1) * limit;
    const tokens = search.length > 0 ? clientSearchTokens(search) : [];

    console.log(
      `🚀 [Загрузка] Страница ${page} | Поиск: "${search}" | токены: [${tokens.join(', ')}] | Тип: ${clientType} | spam: ${spamMode}`,
    );

    // Поиск — после группировки (нормализация ОПФ/кавычек/порядка слов).
    // Хрупкий PostgREST .or(ilike.… " …) с кавычками ломал выдачу и не находил
    // «ООО " РСФ…"» при карточке «РСФ "…" ООО».
    let query = supabase
      .from('users')
      .select('*')
      .eq('role', 'client')
      .order('created_at', { ascending: false });

    if (spamMode === 'only') query = query.eq('is_spam', true);
    else if (spamMode !== 'all') query = query.eq('is_spam', false);

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
          is_spam: Boolean(client.is_spam),
          clients: [],
        });
      }

      const group = grouped.get(key)!;

      if (client.is_spam) group.is_spam = true;

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

    if (tokens.length > 0) {
      allGroups = allGroups.filter((g: any) => groupMatchesSearch(g, tokens));
    } else if (search.length > 0) {
      // После нормализации токенов не осталось (одна буква / только ООО) —
      // мягкий fallback по нормализованной строке.
      const key = normalizeOrgKey(search);
      if (key) {
        allGroups = allGroups.filter((g: any) =>
          normalizeOrgKey(
            `${g.organization_name || ''} ${g.full_name || ''}`,
          ).includes(key),
        );
      }
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
