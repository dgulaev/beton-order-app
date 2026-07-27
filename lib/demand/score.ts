import { CONCRETE_CONFIG } from '@/lib/config/concrete';

export type DemandScoreInput = {
  title?: string | null;
  body?: string | null;
  region?: string | null;
  volume_m3?: number | null;
  grades?: string[] | null;
  delivery_needed?: boolean | null;
};

/** Регион работы завода (можно переопределить env). */
export function getHomeRegions(): string[] {
  const raw = process.env.DEMAND_HOME_REGIONS || 'брянск,брянская';
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function getMinDemandVolume(): number {
  const n = Number(process.env.DEMAND_MIN_VOLUME_M3 || CONCRETE_CONFIG.limits.minVolume);
  return Number.isFinite(n) ? n : 0.5;
}

/**
 * fit_score 0–100: насколько запрос подходит заводу.
 * Правила: регион, объём, марка из прайса, ключевые слова бетона, срочность.
 */
export function scoreDemandItem(item: DemandScoreInput): number {
  const text = `${item.title || ''} ${item.body || ''}`.toLowerCase();
  let score = 10;

  if (/(бетон|раствор|бст|товарн)/i.test(text)) score += 25;

  const home = getHomeRegions();
  const region = (item.region || '').toLowerCase();
  if (region && home.some((h) => region.includes(h) || text.includes(h))) {
    score += 25;
  } else if (region) {
    score += 5;
  }

  const volume = item.volume_m3 ?? extractVolume(text);
  const minVol = getMinDemandVolume();
  if (volume != null) {
    if (volume >= minVol && volume <= CONCRETE_CONFIG.limits.maxVolume) score += 20;
    else if (volume > CONCRETE_CONFIG.limits.maxVolume) score += 8;
    else score += 5;
  }

  const grades = item.grades?.length ? item.grades : extractGrades(text);
  const priceKeys = Object.keys(CONCRETE_CONFIG.prices);
  if (grades.some((g) => priceKeys.includes(normalizeGrade(g)))) score += 15;

  if (item.delivery_needed || /доставк/i.test(text)) score += 5;
  if (/срочн|сегодня|завтра/i.test(text)) score += 5;

  return Math.min(100, score);
}

export function extractVolume(text: string): number | null {
  const m = text.match(/(\d+[.,]?\d*)\s*(м3|м³|куб|м\^3)/i);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

export function extractGrades(text: string): string[] {
  const found = new Set<string>();
  const re = /\b(М\s*\d{2,3}|M\s*\d{2,3}|В\s*\d{1,2}(?:[.,]\d)?)\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    found.add(normalizeGrade(m[1]));
  }
  return Array.from(found);
}

function normalizeGrade(g: string): string {
  return g.replace(/\s+/g, '').toUpperCase().replace(/^M/, 'М');
}

export function enrichDemandFields(title: string, body?: string | null) {
  const text = `${title} ${body || ''}`;
  return {
    volume_m3: extractVolume(text),
    grades: extractGrades(text),
    delivery_needed: /доставк/i.test(text),
    fit_score: scoreDemandItem({ title, body }),
  };
}
