/**
 * Русская локаль: склонение числительных и день недели после «на» / «в».
 */

/** 1 заявка, 2 заявки, 5 заявок, 21 заявка… */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n)) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

export function pluralWord(n: number, one: string, few: string, many: string): string {
  return `${n} ${pluralRu(n, one, few, many)}`;
}

/** Кубы бетона (м³ в разговорной форме): 1 куб, 2 куба, 5 кубов. */
export function pluralConcreteCubes(n: number): string {
  return pluralRu(n, 'куб', 'куба', 'кубов');
}

/** Кубики добавок на складе: 1 кубик, 2 кубика, 5 кубиков. */
export function pluralAdditiveCubes(n: number): string {
  return pluralRu(n, 'кубик', 'кубика', 'кубиков');
}

const WEEKDAY_ACCUSATIVE: Record<string, string> = {
  понедельник: 'понедельник',
  вторник: 'вторник',
  среда: 'среду',
  четверг: 'четверг',
  пятница: 'пятницу',
  суббота: 'субботу',
  воскресенье: 'воскресенье',
};

/** День недели: именительный или винительный (после «на» / «в»). */
export function formatRuWeekday(
  date: Date,
  grammaticalCase: 'nominative' | 'accusative' = 'nominative'
): string {
  const raw = date.toLocaleDateString('ru-RU', { weekday: 'long' });
  const key = raw.toLowerCase();
  if (grammaticalCase === 'accusative') {
    return WEEKDAY_ACCUSATIVE[key] || raw;
  }
  return key in WEEKDAY_ACCUSATIVE ? key : raw;
}

/** «суббота, 25 июля» или «субботу, 25 июля» (для «на …»). */
export function formatRuDateWithWeekday(
  date: Date,
  weekdayCase: 'nominative' | 'accusative' = 'nominative'
): string {
  const weekday = formatRuWeekday(date, weekdayCase);
  const dayMonth = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return `${weekday}, ${dayMonth}`;
}
