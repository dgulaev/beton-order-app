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
 * Форматирует телефон "на лету" по мере ввода в поле — всегда приводит к
 * виду "+7 999 123-45-67", даже если пользователь начал вводить с "8" или
 * сразу с цифры "9" (без "+7"/"8"). Используется в формах входа и создания
 * заявки, чтобы не заставлять сотрудника/клиента вручную стирать "8" и
 * печатать "+7".
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

/**
 * Единый вид для показа в карточках/списках: "+7 900 365-00-44".
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
