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
