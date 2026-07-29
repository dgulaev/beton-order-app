// lib/phone.ts
// Нормализация телефонных номеров для сравнения — убираем всё, кроме цифр,
// и приводим ведущую "8" к "7" (стандартный для РФ формат), чтобы
// "+7 999 123-45-67", "8 (999) 123-45-67" и "79991234567" считались одинаковыми.
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) {
    return '7' + digits.slice(1);
  }
  if (digits.length === 10) {
    // Номер без кода страны — добавляем 7
    return '7' + digits;
  }
  return digits;
}

export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const normA = normalizePhone(a);
  const normB = normalizePhone(b);
  return !!normA && normA === normB;
}

/**
 * Форматирует телефон "на лету" по мере ввода в поле.
 * Мобильный (79…) → "+7 999 123-45-67".
 * Городской → "+7 (4832) 32-13-03" / "+7 (495) 123-45-67".
 */
export function formatPhoneInput(value: string): string {
  if (value.length === 0) return '+7';

  let digits = value.replace(/\D/g, '');

  // Ведущая "8" → "7" (стандартный российский код страны).
  if (digits.startsWith('8')) {
    digits = '7' + digits.slice(1);
  } else if (!digits.startsWith('7')) {
    // Ввод начался не с "8" и не с "7" (например прямо с "9") — подставляем "7".
    digits = '7' + digits;
  }

  digits = digits.slice(0, 11);
  if (digits.length <= 1) return '+7';

  // Городской: вторая цифра не 9
  if (digits[1] !== '9') {
    return formatCityPhoneDigits(digits);
  }

  let formatted = '+7';
  const rest = digits.slice(1);

  if (rest.length > 0) {
    formatted += ' ' + rest.slice(0, 3);
    if (rest.length > 3) formatted += ' ' + rest.slice(3, 6);
    if (rest.length > 6) formatted += '-' + rest.slice(6, 8);
    if (rest.length > 8) formatted += '-' + rest.slice(8, 10);
  }

  return formatted;
}

/** Частые 3-значные коды городов (Москва, СПб и крупные АТС). */
const CITY_CODE_3 =
  /^(495|499|498|496|812|813|814|815|816|818|820|821|831|833|834|835|836|841|842|843|844|845|846|847|848|851|855|861|862|863|865|866|867|869|871|872|873|877|878|879|343|345|347|351|352|353|381|382|383|384|385|388|391|394|395|401|411|413|415|416|421|423|424|426|471|472|473|474|475)/;

/**
 * Городской номер из цифр вида 74832321303 / 74951234567.
 * Пока набрано меньше 11 — мягко форматируем по мере ввода.
 */
function formatCityPhoneDigits(digits: string): string {
  const rest = digits.slice(1); // без кода страны
  if (!rest) return '+7';

  // Неполный ввод — не ломаем набор
  if (rest.length < 10) {
    if (rest.length <= 4) return `+7 (${rest}`;
    return `+7 (${rest.slice(0, 4)}) ${rest.slice(4)}`;
  }

  // Полный 10-значный национальный номер
  if (CITY_CODE_3.test(rest)) {
    return `+7 (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6, 8)}-${rest.slice(8, 10)}`;
  }
  // 5-значный код (мелкие АТС): локальный номер 5 цифр → X-XX-XX
  // эвристика: 48xxx кроме явного 4832 (Брянск, 4 цифры)
  if (/^48\d{3}/.test(rest) && !rest.startsWith('4832')) {
    return `+7 (${rest.slice(0, 5)}) ${rest.slice(5, 6)}-${rest.slice(6, 8)}-${rest.slice(8, 10)}`;
  }
  // По умолчанию 4-значный код: +7 (4832) 32-13-03
  return `+7 (${rest.slice(0, 4)}) ${rest.slice(4, 6)}-${rest.slice(6, 8)}-${rest.slice(8, 10)}`;
}

/**
 * Единый вид для показа в карточках/списках.
 * Мобильный: "+7 900 365-00-44". Городской: "+7 (4832) 32-13-03".
 * Кривые записи вроде "+8900…" тоже приводятся к +7.
 * Если цифр слишком мало — возвращаем исходную строку (или "—").
 */
export function formatPhoneDisplay(raw: string | null | undefined): string {
  if (!raw) return '—';
  const norm = normalizePhone(raw);
  if (!norm) return '—';
  if (norm.length < 10) return String(raw).trim() || '—';
  return formatPhoneInput(norm);
}

/** Для записи в БД: "+79003650044". Пустой / мусор → null. */
export function toStoredPhone(raw: string | null | undefined): string | null {
  const norm = normalizePhone(raw);
  if (!norm || norm.length < 11) return null;
  return '+' + norm;
}
