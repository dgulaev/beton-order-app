import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';

export type LeadLinkForCopy = {
  lead_id: number | null;
  lead_source: string | null;
  external_ref: string | null;
  /** Если задан — подставить в поле объёма копии (кламп до остатка плана). */
  volume?: number | null;
};

const CLOSED_STATUSES = new Set(['fulfilled', 'rejected', 'spam']);

/**
 * Чистая логика (без fetch) — удобно тестировать.
 * Возвращает null-поля, если привязывать нельзя.
 */
export function decideLeadLinkForCopy(input: {
  leadStatus: string;
  leadSource?: string | null;
  leadExternalId?: string | null;
  plan_m3: number | null;
  remaining_m3: number | null;
  /** Объём копируемой заявки (м³). */
  copyVolume?: number | null;
  fallbackLeadSource?: string | null;
  fallbackExternalRef?: string | null;
  leadId: number;
}): LeadLinkForCopy {
  const empty: LeadLinkForCopy = {
    lead_id: null,
    lead_source: null,
    external_ref: null,
  };

  const status = String(input.leadStatus || '');
  if (CLOSED_STATUSES.has(status)) return empty;

  const plan =
    input.plan_m3 != null && Number.isFinite(Number(input.plan_m3))
      ? Number(input.plan_m3)
      : null;
  const remaining =
    input.remaining_m3 != null && Number.isFinite(Number(input.remaining_m3))
      ? Number(input.remaining_m3)
      : null;

  // План закрыт по заказанному объёму
  if (plan != null && remaining != null && remaining <= 0.05) {
    return empty;
  }

  const source =
    (input.leadSource && String(input.leadSource).trim()) ||
    (input.fallbackLeadSource && String(input.fallbackLeadSource).trim()) ||
    null;
  const external =
    (input.leadExternalId && String(input.leadExternalId).trim()) ||
    (input.fallbackExternalRef && String(input.fallbackExternalRef).trim()) ||
    null;

  const copyVol =
    input.copyVolume != null && Number.isFinite(Number(input.copyVolume))
      ? Number(input.copyVolume)
      : null;

  // Есть план и остаток: клампим объём копии, чтобы бейдж не врал
  if (plan != null && remaining != null && copyVol != null && copyVol > remaining + 0.05) {
    const clamped = Math.round(Math.max(0, remaining) * 10) / 10;
    if (clamped <= 0.05) return empty;
    return {
      lead_id: input.leadId,
      lead_source: source,
      external_ref: external,
      volume: clamped,
    };
  }

  return {
    lead_id: input.leadId,
    lead_source: source,
    external_ref: external,
    ...(copyVol != null ? { volume: copyVol } : {}),
  };
}

/**
 * При копировании заявки: оставляем связь с лидом только если лид ещё открыт
 * и по плану остался объём под новую заявку.
 * Исполнен / отказ / спам / нулевой остаток → копия без лида (без бейджа).
 * Если volume копии > remaining — клампим volume (поле volume в ответе).
 */
export async function resolveLeadLinkForOrderCopy(opts: {
  leadId?: number | null;
  leadSource?: string | null;
  externalRef?: string | null;
  volume?: number | null;
}): Promise<LeadLinkForCopy> {
  const empty: LeadLinkForCopy = {
    lead_id: null,
    lead_source: null,
    external_ref: null,
  };

  const leadId =
    opts.leadId != null && Number.isFinite(Number(opts.leadId))
      ? Number(opts.leadId)
      : null;
  if (leadId == null || leadId <= 0) return empty;

  const headers = adminCifraAuthHeaders();

  try {
    const [leadRes, shipRes] = await Promise.all([
      fetch(`/api/adminCifra/leads/${leadId}`, { headers }),
      fetch(`/api/adminCifra/leads/${leadId}/shipments`, { headers }),
    ]);

    const leadJson = await leadRes.json().catch(() => ({}));
    const shipJson = await shipRes.json().catch(() => ({}));

    if (!leadRes.ok || !leadJson.success || !leadJson.lead) {
      return empty;
    }

    // Нет shipments — fail-closed: не тащим в лид вслепую
    if (!shipRes.ok || !shipJson.success) {
      return empty;
    }

    return decideLeadLinkForCopy({
      leadId,
      leadStatus: String(leadJson.lead.status || ''),
      leadSource: leadJson.lead.source ?? null,
      leadExternalId: leadJson.lead.external_id ?? null,
      plan_m3: shipJson.plan_m3 ?? null,
      remaining_m3: shipJson.remaining_m3 ?? null,
      copyVolume: opts.volume ?? null,
      fallbackLeadSource: opts.leadSource ?? null,
      fallbackExternalRef: opts.externalRef ?? null,
    });
  } catch {
    return empty;
  }
}
