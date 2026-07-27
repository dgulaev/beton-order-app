import type { DemandCollector, DemandDraft } from './types';

/** Боевой деплой на Vercel. Локальный `next start` (NODE_ENV=production) не блокируем. */
function isVercelProduction(): boolean {
  return process.env.VERCEL_ENV === 'production';
}

/** Демо только при DEMAND_DEMO=1 и не на Vercel production. */
export const demoCollector: DemandCollector = {
  source: 'demo',

  async collect(): Promise<DemandDraft[]> {
    if (process.env.DEMAND_DEMO !== '1') return [];
    if (isVercelProduction()) {
      console.warn('[demand] DEMAND_DEMO=1 проигнорирован на Vercel production');
      return [];
    }

    const day = new Date().toISOString().slice(0, 10);
    return [
      {
        source: 'demo',
        external_id: `demo-beton-${day}`,
        external_url: null,
        title: `Поставка товарного бетона М300, Брянск (${day})`,
        body: 'Требуется бетон М300 объёмом 45 м³ с доставкой на объект в Брянске. Срочно.',
        region: 'Брянская область',
        published_at: new Date().toISOString(),
        buyer_type: 'b2b',
        raw_payload: { demo: true },
      },
    ];
  },
};
