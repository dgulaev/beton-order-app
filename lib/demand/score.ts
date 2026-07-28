import { CONCRETE_CONFIG } from '@/lib/config/concrete';
import { peekIntegrationSettings } from '@/lib/integrations/settings';
import { extractGrades, extractVolume, normalizeGrade } from './extractFields';

export type DemandScoreInput = {
  title?: string | null;
  body?: string | null;
  region?: string | null;
  volume_m3?: number | null;
  grades?: string[] | null;
  delivery_needed?: boolean | null;
};

export { extractGrades, extractVolume, normalizeGrade } from './extractFields';

/** Регион работы завода (БД → env → дефолт). Перед радаром прогрей getIntegrationSettings(). */
export function getHomeRegions(): string[] {
  const raw = peekIntegrationSettings().demand.homeRegions || 'брянск,брянская';
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function getMinDemandVolume(): number {
  const fromSettings = peekIntegrationSettings().demand.minVolumeM3;
  const n = Number(
    fromSettings != null && Number.isFinite(fromSettings)
      ? fromSettings
      : CONCRETE_CONFIG.limits.minVolume,
  );
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

export function enrichDemandFields(title: string, body?: string | null) {
  const text = `${title} ${body || ''}`;
  return {
    volume_m3: extractVolume(text),
    grades: extractGrades(text),
    delivery_needed: /доставк/i.test(text),
    fit_score: scoreDemandItem({ title, body }),
  };
}
