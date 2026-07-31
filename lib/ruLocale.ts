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

/**
 * Время для UI: всегда HH:MM.
 * Секунды в логике заявок не используются (только часы/минуты), в БД иногда
 * лежит `17:01:00` из типа time — на экране обрезаем.
 */
export function formatTimeHHMM(time: string | null | undefined): string {
  if (time == null) return '';
  const s = String(time).trim();
  if (!s || s === '—') return s;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return s;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** Кубы бетона (м³ в разговорной форме): 1 куб, 2 куба, 5 кубов. */
export function pluralConcreteCubes(n: number): string {
  return pluralRu(n, 'куб', 'куба', 'кубов');
}

/**
 * Миксер в творительном падеже (после «с»): 1 миксером, 2 миксерами, 5 миксерами.
 */
export function pluralMixersInstrumental(n: number): string {
  return pluralRu(n, 'миксером', 'миксерами', 'миксерами');
}

/**
 * Фраза «С выбранным 1 миксером» / «С выбранными 9 миксерами».
 * Для баннера планирования — чтобы логист не видел «9 миксеров» после «с».
 */
export function withSelectedMixersPhrase(n: number): string {
  const abs = Math.abs(Math.trunc(Number(n) || 0));
  const word = pluralMixersInstrumental(abs);
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  const singular = mod10 === 1 && (mod100 < 10 || mod100 > 20);
  return singular
    ? `С выбранным ${abs} ${word}`
    : `С выбранными ${abs} ${word}`;
}

/** Кубики добавок на складе: 1 кубик, 2 кубика, 5 кубиков. */
export function pluralAdditiveCubes(n: number): string {
  return pluralRu(n, 'кубик', 'кубика', 'кубиков');
}

/** Мужские имена на -а/-я — иначе по окончанию их приняли бы за женские. */
const MASCULINE_A_YA_FIRST_NAMES = new Set([
  'никита',
  'илья',
  'илия',
  'кузьма',
  'фома',
  'савва',
  'данила',
  'гаврила',
  'михаила',
  'лёва',
  'лева',
  'власта',
]);

/** Унисекс-уменьшительные — род берём по фамилии. */
const AMBIGUOUS_FIRST_NAMES = new Set(['саша', 'саня', 'женя', 'валя', 'шура']);

/**
 * Женский род по ФИО (для «создал/создала», «изменил/изменила»).
 * Сначала имя, при сомнении — окончание фамилии.
 */
export function isRussianFeminineName(fullName: string): boolean {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.toLowerCase().replace(/ё/g, 'е'));
  if (parts.length === 0) return false;

  const first = parts[0];
  const last = parts.length > 1 ? parts[parts.length - 1] : '';

  const surnameLooksFeminine = (s: string) => {
    if (!s) return false;
    if (/(ова|ева|ина|ына|ская|цкая|ая)$/.test(s)) return true;
    // Аврина и т.п. — женская фамилия на -а
    if (/а$/.test(s)) return true;
    return false;
  };

  const surnameLooksMasculine = (s: string) => {
    if (!s) return false;
    return /(ов|ев|ин|ын|ский|цкий|ой|ый|ич)$/.test(s);
  };

  if (AMBIGUOUS_FIRST_NAMES.has(first)) {
    if (surnameLooksFeminine(last)) return true;
    if (surnameLooksMasculine(last)) return false;
    return false;
  }

  if (MASCULINE_A_YA_FIRST_NAMES.has(first)) return false;

  if (first === 'любовь') return true;
  if (/[ая]$/.test(first)) return true;

  if (last && surnameLooksFeminine(last) && !surnameLooksMasculine(last)) return true;

  return false;
}

/** «изменил» / «изменила» по ФИО. */
export function ruPastByName(fullName: string, masculine: string, feminine: string): string {
  return isRussianFeminineName(fullName) ? feminine : masculine;
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
