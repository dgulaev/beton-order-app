import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { notifyManagers } from '@/lib/notifyManagers';
import { LEAD_SOURCE_LABEL, type Lead, type LeadDraft } from '@/lib/leads';

export type UpsertLeadResult = {
  lead: Lead;
  created: boolean;
};

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
      return { lead: existing as Lead, created: false };
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
  };

  const { data, error } = await supabaseAdmin
    .from('leads')
    .insert(row)
    .select('*')
    .single();

  if (error) {
    // Гонка: unique violation → вернуть существующий
    if (error.code === '23505' && draft.external_id) {
      const { data: existing } = await supabaseAdmin
        .from('leads')
        .select('*')
        .eq('source', draft.source)
        .eq('external_id', draft.external_id)
        .maybeSingle();
      if (existing) return { lead: existing as Lead, created: false };
    }
    console.error('[upsertLead]', error);
    throw error;
  }

  const lead = data as Lead;
  const shouldNotify = lead.status === 'new' || lead.status === 'in_progress';

  if (shouldNotify) {
    const preview = (lead.raw_text || '').slice(0, 180);
    const sourceLabel = LEAD_SOURCE_LABEL[lead.source] || lead.source;
    await notifyManagers({
      type: 'new_lead',
      title: `Новый лид · ${sourceLabel}`,
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
