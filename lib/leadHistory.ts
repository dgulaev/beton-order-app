import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { LEAD_STATUS_LABEL, type LeadStatus } from '@/lib/leads';

export type LeadHistoryEntry = {
  id: number;
  lead_id: number;
  action: string;
  user_id: number | null;
  user_name: string | null;
  user_role: string | null;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
};

export type LeadHistoryDraft = {
  lead_id: number;
  action: string;
  user_id?: number | null;
  user_name?: string | null;
  user_role?: string | null;
  field_name?: string | null;
  old_value?: string | null;
  new_value?: string | null;
};

export function leadStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return LEAD_STATUS_LABEL[status as LeadStatus] || status;
}

/** Запись в lead_history (ошибка не роняет основной поток). */
export async function writeLeadHistory(entry: LeadHistoryDraft): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('lead_history').insert({
      lead_id: entry.lead_id,
      action: entry.action,
      user_id: entry.user_id ?? null,
      user_name: entry.user_name?.trim() || 'Сотрудник',
      user_role: entry.user_role ?? null,
      field_name: entry.field_name ?? null,
      old_value: entry.old_value ?? null,
      new_value: entry.new_value ?? null,
    });
    if (error) console.error('[lead_history]', error.message);
  } catch (e) {
    console.error('[lead_history]', e);
  }
}

export function actorFromPayload(payload: Record<string, unknown> | null | undefined): {
  user_id: number | null;
  user_name: string | null;
  user_role: string | null;
} {
  if (!payload || typeof payload !== 'object') {
    return { user_id: null, user_name: null, user_role: null };
  }
  const idRaw = payload.created_by ?? payload.createdBy;
  const user_id = idRaw != null && Number.isFinite(Number(idRaw)) ? Number(idRaw) : null;
  const user_name = String(payload.created_by_name ?? payload.createdByName ?? '').trim() || null;
  const user_role = String(payload.created_by_role ?? payload.createdByRole ?? '').trim() || null;
  return { user_id, user_name, user_role };
}
