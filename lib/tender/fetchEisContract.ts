import { extractGrades, extractVolume } from '@/lib/demand/extractFields';
import { formatPhoneInput } from '@/lib/phone';
import {
  extractPurchaseRegNumber,
  fetchFieldsFromEisRegNumber,
} from '@/lib/tender/fetchEisPurchase';
import type { ParsedTenderFields } from '@/lib/tender/types';

const DEFAULT_GOSPLAN_BASE = 'https://v2test.gosplan.info';
const FALLBACK_BASES = [
  'https://v2.gosplan.info',
  'https://v2test.gosplan.info',
] as const;

type GosplanContractDetail = {
  reg_num?: string | null;
  purchase_number?: string | number | null;
  subject?: string | null;
  price?: number | null;
  customer?: string | null;
  region?: number | null;
  exe_start?: string | null;
  exe_end?: string | null;
  docs?: Array<{ source?: Record<string, unknown> }> | null;
};

const REGION_NAMES: Record<number, string> = {
  32: 'Брянская область',
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function toIsoDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = String(raw).match(/(\d{2})\.(\d{2})\.(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function formatRuPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10) return null;
  let normalized = digits;
  if (normalized.length === 11 && normalized.startsWith('8')) {
    normalized = `7${normalized.slice(1)}`;
  } else if (normalized.length === 10) {
    normalized = `7${normalized}`;
  } else if (normalized.startsWith('7') && normalized.length > 11) {
    normalized = normalized.slice(0, 11);
  }
  if (normalized.length !== 11 || !normalized.startsWith('7')) return null;
  return formatPhoneInput(normalized);
}

function preferGrade(grades: string[]): string | null {
  return grades.find((g) => /^М\d/i.test(g)) || grades[0] || null;
}

function cityFromText(...parts: Array<string | null | undefined>): string | null {
  // Сначала адрес поставки (parts[0]), потом остальное — иначе «Брянская обл.» перекрывает «г.Карачев».
  for (const part of parts) {
    if (!part) continue;
    const m = String(part).match(/\bг\.?\s*\.??\s*([А-ЯЁA-Za-z][а-яёa-z-]+)/i);
    if (m) return m[1];
  }
  const blob = parts.filter(Boolean).join(' ');
  if (/карачев/i.test(blob)) return 'Карачев';
  if (/брянск/i.test(blob)) return 'Брянск';
  return null;
}

function eisNoticeUrl(law: 'fz44' | 'fz223', purchaseNumber: string): string {
  if (law === 'fz223') {
    return `https://zakupki.gov.ru/epz/order/notice/notice223/common-info.html?regNumber=${encodeURIComponent(purchaseNumber)}`;
  }
  return `https://zakupki.gov.ru/epz/order/notice/ea20/view/common-info.html?regNumber=${encodeURIComponent(purchaseNumber)}`;
}

function eisContractUrl(reestrNumber: string): string {
  return `https://zakupki.gov.ru/epz/contract/contractCard/common-info.html?reestrNumber=${encodeURIComponent(reestrNumber)}`;
}

/** Реестровый номер контракта из URL карточки ЕИС. */
export function extractContractReestrNumber(urlOrText: string): string | null {
  const s = urlOrText.trim();
  const fromQuery = s.match(/reestrNumber=(\d{11,25})/i)?.[1];
  if (fromQuery) return fromQuery;
  if (/\/epz\/contract\//i.test(s) || /contractCard/i.test(s)) {
    return s.match(/\b(\d{18,25})\b/)?.[1] || null;
  }
  return null;
}

function mergeFields(
  primary: ParsedTenderFields,
  secondary: ParsedTenderFields | null,
): ParsedTenderFields {
  if (!secondary) return primary;
  const out: ParsedTenderFields = { ...primary };
  for (const key of Object.keys(secondary) as Array<keyof ParsedTenderFields>) {
    const cur = out[key];
    const next = secondary[key];
    if (cur == null || cur === '') {
      (out as Record<string, unknown>)[key] = next;
    }
  }
  return out;
}

function pickCustomer(source: Record<string, unknown> | null): {
  organization_name: string | null;
  inn: string | null;
} {
  const customer = asRecord(source?.customer);
  if (!customer) return { organization_name: null, inn: null };
  return {
    organization_name: customer.fullName != null ? String(customer.fullName) : null,
    inn: customer.inn != null || customer.INN != null
      ? String(customer.inn || customer.INN)
      : null,
  };
}

function pickDelivery(source: Record<string, unknown> | null): string | null {
  const info = asRecord(source?.deliveryPlaceInfo);
  if (!info) return null;
  const byGar = asRecord(info.byGARInfo);
  const place = byGar?.deliveryPlace != null ? String(byGar.deliveryPlace) : null;
  const gar = byGar?.GARAddress != null ? String(byGar.GARAddress) : null;
  return place || gar || null;
}

function pickProduct(source: Record<string, unknown> | null): {
  name: string | null;
  volume_m3: number | null;
} {
  const products = asRecord(source?.products);
  const productNode = products
    ? asRecord(products.product) ||
      (Array.isArray(products.product) ? asRecord(products.product[0]) : null)
    : null;
  if (!productNode) return { name: null, volume_m3: null };
  const name = productNode.name != null ? String(productNode.name) : null;
  const okei = asRecord(productNode.OKEI || productNode.okei);
  const okeiName = String(okei?.name || okei?.code || '');
  const qty = productNode.quantity != null ? Number(productNode.quantity) : null;
  const isM3 = /куб|м3|м³|113/i.test(okeiName);
  const volume_m3 =
    qty != null && Number.isFinite(qty) && isM3 ? qty : extractVolume(name || '');
  return { name, volume_m3: volume_m3 ?? null };
}

function mapContractToFields(
  detail: GosplanContractDetail,
  law: 'fz44' | 'fz223',
  originalUrl?: string | null,
): ParsedTenderFields {
  const reestr =
    detail.reg_num != null ? String(detail.reg_num) : null;
  const purchaseNumber =
    detail.purchase_number != null ? String(detail.purchase_number) : null;
  const source = detail.docs?.[0]?.source
    ? asRecord(detail.docs[0].source)
    : null;
  const cust = pickCustomer(source);
  const delivery = pickDelivery(source);
  const product = pickProduct(source);
  const title = detail.subject ? String(detail.subject) : product.name;
  const grades = extractGrades(`${title || ''} ${product.name || ''}`);
  const regionLabel =
    detail.region != null ? REGION_NAMES[detail.region] || null : null;
  const address = delivery || regionLabel || null;
  const city = cityFromText(delivery, cust.organization_name, regionLabel, title);
  const inn =
    cust.inn ||
    (detail.customer != null ? String(detail.customer) : null);
  const noticeUrl = purchaseNumber ? eisNoticeUrl(law, purchaseNumber) : null;
  const contractUrl = reestr ? eisContractUrl(reestr) : originalUrl || null;

  const comment = [
    title ? `Контракт: ${title}` : null,
    reestr ? `Реестр контракта № ${reestr}` : null,
    purchaseNumber ? `Извещение № ${purchaseNumber}` : null,
    detail.price != null ? `Цена контракта ${detail.price} ₽` : null,
    product.volume_m3 != null ? `Объём ${product.volume_m3} м³` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    platform: 'ЕИС (zakupki.gov.ru)',
    purchase_number: purchaseNumber,
    law: law === 'fz223' ? '223-ФЗ' : '44-ФЗ',
    nmck: detail.price != null ? String(detail.price) : null,
    organization_name: cust.organization_name,
    inn,
    contact_name: null,
    phone: null,
    grade: preferGrade(grades),
    volume_m3: product.volume_m3,
    city,
    address,
    deadline: null,
    desired_date: toIsoDate(detail.exe_end) || toIsoDate(detail.exe_start),
    etp_url: originalUrl?.includes('zakupki.gov.ru')
      ? originalUrl
      : contractUrl || noticeUrl,
    docs_url: noticeUrl || contractUrl,
    comment: comment || null,
    title: title || null,
  };
}

async function gosplanBaseAndKey(): Promise<{ base: string; apiKey: string | null }> {
  let base = (process.env.GOSPLAN_BASE_URL || DEFAULT_GOSPLAN_BASE).replace(/\/$/, '');
  let apiKey = process.env.GOSPLAN_API_KEY?.trim() || null;
  try {
    const { getIntegrationSettings } = await import('@/lib/integrations/settings');
    const settings = await getIntegrationSettings();
    base = (settings.gosplan.baseUrl || base).replace(/\/$/, '');
    apiKey = settings.gosplan.apiKey || apiKey;
  } catch {
    /* env */
  }
  return { base, apiKey };
}

async function fetchGosplanContract(
  law: 'fz44' | 'fz223',
  reestrNumber: string,
): Promise<GosplanContractDetail | null> {
  const { base, apiKey } = await gosplanBaseAndKey();
  const bases = [
    base,
    ...FALLBACK_BASES.map((b) => b.replace(/\/$/, '')),
  ].filter((b, i, arr) => arr.indexOf(b) === i);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  for (const host of bases) {
    try {
      const res = await fetch(
        `${host}/${law}/contracts/${encodeURIComponent(reestrNumber)}`,
        { cache: 'no-store', headers },
      );
      if (!res.ok) continue;
      const json = await res.json();
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        return json as GosplanContractDetail;
      }
    } catch {
      /* try next host */
    }
  }
  return null;
}

/**
 * Поля формы из карточки контракта ЕИС (reestrNumber).
 * Затем дозаполняет контакты/сроки из связанного извещения.
 */
export async function fetchFieldsFromEisContractReestrNumber(
  reestrNumber: string,
  opts?: { originalUrl?: string | null; preferredLaw?: 'fz44' | 'fz223' | null },
): Promise<ParsedTenderFields | null> {
  const order: Array<'fz44' | 'fz223'> =
    opts?.preferredLaw === 'fz223' ? ['fz223', 'fz44'] : ['fz44', 'fz223'];

  for (const law of order) {
    const detail = await fetchGosplanContract(law, reestrNumber);
    if (!detail?.reg_num && !detail?.purchase_number && !detail?.subject) continue;

    let fields = mapContractToFields(detail, law, opts?.originalUrl);

    const purchaseNumber = fields.purchase_number;
    if (purchaseNumber) {
      const fromPurchase = await fetchFieldsFromEisRegNumber(purchaseNumber, law);
      if (fromPurchase) {
        const keptEtp = fields.etp_url;
        const keptNmck = fields.nmck;
        const keptOrg = fields.organization_name;
        const keptInn = fields.inn;
        const keptAddress = fields.address;
        const keptDesired = fields.desired_date;
        fields = mergeFields(fields, fromPurchase);
        fields.etp_url = keptEtp || fields.etp_url;
        fields.nmck = keptNmck || fields.nmck;
        fields.organization_name = keptOrg || fields.organization_name;
        fields.inn = keptInn || fields.inn;
        fields.address = keptAddress || fields.address;
        fields.desired_date = keptDesired || fields.desired_date;
        fields.phone = formatRuPhone(fields.phone) || fields.phone;
      }
    }

    return fields;
  }
  return null;
}

/** Определение типа ссылки ЕИС: контракт vs извещение. */
export function extractEisLinkIds(urlOrText: string): {
  contractReestrNumber: string | null;
  purchaseNumber: string | null;
  law: 'fz44' | 'fz223' | null;
} {
  const s = urlOrText.trim();
  const contractReestrNumber = extractContractReestrNumber(s);
  let { regNumber: purchaseNumber, law } = extractPurchaseRegNumber(s);

  // На карточке контракта голый номер в URL — это reestrNumber, не извещение.
  if (contractReestrNumber && purchaseNumber === contractReestrNumber) {
    purchaseNumber = null;
  }
  if (contractReestrNumber && /\/epz\/contract\//i.test(s) && !/regNumber=/i.test(s)) {
    purchaseNumber = null;
  }

  if (!law && /\/epz\/contract\//i.test(s)) {
    // контракты 44 часто начинаются с 3 и длинные; закон уточним из ГосПлана
    law = null;
  }

  return { contractReestrNumber, purchaseNumber, law };
}
