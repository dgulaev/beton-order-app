// lib/yandexRoute.ts
// Построение ссылки на маршрут в Яндекс.Картах для водителей — от завода до
// адреса доставки из заявки. Ссылка вида https://yandex.ru/maps/?rtext=...
// на телефоне открывает нативное приложение Яндекс.Карт (если установлено,
// через универсальные ссылки), иначе — веб-версию в браузере.

// Точка отправления — всегда завод, адрес не меняется от заявки к заявке.
// TODO: при опечатке/переезде — просто исправить эту строку, больше менять
// нигде не нужно.
export const ROUTE_ORIGIN_ADDRESS = 'Брянск, Орловский тупик, 6';

// Иногда в заявке вместо точного адреса указывают ориентир/название
// организации (например "Варяг" вместо реального адреса) — без города и
// улицы Яндекс.Карты могут не найти нужную точку или найти в другом регионе.
// Здесь сопоставляем такие ориентиры с их настоящим адресом в Брянске.
// Чтобы добавить новый ориентир — впишите ключевые слова (в нижнем регистре)
// и точный адрес с городом.
const KNOWN_LANDMARKS: { keywords: string[]; address: string }[] = [
  { keywords: ['варяг'], address: 'Брянск, улица Дуки, 56В' },
];

// Маркеры населённого пункта (город/посёлок/село и т.п.), кроме самого
// Брянска — если он указан без области, Яндекс может найти одноимённый
// населённый пункт в другом регионе России.
const SETTLEMENT_MARKER = /(?:^|[\s,])(г\.?|город|гор\.|пос\.?|посёлок|поселок|село|с\.|дер\.?|деревня|ст\.?|станица|рп\.?|пгт\.?)\s*[А-ЯЁ]/i;

// В JS \b и \w не считают кириллицу "буквой" (работают только с ASCII), поэтому
// обычный /\bбрянск\b/i не отличает "Брянск" от "Брянская область" — приходится
// проверять соседние символы вручную.
const CYRILLIC_LETTER = /[а-яё]/i;

function hasWholeWord(haystack: string, word: string): boolean {
  const lower = haystack.toLowerCase();
  let fromIndex = 0;
  while (true) {
    const idx = lower.indexOf(word, fromIndex);
    if (idx === -1) return false;
    const before = idx > 0 ? lower[idx - 1] : '';
    const after = idx + word.length < lower.length ? lower[idx + word.length] : '';
    if (!CYRILLIC_LETTER.test(before) && !CYRILLIC_LETTER.test(after)) return true;
    fromIndex = idx + 1;
  }
}

function mentionsBryanskCity(address: string): boolean {
  return hasWholeWord(address, 'брянск');
}

function mentionsBryanskRegion(address: string): boolean {
  return /брянск[а-яё]*\s*обл/i.test(address);
}

/**
 * Достраивает адрес доставки до вида, который Яндекс.Карты однозначно
 * распознают: подставляет известный ориентир, добавляет город Брянск (если
 * населённый пункт не указан вовсе) или область Брянская (если указан другой
 * населённый пункт региона, но не сам Брянск).
 */
export function normalizeDeliveryAddress(rawAddress: string | null | undefined): string {
  const trimmed = (rawAddress || '').trim();
  if (!trimmed) return ROUTE_ORIGIN_ADDRESS;

  const lower = trimmed.toLowerCase();

  // 1. Известный ориентир — подставляем полный адрес целиком.
  const landmark = KNOWN_LANDMARKS.find((l) => l.keywords.some((kw) => lower.includes(kw)));
  if (landmark) return landmark.address;

  // 2. Область уже указана явно ("... Брянская область ...") — адрес уже
  //    однозначен, ничего не трогаем (даже если сам населённый пункт написан
  //    без "г."/"пос." — например "Сельцо, Брянская область").
  if (mentionsBryanskRegion(trimmed)) return trimmed;

  // 3. Город Брянск указан явно — адрес уже однозначен.
  if (mentionsBryanskCity(trimmed)) return trimmed;

  // 4. Указан другой населённый пункт региона (например "г. Сельцо") —
  //    добавляем область.
  if (SETTLEMENT_MARKER.test(trimmed)) {
    return `${trimmed}, Брянская область`;
  }

  // 5. Населённый пункт не указан вовсе — считаем, что это Брянск.
  return `г. Брянск, ${trimmed}`;
}

/** Ссылка на построение маршрута в Яндекс.Картах от завода до адреса доставки. */
export function buildYandexMapsRouteUrl(rawAddress: string | null | undefined): string {
  const destination = normalizeDeliveryAddress(rawAddress);
  const params = new URLSearchParams({
    rtext: `${ROUTE_ORIGIN_ADDRESS}~${destination}`,
    rtt: 'auto',
  });
  return `https://yandex.ru/maps/?${params.toString()}`;
}
