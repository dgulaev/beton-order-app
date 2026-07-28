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

/** Источники, которые можно выбрать при ручном создании из админки. */
export const LEAD_MANUAL_CREATE_SOURCES = ['tender', 'manual', 'site'] as const;
export type LeadManualCreateSource = (typeof LEAD_MANUAL_CREATE_SOURCES)[number];

/** Подписи и подсказки для формы «Новый лид» (не путать с фильтром списка). */
export const LEAD_CREATE_SOURCE_META: Record<
  LeadManualCreateSource,
  { label: string; subtitle: string }
> = {
  tender: {
    label: 'Тендер',
    subtitle: 'Площадка, реквизиты закупки, НМЦК, контракты и исполнитель',
  },
  site: {
    label: 'Сайт',
    subtitle: 'Заявка с сайта завода: контакт, поставка и комментарий',
  },
  manual: {
    label: 'Физлицо / звонок',
    subtitle: 'Простой заказ: ФИО, телефон, марка и адрес поставки',
  },
};

/** Площадки для специалиста по торгам. */
export const LEAD_PLATFORM_OPTIONS = [
  'ЕИС (zakupki.gov.ru)',
  'Lot-online (РАД)',
  'Сбербанк-АСТ',
  'РТС-тендер',
  'ТЭК-Торг',
  'Фабрикант',
  'B2B-Center',
  'Авито',
  'Другое',
] as const;

/** Типичные источники для лида «Сайт». */
export const LEAD_SITE_ORIGIN_OPTIONS = [
  'Сайт завода',
  'Форма на сайте',
  'Landing',
  'WhatsApp с сайта',
  'Другое',
] as const;

export const LEAD_LAW_OPTIONS = ['44-ФЗ', '223-ФЗ', 'Коммерция', 'Иное'] as const;

export const LEAD_STATUSES = ['new', 'in_progress', 'converted', 'fulfilled', 'rejected', 'spam'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  converted: 'В отгрузке',
  fulfilled: 'Исполнен',
  rejected: 'Отказ',
  spam: 'Спам',
};

/**
 * Входящие лиды без торгового назначения:
 * «Взять в работу» / «Создать заказ» доступны всем менеджерам.
 */
export const LEAD_OPEN_WORK_SOURCES = ['avito', 'public_form'] as const;

export function isLeadWorkOpenToAll(source: string | null | undefined): boolean {
  if (!source) return false;
  return (LEAD_OPEN_WORK_SOURCES as readonly string[]).includes(String(source).toLowerCase());
}

/**
 * Отказ/спам у менеджеров только для Авито и публичной формы.
 * Спрос / тендер / площадка уже проработаны админом или специалистом по торгам.
 */
export function canManagerRejectOrSpamLead(source: string | null | undefined): boolean {
  return isLeadWorkOpenToAll(source);
}

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
  assigned_to?: number | null;
};

/** Prefill для NewOrderModal / MobileNewOrderModal */
export function leadToOrderInitialData(
  lead: Lead,
  opts?: { remainingVolumeM3?: number | null },
) {
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

  const hasPriorOrders = lead.status === 'converted' || lead.order_id != null;
  let volumeStr = '';
  if (
    opts?.remainingVolumeM3 != null &&
    Number.isFinite(opts.remainingVolumeM3)
  ) {
    const rem = Math.round(Math.max(0, opts.remainingVolumeM3) * 10) / 10;
    volumeStr = rem > 0 ? String(rem) : '';
  } else if (!hasPriorOrders && lead.volume_m3 != null) {
    volumeStr = String(lead.volume_m3);
  } else if (!hasPriorOrders && payload.volume != null) {
    volumeStr = String(payload.volume);
  }

  return {
    phone: lead.phone || String(payload.phone ?? ''),
    fullName: isLegal ? '' : fullName,
    organizationName: isLegal ? (organizationName || fullName) : organizationName,
    grade: lead.grade || String(payload.grade ?? '') || 'М300',
    volume: volumeStr,
    address: lead.address || String(payload.address ?? ''),
    delivery_date: getLeadDeliveryDateIso(lead)
      || (payload.delivery_date ? String(payload.delivery_date).slice(0, 10) : undefined)
      || (payload.deliveryDate ? String(payload.deliveryDate).slice(0, 10) : undefined)
      || undefined,
    delivery_time: deliveryTime || undefined,
    // camelCase — для MobileNewOrderModal
    deliveryDate: getLeadDeliveryDateIso(lead)
      || (payload.delivery_date ? String(payload.delivery_date).slice(0, 10) : undefined)
      || (payload.deliveryDate ? String(payload.deliveryDate).slice(0, 10) : undefined)
      || undefined,
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

/** YYYY-MM-DD или null. */
export function toLeadDateIso(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const iso = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

/** Сегодня YYYY-MM-DD в Europe/Moscow. */
export function todayMoscowYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function formatLeadDateRu(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, '0')}.${String(m).padStart(2, '0')}.${y}`;
}

/**
 * Срок подачи заявок на торги (ЕИС / ЭТП).
 * Живёт в raw_payload.deadline — это НЕ срок поставки и НЕ дедлайн работы менеджера.
 */
export function getLeadSubmissionDeadlineIso(
  lead: Pick<Lead, 'raw_payload'>,
): string | null {
  const payload =
    lead.raw_payload && typeof lead.raw_payload === 'object'
      ? (lead.raw_payload as Record<string, unknown>)
      : null;
  return toLeadDateIso(payload?.deadline);
}

/**
 * Реальная дата поставки / желаемая дата.
 * Если desired_date совпадает со сроком подачи заявок — считаем, что дату
 * поставки когда-то ошибочно скопировали из ЕИС, и игнорируем.
 */
export function getLeadDeliveryDateIso(
  lead: Pick<Lead, 'desired_date' | 'raw_payload'>,
): string | null {
  const desired = toLeadDateIso(lead.desired_date);
  if (!desired) return null;
  const submission = getLeadSubmissionDeadlineIso(lead);
  if (submission && desired === submission) return null;
  return desired;
}

/** Просрочка работы/поставки — только по дате поставки, не по сроку подачи заявок. */
export function isLeadDeliveryOverdue(
  lead: Pick<Lead, 'desired_date' | 'raw_payload' | 'status'>,
): boolean {
  if (lead.status === 'fulfilled' || lead.status === 'rejected' || lead.status === 'spam') {
    return false;
  }
  const delivery = getLeadDeliveryDateIso(lead);
  if (!delivery) return false;
  return delivery < todayMoscowYmd();
}

export type LeadDateHints = {
  /** Окончание подачи заявок (ЕИС). */
  submissionDeadline: string | null;
  /** Дата поставки (если известна и не спутана с подачей заявок). */
  deliveryDate: string | null;
  /** Просрочена ли поставка. */
  deliveryOverdue: boolean;
};

export function getLeadDateHints(
  lead: Pick<Lead, 'desired_date' | 'raw_payload' | 'status'>,
): LeadDateHints {
  const submissionDeadline = getLeadSubmissionDeadlineIso(lead);
  const deliveryDate = getLeadDeliveryDateIso(lead);
  return {
    submissionDeadline,
    deliveryDate,
    deliveryOverdue: isLeadDeliveryOverdue(lead),
  };
}

/**
 * Для форм: если в desired_date лежит копия срока подачи — очищаем поле «Дата поставки».
 */
export function sanitizeDesiredDateForForm(
  desiredDate: unknown,
  submissionDeadline: unknown,
): string {
  const desired = toLeadDateIso(desiredDate) || '';
  const submission = toLeadDateIso(submissionDeadline) || '';
  if (desired && submission && desired === submission) return '';
  return desired;
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
