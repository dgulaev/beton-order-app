// lib/yandexRoute.ts
'use client';
// Построение ссылки на маршрут в Яндекс.Картах для водителей — от завода до
// адреса доставки из заявки. Ссылка вида https://yandex.ru/maps/?rtext=...
// на телефоне открывает нативное приложение Яндекс.Карт (если установлено,
// через универсальные ссылки), иначе — веб-версию в браузере.

import { useEffect, useMemo, useState } from 'react';

export {
  ROUTE_ORIGIN_ADDRESS,
  isOutsideBryansk,
  isPickupOrder,
  normalizeDeliveryAddress,
} from './bryanskAddress';

import {
  getRouteOriginAddress,
  isPickupOrder,
  mentionsBryanskCity,
  normalizeDeliveryAddress,
} from './bryanskAddress';

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
    rtext: `${getRouteOriginAddress()}~${destination}`,
    rtt: 'auto',
  });
  return `https://yandex.ru/maps/?${params.toString()}`;
}

// Чистые geo-хелперы живут в lib/geocodeAddress.ts (без 'use client'),
// чтобы их могли вызывать и серверные API. Здесь — реэкспорт для клиента.
export {
  ROUTE_ORIGIN_COORDS,
  getRouteOriginCoords,
  extractCoordsFromAddress,
  type Coords,
} from './geocodeAddress';
import { getRouteOriginCoords, extractCoordsFromAddress, type Coords } from './geocodeAddress';

/** Ссылка на построение маршрута в Яндекс.Картах по КООРДИНАТАМ — работает
 * одинаково надёжно и в обычном браузере, и в Яндекс.Браузере (открывает
 * приложение и сразу строит маршрут). */
/** Точка завода на карте (без маршрута) — для самовывоза. */
function buildPlantPlaceUrl(service: 'yandex' | 'google' | '2gis'): string {
  const o = getRouteOriginCoords();
  const addr = getRouteOriginAddress();
  if (service === 'yandex') {
    return `https://yandex.ru/maps/?pt=${o.lon},${o.lat}&z=16&l=map&text=${encodeURIComponent(addr)}`;
  }
  if (service === 'google') {
    return `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lon}`;
  }
  return `https://2gis.ru/bryansk/geo/${o.lon}%2C${o.lat}`;
}

function buildYandexMapsRouteUrlByCoords(destLat: number, destLon: number): string {
  const o = getRouteOriginCoords();
  const params = new URLSearchParams({
    rtext: `${o.lat},${o.lon}~${destLat},${destLon}`,
    rtt: 'auto',
  });
  return `https://yandex.ru/maps/?${params.toString()}`;
}

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
// v8 — самовывоз → завод, не центр города.
const SESSION_CACHE_PREFIX = 'yandexGeocode:v8:';

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
  const pickup = isPickupOrder(rawAddress);

  const fallbackHref = useMemo(() => {
    if (pickup) return buildPlantPlaceUrl('yandex');
    if (embeddedCoords) {
      return buildYandexMapsRouteUrlByCoords(embeddedCoords.lat, embeddedCoords.lon);
    }
    return buildYandexMapsRouteUrl(rawAddress);
  }, [rawAddress, embeddedCoords, pickup]);

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
    if (!rawAddress || pickup) return;

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
  }, [rawAddress, embeddedCoords, pickup]);

  // Самовывоз / координаты в тексте — ссылка готова сразу, без DaData
  if (pickup || embeddedCoords) {
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
function twoGisOrigin(): string {
  const o = getRouteOriginCoords();
  return `${o.lon},${o.lat}`;
}

function buildGoogleMapsRouteUrl(rawAddress: string | null | undefined, coords: Coords | null): string {
  const destination = coords ? `${coords.lat},${coords.lon}` : normalizeDeliveryAddress(rawAddress);
  const params = new URLSearchParams({
    api: '1',
    origin: getRouteOriginAddress(),
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
    return `https://2gis.ru/routeSearch/rsType/car/from/${twoGisOrigin()}/to/${coords.lon},${coords.lat}`;
  }
  return `https://2gis.ru/bryansk/search/${encodeURIComponent(normalizeDeliveryAddress(rawAddress))}`;
}

export interface MapRouteLinks {
  yandexHref: string;
  googleHref: string;
  twoGisHref: string;
  /** true — координаты подтянуты (или геокодирование гарантированно не удастся/истёк таймаут) — ссылки на все три сервиса безопасно открывать. */
  ready: boolean;
  /** Адрес = самовывоз: ссылки ведут на завод, без маршрута «в центр». */
  pickup: boolean;
}

/**
 * Единая точка входа для кнопок "Яндекс" / "Google" / "2ГИС" в модалках
 * заявки: все три ссылки строятся из одного и того же нормализованного
 * адреса/координат (см. `normalizeDeliveryAddress`, `useDeliveryCoords`),
 * поэтому дозаполнение города/области и разбор вручную вписанных координат
 * работает одинаково для всех сервисов, а не только для Яндекса.
 */
export function useMapRouteLinks(rawAddress: string | null | undefined): MapRouteLinks {
  const pickup = isPickupOrder(rawAddress);
  const { href: yandexHref, ready: yandexReady } = useYandexRouteHref(rawAddress);
  const { coords, ready: coordsReady } = useDeliveryCoords(rawAddress);

  const googleHref = useMemo(
    () => (pickup ? buildPlantPlaceUrl('google') : buildGoogleMapsRouteUrl(rawAddress, coords)),
    [rawAddress, coords, pickup],
  );
  const twoGisHref = useMemo(
    () => (pickup ? buildPlantPlaceUrl('2gis') : buildTwoGisRouteUrl(rawAddress, coords)),
    [rawAddress, coords, pickup],
  );

  return {
    yandexHref,
    googleHref,
    twoGisHref,
    ready: yandexReady && coordsReady,
    pickup,
  };
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
  const pickup = isPickupOrder(rawAddress);

  const [resolved, setResolved] = useState<{ address: string | null | undefined; coords: Coords | null } | null>(null);
  const [timedOutAddress, setTimedOutAddress] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!rawAddress || embeddedCoords || pickup) return;

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
  }, [rawAddress, embeddedCoords, pickup]);

  // Самовывоз: точка завода (карта покажет завод без маршрута «в центр»).
  if (pickup) {
    return { coords: getRouteOriginCoords(), ready: true };
  }

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
