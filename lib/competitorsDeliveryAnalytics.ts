/**
 * Зимняя / доставочная аналитика конкурентов:
 * период, матчинг марки, расстояния (haversine × кривизна дорог), агрегаты.
 */

import { recipeToMatrixCell, type CompetitorFiller } from '@/lib/competitors';
import { haversineKm, DEFAULT_DELIVERY_SETTINGS } from '@/lib/deliveryPricing';
import { ROUTE_ORIGIN_COORDS, type Coords } from '@/lib/geocodeAddress';

export const OWN_PLANT_ID = 'own';
export const OWN_PLANT_NAME = 'ТрейдКом';

/** Средняя скорость для оценки времени (км/ч), как в travel-time. */
const AVG_SPEED_KMH = 50;
const MIN_TRAVEL_MIN = 10;

export type PlantRef = {
  id: string; // 'own' | String(competitorId)
  name: string;
  lat: number;
  lon: number;
  isOwn: boolean;
};

export type DeliveryPlantStats = {
  id: string;
  name: string;
  isOwn: boolean;
  nearestCount: number;
  cheapestCount: number;
  /** Сколько раз завод выиграл по коэф. (км/км_своего)×(цена/цена_своей) */
  bestScoreCount: number;
  avgRoadKm: number | null;
  avgTravelMin: number | null;
  samples: number;
};

export type DeliveryOrderExample = {
  id: number;
  delivery_date: string;
  address: string;
  grade: string | null;
  volume: number | null;
  organization_name: string | null;
  ourRoadKm: number | null;
  ourTravelMin: number | null;
  nearest: { id: string; name: string; roadKm: number; travelMin: number } | null;
  cheapest: { id: string; name: string; price: number } | null;
  ourPrice: number | null;
  /** Лучший завод по коэф. ближе×дешевле (относительно своего БСУ) */
  best: {
    id: string;
    name: string;
    score: number;
    roadKm: number;
    price: number;
    isOwn: boolean;
  } | null;
  recommendation: string;
};

/** score = (км/км_своего) × (цена/цена_своей); меньше — лучше. */
export function comboScore(
  roadKm: number,
  price: number,
  ownRoadKm: number,
  ownPrice: number
): number {
  const k = Math.max(ownRoadKm, 0.1);
  const p = Math.max(ownPrice, 1);
  return (roadKm / k) * (price / p);
}

export type DeliveryAnalyticsResult = {
  plants: DeliveryPlantStats[];
  orders: DeliveryOrderExample[];
  meta: {
    from: string;
    to: string;
    totalOrders: number;
    geocoded: number;
    withoutCoords: number;
    roadCurvature: number;
  };
};

function isoDate(y: number, month1to12: number, day: number): string {
  return `${y}-${String(month1to12).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Текущий календарный месяц (1-е … последний день). */
export function currentMonthRange(now: Date = new Date()): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  const last = new Date(y, m, 0).getDate();
  return { from: isoDate(y, m, 1), to: isoDate(y, m, last) };
}

/** Текущий зимний сезон: нояб–март. */
export function currentWinterSeason(now: Date = new Date()): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  if (m >= 11) {
    return { from: isoDate(y, 11, 1), to: isoDate(y + 1, 3, 31) };
  }
  return { from: isoDate(y - 1, 11, 1), to: isoDate(y, 3, 31) };
}

/** Марка заявки → ячейка матрицы (М300 / М300и / ТР М100). */
export function orderGradeToMatrix(
  grade: string | null | undefined
): { grade_key: string; filler: CompetitorFiller } | null {
  const cell = recipeToMatrixCell({ code: grade, name: grade, price: 1 });
  if (!cell) return null;
  return { grade_key: cell.grade_key, filler: cell.filler };
}

export function roadKmBetween(
  a: Coords,
  b: Coords,
  curvature: number = DEFAULT_DELIVERY_SETTINGS.road_curvature_coefficient
): number {
  return haversineKm(a, b) * (curvature > 0 ? curvature : 1.3);
}

export function travelMinFromRoadKm(roadKm: number): number {
  const estimated = Math.round((roadKm / AVG_SPEED_KMH) * 60);
  return Math.max(MIN_TRAVEL_MIN, estimated);
}

export function buildOwnPlant(): PlantRef {
  return {
    id: OWN_PLANT_ID,
    name: OWN_PLANT_NAME,
    lat: ROUTE_ORIGIN_COORDS.lat,
    lon: ROUTE_ORIGIN_COORDS.lon,
    isOwn: true,
  };
}

function priceKey(competitorId: string | number, grade_key: string, filler: CompetitorFiller) {
  return `${competitorId}|${grade_key}|${filler}`;
}

export function buildDeliveryAnalytics(input: {
  from: string;
  to: string;
  orders: Array<{
    id: number;
    address: string;
    grade?: string | null;
    volume?: number | null;
    delivery_date?: string | null;
    organization_name?: string | null;
    full_name?: string | null;
  }>;
  plants: PlantRef[];
  /** Ключ: competitorId|grade|filler или own|grade|filler → цена */
  prices: Map<string, number>;
  /** Координаты адресов (нормализованный trim address → coords | null) */
  addressCoords: Map<string, Coords | null>;
  roadCurvature: number;
  maxExamples?: number;
}): DeliveryAnalyticsResult {
  const maxExamples = input.maxExamples ?? 50;
  const curvature = input.roadCurvature > 0 ? input.roadCurvature : 1.3;

  type Acc = {
    nearestCount: number;
    cheapestCount: number;
    bestScoreCount: number;
    sumKm: number;
    sumMin: number;
    samples: number;
  };
  const acc = new Map<string, Acc>();
  for (const p of input.plants) {
    acc.set(p.id, {
      nearestCount: 0,
      cheapestCount: 0,
      bestScoreCount: 0,
      sumKm: 0,
      sumMin: 0,
      samples: 0,
    });
  }

  const examples: DeliveryOrderExample[] = [];
  let geocoded = 0;
  let withoutCoords = 0;

  for (const order of input.orders) {
    const addr = String(order.address || '').trim();
    if (!addr) continue;
    const coords = input.addressCoords.get(addr);
    if (!coords) {
      withoutCoords++;
      continue;
    }
    geocoded++;

    const matrix = orderGradeToMatrix(order.grade);
    const dest: Coords = coords;

    type DistRow = { plant: PlantRef; roadKm: number; travelMin: number; price: number | null };
    const rows: DistRow[] = input.plants.map((plant) => {
      const roadKm = roadKmBetween({ lat: plant.lat, lon: plant.lon }, dest, curvature);
      const travelMin = travelMinFromRoadKm(roadKm);
      let price: number | null = null;
      if (matrix) {
        const key = plant.isOwn
          ? priceKey(OWN_PLANT_ID, matrix.grade_key, matrix.filler)
          : priceKey(plant.id, matrix.grade_key, matrix.filler);
        const p =
          input.prices.get(key) ??
          (plant.isOwn ? input.prices.get(`${matrix.grade_key}|${matrix.filler}`) : undefined);
        if (p != null && Number.isFinite(p)) price = p;
      }
      return { plant, roadKm, travelMin, price };
    });

    let nearest = rows[0];
    for (const r of rows) {
      if (r.roadKm < nearest.roadKm) nearest = r;
    }

    const priced = rows.filter((r) => r.price != null) as Array<DistRow & { price: number }>;
    let cheapest: (DistRow & { price: number }) | null = null;
    for (const r of priced) {
      if (!cheapest || r.price < cheapest.price) cheapest = r;
    }

    const ownRow = rows.find((r) => r.plant.isOwn) || null;
    const ourPrice =
      matrix != null
        ? input.prices.get(priceKey(OWN_PLANT_ID, matrix.grade_key, matrix.filler)) ??
          input.prices.get(`${matrix.grade_key}|${matrix.filler}`) ??
          null
        : null;

    // Коэф. (км/км_своего)×(цена/цена_своей) — только при своей цене и км
    let best: DeliveryOrderExample['best'] = null;
    if (ownRow && ourPrice != null && ourPrice > 0) {
      let bestRow: (DistRow & { price: number; score: number }) | null = null;
      for (const r of priced) {
        const score = comboScore(r.roadKm, r.price, ownRow.roadKm, ourPrice);
        if (!bestRow || score < bestRow.score) {
          bestRow = { ...r, score };
        }
      }
      if (bestRow) {
        best = {
          id: bestRow.plant.id,
          name: bestRow.plant.name,
          score: Math.round(bestRow.score * 100) / 100,
          roadKm: Math.round(bestRow.roadKm * 10) / 10,
          price: bestRow.price,
          isOwn: bestRow.plant.isOwn,
        };
      }
    }

    for (const r of rows) {
      const a = acc.get(r.plant.id);
      if (!a) continue;
      a.sumKm += r.roadKm;
      a.sumMin += r.travelMin;
      a.samples++;
    }
    const nAcc = acc.get(nearest.plant.id);
    if (nAcc) nAcc.nearestCount++;
    if (cheapest) {
      const cAcc = acc.get(cheapest.plant.id);
      if (cAcc) cAcc.cheapestCount++;
    }
    if (best) {
      const bAcc = acc.get(best.id);
      if (bAcc) bAcc.bestScoreCount++;
    }

    let recommendation = '';
    if (best && ownRow && ourPrice != null) {
      const pct = Math.round((1 - best.score) * 100);
      const kmOwn = Math.round(ownRow.roadKm * 10) / 10;
      const priceOwn = Math.round(ourPrice).toLocaleString('ru-RU');
      const priceBest = Math.round(best.price).toLocaleString('ru-RU');
      if (best.isOwn) {
        const next = priced
          .filter((r) => !r.plant.isOwn)
          .map((r) => ({
            name: r.plant.name,
            score: comboScore(r.roadKm, r.price, ownRow.roadKm, ourPrice),
          }))
          .sort((a, b) => a.score - b.score)[0];
        recommendation = next
          ? `${best.name} (свой) — лучший коэф. ${best.score.toFixed(2)}; ближайший по коэф. ${next.name} ${next.score.toFixed(2)}`
          : `${best.name} (свой) — лучший коэф. ${best.score.toFixed(2)}`;
      } else if (pct > 0) {
        recommendation = `${best.name} — коэф. ${best.score.toFixed(2)} (на ${pct}% выгоднее своего: ${best.roadKm} км vs ${kmOwn} км, ${priceBest} ₽ vs ${priceOwn} ₽)`;
      } else {
        recommendation = `${best.name} — коэф. ${best.score.toFixed(2)} (${best.roadKm} км, ${priceBest} ₽; свой ${kmOwn} км, ${priceOwn} ₽)`;
      }
    } else if (nearest) {
      recommendation = ourPrice == null
        ? `Нет своей цены по марке — коэф. не считаем. Ближе ${nearest.plant.name} (${nearest.roadKm.toFixed(1)} км)`
        : `Ближе ${nearest.plant.name} (${nearest.roadKm.toFixed(1)} км)`;
    }

    examples.push({
      id: order.id,
      delivery_date: String(order.delivery_date || '').slice(0, 10),
      address: addr,
      grade: order.grade ?? null,
      volume: order.volume != null ? Number(order.volume) : null,
      organization_name: order.organization_name || order.full_name || null,
      ourRoadKm: ownRow ? Math.round(ownRow.roadKm * 10) / 10 : null,
      ourTravelMin: ownRow ? ownRow.travelMin : null,
      nearest: {
        id: nearest.plant.id,
        name: nearest.plant.name,
        roadKm: Math.round(nearest.roadKm * 10) / 10,
        travelMin: nearest.travelMin,
      },
      cheapest: cheapest
        ? { id: cheapest.plant.id, name: cheapest.plant.name, price: cheapest.price }
        : null,
      ourPrice,
      best,
      recommendation,
    });
  }

  // Сначала заявки, где выгоднее не свой завод
  examples.sort((a, b) => {
    const aAway = a.best && !a.best.isOwn ? 0 : 1;
    const bAway = b.best && !b.best.isOwn ? 0 : 1;
    if (aAway !== bAway) return aAway - bAway;
    const aScore = a.best?.score ?? 99;
    const bScore = b.best?.score ?? 99;
    if (aScore !== bScore) return aScore - bScore;
    return (b.volume || 0) - (a.volume || 0);
  });

  const plants: DeliveryPlantStats[] = input.plants.map((p) => {
    const a = acc.get(p.id)!;
    return {
      id: p.id,
      name: p.name,
      isOwn: p.isOwn,
      nearestCount: a.nearestCount,
      cheapestCount: a.cheapestCount,
      bestScoreCount: a.bestScoreCount,
      avgRoadKm: a.samples > 0 ? Math.round((a.sumKm / a.samples) * 10) / 10 : null,
      avgTravelMin: a.samples > 0 ? Math.round(a.sumMin / a.samples) : null,
      samples: a.samples,
    };
  });

  plants.sort(
    (a, b) =>
      b.bestScoreCount - a.bestScoreCount ||
      b.nearestCount - a.nearestCount ||
      b.cheapestCount - a.cheapestCount
  );

  return {
    plants,
    orders: examples.slice(0, maxExamples),
    meta: {
      from: input.from,
      to: input.to,
      totalOrders: input.orders.length,
      geocoded,
      withoutCoords,
      roadCurvature: curvature,
    },
  };
}
