/**
 * Чистые хелперы текста Авито — без server-only зависимостей.
 * Можно импортировать из client layout / browser.
 */

/**
 * Авито без тарифа «API мессенджера» иногда подсовывает текст ошибки
 * вместо текста сообщения покупателя — в тосты/карточки его не пускаем.
 */
export function isAvitoMessengerPaywallText(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    t.includes('api мессенджера') ||
    t.includes('api messenger') ||
    (t.includes('подписк') &&
      (t.includes('мессенджер') || t.includes('messenger') || t.includes('чат'))) ||
    /перейдите на подписку/i.test(text) ||
    /\b402\b/.test(t)
  );
}

/** Текст сообщения для UI; paywall-ошибку Авито считаем «пустым» текстом. */
export function sanitizeAvitoMessageText(text: string | null | undefined): string {
  const raw = (text || '').trim();
  if (!raw || isAvitoMessengerPaywallText(raw)) return '';
  return raw;
}
