/**
 * Аналитика «где выгоднее купить», если не грузим со своего завода.
 */

import { priceDelta, type Competitor, type CompetitorFiller, type MatrixColumn } from '@/lib/competitors';

export type PriceLookup = Map<string, number | null>;

export type GradeDeal = {
  label: string;
  grade_key: string;
  filler: CompetitorFiller;
  our: number;
  their: number;
  savings: number; // our - their (>0 = конкурент дешевле)
  competitorId: number;
  competitorName: string;
};

export type PartnerScore = {
  competitorId: number;
  competitorName: string;
  /** Сколько ячеек дешевле нас */
  cheaperCount: number;
  /** Сколько ячеек с ценой */
  pricedCount: number;
  /** Средняя экономия ₽/м³ по ячейкам, где они дешевле (положительная) */
  avgSavings: number;
  /** Суммарная экономия по ключевой корзине (если есть цены) */
  basketTotal: number | null;
  basketVsOurs: number | null;
  /** 0…100: доля ячеек дешевле + сила экономии */
  score: number;
  hasCoords: boolean;
};

export type SegmentWinner = {
  filler: CompetitorFiller;
  title: string;
  competitorName: string;
  competitorId: number;
  avgPrice: number;
  ourAvg: number | null;
  savingsVsOurs: number | null;
  grades: string[];
};

export type CompetitorsAnalytics = {
  /** Топ сделок: где конкурент заметно дешевле нас */
  bestDeals: GradeDeal[];
  /** Рейтинг партнёров для закупки */
  partnerRanking: PartnerScore[];
  /** Победители по сегментам */
  segmentWinners: SegmentWinner[];
  /** Ключевая корзина марок */
  basketLabels: string[];
  /** Рекомендации текстом */
  recommendations: string[];
};

const KEY_BASKET: { grade_key: string; filler: CompetitorFiller }[] = [
  { grade_key: 'М200', filler: 'granite' },
  { grade_key: 'М250', filler: 'granite' },
  { grade_key: 'М300', filler: 'granite' },
  { grade_key: 'М350', filler: 'granite' },
];

const SEGMENT_TITLES: Record<CompetitorFiller, string> = {
  granite: 'Гранит',
  dolomite: 'Известняк / доломит',
  mortar: 'Раствор',
};

function cellKey(competitorId: number, grade_key: string, filler: CompetitorFiller) {
  return `${competitorId}|${grade_key}|${filler}`;
}

function colLabel(columns: MatrixColumn[], grade_key: string, filler: CompetitorFiller) {
  return (
    columns.find((c) => c.grade_key === grade_key && c.filler === filler)?.label ||
    `${grade_key}/${filler}`
  );
}

export function buildCompetitorsAnalytics(opts: {
  competitors: Competitor[];
  columns: MatrixColumn[];
  priceMap: PriceLookup;
  ours: Record<string, number>;
}): CompetitorsAnalytics {
  const active = opts.competitors.filter((c) => c.active !== false);
  const { columns, priceMap, ours } = opts;

  const bestDeals: GradeDeal[] = [];

  for (const col of columns) {
    const our = ours[`${col.grade_key}|${col.filler}`];
    if (our == null || !(our > 0)) continue;

    let best: GradeDeal | null = null;
    for (const c of active) {
      const their = priceMap.get(cellKey(c.id, col.grade_key, col.filler));
      if (their == null || !(their > 0)) continue;
      const d = priceDelta(our, their);
      if (d == null || d >= 0) continue; // только где конкурент дешевле
      const savings = our - their;
      if (!best || savings > best.savings) {
        best = {
          label: col.label,
          grade_key: col.grade_key,
          filler: col.filler,
          our,
          their,
          savings,
          competitorId: c.id,
          competitorName: c.short_name || c.name,
        };
      }
    }
    if (best && best.savings >= 50) bestDeals.push(best);
  }

  bestDeals.sort((a, b) => b.savings - a.savings);

  const basketLabels = KEY_BASKET.map((b) => colLabel(columns, b.grade_key, b.filler));

  const partnerRanking: PartnerScore[] = active.map((c) => {
    let cheaperCount = 0;
    let pricedCount = 0;
    let savingsSum = 0;
    let basketTotal = 0;
    let basketOurs = 0;
    let basketParts = 0;

    for (const col of columns) {
      const their = priceMap.get(cellKey(c.id, col.grade_key, col.filler));
      if (their == null || !(their > 0)) continue;
      pricedCount += 1;
      const our = ours[`${col.grade_key}|${col.filler}`];
      if (our != null && our > 0) {
        const d = priceDelta(our, their);
        if (d != null && d < 0) {
          cheaperCount += 1;
          savingsSum += our - their;
        }
      }
    }

    for (const b of KEY_BASKET) {
      const their = priceMap.get(cellKey(c.id, b.grade_key, b.filler));
      const our = ours[`${b.grade_key}|${b.filler}`];
      if (their != null && their > 0) {
        basketTotal += their;
        basketParts += 1;
        if (our != null && our > 0) basketOurs += our;
      }
    }

    const avgSavings = cheaperCount > 0 ? Math.round(savingsSum / cheaperCount) : 0;
    const coverage = columns.length ? pricedCount / columns.length : 0;
    const cheaperRate = pricedCount ? cheaperCount / pricedCount : 0;
    const score = Math.round(
      Math.min(100, cheaperRate * 55 + Math.min(avgSavings / 20, 30) + coverage * 15)
    );

    return {
      competitorId: c.id,
      competitorName: c.short_name || c.name,
      cheaperCount,
      pricedCount,
      avgSavings,
      basketTotal: basketParts >= 3 ? Math.round(basketTotal) : null,
      basketVsOurs:
        basketParts >= 3 && basketOurs > 0 ? Math.round(basketOurs - basketTotal) : null,
      score,
      hasCoords: c.lat != null && c.lon != null,
    };
  });

  partnerRanking.sort((a, b) => b.score - a.score || b.avgSavings - a.avgSavings);

  const segmentWinners: SegmentWinner[] = [];
  for (const filler of ['granite', 'dolomite', 'mortar'] as CompetitorFiller[]) {
    const segCols = columns.filter((c) => c.filler === filler);
    if (!segCols.length) continue;

    let winner: SegmentWinner | null = null;
    for (const c of active) {
      const prices: number[] = [];
      const grades: string[] = [];
      let ourSum = 0;
      let ourN = 0;
      for (const col of segCols) {
        const their = priceMap.get(cellKey(c.id, col.grade_key, col.filler));
        if (their == null || !(their > 0)) continue;
        prices.push(their);
        grades.push(col.label);
        const our = ours[`${col.grade_key}|${col.filler}`];
        if (our != null && our > 0) {
          ourSum += our;
          ourN += 1;
        }
      }
      if (prices.length < 2) continue;
      const avgPrice = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
      const ourAvg = ourN >= 2 ? Math.round(ourSum / ourN) : null;
      const cand: SegmentWinner = {
        filler,
        title: SEGMENT_TITLES[filler],
        competitorName: c.short_name || c.name,
        competitorId: c.id,
        avgPrice,
        ourAvg,
        savingsVsOurs: ourAvg != null ? ourAvg - avgPrice : null,
        grades,
      };
      if (!winner || cand.avgPrice < winner.avgPrice) winner = cand;
    }
    if (winner) segmentWinners.push(winner);
  }

  const recommendations: string[] = [];
  for (const deal of bestDeals.slice(0, 5)) {
    recommendations.push(
      `Если не грузим сами ${deal.label} — бери у «${deal.competitorName}»: ${deal.their.toLocaleString('ru-RU')} ₽ (экономия ${deal.savings.toLocaleString('ru-RU')} ₽/м³ к нам).`
    );
  }

  const topPartner = partnerRanking.find((p) => p.cheaperCount > 0 && p.pricedCount >= 3);
  if (topPartner) {
    recommendations.push(
      `Лучший партнёр по индексу закупки — «${topPartner.competitorName}» (индекс ${topPartner.score}: дешевле нас в ${topPartner.cheaperCount} позициях, ср. экономия ${topPartner.avgSavings.toLocaleString('ru-RU')} ₽/м³).`
    );
  }

  for (const seg of segmentWinners) {
    if (seg.savingsVsOurs != null && seg.savingsVsOurs > 0) {
      recommendations.push(
        `Сегмент «${seg.title}»: самый низкий средний прайс у «${seg.competitorName}» (${seg.avgPrice.toLocaleString('ru-RU')} ₽) — на ${seg.savingsVsOurs.toLocaleString('ru-RU')} ₽/м³ ниже нашего среднего.`
      );
    } else {
      recommendations.push(
        `Сегмент «${seg.title}»: минимальный средний прайс у «${seg.competitorName}» (${seg.avgPrice.toLocaleString('ru-RU')} ₽).`
      );
    }
  }

  const basketLeader = partnerRanking
    .filter((p) => p.basketTotal != null)
    .sort((a, b) => (a.basketTotal ?? Infinity) - (b.basketTotal ?? Infinity))[0];
  if (basketLeader?.basketTotal != null) {
    const vs =
      basketLeader.basketVsOurs != null && basketLeader.basketVsOurs > 0
        ? `, на ${basketLeader.basketVsOurs.toLocaleString('ru-RU')} ₽ дешевле нашей корзины`
        : '';
    recommendations.push(
      `Корзина ${basketLabels.join(' + ')}: выгоднее всего у «${basketLeader.competitorName}» — ${basketLeader.basketTotal.toLocaleString('ru-RU')} ₽ суммарно${vs}.`
    );
  }

  return {
    bestDeals: bestDeals.slice(0, 8),
    partnerRanking,
    segmentWinners,
    basketLabels,
    recommendations: recommendations.slice(0, 8),
  };
}
