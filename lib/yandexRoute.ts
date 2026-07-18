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
 * Короткая подпись адреса для подсказки на точке карты (см. `OrderRouteMap`):
 * если это сам Брянск — только улица/дом (город и так ясен по контексту
 * карты завода), если другой населённый пункт региона — населённый пункт +
 * улица/дом (без повторного "Брянская область" — это не несёт новой
 * информации на подсказке одной точки).
 */
export function getShortDeliveryLabel(rawAddress: string | null | undefined): string {
  const normalized = normalizeDeliveryAddress(rawAddress);

  // Вписанные прямо в текст координаты (см. `extractCoordsFromAddress`) в
  // короткой подписи не нужны — они не читаются человеком.
  let text = normalized.replace(/\d{2,3}\.\d{3,}[,\s]+\d{2,3}\.\d{3,}/, '').trim();
  text = text.replace(/,\s*,/g, ',').replace(/^[,\s]+|[,\s]+$/g, '').trim();
  if (!text) return normalized;

  if (mentionsBryanskCity(text)) {
    const withoutCity = text.replace(/(?:^|,)\s*г\.?\s*Брянск\.?\s*/i, '').replace(/^[,\s]+/, '').trim();
    return withoutCity || 'г. Брянск';
  }

  const withoutRegion = text.replace(/,?\s*Брянская\s*обл(?:асть)?\.?\s*$/i, '').trim();
  return withoutRegion || text;
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
export const ROUTE_ORIGIN_COORDS = { lat: 53.25347, lon: 34.416444 };

/**
 * Извлекает координаты прямо из текста адреса, если диспетчер вставил их
 * в поле адреса (например "ул. Ленина 5\n52.735700, 34.774616").
 * Это быстрее и точнее любого геокодирования — не нужен запрос к DaData.
 */
export function extractCoordsFromAddress(address: string | null | undefined): Coords | null {
  if (!address) return null;
  // Ищем пару чисел вида ДД.ДДД, ДД.ДДД — широта и долгота
  const match = address.match(/(\d{2,3}\.\d{3,})[,\s]+(\d{2,3}\.\d{3,})/);
  if (!match) return null;
  const lat = parseFloat(match[1]);
  const lon = parseFloat(match[2]);
  // Санитарная проверка: диапазон координат для России
  if (lat >= 41 && lat <= 82 && lon >= 19 && lon <= 170) {
    return { lat, lon };
  }
  return null;
}

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

export type Coords = { lat: number; lon: number };

// Кэш результатов геокодирования на время сессии (вкладки). Один и тот же
// адрес доставки часто встречается сразу в нескольких местах (список заявок
// водителя, дашборд, модалка заказа) и может перерендериваться много раз —
// без кэша каждый такой рендер заново дёргал бы /api/geocode → DaData.
// - geocodeMemoryCache — быстрый доступ в рамках текущей загрузки страницы.
// - sessionStorage — переживает переход между страницами/вкладками мобильного
//   приложения в рамках одной сессии браузера (адреса заявок не меняются).
// - geocodeInFlight — если несколько компонентов одновременно запросили один
//   и тот же адрес (например, две карточки заявки с одинаковым адресом),
//   не шлём дублирующие запросы, а ждём один общий promise.
const geocodeMemoryCache = new Map<string, Coords | null>();
const geocodeInFlight = new Map<string, Promise<Coords | null>>();
const SESSION_CACHE_PREFIX = 'yandexGeocode:';

function readSessionCache(key: string): Coords | null | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.sessionStorage.getItem(SESSION_CACHE_PREFIX + key);
    if (raw === null) return undefined;
    return JSON.parse(raw) as Coords | null;
  } catch {
    return undefined;
  }
}

function writeSessionCache(key: string, value: Coords | null) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SESSION_CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    // sessionStorage может быть недоступен (приватный режим и т.п.) — не критично.
  }
}

/** Геокодирует адрес через сервер (DaData) в координаты. null, если не удалось. */
async function fetchGeocode(address: string): Promise<Coords | null> {
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

/** Геокодирует адрес с кэшированием (память вкладки → sessionStorage → сеть). */
async function geocodeAddressCached(address: string): Promise<Coords | null> {
  if (geocodeMemoryCache.has(address)) return geocodeMemoryCache.get(address) ?? null;

  const fromSession = readSessionCache(address);
  if (fromSession !== undefined) {
    geocodeMemoryCache.set(address, fromSession);
    return fromSession;
  }

  let inFlight = geocodeInFlight.get(address);
  if (!inFlight) {
    inFlight = fetchGeocode(address).finally(() => geocodeInFlight.delete(address));
    geocodeInFlight.set(address, inFlight);
  }

  const result = await inFlight;
  geocodeMemoryCache.set(address, result);
  // ⚠️ Неудачный результат (null) в sessionStorage не сохраняем: он живёт до
  // закрытия вкладки, и если геокодирование не удалось по временной причине
  // (сеть, не настроен DADATA_API_KEY на сервере и т.п.), адрес "залипал" бы
  // сломанным на весь сеанс браузера даже после того, как причина устранена
  // на сервере — следующий рендер снова постучится в API и получит уже
  // исправленный ответ. Успешный результат кэшируем как обычно.
  if (result) writeSessionCache(address, result);
  return result;
}

// Сколько ждём координаты, прежде чем разрешить клик по ссылке с текстовым
// (менее надёжным) фолбэком — чтобы кнопка не оставалась заблокированной
// навечно, если геокодирование почему-то не отвечает.
const GEOCODE_READY_TIMEOUT_MS = 6000;

export interface YandexRouteLink {
  /** Готовая ссылка на маршрут — координатная, если успели геокодировать, иначе текстовый фолбэк. */
  href: string;
  /**
   * true — координаты уже подтянуты (или геокодирование гарантированно не
   * удастся/зависло дольше таймаута), ссылку безопасно открывать даже в
   * Яндекс.Браузере. false — координаты ещё "летят": в Яндекс.Браузере клик
   * по текстовому fallback-адресу откроет приложение БЕЗ построения
   * маршрута, поэтому пока ссылку лучше не отпускать (см. компоненты кнопок).
   */
  ready: boolean;
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
 *
 * ⚠️ Но если пользователь успевает кликнуть РАНЬШЕ, чем подтянутся
 * координаты, href в момент клика — ещё текстовый. В обычном браузере это не
 * страшно (веб-версия Карт сама геокодирует текст), но Яндекс.Браузер
 * перехватывает ссылку и передаёт её приложению В ОБХОД геокодера — маршрут
 * не строится. Поэтому кроме href хук отдаёт `ready`: пока координаты не
 * готовы (и не истёк таймаут), кнопки блокируют клик, показывая, что ссылка
 * ещё "дозревает" (см. `RouteButton` и другие места использования).
 */
export function useYandexRouteHref(rawAddress: string | null | undefined): YandexRouteLink {
  // Быстрый путь: если в адресе уже есть координаты — сразу строим ссылку,
  // без запроса к DaData. Это точнее геокодирования и не требует ожидания.
  const embeddedCoords = useMemo(() => extractCoordsFromAddress(rawAddress), [rawAddress]);

  const fallbackHref = useMemo(() => {
    if (embeddedCoords) {
      return buildYandexMapsRouteUrlByCoords(embeddedCoords.lat, embeddedCoords.lon);
    }
    return buildYandexMapsRouteUrl(rawAddress);
  }, [rawAddress, embeddedCoords]);

  // Результат геокодирования — храним вместе с адресом, для которого он
  // получен: если rawAddress уже сменился, а старый результат ещё "летит",
  // просто игнорируем его (сравнение ниже), не сбрасывая state вручную.
  const [resolved, setResolved] = useState<{ address: string | null | undefined; href: string } | null>(null);
  // Храним адрес, для которого истёк таймаут (а не просто boolean) — по той
  // же причине, что и с `resolved` выше: так при смене rawAddress "просрочен"
  // автоматически перестаёт быть true без отдельного сброса синхронным
  // setState прямо в теле эффекта (setState нужен только внутри callback'ов —
  // тогда, когда таймер/геокодирование реально что-то узнали).
  const [timedOutAddress, setTimedOutAddress] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!rawAddress) return;

    // Координаты уже извлечены из текста — DaData не нужна, ссылка уже готова
    if (embeddedCoords) return;

    let cancelled = false;
    const destination = normalizeDeliveryAddress(rawAddress);

    geocodeAddressCached(destination).then((coords) => {
      if (cancelled || !coords) return;
      setResolved({ address: rawAddress, href: buildYandexMapsRouteUrlByCoords(coords.lat, coords.lon) });
    });

    const timer = setTimeout(() => {
      if (!cancelled) setTimedOutAddress(rawAddress);
    }, GEOCODE_READY_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rawAddress, embeddedCoords]);

  // Если координаты найдены в тексте — ссылка готова сразу, без ожидания
  if (embeddedCoords) {
    return { href: fallbackHref, ready: true };
  }

  const isResolved = !!resolved && resolved.address === rawAddress;
  const isTimedOut = timedOutAddress === rawAddress;

  return {
    href: isResolved ? resolved!.href : fallbackHref,
    ready: isResolved || isTimedOut,
  };
}

// ==================== ССЫЛКИ НА GOOGLE КАРТЫ И 2ГИС — ТА ЖЕ НОРМАЛИЗАЦИЯ АДРЕСА ====================
// Раньше кнопки "Google" и "2ГИС" подставляли в ссылку СЫРОЙ адрес заявки
// (order.address) без каких-либо поправок. Если менеджер написал адрес без
// города ("ул. Советская") — Яндекс.Карты (через normalizeDeliveryAddress)
// корректно достраивали "г. Брянск, ...", а Google/2ГИС могли уехать в другой
// регион (или вовсе не найти адрес). Приводим все три сервиса к единой логике:
// 1) если в адресе есть готовые координаты (extractCoordsFromAddress) — берём
//    их и не геокодируем вовсе; 2) иначе, как только достаётся геокодирование
//    через normalizeDeliveryAddress (DaData, регион "Брянская" — см.
//    /api/geocode), используем координаты результата; 3) до готовности
//    координат — временный фолбэк на нормализованный ТЕКСТ адреса.
const TWO_GIS_ORIGIN = `${ROUTE_ORIGIN_COORDS.lon},${ROUTE_ORIGIN_COORDS.lat}`;

function buildGoogleMapsRouteUrl(rawAddress: string | null | undefined, coords: Coords | null): string {
  const destination = coords ? `${coords.lat},${coords.lon}` : normalizeDeliveryAddress(rawAddress);
  const params = new URLSearchParams({
    api: '1',
    origin: ROUTE_ORIGIN_ADDRESS,
    destination,
    travelmode: 'driving',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * 2ГИС координаты в deeplink-ссылке указываются в порядке "долгота,широта"
 * (см. help.2gis.ru — "точка А/Б = [lon],[lat]"), в отличие от Яндекса и
 * Google, где принят обратный порядок "широта,долгота" — легко перепутать.
 * Без координат 2ГИС не умеет строить маршрут по ссылке (координата — 
 * обязательный параметр), поэтому пока координаты не готовы отдаём хотя бы
 * ссылку на поиск нормализованного адреса в Брянске.
 */
function buildTwoGisRouteUrl(rawAddress: string | null | undefined, coords: Coords | null): string {
  if (coords) {
    return `https://2gis.ru/routeSearch/rsType/car/from/${TWO_GIS_ORIGIN}/to/${coords.lon},${coords.lat}`;
  }
  return `https://2gis.ru/bryansk/search/${encodeURIComponent(normalizeDeliveryAddress(rawAddress))}`;
}

export interface MapRouteLinks {
  yandexHref: string;
  googleHref: string;
  twoGisHref: string;
  /** true — координаты подтянуты (или геокодирование гарантированно не удастся/истёк таймаут) — ссылки на все три сервиса безопасно открывать. */
  ready: boolean;
}

/**
 * Единая точка входа для кнопок "Яндекс" / "Google" / "2ГИС" в модалках
 * заявки: все три ссылки строятся из одного и того же нормализованного
 * адреса/координат (см. `normalizeDeliveryAddress`, `useDeliveryCoords`),
 * поэтому дозаполнение города/области и разбор вручную вписанных координат
 * работает одинаково для всех сервисов, а не только для Яндекса.
 */
export function useMapRouteLinks(rawAddress: string | null | undefined): MapRouteLinks {
  const { href: yandexHref, ready: yandexReady } = useYandexRouteHref(rawAddress);
  const { coords, ready: coordsReady } = useDeliveryCoords(rawAddress);

  const googleHref = useMemo(() => buildGoogleMapsRouteUrl(rawAddress, coords), [rawAddress, coords]);
  const twoGisHref = useMemo(() => buildTwoGisRouteUrl(rawAddress, coords), [rawAddress, coords]);

  return { yandexHref, googleHref, twoGisHref, ready: yandexReady && coordsReady };
}

export interface DeliveryCoordsResult {
  /** Координаты адреса доставки. null, пока не получены (или если геокодирование не удалось). */
  coords: Coords | null;
  /** true — попытка получить координаты завершена (успешно или неуспешно), можно перестать показывать загрузку. */
  ready: boolean;
}

/**
 * Хук, отдающий координаты адреса доставки напрямую (а не готовую ссылку,
 * как `useYandexRouteHref`) — нужен там, где адрес требуется не для ссылки,
 * а для отрисовки точки/маршрута на самой карте (см. `OrderRouteMap`).
 * Использует тот же кэш геокодирования (память вкладки → sessionStorage →
 * DaData), что и `useYandexRouteHref`, поэтому повторный запрос одного и
 * того же адреса в разных местах интерфейса не дублирует сетевые запросы.
 */
export function useDeliveryCoords(rawAddress: string | null | undefined): DeliveryCoordsResult {
  const embeddedCoords = useMemo(() => extractCoordsFromAddress(rawAddress), [rawAddress]);

  const [resolved, setResolved] = useState<{ address: string | null | undefined; coords: Coords | null } | null>(null);
  const [timedOutAddress, setTimedOutAddress] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!rawAddress || embeddedCoords) return;

    let cancelled = false;
    const destination = normalizeDeliveryAddress(rawAddress);

    geocodeAddressCached(destination).then((coords) => {
      if (cancelled) return;
      setResolved({ address: rawAddress, coords });
    });

    const timer = setTimeout(() => {
      if (!cancelled) setTimedOutAddress(rawAddress);
    }, GEOCODE_READY_TIMEOUT_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [rawAddress, embeddedCoords]);

  if (embeddedCoords) {
    return { coords: embeddedCoords, ready: true };
  }

  const isResolved = !!resolved && resolved.address === rawAddress;
  const isTimedOut = timedOutAddress === rawAddress;

  return {
    coords: isResolved ? resolved!.coords : null,
    ready: isResolved || isTimedOut,
  };
}
