/**
 * Участки/дома садовых обществ Брянска (ginfo.ru).
 * Данные: lib/data/bryanskGardenPlots.json
 * Обновить: node scripts/scrape-bryansk-garden-plots.mjs
 */

import plotsData from '@/lib/data/bryanskGardenPlots.json';

export type GardenPlotCoords = { lat: number; lon: number };

type GardenSocietyPlots = {
  name: string;
  nameKey: string;
  slug: string;
  plots: Record<string, GardenPlotCoords>;
};

type GardenPlotsFile = {
  source: string;
  updatedAt: string;
  societyCount: number;
  plotCount: number;
  societies: Record<string, GardenSocietyPlots>;
};

const DATA = plotsData as GardenPlotsFile;

function foldYo(value: string): string {
  return value.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
}

/** Ключ участка: «86/1», «86а», «12» → нормализованная строка. */
export function normalizeGardenPlotKey(raw: string): string {
  return foldYo(String(raw || ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/\\/g, '/')
    .replace(/-/g, '/');
}

/**
 * Достаёт номер участка из адреса заявки.
 * «участок 86/1», «уч. 86», «дом 12», «… Фрунзе, 86/1».
 */
export function extractGardenPlotKey(address: string): string | null {
  const t = foldYo(String(address || '').toLowerCase());
  if (!t) return null;

  const plotToken = String.raw`([0-9]+(?:\s*[\/\\-]\s*[0-9а-яa-z]+)?|[0-9]+[а-яa-z]?)`;

  const marked = t.match(
    new RegExp(
      String.raw`(?:участок|уч\.?|сотк[аи]|№)\s*${plotToken}(?=$|[\s,.;])`,
      'i',
    ),
  );
  if (marked?.[1]) return normalizeGardenPlotKey(marked[1]);

  // «дом 86» — только с явным «дом»/«д.» (не путать с «д. Заречная»)
  const house = t.match(
    new RegExp(String.raw`(?:^|[\s,])дом\s*${plotToken}(?=$|[\s,.;])`, 'i'),
  );
  if (house?.[1]) return normalizeGardenPlotKey(house[1]);

  // Хвост: «… Фрунзе, 86/1» / «… Фрунзе 86»
  const tail = t.match(
    new RegExp(String.raw`(?:,\s*|\s+)${plotToken}\s*$`, 'i'),
  );
  if (tail?.[1]) return normalizeGardenPlotKey(tail[1]);

  return null;
}

/** Кандидаты для поиска: 86/1 → 86/1, 86; 86а → 86а, 86. */
export function gardenPlotKeyCandidates(plotKey: string): string[] {
  const k = normalizeGardenPlotKey(plotKey);
  if (!k) return [];
  const out: string[] = [k];

  const slash = k.match(/^(\d+)\/(.+)$/);
  if (slash) {
    out.push(slash[1]);
    // 86/1а → ещё 86/1 без буквы в хвосте
    const sub = slash[2].match(/^(\d+)([а-яa-z]+)$/);
    if (sub) out.push(`${slash[1]}/${sub[1]}`);
  }

  const letter = k.match(/^(\d+)([а-яa-z]+)$/);
  if (letter) out.push(letter[1]);

  return [...new Set(out)];
}

export function getGardenSocietyPlots(
  societyId: string,
): GardenSocietyPlots | null {
  return DATA.societies[societyId] || null;
}

export type ResolvedGardenPlot = GardenPlotCoords & {
  /** Какой ключ из справочника сработал (может быть «86» при запросе «86/1»). */
  matchedKey: string;
  /** Запрошенный ключ (если был). */
  requestedKey: string | null;
  exact: boolean;
};

/**
 * Координаты участка в СО. Fallback: 86/1 → 86 → null (тогда центр СО).
 */
export function resolveGardenPlotCoords(
  societyId: string,
  plotKey: string | null | undefined,
): ResolvedGardenPlot | null {
  const society = getGardenSocietyPlots(societyId);
  if (!society) return null;
  if (!plotKey) return null;

  const requested = normalizeGardenPlotKey(plotKey);
  for (const cand of gardenPlotKeyCandidates(requested)) {
    const hit = society.plots[cand];
    if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lon)) {
      return {
        lat: hit.lat,
        lon: hit.lon,
        matchedKey: cand,
        requestedKey: requested,
        exact: cand === requested,
      };
    }
  }
  return null;
}

export function gardenPlotsStats(): {
  societyCount: number;
  plotCount: number;
  updatedAt: string;
} {
  return {
    societyCount: DATA.societyCount,
    plotCount: DATA.plotCount,
    updatedAt: DATA.updatedAt,
  };
}
