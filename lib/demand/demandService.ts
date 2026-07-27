import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { notifyManagers } from '@/lib/notifyManagers';
import { demandSourceLabel } from '@/lib/demand/labels';
import { enrichDemandFields, getMinDemandVolume, scoreDemandItem } from './score';
import { getDemandCollectors, type DemandDraft } from './collectors';

const ALERT_THRESHOLD = Number(process.env.DEMAND_ALERT_SCORE || 60);

export async function upsertDemandDraft(draft: DemandDraft) {
  const enriched = enrichDemandFields(draft.title, draft.body);
  const volume = draft.volume_m3 ?? enriched.volume_m3;
  const grades = draft.grades ?? enriched.grades;
  const deliveryNeeded = draft.delivery_needed ?? enriched.delivery_needed;
  const score = scoreDemandItem({
    title: draft.title,
    body: draft.body,
    region: draft.region,
    volume_m3: volume,
    grades,
    delivery_needed: deliveryNeeded,
  });

  const row = {
    source: draft.source,
    external_id: draft.external_id ?? null,
    external_url: draft.external_url ?? null,
    title: draft.title,
    body: draft.body ?? null,
    region: draft.region ?? null,
    published_at: draft.published_at ?? null,
    volume_m3: volume,
    grades,
    delivery_needed: deliveryNeeded,
    buyer_type: draft.buyer_type ?? null,
    fit_score: score,
    raw_payload: draft.raw_payload ?? null,
  };

  if (draft.external_id) {
    const { data: existing } = await supabaseAdmin
      .from('demand_items')
      .select('id, status, fit_score')
      .eq('source', draft.source)
      .eq('external_id', draft.external_id)
      .maybeSingle();

    if (existing) {
      const { data } = await supabaseAdmin
        .from('demand_items')
        .update(row)
        .eq('id', existing.id)
        .select('*')
        .single();
      return { item: data, created: false };
    }
  }

  const { data, error } = await supabaseAdmin
    .from('demand_items')
    .insert({ ...row, status: 'new' })
    .select('*')
    .single();

  if (error) throw error;

  const minVol = getMinDemandVolume();
  const volumeOk = volume == null || volume >= minVol;
  if (score >= ALERT_THRESHOLD && volumeOk) {
    await notifyManagers({
      type: 'demand_hit',
      title: `Спрос ${score}% · ${demandSourceLabel(draft.source)}`,
      body: draft.title.slice(0, 200),
      entityId: data.id,
      priority: score >= 80 ? 'high' : 'medium',
    });
  }

  return { item: data, created: true };
}

export async function runDemandRadar(): Promise<{ collected: number; created: number; errors: string[] }> {
  const collectors = getDemandCollectors();
  let collected = 0;
  let created = 0;
  const errors: string[] = [];

  for (const c of collectors) {
    try {
      const drafts = await c.collect();
      collected += drafts.length;
      for (const d of drafts) {
        const r = await upsertDemandDraft(d);
        if (r.created) created += 1;
      }
    } catch (e: unknown) {
      errors.push(`${c.source}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { collected, created, errors };
}
