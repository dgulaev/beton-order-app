import { getIntegrationSettings } from '@/lib/integrations/settings';
import type { DemandCollector, DemandDraft } from './types';

const DEFAULT_BASE = 'https://v2test.gosplan.info';
/** Тестовый сервер: 10 req/min с IP → пауза между запросами. */
const MIN_INTERVAL_MS = 6500;
const REGION_NAMES: Record<number, string> = {
  32: 'Брянская область',
};

/** purchase_type (ГосПлан) → сегмент URL карточки 44-ФЗ на zakupki.gov.ru */
const FZ44_NOTICE_PATH: Record<string, string> = {
  epNotificationEF2020: 'ea20',
  epNotificationEF: 'ea20',
  epNotificationEZK2020: 'zk20',
  epNotificationEZK: 'zk20',
  epNotificationEZT2020: 'ezt20',
  epNotificationEOK2020: 'ok20',
  epNotificationEOK: 'ok20',
  epNotificationEOKOU: 'okou20',
  epNotificationEOKD: 'okd20',
  epNotificationEOKOU2020: 'okou20',
  fcsNotificationEF: 'ea44',
  fcsNotificationZK: 'zk44',
  fcsNotificationOK: 'ok44',
};

type GosplanPurchase = {
  purchase_number?: string | number;
  object_info?: string | null;
  region?: number | null;
  published_at?: string | null;
  max_price?: number | null;
  okpd2?: string[] | null;
  ktru?: string[] | null;
  customers?: string[] | null;
  customer?: string | null;
  purchase_type?: string | null;
  stage?: number | null;
  submission_close_at?: string | null;
  docs?: Array<{
    doc_type?: string;
    published_at?: string;
    source?: Record<string, unknown>;
  }> | null;
};

function parseList(raw: string | undefined, fallback: string[]): string[] {
  if (!raw?.trim()) return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseRegions(regionsRaw: string): number[] {
  return parseList(regionsRaw, ['32'])
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let lastRequestAt = 0;

async function rateLimitedFetch(url: string, init?: RequestInit): Promise<Response> {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
  return fetch(url, init);
}

function regionLabel(code: number | null | undefined): string | null {
  if (code == null) return null;
  return REGION_NAMES[code] || `Регион ${code}`;
}

function formatRub(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return `${Math.round(n).toLocaleString('ru-RU')} ₽`;
}

function formatDt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16).replace('T', ' ');
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function zakupkiUrl44(purchaseNumber: string, purchaseType?: string | null): string {
  const path = (purchaseType && FZ44_NOTICE_PATH[purchaseType]) || 'ea20';
  return `https://zakupki.gov.ru/epz/order/notice/${path}/view/common-info.html?regNumber=${encodeURIComponent(purchaseNumber)}`;
}

function zakupkiUrl223(purchaseNumber: string): string {
  return `https://zakupki.gov.ru/223/purchase/public/purchase/info/common-info.html?regNumber=${encodeURIComponent(purchaseNumber)}`;
}

function defaultZakupkiUrl(law: 'fz44' | 'fz223', purchaseNumber: string, purchaseType?: string | null): string {
  return law === 'fz223' ? zakupkiUrl223(purchaseNumber) : zakupkiUrl44(purchaseNumber, purchaseType);
}

/** ОКПД2 23.63* — и закупка не «простыня» из сотен кодов. */
function hasFocusedReadyMixClassifier(item: GosplanPurchase): boolean {
  const codes = [...(item.okpd2 || []), ...(item.ktru || [])].map(String);
  const ready = codes.filter((c) => /^23\.63/.test(c));
  if (!ready.length) return false;
  return codes.length <= 8;
}

/**
 * Явные формулировки поставки товарного бетона / БСТ / раствора.
 * Важно: в JS \\b не работает с кириллицей — границы задаём явно.
 */
const CONCRETE_RE =
  /(смес[ьи]\s*бетон|бетонн?\w*\s*смес|товарн\w*\s*бетон|бетон\w*\s*товарн|(^|[^а-яёa-z0-9])бст([^а-яёa-z0-9]|$)|раствор\w*\s*строитель|строительн\w*\s*раствор|пескобетон|(^|[^а-яёa-z0-9])бетон)/i;
const NOISE_RE =
  /(бетонн\w*\s*камн|камн\w*\s*бетон|бортов|лоток|лотк\w*|железобетон|(^|[^а-яёa-z0-9])жби([^а-яёa-z0-9]|$)|плит[аыу]\s*бетон|издел\w*\s*бетон|санузел|медицин|лекарств|инфуз|сух\w*\s*смес|смес\w*\s*сух|штукатур|короед|плиточн|гипсокартон)/i;

function isConcreteRelevant(item: GosplanPurchase): boolean {
  const title = (item.object_info || '').trim();
  if (title) {
    if (NOISE_RE.test(title)) return false;
    return CONCRETE_RE.test(title);
  }
  return hasFocusedReadyMixClassifier(item);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pickNoticeSource(detail: GosplanPurchase): Record<string, unknown> | null {
  const docs = detail.docs || [];
  for (const doc of docs) {
    const src = asRecord(doc.source);
    if (!src) continue;
    // 223: urlVSRZ / customer; 44: commonInfo.href
    if (src.urlVSRZ || src.customer || src.commonInfo || src.contact) return src;
  }
  return asRecord(docs[0]?.source) || null;
}

function extractLotData(notice: Record<string, unknown> | null): {
  subject?: string;
  volume_m3?: number | null;
  delivery?: string | null;
  initialSum?: number | null;
} {
  if (!notice) return {};
  const lots = asRecord(notice.lots);
  const lotNode = lots ? asRecord(lots.lot) || (Array.isArray(lots.lot) ? asRecord(lots.lot[0]) : null) : null;
  const lotData = lotNode ? asRecord(lotNode.lotData) : null;
  if (!lotData) return {};

  const deliveryPlace = asRecord(lotData.deliveryPlace);
  const lotItems = asRecord(lotData.lotItems);
  const itemNode = lotItems
    ? asRecord(lotItems.lotItem) || (Array.isArray(lotItems.lotItem) ? asRecord(lotItems.lotItem[0]) : null)
    : null;
  const okei = itemNode ? asRecord(itemNode.okei) : null;
  const qtyRaw = itemNode?.qty != null ? Number(itemNode.qty) : null;
  const okeiName = String(okei?.name || okei?.code || '');
  const isM3 = /куб|м3|м³|113/i.test(okeiName);
  const volume_m3 = qtyRaw != null && Number.isFinite(qtyRaw) && isM3 ? qtyRaw : null;

  return {
    subject: lotData.subject != null ? String(lotData.subject) : undefined,
    volume_m3,
    delivery: deliveryPlace?.address != null ? String(deliveryPlace.address) : null,
    initialSum: lotData.initialSum != null ? Number(lotData.initialSum) : null,
  };
}

function extractEnrichment(law: 'fz44' | 'fz223', detail: GosplanPurchase) {
  const notice = pickNoticeSource(detail);
  const purchaseNumber = detail.purchase_number != null ? String(detail.purchase_number) : '';
  const lot = extractLotData(notice);

  let external_url = defaultZakupkiUrl(law, purchaseNumber, detail.purchase_type);
  let etp_url: string | null = null;
  let docs_url: string | null = null;
  let customerName: string | null = null;
  let customerInn: string | null = null;
  let contactLine: string | null = null;
  let methodName: string | null = null;
  let closeAt: string | null = detail.submission_close_at ?? null;

  if (notice) {
    if (law === 'fz44') {
      const common = asRecord(notice.commonInfo);
      if (common?.href) external_url = String(common.href);
      const etp = asRecord(common?.ETP);
      if (etp?.url) etp_url = String(etp.url);
      if (common?.placingWay && asRecord(common.placingWay)?.name) {
        methodName = String(asRecord(common.placingWay)!.name);
      }
      const resp = asRecord(notice.purchaseResponsibleInfo);
      const org = asRecord(resp?.responsibleOrgInfo) || asRecord(resp?.responsibleInfo);
      const orgMain = asRecord(org?.fullName) ? org : asRecord(org);
      // 44 structure varies; try common paths
      const responsibleOrg = asRecord(resp?.responsibleOrgInfo);
      if (responsibleOrg?.fullName) customerName = String(responsibleOrg.fullName);
      if (responsibleOrg?.INN) customerInn = String(responsibleOrg.INN);
      const contact = asRecord(resp?.responsibleInfo) || asRecord(resp?.contactPersonInfo);
      if (contact) {
        const fio = [contact.lastName, contact.firstName, contact.middleName].filter(Boolean).join(' ');
        const phone = contact.contactPhone || contact.phone;
        const email = contact.contactEMail || contact.email;
        contactLine = [fio, phone, email].filter(Boolean).map(String).join(', ') || null;
      }
    } else {
      if (notice.urlVSRZ) etp_url = String(notice.urlVSRZ);
      // Публичная карточка ЕИС 223; lk.* — только для авторизованных
      external_url = zakupkiUrl223(purchaseNumber);
      const cust = asRecord(asRecord(notice.customer)?.mainInfo);
      if (cust?.fullName) customerName = String(cust.fullName);
      if (cust?.inn) customerInn = String(cust.inn);
      if (notice.purchaseCodeName) methodName = String(notice.purchaseCodeName);
      if (notice.submissionCloseDateTime) closeAt = String(notice.submissionCloseDateTime);
      const contact = asRecord(notice.contact);
      if (contact) {
        const fio = [contact.lastName, contact.firstName, contact.middleName].filter(Boolean).join(' ');
        contactLine = [fio, contact.phone, contact.email].filter(Boolean).map(String).join(', ') || null;
      }
      const att = asRecord(notice.attachments);
      const doc = att ? asRecord(att.document) || (Array.isArray(att.document) ? asRecord(att.document[0]) : null) : null;
      if (doc?.url) docs_url = String(doc.url);
    }
  }

  const price = formatRub(lot.initialSum ?? detail.max_price);
  const lines = [
    law === 'fz44' ? '44-ФЗ' : '223-ФЗ',
    purchaseNumber ? `№ ${purchaseNumber}` : null,
    price ? `НМЦК ${price}` : null,
    lot.volume_m3 != null ? `Объём ${lot.volume_m3} м³` : null,
    lot.subject && lot.subject !== detail.object_info ? `Лот: ${lot.subject}` : null,
    customerName ? `Заказчик: ${customerName}${customerInn ? ` (ИНН ${customerInn})` : ''}` : null,
    contactLine ? `Контакт: ${contactLine}` : null,
    lot.delivery ? `Поставка: ${lot.delivery}` : null,
    methodName ? `Способ: ${methodName}` : null,
    closeAt ? `Приём заявок до: ${formatDt(closeAt)}` : null,
    detail.published_at ? `Опубликовано: ${formatDt(detail.published_at)}` : null,
    etp_url ? `Площадка: ${etp_url}` : null,
    docs_url ? `Документация: ${docs_url}` : null,
  ].filter(Boolean) as string[];

  return {
    external_url,
    etp_url,
    docs_url,
    body: lines.join('\n'),
    volume_m3: lot.volume_m3 ?? null,
    region: lot.delivery || regionLabel(detail.region),
    customerName,
    customerInn,
    contactLine,
  };
}

function toDraft(item: GosplanPurchase, law: 'fz44' | 'fz223'): DemandDraft | null {
  const purchaseNumber = item.purchase_number != null ? String(item.purchase_number) : '';
  if (!purchaseNumber || !isConcreteRelevant(item)) return null;

  const title = (item.object_info || '').trim() || `Закупка ${purchaseNumber}`;
  const price = formatRub(item.max_price);
  const body = [
    law === 'fz44' ? '44-ФЗ' : '223-ФЗ',
    `№ ${purchaseNumber}`,
    price ? `НМЦК ${price}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    source: 'gosplan',
    external_id: `${law}:${purchaseNumber}`,
    external_url: defaultZakupkiUrl(law, purchaseNumber, item.purchase_type),
    title,
    body,
    region: regionLabel(item.region),
    published_at: item.published_at ?? null,
    buyer_type: 'b2b',
    raw_payload: { law, ...item },
  };
}

async function fetchJson(
  url: string,
  apiKey: string | null,
): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await rateLimitedFetch(url, { cache: 'no-store', headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GosPlan ${res.status}${text ? `: ${text.slice(0, 180)}` : ''}`);
  }
  return res.json();
}

async function fetchPurchases(
  base: string,
  path: '/fz44/purchases' | '/fz223/purchases',
  params: URLSearchParams,
  apiKey: string | null,
): Promise<GosplanPurchase[]> {
  const json = await fetchJson(`${base}${path}?${params.toString()}`, apiKey);
  return Array.isArray(json) ? (json as GosplanPurchase[]) : [];
}

async function fetchPurchaseDetail(
  base: string,
  law: 'fz44' | 'fz223',
  purchaseNumber: string,
  apiKey: string | null,
): Promise<GosplanPurchase | null> {
  const path = law === 'fz44' ? '/fz44/purchases' : '/fz223/purchases';
  try {
    const json = await fetchJson(`${base}${path}/${encodeURIComponent(purchaseNumber)}`, apiKey);
    return json && typeof json === 'object' ? (json as GosplanPurchase) : null;
  } catch (e) {
    console.warn('[gosplan] detail', purchaseNumber, e);
    return null;
  }
}

async function enrichDraft(
  draft: DemandDraft,
  base: string,
  apiKey: string | null,
): Promise<DemandDraft> {
  const law = draft.external_id?.startsWith('fz223:') ? 'fz223' : 'fz44';
  const purchaseNumber = draft.external_id?.split(':')[1];
  if (!purchaseNumber) return draft;

  const detail = await fetchPurchaseDetail(base, law, purchaseNumber, apiKey);
  if (!detail) return draft;

  const enrich = extractEnrichment(law, detail);
  return {
    ...draft,
    external_url: enrich.external_url,
    body: enrich.body,
    region: enrich.region || draft.region,
    volume_m3: enrich.volume_m3,
    raw_payload: {
      ...(draft.raw_payload || {}),
      law,
      enriched: true,
      customerName: enrich.customerName,
      customerInn: enrich.customerInn,
      contactLine: enrich.contactLine,
      etp_url: enrich.etp_url,
      docs_url: enrich.docs_url,
      detail,
    },
  };
}

/**
 * Коллектор ГосПлан API (ЕИС).
 * Тумблер/регионы/ключ — из Интеграций (БД) с fallback на env.
 * Доп. тюнинг (classifiers, limit, enrich) пока только через env.
 */
export const gosplanCollector: DemandCollector = {
  source: 'gosplan',

  async collect(): Promise<DemandDraft[]> {
    const { gosplan } = await getIntegrationSettings();
    if (!gosplan.enabled) return [];

    const base = (gosplan.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
    const apiKey = gosplan.apiKey;
    const regions = parseRegions(gosplan.regions);
    const classifiers = parseList(process.env.GOSPLAN_CLASSIFIERS, ['23.63']);
    const publishedForpast = process.env.GOSPLAN_PUBLISHED_FORPAST?.trim() || '180d';
    const limit = Math.min(100, Math.max(1, Number(process.env.GOSPLAN_LIMIT || 50) || 50));
    const textQueries = parseList(process.env.GOSPLAN_QUERIES, [
      '"смесь бетонная" бетон БСТ -камн -бортов -лоток -жби',
    ]);
    const enrichOn = !['0', 'false', 'off'].includes(
      (process.env.GOSPLAN_ENRICH || '1').trim().toLowerCase(),
    );

    const byId = new Map<string, DemandDraft>();

    const add = (law: 'fz44' | 'fz223', items: GosplanPurchase[]) => {
      for (const item of items) {
        const draft = toDraft(item, law);
        if (draft?.external_id) byId.set(draft.external_id, draft);
      }
    };

    for (const region of regions) {
      const common = () => {
        const p = new URLSearchParams();
        p.set('limit', String(limit));
        p.set('skip', '0');
        p.set('region', String(region));
        p.set('published_forpast', publishedForpast);
        for (const c of classifiers.slice(0, 5)) p.append('classifier', c);
        return p;
      };

      add('fz44', await fetchPurchases(base, '/fz44/purchases', common(), apiKey));
      add('fz223', await fetchPurchases(base, '/fz223/purchases', common(), apiKey));

      for (const q of textQueries.slice(0, 2)) {
        const p44 = new URLSearchParams();
        p44.set('limit', String(limit));
        p44.set('skip', '0');
        p44.set('region', String(region));
        p44.set('published_forpast', publishedForpast);
        p44.set('object_info', q);
        add('fz44', await fetchPurchases(base, '/fz44/purchases', p44, apiKey));

        const p223 = new URLSearchParams();
        p223.set('limit', String(limit));
        p223.set('skip', '0');
        p223.set('region', String(region));
        p223.set('published_forpast', publishedForpast);
        p223.set('object_info', q);
        add('fz223', await fetchPurchases(base, '/fz223/purchases', p223, apiKey));
      }
    }

    const drafts = Array.from(byId.values());
    if (!enrichOn) return drafts;

    const enriched: DemandDraft[] = [];
    for (const draft of drafts) {
      enriched.push(await enrichDraft(draft, base, apiKey));
    }
    return enriched;
  },
};
