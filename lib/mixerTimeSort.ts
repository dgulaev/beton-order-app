/**
 * Сортировка рейсов одной заявки с учётом перехода через полночь.
 *
 * Время рейса хранится как HH:mm без даты, поэтому наивная сортировка
 * ставит 00:00 раньше 06:50. Для круглосуточной заливки рейс «на следующие
 * сутки» должен оказаться в конце последовательности, а не в начале.
 *
 * Логика старта «логистических суток»:
 * 1) Если есть и дневные/вечерние рейсы (с 12:00), и хвост после полуночи
 *    (до 04:00) — сутки начинаются с самого раннего «дневного» рейса (≥ 04:00).
 * 2) Иначе — наибольший разрыв между соседними временами (включая wrap
 *    через полночь); старт сразу после этого разрыва.
 */

/** Граница «хвоста после полуночи» (рейсы 00:00–03:59). */
const POST_MIDNIGHT_END_MINS = 4 * 60;

export function parseTimeToMinutes(time: string | null | undefined): number {
  const [h, m] = String(time || '00:00')
    .slice(0, 5)
    .split(':')
    .map(Number);
  return ((h || 0) % 24) * 60 + (m || 0);
}

function findLargestGapDayStart(uniqueMins: number[]): number {
  if (uniqueMins.length <= 1) return uniqueMins[0] ?? 0;

  let maxGap = -1;
  let startMins = uniqueMins[0];
  for (let i = 0; i < uniqueMins.length; i++) {
    const cur = uniqueMins[i];
    const next =
      i + 1 < uniqueMins.length ? uniqueMins[i + 1] : uniqueMins[0] + 1440;
    const gap = next - cur;
    if (gap > maxGap) {
      maxGap = gap;
      startMins = next % 1440;
    }
  }
  return startMins;
}

/** Старт «логистических суток» заявки в минутах от полуночи (0..1439). */
export function findLogisticsDayStartMinutes(
  times: Array<string | null | undefined>
): number {
  const minsList = times.map(parseTimeToMinutes);
  const uniqueMins = [...new Set(minsList)].sort((a, b) => a - b);
  if (uniqueMins.length <= 1) return uniqueMins[0] ?? 0;

  const hasPostMidnightTail = uniqueMins.some((m) => m < POST_MIDNIGHT_END_MINS);
  const hasLateDay = uniqueMins.some((m) => m >= 12 * 60);

  // Дневная заливка с рейсом, ушедшим за полночь: не даём 00:00 стать «началом».
  if (hasPostMidnightTail && hasLateDay) {
    const main = uniqueMins.filter((m) => m >= POST_MIDNIGHT_END_MINS);
    if (main.length > 0) return main[0];
  }

  return findLargestGapDayStart(uniqueMins);
}

/** Минуты от старта логистических суток (0..1439) — для порядка и оси. */
export function logisticsOffsetMinutes(
  time: string | null | undefined,
  dayStartMins: number
): number {
  return (parseTimeToMinutes(time) - dayStartMins + 1440) % 1440;
}

type MixerLike = {
  time?: string | null;
  sortOrder?: number | null;
  id?: string | number;
};

export function sortMixersByLogisticsTime<T extends MixerLike>(mixers: T[]): T[] {
  if (mixers.length <= 1) return mixers.slice();

  const dayStart = findLogisticsDayStartMinutes(mixers.map((m) => m.time));

  return mixers
    .map((m, idx) => ({
      m,
      idx,
      key: logisticsOffsetMinutes(m.time, dayStart),
    }))
    .sort((a, b) => {
      if (a.key !== b.key) return a.key - b.key;
      const so = (a.m.sortOrder ?? 0) - (b.m.sortOrder ?? 0);
      if (so !== 0) return so;
      return a.idx - b.idx;
    })
    .map((x) => x.m);
}
