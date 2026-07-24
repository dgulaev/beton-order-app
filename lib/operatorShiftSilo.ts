/**
 * Рабочий силос смены оператора: актуальность по календарному дню МСК
 * (не по TZ сервера — на Vercel это UTC, иначе силос «пропадает» среди ночи).
 */
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

export function moscowDateKey(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function isSameMoscowDay(a: Date, b: Date = new Date()): boolean {
  return moscowDateKey(a) === moscowDateKey(b);
}

/** Силос выбран сегодня по МСК и id ∈ 1..3. */
export function isActiveSiloFresh(
  siloId: unknown,
  setAt: string | null | undefined,
  now: Date = new Date(),
): siloId is 1 | 2 | 3 {
  const id = Number(siloId);
  if (![1, 2, 3].includes(id)) return false;
  if (!setAt) return false;
  const t = new Date(setAt);
  if (Number.isNaN(t.getTime())) return false;
  return isSameMoscowDay(t, now);
}

/**
 * Читает рабочий силос смены. Если метка вчерашняя (МСК) — считает невыбранным
 * (ленивый сброс без обязательного GET).
 */
export async function getFreshActiveSiloId(): Promise<number | null> {
  const { data, error } = await supabase
    .from('operator_shift_settings')
    .select('active_silo_id, active_silo_set_at')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) return null;
  if (!isActiveSiloFresh(data.active_silo_id, data.active_silo_set_at)) return null;
  return Number(data.active_silo_id);
}
