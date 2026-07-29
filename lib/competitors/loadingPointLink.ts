import type { SupabaseClient } from '@supabase/supabase-js';
import { BRYANSK_COMPETITORS } from '@/lib/competitorsCatalog';

/** Ключи loading_points.external_key для карточки конкурента. */
export function competitorExternalKeys(c: {
  parser_key?: string | null;
  name?: string | null;
  short_name?: string | null;
}): string[] {
  const keys = new Set<string>();
  const seed =
    (c.parser_key
      ? BRYANSK_COMPETITORS.find((s) => s.parser_key === c.parser_key || s.key === c.parser_key)
      : undefined) ||
    BRYANSK_COMPETITORS.find(
      (s) =>
        s.name === c.name ||
        s.short_name === c.short_name ||
        (c.name && s.former_names?.includes(c.name)) ||
        (c.short_name && s.former_names?.includes(c.short_name)),
    );
  if (seed) keys.add(`competitor:${seed.key}`);
  if (c.parser_key) keys.add(`competitor:${c.parser_key}`);
  return Array.from(keys);
}

/** Скрыть / показать партнёрские точки погрузки вместе с конкурентом. */
export async function setCompetitorLoadingPointsActive(
  supabase: SupabaseClient,
  c: { parser_key?: string | null; name?: string | null; short_name?: string | null },
  active: boolean,
): Promise<void> {
  const keys = competitorExternalKeys(c);
  const now = new Date().toISOString();
  if (keys.length > 0) {
    await supabase
      .from('loading_points')
      .update({ active, updated_at: now })
      .in('external_key', keys);
  }

  // Fallback только для точек без external_key и с точным seed-именем
  const short = c.short_name || c.name;
  if (short) {
    const exactName = `${short} (партнёр)`;
    await supabase
      .from('loading_points')
      .update({ active, updated_at: now })
      .eq('ownership', 'partner')
      .eq('name', exactName)
      .is('external_key', null);
  }
}
