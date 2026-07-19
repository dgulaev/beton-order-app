// lib/deliveryPricing.ts
// Единая формула расчёта стоимости ДОСТАВКИ бетона — используется во всех
// формах создания заявки (десктоп-админка NewOrderModal, мобильная админка
// MobileNewOrderModal, клиентская страница заказа ConcreteOrderPageContent),
// чтобы правило не приходилось дублировать (и рассинхронизировать) в трёх
// местах. Сами тарифы (цены, ставка за км, коэффициент кривизны дорог)
// хранятся в таблице delivery_settings и редактируются админом на вкладке
// «Тарифы доставки» страницы «Миксеры» — см. app/api/adminCifra/delivery-settings
// и scripts/delivery-settings-schema.sql.
//
// ФОРМУЛА:
//   • адрес ЗА ПРЕДЕЛАМИ Брянска (см. isOutsideBryansk в lib/yandexRoute.ts) —
//     ПОЛНОСТЬЮ заменяет тарифы ниже: расстояние по прямой между координатами
//     завода и геокодированного адреса × road_curvature_coefficient (поправка
//     на то, что реальная дорога длиннее прямой) × price_per_km ₽/км,
//     умноженное на количество рейсов (каждый миксер реально едет туда и
//     обратно — см. tripsCountForVolume).
//   • иначе (адрес в черте Брянска или город/область не указаны вовсе —
//     тогда по умолчанию считаем, что это Брянск, как и normalizeDeliveryAddress):
//       - объём ≤ 10 м³      → price_tier_10 ₽ за рейс
//       - 10 < объём ≤ 12 м³ → price_tier_12 ₽ за рейс (мощнее миксер)
//       - 12 < объём ≤ 50 м³ → рейсов × price_tier_trip ₽
//       - объём > 50 м³      → price_per_m3_over_50 ₽ за 1 м³

import { ROUTE_ORIGIN_COORDS, isOutsideBryansk, type Coords } from './yandexRoute';

export interface DeliverySettings {
  price_tier_10: number;
  price_tier_12: number;
  price_tier_trip: number;
  price_per_m3_over_50: number;
  price_per_km: number;
  road_curvature_coefficient: number;
}

// Ровно те же значения, что были захардкожены в коде до появления этой
// настройки — используются как фолбэк, пока /api/adminCifra/delivery-settings
// не успел отдать реальные (или если таблица настроек ещё не создана).
export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  price_tier_10: 6000,
  price_tier_12: 7500,
  price_tier_trip: 6000,
  price_per_m3_over_50: 600,
  price_per_km: 300,
  road_curvature_coefficient: 1.3,
};

/** Стандартная вместимость одного рейса миксера для тарифов "по рейсам" (12–50 м³ и за городом). */
const STANDARD_TRIP_VOLUME_M3 = 10;

/**
 * Сколько реальных рейсов миксера нужно для этого объёма — используется и
 * для тарифа "12–50 м³" (в черте города), и для умножения км-стоимости за
 * городом (каждый рейс — отдельная поездка туда-обратно).
 * До 12 м³ включительно — всегда 1 рейс (для 10–12 просто берут более
 * вместительный миксер, а не гоняют два маленьких).
 */
export function tripsCountForVolume(volume: number): number {
  if (volume <= 0) return 0;
  if (volume <= 12) return 1;
  return Math.ceil(volume / STANDARD_TRIP_VOLUME_M3);
}

/** Расстояние по прямой между двумя точками (формула гаверсинуса), км. */
export function haversineKm(a: Coords, b: Coords): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export interface DeliveryCostResult {
  deliveryCost: number;
  /** Пояснение под итоговой суммой (без эмодзи — его добавляет разметка формы, см. NewOrderModal и др.). */
  deliveryNote: string;
  tripsCount: number;
  /** Расстояние до адреса (км, с учётом коэффициента кривизны), только для доставки за городом. */
  distanceKm: number | null;
  isOutOfCity: boolean;
}

export function calculateDeliveryCost(params: {
  volume: number;
  address?: string | null;
  /** Координаты адреса доставки (геокодирование) — нужны только для доставки за городом. */
  coords?: Coords | null;
  settings?: DeliverySettings;
}): DeliveryCostResult {
  const { volume, address, coords } = params;
  const s = params.settings ?? DEFAULT_DELIVERY_SETTINGS;

  if (!volume || volume <= 0) {
    return { deliveryCost: 0, deliveryNote: '', tripsCount: 0, distanceKm: null, isOutOfCity: false };
  }

  const tripsCount = tripsCountForVolume(volume);
  const outOfCity = isOutsideBryansk(address);

  if (outOfCity) {
    // Адрес за городом, но координаты ещё не подтянулись (геокодирование в
    // процессе/не удалось) — честно показываем 0 с пояснением, а не тихо
    // считаем по городским тарифам (это была бы неверная, заниженная цена).
    if (!coords) {
      return {
        deliveryCost: 0,
        deliveryNote: 'за городом — уточняем расстояние по адресу...',
        tripsCount,
        distanceKm: null,
        isOutOfCity: true,
      };
    }

    const distanceKm = haversineKm(ROUTE_ORIGIN_COORDS, coords) * (s.road_curvature_coefficient || 1);
    const oneWayCost = distanceKm * s.price_per_km;
    const deliveryCost = Math.round(oneWayCost * tripsCount);
    const tripsLabel = tripsCount > 1 ? `${tripsCount} рейса` : '1 рейс';
    const deliveryNote = `за городом: ${tripsLabel} × ~${Math.round(distanceKm)} км × ${s.price_per_km.toLocaleString('ru-RU')} ₽/км`;

    return { deliveryCost, deliveryNote, tripsCount, distanceKm, isOutOfCity: true };
  }

  if (volume <= 10) {
    return {
      deliveryCost: s.price_tier_10,
      deliveryNote: `${s.price_tier_10.toLocaleString('ru-RU')} ₽ за рейс (до 10 м³)`,
      tripsCount,
      distanceKm: null,
      isOutOfCity: false,
    };
  }

  if (volume <= 12) {
    return {
      deliveryCost: s.price_tier_12,
      deliveryNote: `${s.price_tier_12.toLocaleString('ru-RU')} ₽ за рейс (до 12 м³)`,
      tripsCount,
      distanceKm: null,
      isOutOfCity: false,
    };
  }

  if (volume <= 50) {
    const deliveryCost = tripsCount * s.price_tier_trip;
    return {
      deliveryCost,
      deliveryNote: `${tripsCount} рейса × ${s.price_tier_trip.toLocaleString('ru-RU')} ₽`,
      tripsCount,
      distanceKm: null,
      isOutOfCity: false,
    };
  }

  const deliveryCost = Math.round(volume * s.price_per_m3_over_50);
  return {
    deliveryCost,
    deliveryNote: `${s.price_per_m3_over_50.toLocaleString('ru-RU')} ₽ за 1 м³`,
    tripsCount,
    distanceKm: null,
    isOutOfCity: false,
  };
}

/**
 * Подгружает актуальные тарифы доставки с сервера, с фолбэком на дефолтные
 * значения, если запрос не удался. Вызывающая форма сама решает, в каком
 * effect её дёргать (по аналогии с тем, как формы уже грузят
 * /api/adminCifra/recipes) — обычной React-хук здесь не нужен.
 */
export async function fetchDeliverySettings(): Promise<DeliverySettings> {
  try {
    const res = await fetch('/api/adminCifra/delivery-settings');
    if (!res.ok) return DEFAULT_DELIVERY_SETTINGS;
    const data = await res.json();
    return {
      price_tier_10: Number(data.price_tier_10) || DEFAULT_DELIVERY_SETTINGS.price_tier_10,
      price_tier_12: Number(data.price_tier_12) || DEFAULT_DELIVERY_SETTINGS.price_tier_12,
      price_tier_trip: Number(data.price_tier_trip) || DEFAULT_DELIVERY_SETTINGS.price_tier_trip,
      price_per_m3_over_50: Number(data.price_per_m3_over_50) || DEFAULT_DELIVERY_SETTINGS.price_per_m3_over_50,
      price_per_km: Number(data.price_per_km) || DEFAULT_DELIVERY_SETTINGS.price_per_km,
      road_curvature_coefficient: Number(data.road_curvature_coefficient) || DEFAULT_DELIVERY_SETTINGS.road_curvature_coefficient,
    };
  } catch {
    return DEFAULT_DELIVERY_SETTINGS;
  }
}
