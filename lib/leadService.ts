import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { notifyManagers } from '@/lib/notifyManagers';
import { actorFromPayload, writeLeadHistory } from '@/lib/leadHistory';
import { LEAD_SOURCE_LABEL, type Lead, type LeadDraft } from '@/lib/leads';

export type UpsertLeadResult = {
  lead: Lead;
  created: boolean;
};

function mergePayload(
  prev: unknown,
  next: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const base =
    prev && typeof prev === 'object' ? { ...(prev as Record<string, unknown>) } : {};
  if (!next) return base;
  return { ...base, ...next };
}

/** Обновить существующий лид полями из draft (исполнители / реквизиты). */
async function updateExistingLead(existing: Lead, draft: LeadDraft): Promise<Lead> {
  const nextPayload = mergePayload(existing.raw_payload, draft.raw_payload ?? null);
  const patch: Record<string, unknown> = {
    raw_payload: nextPayload,
  };

  // null не затирает существующего исполнителя при частичном retry.
  if (draft.assigned_to != null) patch.assigned_to = draft.assigned_to;
  if (draft.phone !== undefined) patch.phone = draft.phone;
  if (draft.name !== undefined) patch.name = draft.name;
  if (draft.chat_url !== undefined) patch.chat_url = draft.chat_url;
  if (draft.raw_text !== undefined && draft.raw_text) patch.raw_text = draft.raw_text;
  if (draft.grade !== undefined) patch.grade = draft.grade;
  if (draft.volume_m3 !== undefined) patch.volume_m3 = draft.volume_m3;
  if (draft.address !== undefined) patch.address = draft.address;
  if (draft.city !== undefined) patch.city = draft.city;
  if (draft.desired_date !== undefined) patch.desired_date = draft.desired_date;
  if (draft.score !== undefined) patch.score = draft.score;

  // Не откатываем уже взятый/конвертированный статус.
  if (
    draft.status &&
    existing.status !== 'converted' &&
    existing.status !== 'rejected' &&
    existing.status !== 'spam'
  ) {
    // оставляем status как есть при retry, кроме явного new при ещё new
  }

  const { data, error } = await supabaseAdmin
    .from('leads')
    .update(patch)
    .eq('id', existing.id)
    .select('*')
    .single();

  if (error || !data) {
    console.error('[upsertLead updateExisting]', error?.message);
    return existing;
  }
  return data as Lead;
}

/** Идемпотентный upsert лида + алерт менеджерам при новом non-spam. */
export async function upsertLead(draft: LeadDraft): Promise<UpsertLeadResult | null> {
  if (!draft.source) return null;

  if (draft.external_id) {
    const { data: existing } = await supabaseAdmin
      .from('leads')
      .select('*')
      .eq('source', draft.source)
      .eq('external_id', draft.external_id)
      .maybeSingle();

    if (existing) {
      const updated = await updateExistingLead(existing as Lead, draft);
      return { lead: updated, created: false };
    }
  }

  const row = {
    source: draft.source,
    external_id: draft.external_id ?? null,
    status: draft.status ?? 'new',
    phone: draft.phone ?? null,
    name: draft.name ?? null,
    chat_url: draft.chat_url ?? null,
    raw_text: draft.raw_text ?? null,
    raw_payload: draft.raw_payload ?? null,
    grade: draft.grade ?? null,
    volume_m3: draft.volume_m3 ?? null,
    address: draft.address ?? null,
    city: draft.city ?? null,
    desired_date: draft.desired_date ?? null,
    score: draft.score ?? 0,
    listing_id: draft.listing_id ?? null,
    assigned_to: draft.assigned_to ?? null,
  };

  const { data, error } = await supabaseAdmin
    .from('leads')
    .insert(row)
    .select('*')
    .single();

  if (error) {
    // Гонка: unique violation → обновить существующий
    if (error.code === '23505' && draft.external_id) {
      const { data: existing } = await supabaseAdmin
        .from('leads')
        .select('*')
        .eq('source', draft.source)
        .eq('external_id', draft.external_id)
        .maybeSingle();
      if (existing) {
        const updated = await updateExistingLead(existing as Lead, draft);
        return { lead: updated, created: false };
      }
    }
    console.error('[upsertLead]', error);
    throw error;
  }

  const lead = data as Lead;
  const actor = actorFromPayload(lead.raw_payload);
  const sourceLabel = LEAD_SOURCE_LABEL[lead.source] || lead.source;
  const isStaffCreated = Boolean(actor.user_id || actor.user_name);
  const createAction =
    lead.source === 'demand' && isStaffCreated
      ? 'Одобрил лид из спроса'
      : isStaffCreated
        ? 'Создал лид'
        : 'Поступил новый лид';

  await writeLeadHistory({
    lead_id: lead.id,
    action: createAction,
    user_id: actor.user_id,
    user_name: actor.user_name || sourceLabel || 'Система',
    user_role: actor.user_role || (isStaffCreated ? null : 'system'),
    field_name: 'status',
    old_value: null,
    new_value: lead.status,
  });

  if (lead.assigned_to) {
    const assigneeName =
      String(
        (lead.raw_payload as Record<string, unknown> | null)?.assigned_to_name ?? '',
      ).trim() || `user #${lead.assigned_to}`;
    await writeLeadHistory({
      lead_id: lead.id,
      action: 'Назначил исполнителя',
      user_id: actor.user_id,
      user_name: actor.user_name || 'Сотрудник',
      user_role: actor.user_role,
      field_name: 'assigned_to',
      old_value: null,
      new_value: assigneeName,
    });
  }

  const shouldNotify = lead.status === 'new' || lead.status === 'in_progress';
  // Спрос, обработанный сотрудником: персональный lead_take уйдёт из /take — без общего new_lead.
  const skipBroadcast = lead.source === 'demand' && isStaffCreated;

  if (shouldNotify && !skipBroadcast) {
    const preview = (lead.raw_text || '').slice(0, 180);
    const notifyTitle =
      lead.source === 'demand' && actor.user_name
        ? `${actor.user_name} · лид из спроса`
        : `Новый лид · ${sourceLabel}`;
    await notifyManagers({
      type: 'new_lead',
      title: notifyTitle,
      body: [lead.name, lead.phone, preview].filter(Boolean).join(' · ') || 'Без текста',
      entityId: lead.id,
      priority: 'high',
    });

    await supabaseAdmin
      .from('leads')
      .update({ notified_at: new Date().toISOString() })
      .eq('id', lead.id);
  }

  return { lead, created: true };
}
