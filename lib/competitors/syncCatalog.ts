import { createClient } from '@supabase/supabase-js';
import {
  BRYANSK_COMPETITORS,
  COMPETITORS_DEACTIVATE_NAMES,
} from '@/lib/competitorsCatalog';
import { runAllCompetitorParsers, type ParseResult } from '@/lib/competitors/parsePrices';

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export type SyncCatalogResult = {
  competitorsUpserted: number;
  loadingPointsUpserted: number;
  parseResults: ParseResult[];
  pricesInserted: number;
  errors: string[];
};

async function findCompetitorId(
  supabase: ReturnType<typeof supabaseAdmin>,
  c: (typeof BRYANSK_COMPETITORS)[number]
): Promise<number | null> {
  if (c.parser_key) {
    const { data } = await supabase
      .from('competitors')
      .select('id')
      .eq('parser_key', c.parser_key)
      .maybeSingle();
    if (data?.id) return data.id;
  }
  const names = [c.name, c.short_name, ...(c.former_names || [])].filter(Boolean);
  for (const name of names) {
    const { data } = await supabase
      .from('competitors')
      .select('id')
      .ilike('name', name)
      .maybeSingle();
    if (data?.id) return data.id;
    const { data: byShort } = await supabase
      .from('competitors')
      .select('id')
      .ilike('short_name', name)
      .maybeSingle();
    if (byShort?.id) return byShort.id;
  }
  return null;
}

/** Upsert карточек конкурентов + партнёрских точек погрузки + парсинг прайсов. */
export async function syncCompetitorsCatalog(opts?: {
  parsePrices?: boolean;
}): Promise<SyncCatalogResult> {
  const supabase = supabaseAdmin();
  const errors: string[] = [];
  let competitorsUpserted = 0;
  let loadingPointsUpserted = 0;
  let pricesInserted = 0;

  // 1) Карточки конкурентов
  // При update: не трогаем active; не затираем уже заполненные ручные поля —
  // seed дописывает только пустые + всегда обновляет parser_key.
  for (const c of BRYANSK_COMPETITORS) {
    const existingId = await findCompetitorId(supabase, c);

    const seedRow = {
      name: c.name,
      short_name: c.short_name,
      website: c.website,
      phone: c.phone,
      address: c.address,
      lat: c.lat,
      lon: c.lon,
      notes: c.notes,
      parser_key: c.parser_key,
      sort_order: c.sort_order,
      updated_at: new Date().toISOString(),
    };

    if (existingId) {
      const { data: existing } = await supabase
        .from('competitors')
        .select('name, short_name, website, phone, address, lat, lon, notes, sort_order')
        .eq('id', existingId)
        .maybeSingle();

      const patch = {
        parser_key: c.parser_key,
        name: existing?.name || c.name,
        short_name: existing?.short_name || c.short_name,
        website: existing?.website || c.website,
        phone: existing?.phone || c.phone,
        address: existing?.address || c.address,
        lat: existing?.lat != null ? existing.lat : c.lat,
        lon: existing?.lon != null ? existing.lon : c.lon,
        notes: existing?.notes || c.notes,
        sort_order: existing?.sort_order != null ? existing.sort_order : c.sort_order,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase.from('competitors').update(patch).eq('id', existingId);
      if (error) errors.push(`${c.name}: ${error.message}`);
      else competitorsUpserted += 1;
    } else {
      const { error } = await supabase.from('competitors').insert([{ ...seedRow, active: true }]);
      if (error) errors.push(`${c.name}: ${error.message}`);
      else competitorsUpserted += 1;
    }
  }

  // 1b) Закрытые заводы — скрыть из матрицы
  for (const name of COMPETITORS_DEACTIVATE_NAMES) {
    const { error } = await supabase
      .from('competitors')
      .update({ active: false, updated_at: new Date().toISOString() })
      .ilike('name', `%${name}%`);
    if (error) errors.push(`deactivate ${name}: ${error.message}`);
  }

  // 2) Точки погрузки всех заводов-конкурентов (для маршрутов в заявках)
  // active точки = active карточки конкурента (скрытый завод → скрытая точка)
  for (const c of BRYANSK_COMPETITORS) {
    if (!c.asLoadingPoint) continue;
    const competitorId = await findCompetitorId(supabase, c);
    let competitorActive = true;
    if (competitorId) {
      const { data: compRow } = await supabase
        .from('competitors')
        .select('active')
        .eq('id', competitorId)
        .maybeSingle();
      competitorActive = compRow?.active !== false;
    }

    const external_key = `competitor:${c.key}`;
    const seedLp = {
      name: `${c.short_name} (партнёр)`,
      kind: 'concrete' as const,
      ownership: 'partner' as const,
      address: c.address,
      lat: c.lat,
      lon: c.lon,
      is_default: false,
      active: competitorActive,
      notes:
        c.lat != null && c.lon != null
          ? `Точка погрузки партнёра: ${c.name}`
          : `Точка погрузки партнёра: ${c.name}. Координаты уточнить.`,
      external_key,
      updated_at: new Date().toISOString(),
    };
    let existsId: number | null = null;
    const { data: byKey } = await supabase
      .from('loading_points')
      .select('id, name, address, lat, lon, notes, kind')
      .eq('external_key', external_key)
      .maybeSingle();
    if (byKey?.id) existsId = byKey.id;
    else {
      // Если external_key стёрли — ищем только точное seed-имя без ключа
      const { data: byName } = await supabase
        .from('loading_points')
        .select('id, name, address, lat, lon, notes, kind, external_key')
        .eq('ownership', 'partner')
        .eq('name', seedLp.name)
        .is('external_key', null)
        .limit(1)
        .maybeSingle();
      if (byName?.id) existsId = byName.id;
    }

    if (existsId) {
      const { data: existing } = byKey?.id
        ? { data: byKey }
        : await supabase
            .from('loading_points')
            .select('id, name, address, lat, lon, notes, kind')
            .eq('id', existsId)
            .maybeSingle();

      // Не затираем ручные поля; всегда восстанавливаем связь и active по конкуренту
      const patch = {
        external_key,
        ownership: 'partner' as const,
        active: competitorActive,
        name: existing?.name || seedLp.name,
        kind: existing?.kind || seedLp.kind,
        address: existing?.address || seedLp.address,
        lat: existing?.lat != null ? existing.lat : seedLp.lat,
        lon: existing?.lon != null ? existing.lon : seedLp.lon,
        notes: existing?.notes || seedLp.notes,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('loading_points').update(patch).eq('id', existsId);
      if (error) errors.push(`lp ${c.key}: ${error.message}`);
      else loadingPointsUpserted += 1;
    } else {
      const { updated_at: _u, ...ins } = seedLp;
      void _u;
      const { error } = await supabase.from('loading_points').insert([ins]);
      if (error) {
        if (/loading_points/i.test(error.message)) {
          errors.push('Таблица loading_points отсутствует — scripts/loading-points.sql');
          break;
        }
        errors.push(`lp ${c.key}: ${error.message}`);
      } else loadingPointsUpserted += 1;
    }
  }

  // Скрыть точки закрытых заводов
  for (const name of COMPETITORS_DEACTIVATE_NAMES) {
    const { error } = await supabase
      .from('loading_points')
      .update({ active: false, updated_at: new Date().toISOString() })
      .ilike('name', `%${name}%`)
      .eq('ownership', 'partner');
    if (error) errors.push(`lp deactivate ${name}: ${error.message}`);
  }

  // 3) Парсинг прайсов
  let parseResults: ParseResult[] = [];
  if (opts?.parsePrices !== false) {
    parseResults = await runAllCompetitorParsers();

    const { data: comps } = await supabase
      .from('competitors')
      .select('id, parser_key, name');

    const byParser = new Map<string, number>();
    for (const row of comps || []) {
      if (row.parser_key) byParser.set(row.parser_key, row.id);
    }

    for (const pr of parseResults) {
      const competitorId = byParser.get(pr.parser_key);
      if (!competitorId) {
        if (pr.error) errors.push(`${pr.parser_key}: ${pr.error}`);
        continue;
      }
      // Частичный успех multi-url: warning + всё равно пишем найденные строки
      if (pr.error) {
        errors.push(
          pr.rows.length > 0
            ? `${pr.parser_key} (частично): ${pr.error}`
            : `${pr.parser_key}: ${pr.error}`,
        );
        if (pr.rows.length === 0) continue;
      }
      for (const row of pr.rows) {
        const { error } = await supabase.from('competitor_price_snapshots').insert([
          {
            competitor_id: competitorId,
            grade_key: row.grade_key,
            filler: row.filler,
            price: row.price,
            source_url: row.source_url,
            source_kind: 'parser',
            parsed_at: new Date().toISOString(),
          },
        ]);
        if (error) errors.push(`price ${pr.parser_key} ${row.grade_key}: ${error.message}`);
        else pricesInserted += 1;
      }
    }
  }

  return {
    competitorsUpserted,
    loadingPointsUpserted,
    parseResults,
    pricesInserted,
    errors,
  };
}
