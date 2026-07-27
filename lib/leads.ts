export const LEAD_SOURCES = ['avito', 'site', 'public_form', 'tender', 'manual', 'demand'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number] | string;

/** Подписи источников для UI */
export const LEAD_SOURCE_LABEL: Record<string, string> = {
  avito: 'Авито',
  site: 'Сайт',
  public_form: 'Публичная форма',
  tender: 'Тендер',
  manual: 'Вручную',
  demand: 'Спрос',
};

export const LEAD_STATUSES = ['new', 'in_progress', 'converted', 'rejected', 'spam'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  converted: 'В заказ',
  rejected: 'Отказ',
  spam: 'Спам',
};

export type Lead = {
  id: number;
  source: LeadSource;
  external_id: string | null;
  status: LeadStatus;
  phone: string | null;
  name: string | null;
  chat_url: string | null;
  raw_text: string | null;
  raw_payload: Record<string, unknown> | null;
  grade: string | null;
  volume_m3: number | null;
  address: string | null;
  city: string | null;
  desired_date: string | null;
  score: number | null;
  assigned_to: number | null;
  order_id: number | null;
  listing_id: string | null;
  notified_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LeadDraft = {
  source: LeadSource;
  external_id?: string | null;
  status?: LeadStatus;
  phone?: string | null;
  name?: string | null;
  chat_url?: string | null;
  raw_text?: string | null;
  raw_payload?: Record<string, unknown> | null;
  grade?: string | null;
  volume_m3?: number | null;
  address?: string | null;
  city?: string | null;
  desired_date?: string | null;
  score?: number | null;
  listing_id?: string | null;
};

/** Prefill для NewOrderModal / MobileNewOrderModal */
export function leadToOrderInitialData(lead: Lead) {
  const payload = (lead.raw_payload && typeof lead.raw_payload === 'object')
    ? lead.raw_payload
    : {};
  const customerTypeRaw = String(
    payload.customer_type ?? payload.customerType ?? '',
  );
  const isLegal = /юридичес/i.test(customerTypeRaw) || customerTypeRaw === 'legal';
  const fullName = String(payload.full_name ?? payload.fullName ?? lead.name ?? '');
  const organizationName = String(
    payload.organization_name ?? payload.organizationName ?? '',
  );
  const deliveryTime = String(payload.delivery_time ?? payload.deliveryTime ?? '');
  const inn = String(payload.inn ?? '');
  const formComment = String(payload.comment ?? '');
  const sourceLabel = LEAD_SOURCE_LABEL[lead.source] || lead.source;
  const referredRaw = payload.referred_by ?? payload.referredBy;
  const referredBy = referredRaw != null && Number.isFinite(Number(referredRaw))
    ? Number(referredRaw)
    : undefined;

  // Для публичной формы raw_text — сводка полей; в comment кладём только текст клиента
  const isPublicForm = lead.source === 'public_form';
  const commentParts = isPublicForm
    ? [formComment || null, lead.chat_url ? `Чат: ${lead.chat_url}` : null, `Источник: ${sourceLabel}`]
    : [
        formComment,
        lead.raw_text && lead.raw_text !== formComment ? lead.raw_text : null,
        lead.chat_url ? `Чат: ${lead.chat_url}` : null,
        `Источник: ${sourceLabel}`,
      ];

  return {
    phone: lead.phone || String(payload.phone ?? ''),
    fullName: isLegal ? '' : fullName,
    organizationName: isLegal ? (organizationName || fullName) : organizationName,
    grade: lead.grade || String(payload.grade ?? '') || 'М300',
    volume: lead.volume_m3 != null
      ? String(lead.volume_m3)
      : (payload.volume != null ? String(payload.volume) : ''),
    address: lead.address || String(payload.address ?? ''),
    delivery_date: lead.desired_date
      || (payload.delivery_date ? String(payload.delivery_date) : undefined)
      || (payload.deliveryDate ? String(payload.deliveryDate) : undefined),
    delivery_time: deliveryTime || undefined,
    // camelCase — для MobileNewOrderModal
    deliveryDate: lead.desired_date
      || (payload.delivery_date ? String(payload.delivery_date) : undefined)
      || (payload.deliveryDate ? String(payload.deliveryDate) : undefined),
    deliveryTime: deliveryTime || undefined,
    inn: inn || undefined,
    comment: commentParts.filter(Boolean).join('\n\n'),
    customerType: isLegal ? ('legal' as const) : ('physical' as const),
    referredBy,
    referred_by: referredBy,
    lead_id: lead.id,
    lead_source: lead.source,
    external_ref: lead.external_id || lead.listing_id || undefined,
  };
}

const CONCRETE_KEYWORDS =
  /\b(бетон|раствор|м3|м³|куб|марка|м100|м150|м200|м250|м300|м350|м400|доставк)/i;

export function scoreLeadText(text: string | null | undefined): number {
  if (!text || !text.trim()) return 20;
  let score = 40;
  if (CONCRETE_KEYWORDS.test(text)) score += 30;
  if (/\d+\s*(м3|м³|куб)/i.test(text)) score += 15;
  if (/м\s*\d{2,3}|в\s*\d{1,2}/i.test(text)) score += 10;
  if (/срочн|сегодня|завтра/i.test(text)) score += 5;
  return Math.min(100, score);
}

export function extractLeadFields(text: string | null | undefined): Partial<LeadDraft> {
  if (!text) return {};
  const volumeMatch = text.match(/(\d+[.,]?\d*)\s*(м3|м³|куб)/i);
  const gradeMatch = text.match(/\b(М\s*\d{2,3}|M\s*\d{2,3}|В\s*\d{1,2}(?:[.,]\d)?)\b/i);
  const phoneMatch = text.match(/(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}/);

  let grade: string | null = null;
  if (gradeMatch) {
    const raw = gradeMatch[1].replace(/\s+/g, '').toUpperCase().replace(/^M/, 'М');
    grade = raw;
  }

  return {
    volume_m3: volumeMatch ? parseFloat(volumeMatch[1].replace(',', '.')) : null,
    grade,
    phone: phoneMatch ? phoneMatch[0] : null,
    score: scoreLeadText(text),
  };
}

export function isLikelySpam(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  if (/(реклам|казино|крипт|займ|кредит без)/i.test(t) && !CONCRETE_KEYWORDS.test(t)) return true;
  return false;
}
