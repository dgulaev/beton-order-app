import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { canProcessTenders } from '@/lib/demandProcessAccess';
import { transferDemandContractsToLead } from '@/lib/demandContractsServer';
import { parseIdList } from '@/lib/leadAssigneeIds';
import { notifyLeadTakeRequired, resolveStaffRefs } from '@/lib/leadAssigneesServer';
import { writeLeadHistory } from '@/lib/leadHistory';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { upsertLead } from '@/lib/leadService';
import type { LeadDraft } from '@/lib/leads';

type Ctx = { params: Promise<{ id: string }> };

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Отправить обработанный спрос в лиды (создать лид). */
export async function POST(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;
  if (!canProcessTenders(auth.user)) {
    return NextResponse.json(
      { success: false, error: 'Отправку в лиды делают админы и специалист по торгам' },
      { status: 403 },
    );
  }

  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ success: false, error: 'Некорректный JSON' }, { status: 400 });
  }

  const { data: item, error } = await supabaseAdmin
    .from('demand_items')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !item) {
    return NextResponse.json({ success: false, error: 'Не найдено' }, { status: 404 });
  }

  if (item.status === 'ignored') {
    return NextResponse.json(
      { success: false, error: 'Запись в игноре — сначала верните в «Новые»' },
      { status: 409 },
    );
  }

  const savedProcessing =
    item.raw_payload &&
    typeof item.raw_payload === 'object' &&
    (item.raw_payload as Record<string, unknown>).processing &&
    typeof (item.raw_payload as Record<string, unknown>).processing === 'object'
      ? ((item.raw_payload as Record<string, unknown>).processing as Record<string, unknown>)
      : {};

  const merged = { ...savedProcessing, ...body };

  const organizationName = str(merged.organization_name);
  const contactName = str(merged.contact_name) || str(merged.name);
  const platform = str(merged.platform) || str(merged.platform_name);
  const purchaseNumber = str(merged.purchase_number);
  const law = str(merged.law);
  const etpUrl = str(merged.etp_url) || str(item.external_url);
  const docsUrl = str(merged.docs_url);
  const deadline = str(merged.deadline);
  const comment = str(merged.comment);
  const inn = str(merged.inn);
  const phone = str(merged.phone);
  const grade = str(merged.grade) || item.grades?.[0] || null;
  const city = str(merged.city) || str(item.region);
  const address = str(merged.address) || city;
  const desiredDate = str(merged.desired_date) || deadline;

  let volume = numOrNull(merged.volume_m3);
  if (volume == null) volume = item.volume_m3 != null ? Number(item.volume_m3) : null;
  if (volume != null && volume < 0) {
    return NextResponse.json({ success: false, error: 'Некорректный объём' }, { status: 400 });
  }

  const nmck = numOrNull(merged.nmck);
  if (merged.nmck != null && merged.nmck !== '' && nmck == null) {
    return NextResponse.json({ success: false, error: 'Некорректная НМЦК' }, { status: 400 });
  }

  let assignedTo: number | null = null;
  let assignedToName: string | null = null;
  if (merged.assigned_to != null && merged.assigned_to !== '') {
    const aid = Number(merged.assigned_to);
    if (!Number.isFinite(aid) || aid <= 0) {
      return NextResponse.json({ success: false, error: 'Некорректный исполнитель' }, { status: 400 });
    }
    const refs = await resolveStaffRefs([aid]);
    if (refs.length === 0) {
      return NextResponse.json({ success: false, error: 'Сотрудник не найден' }, { status: 400 });
    }
    assignedTo = refs[0].user_id;
    assignedToName = refs[0].name;
  }

  const coIdsRaw = parseIdList(merged.co_assignees).filter((uid) => uid !== assignedTo);
  const coRefs = await resolveStaffRefs(coIdsRaw);
  if (coIdsRaw.length > 0 && coRefs.length !== coIdsRaw.length) {
    return NextResponse.json(
      { success: false, error: 'Один из соисполнителей не найден' },
      { status: 400 },
    );
  }
  const coAssigneeIds = coRefs.map((r) => r.user_id);
  const coAssigneeNames = coRefs.map((r) => r.name);

  const notifyIds = [
    ...(assignedTo ? [assignedTo] : []),
    ...coAssigneeIds,
  ].filter((uid) => uid !== auth.user.user_id);

  if (notifyIds.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: 'Назначьте исполнителя или соисполнителя, чтобы отправить в работу',
      },
      { status: 400 },
    );
  }

  // Уже в лидах — обновляем исполнителей и (при необходимости) шлём задание снова.
  if (item.lead_id || item.status === 'taken') {
    if (!item.lead_id) {
      return NextResponse.json(
        { success: false, error: 'Спрос помечен taken без lead_id — обратитесь к админу' },
        { status: 409 },
      );
    }
    const draftRetry: LeadDraft = {
      source: 'demand',
      external_id: `demand:${item.id}`,
      assigned_to: assignedTo,
      raw_payload: {
        assigned_to: assignedTo,
        assigned_to_name: assignedToName,
        co_assignees: coAssigneeIds,
        co_assignee_names: coAssigneeNames,
        sent_to_work_at: new Date().toISOString(),
        sent_to_work_by: auth.user.user_id,
        sent_to_work_by_name: auth.user.full_name || 'Сотрудник',
      },
    };
    const updated = await upsertLead(draftRetry);
    const lead = updated?.lead;
    if (!lead) {
      return NextResponse.json({ success: false, error: 'Не удалось обновить лид' }, { status: 500 });
    }

    let contractsWarning: string | null = null;
    try {
      await transferDemandContractsToLead({
        demandId: id,
        leadId: lead.id,
        uploadedBy: auth.user.user_id,
        uploadedByName: auth.user.full_name || 'Сотрудник',
      });
    } catch (e) {
      contractsWarning = e instanceof Error ? e.message : 'Файлы не перенесены';
      console.error('[take transfer contracts]', e);
    }

    await notifyLeadTakeRequired({
      leadId: lead.id,
      userIds: notifyIds,
      preview: lead.raw_text || undefined,
    });

    return NextResponse.json({
      success: true,
      lead,
      already: true,
      sent_to_work: true,
      ...(contractsWarning ? { warning: contractsWarning } : {}),
    });
  }

  const summaryParts = [
    organizationName,
    purchaseNumber ? `№ ${purchaseNumber}` : null,
    law,
    platform,
    nmck != null ? `НМЦК ${nmck.toLocaleString('ru-RU')} ₽` : null,
    comment,
    item.title,
    item.body,
    etpUrl,
  ].filter(Boolean);

  const draft: LeadDraft = {
    source: 'demand',
    external_id: `demand:${item.id}`,
    phone,
    name: contactName || organizationName,
    chat_url: etpUrl,
    raw_text: summaryParts.join('\n\n'),
    grade,
    volume_m3: volume,
    address,
    city,
    desired_date: desiredDate,
    status: 'new',
    score: item.fit_score ?? 50,
    assigned_to: assignedTo,
    raw_payload: {
      demand_id: item.id,
      demand_source: item.source,
      source: item.source,
      created_by: auth.user.user_id,
      created_by_name: auth.user.full_name || 'Сотрудник',
      created_by_role: auth.user.role,
      processed_from_demand: true,
      customer_type: organizationName || inn ? 'legal' : 'physical',
      organization_name: organizationName,
      contact_name: contactName,
      full_name: contactName,
      inn,
      platform,
      platform_name: platform,
      purchase_number: purchaseNumber,
      law,
      nmck,
      etp_url: etpUrl,
      docs_url: docsUrl,
      deadline,
      comment,
      assigned_to: assignedTo,
      assigned_to_name: assignedToName,
      co_assignees: coAssigneeIds,
      co_assignee_names: coAssigneeNames,
      sent_to_work_at: new Date().toISOString(),
      sent_to_work_by: auth.user.user_id,
      sent_to_work_by_name: auth.user.full_name || 'Сотрудник',
    },
  };

  const result = await upsertLead(draft);
  if (!result) {
    return NextResponse.json({ success: false, error: 'Не удалось создать лид' }, { status: 500 });
  }

  const prevPayload =
    item.raw_payload && typeof item.raw_payload === 'object'
      ? (item.raw_payload as Record<string, unknown>)
      : {};

  // Атомарно: только если ещё никто не привязал lead_id (защита от двойного клика).
  const { data: linked, error: linkError } = await supabaseAdmin
    .from('demand_items')
    .update({
      status: 'taken',
      lead_id: result.lead.id,
      raw_payload: {
        ...prevPayload,
        processing: {
          ...savedProcessing,
          organization_name: organizationName,
          contact_name: contactName,
          platform,
          purchase_number: purchaseNumber,
          law,
          nmck,
          etp_url: etpUrl,
          docs_url: docsUrl,
          deadline,
          comment,
          inn,
          phone,
          grade,
          volume_m3: volume,
          city,
          address,
          desired_date: desiredDate,
        },
        sent_to_leads_at: new Date().toISOString(),
        sent_to_leads_by: auth.user.user_id,
        sent_to_leads_by_name: auth.user.full_name || 'Сотрудник',
        lead_id: result.lead.id,
      },
    })
    .eq('id', id)
    .is('lead_id', null)
    .select('*')
    .maybeSingle();

  if (linkError) {
    return NextResponse.json({ success: false, error: linkError.message }, { status: 500 });
  }

  if (!linked) {
    const { data: again } = await supabaseAdmin
      .from('demand_items')
      .select('lead_id')
      .eq('id', id)
      .maybeSingle();
    const { data: existingLead } = again?.lead_id
      ? await supabaseAdmin.from('leads').select('*').eq('id', again.lead_id).maybeSingle()
      : { data: null };
    return NextResponse.json({
      success: true,
      lead: existingLead || result.lead,
      already: true,
    });
  }

  let contractsWarning: string | null = null;
  try {
    await transferDemandContractsToLead({
      demandId: id,
      leadId: result.lead.id,
      uploadedBy: auth.user.user_id,
      uploadedByName: auth.user.full_name || 'Сотрудник',
    });
  } catch (e) {
    contractsWarning = e instanceof Error ? e.message : 'Файлы не перенесены';
    console.error('[take transfer contracts]', e);
  }

  await notifyLeadTakeRequired({
    leadId: result.lead.id,
    userIds: notifyIds,
    preview: result.lead.raw_text || undefined,
  });

  const actorName = auth.user.full_name || 'Сотрудник';
  await writeLeadHistory({
    lead_id: result.lead.id,
    action: 'Отправил в работу со Спроса',
    user_id: auth.user.user_id,
    user_name: actorName,
    user_role: auth.user.role,
    field_name: 'send_to_work',
    old_value: null,
    new_value: notifyIds.join(','),
  });

  return NextResponse.json({
    success: true,
    lead: result.lead,
    created: result.created,
    sent_to_work: true,
    ...(contractsWarning ? { warning: contractsWarning } : {}),
  });
}
