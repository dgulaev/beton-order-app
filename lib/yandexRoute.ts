// lib/yandexRoute.ts
'use client';
// Построение ссылки на маршрут в Яндекс.Картах для водителей — от завода до
// адреса доставки из заявки. Ссылка вида https://yandex.ru/maps/?rtext=...
// на телефоне открывает нативное приложение Яндекс.Карт (если установлено,
// через универсальные ссылки), иначе — веб-версию в браузере.

import { useEffect, useMemo, useState } from 'react';

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

/**
 * Ссылка на построение маршрута в Яндекс.Картах по ТЕКСТОВЫМ адресам.
 * Работает в обычном браузере (в т.ч. на телефоне) — веб-версия Яндекс.Карт
 * сама геокодирует текст в координаты. НЕ работает в Яндекс.Браузере: он
 * перехватывает ссылки на yandex.ru/maps и передаёт их прямо в приложение
 * Яндекс.Карт, минуя геокодер веб-страницы, а приложение понимает в rtext
 * только координаты — поэтому используем эту ссылку только как запасной
 * вариант, если геокодирование через `buildYandexMapsRouteUrlByCoords` не
 * удалось (см. `useYandexRouteHref`).
 */
export function buildYandexMapsRouteUrl(rawAddress: string | null | undefined): string {
  const destination = normalizeDeliveryAddress(rawAddress);
  const params = new URLSearchParams({
    rtext: `${ROUTE_ORIGIN_ADDRESS}~${destination}`,
    rtt: 'auto',
  });
  return `https://yandex.ru/maps/?${params.toString()}`;
}

// Координаты завода (Брянск, Орловский тупик, 6) — получены геокодером один
// раз и захардкожены, чтобы не дёргать API на каждое построение маршрута:
// точка отправления не меняется от заявки к заявке.
const ROUTE_ORIGIN_COORDS = { lat: 53.25347, lon: 34.416444 };

/** Ссылка на построение маршрута в Яндекс.Картах по КООРДИНАТАМ — работает
 * одинаково надёжно и в обычном браузере, и в Яндекс.Браузере (открывает
 * приложение и сразу строит маршрут). */
function buildYandexMapsRouteUrlByCoords(destLat: number, destLon: number): string {
  const params = new URLSearchParams({
    rtext: `${ROUTE_ORIGIN_COORDS.lat},${ROUTE_ORIGIN_COORDS.lon}~${destLat},${destLon}`,
    rtt: 'auto',
  });
  return `https://yandex.ru/maps/?${params.toString()}`;
}

/** Геокодирует адрес через сервер (DaData) в координаты. null, если не удалось. */
async function geocodeAddress(address: string): Promise<{ lat: number; lon: number } | null> {
  try {
    const res = await fetch('/api/geocode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (typeof data.lat === 'number' && typeof data.lon === 'number') {
      return { lat: data.lat, lon: data.lon };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Хук для кнопки/ссылки «Маршрут»: сразу отдаёт текстовую ссылку (работает
 * почти везде), а как только в фоне подтягиваются координаты — переключает
 * на ссылку по координатам (надёжно работает и в Яндекс.Браузере).
 *
 * ⚠️ Раньше вместо этого использовался приём с window.open('', '_blank') +
 * последующим редиректом внутри onClick — чтобы можно было открыть окно
 * СИНХРОННО (до асинхронного геокодирования), а потом подставить в него
 * готовый URL. На мобильных браузерах (не только Яндекс.Браузере — похоже,
 * во всех Chromium-based) это открывало не отдельную вкладку, а просто
 * "обеляло" текущую страницу пустым документом, и после закрытия приложения
 * Карт пользователь видел белый экран, пока не нажимал "назад" в браузере.
 * Обычная ссылка <a href> с уже готовым URL (даже если он "дозревает"
 * асинхронно и подставляется только когда пользователь ещё не успел
 * кликнуть) браузер обрабатывает штатно, без побочных эффектов.
 */
export function useYandexRouteHref(rawAddress: string | null | undefined): string {
  // Синхронный текстовый фолбэк — пересчитывается прямо при рендере, без
  // setState в эффекте (это и держит href актуальным сразу при смене адреса,
  // до того как подтянутся координаты).
  const fallbackHref = useMemo(() => buildYandexMapsRouteUrl(rawAddress), [rawAddress]);

  // Результат геокодирования — храним вместе с адресом, для которого он
  // получен: если rawAddress уже сменился, а старый результат ещё "летит",
  // просто игнорируем его (сравнение ниже), не сбрасывая state вручную.
  const [resolved, setResolved] = useState<{ address: string | null | undefined; href: string } | null>(null);

  useEffect(() => {
    if (!rawAddress) return;

    let cancelled = false;
    const destination = normalizeDeliveryAddress(rawAddress);

    geocodeAddress(destination).then((coords) => {
      if (cancelled || !coords) return;
      setResolved({ address: rawAddress, href: buildYandexMapsRouteUrlByCoords(coords.lat, coords.lon) });
    });

    return () => {
      cancelled = true;
    };
  }, [rawAddress]);

  return resolved && resolved.address === rawAddress ? resolved.href : fallbackHref;
}
