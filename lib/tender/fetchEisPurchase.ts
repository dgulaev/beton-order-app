import { extractGrades } from '@/lib/demand/extractFields';
import { formatPhoneInput } from '@/lib/phone';
import type { ParsedTenderFields } from '@/lib/tender/types';

const DEFAULT_GOSPLAN_BASE = 'https://v2test.gosplan.info';

type GosplanDetail = {
  purchase_number?: string | number;
  object_info?: string | null;
  region?: number | null;
  max_price?: number | null;
  submission_close_at?: string | null;
  customer?: string | null;
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
    // «748326448346» иногда с лишней цифрой в конце с ЕИС
    normalized = normalized.slice(0, 11);
  }
  if (normalized.length !== 11 || !normalized.startsWith('7')) return null;
  return formatPhoneInput(normalized);
}

function preferGrade(grades: string[]): string | null {
  const m = grades.find((g) => /^М\d/i.test(g));
  return m || grades[0] || null;
}

function cityFromText(...parts: Array<string | null | undefined>): string | null {
  const blob = parts.filter(Boolean).join(' ');
  if (/брянск/i.test(blob)) return 'Брянск';
  const m = blob.match(/\bг\.?\s*\.??\s*([А-ЯЁA-Za-z][а-яёa-z-]+)/i);
  return m ? m[1] : null;
}

function eisNoticeUrl(law: 'fz44' | 'fz223', purchaseNumber: string): string {
  if (law === 'fz223') {
    return `https://zakupki.gov.ru/epz/order/notice/notice223/common-info.html?regNumber=${encodeURIComponent(purchaseNumber)}`;
  }
  return `https://zakupki.gov.ru/epz/order/notice/ea20/view/common-info.html?regNumber=${encodeURIComponent(purchaseNumber)}`;
}

function extractLot(source: Record<string, unknown> | null) {
  if (!source) return {};
  const lots = asRecord(source.lots);
  const lotNode = lots
    ? asRecord(lots.lot) || (Array.isArray(lots.lot) ? asRecord(lots.lot[0]) : null)
    : null;
  const lotData = lotNode ? asRecord(lotNode.lotData) : null;
  if (!lotData) return {};

  const deliveryPlace = asRecord(lotData.deliveryPlace);
  const lotItems = asRecord(lotData.lotItems);
  const itemNode = lotItems
    ? asRecord(lotItems.lotItem) ||
      (Array.isArray(lotItems.lotItem) ? asRecord(lotItems.lotItem[0]) : null)
    : null;
  const okei = itemNode ? asRecord(itemNode.okei) : null;
  const qtyRaw = itemNode?.qty != null ? Number(itemNode.qty) : null;
  const okeiName = String(okei?.name || okei?.code || '');
  const isM3 = /куб|м3|м³|113/i.test(okeiName);
  const volume_m3 =
    qtyRaw != null && Number.isFinite(qtyRaw) && isM3 ? qtyRaw : null;

  return {
    subject: lotData.subject != null ? String(lotData.subject) : null,
    volume_m3,
    delivery: deliveryPlace?.address != null ? String(deliveryPlace.address) : null,
    initialSum: lotData.initialSum != null ? Number(lotData.initialSum) : null,
  };
}

function mapGosplanDetailToFields(
  detail: GosplanDetail,
  law: 'fz44' | 'fz223',
): ParsedTenderFields {
  const purchaseNumber =
    detail.purchase_number != null ? String(detail.purchase_number) : '';
  const source = detail.docs?.[0]?.source
    ? asRecord(detail.docs[0].source)
    : null;
  const lot = extractLot(source);

  let organization_name: string | null = null;
  let inn: string | null =
    detail.customer != null ? String(detail.customer) : null;
  let contact_name: string | null = null;
  let phone: string | null = null;
  let email: string | null = null;
  let etpPlatformUrl: string | null = null;
  let platform: string | null = 'ЕИС (zakupki.gov.ru)';

  if (source) {
    const cust = asRecord(asRecord(source.customer)?.mainInfo);
    if (cust?.fullName) organization_name = String(cust.fullName);
    if (cust?.inn) inn = String(cust.inn);

    const contact = asRecord(source.contact);
    if (contact) {
      contact_name =
        [contact.lastName, contact.firstName, contact.middleName]
          .filter(Boolean)
          .map(String)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim() || null;
      phone = formatRuPhone(String(contact.phone || ''));
      email = contact.email != null ? String(contact.email) : null;
    }

    if (source.urlVSRZ) {
      etpPlatformUrl = String(source.urlVSRZ);
      if (/lot-online/i.test(etpPlatformUrl)) platform = 'Lot-online (РАД)';
    }
    const place = asRecord(source.electronicPlaceInfo);
    const placeName = String(place?.name || '');
    if (/лот-онлайн|аукционный дом|lot-online|рад/i.test(placeName)) {
      platform = 'Lot-online (РАД)';
    } else if (/сбербанк/i.test(placeName)) platform = 'Сбербанк-АСТ';
    else if (/ртс/i.test(placeName)) platform = 'РТС-тендер';
    else if (/тэк/i.test(placeName)) platform = 'ТЭК-Торг';
    else if (/фабрикант/i.test(placeName)) platform = 'Фабрикант';
    else if (/b2b/i.test(placeName)) platform = 'B2B-Center';
  }

  const title = detail.object_info ? String(detail.object_info) : lot.subject;
  const grades = extractGrades(`${title || ''} ${lot.subject || ''}`);
  const nmckVal = lot.initialSum ?? detail.max_price ?? null;
  const regionLabel =
    detail.region != null ? REGION_NAMES[detail.region] || null : null;
  const delivery = lot.delivery || null;
  const city =
    cityFromText(delivery, organization_name, regionLabel) ||
    (regionLabel?.includes('Брянск') ? 'Брянск' : null);
  const address = delivery || regionLabel || null;
  const deadline = toIsoDate(detail.submission_close_at);
  const docsUrl = purchaseNumber ? eisNoticeUrl(law, purchaseNumber) : null;

  const comment = [
    title ? `Закупка: ${title}` : null,
    lot.subject && lot.subject !== title ? `Лот: ${lot.subject}` : null,
    purchaseNumber ? `№ ${purchaseNumber}` : null,
    nmckVal != null ? `НМЦК ${nmckVal} ₽` : null,
    lot.volume_m3 != null ? `Объём ${lot.volume_m3} м³` : null,
    email ? `Email: ${email}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    platform,
    purchase_number: purchaseNumber || null,
    law: law === 'fz223' ? '223-ФЗ' : '44-ФЗ',
    nmck: nmckVal != null ? String(nmckVal) : null,
    organization_name,
    inn,
    contact_name,
    phone,
    grade: preferGrade(grades),
    volume_m3: lot.volume_m3 ?? null,
    city,
    address,
    deadline,
    // Карточка ЕИС — основной источник; ЭТП (лот-онлайн) кладём отдельно, если есть.
    etp_url: docsUrl,
    docs_url: etpPlatformUrl || docsUrl,
    comment: comment || null,
    title: title || null,
  };
}

async function fetchGosplanDetail(
  law: 'fz44' | 'fz223',
  purchaseNumber: string,
): Promise<GosplanDetail | null> {
  let base = (process.env.GOSPLAN_BASE_URL || DEFAULT_GOSPLAN_BASE).replace(/\/$/, '');
  let apiKey = process.env.GOSPLAN_API_KEY || null;
  try {
    const { getIntegrationSettings } = await import('@/lib/integrations/settings');
    const settings = await getIntegrationSettings();
    base = (settings.gosplan.baseUrl || base).replace(/\/$/, '');
    apiKey = settings.gosplan.apiKey || apiKey;
  } catch {
    /* без .env / БД — публичный тест ГосПлана */
  }

  const path = law === 'fz44' ? '/fz44/purchases' : '/fz223/purchases';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(`${base}${path}/${encodeURIComponent(purchaseNumber)}`, {
    cache: 'no-store',
    headers,
  });
  if (!res.ok) return null;
  const json = await res.json();
  return json && typeof json === 'object' ? (json as GosplanDetail) : null;
}

/** Достаёт regNumber из URL ЕИС / lot-online / произвольной строки. */
export function extractPurchaseRegNumber(urlOrText: string): {
  regNumber: string | null;
  law: 'fz44' | 'fz223' | null;
} {
  const s = urlOrText.trim();
  const reg =
    s.match(/regNumber=(\d{11,20})/i)?.[1] ||
    s.match(/purchaseNoticeNumber=(\d{11,20})/i)?.[1] ||
    s.match(/notice223[^0-9]*(\d{11,20})/i)?.[1] ||
    s.match(/\b(3\d{10,19})\b/)?.[1] ||
    null;

  let law: 'fz44' | 'fz223' | null = null;
  if (/notice223|\/223\/|fz223|223-фз/i.test(s)) law = 'fz223';
  else if (/\/44\/|fz44|notice\/ea|223-фз/i.test(s) === false && /44-фз|epNotification|fcsNotification/i.test(s)) {
    law = 'fz44';
  } else if (/notice223|223/i.test(s)) law = 'fz223';

  // Реестровые номера 223 часто начинаются с 3 и длиной 11+.
  if (!law && reg?.startsWith('3') && reg.length >= 11) law = 'fz223';
  if (!law && reg) law = 'fz223';

  return { regNumber: reg, law };
}

/**
 * Полные поля формы из ЕИС (ГосПлан API → детализация извещения).
 * Пробует 223 и 44, если закон неизвестен.
 */
export async function fetchFieldsFromEisRegNumber(
  regNumber: string,
  preferredLaw?: 'fz44' | 'fz223' | null,
): Promise<ParsedTenderFields | null> {
  const order: Array<'fz44' | 'fz223'> = preferredLaw === 'fz44'
    ? ['fz44', 'fz223']
    : ['fz223', 'fz44'];

  for (const law of order) {
    const detail = await fetchGosplanDetail(law, regNumber);
    if (!detail?.purchase_number && !detail?.object_info) continue;
    return mapGosplanDetailToFields(detail, law);
  }
  return null;
}
