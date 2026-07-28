import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { canProcessTenders } from '@/lib/demandProcessAccess';
import { parseIdList } from '@/lib/leadAssigneeIds';
import { notifyLeadTakeRequired, resolveStaffRefs } from '@/lib/leadAssigneesServer';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { upsertLead } from '@/lib/leadService';
import {
  LEAD_MANUAL_CREATE_SOURCES,
  type LeadDraft,
  type LeadManualCreateSource,
} from '@/lib/leads';

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const status = request.nextUrl.searchParams.get('status');
  const source = request.nextUrl.searchParams.get('source');
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') || 100), 300);

  let query = supabaseAdmin
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);
  if (source) query = query.eq('source', source);

  const { data, error } = await query;
  if (error) {
    console.error('[leads GET]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, leads: data ?? [] });
}

/** Ручное создание лида (торги / вручную / сайт). */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();

    const sourceRaw = String(body.source || 'tender').toLowerCase();
    if (!(LEAD_MANUAL_CREATE_SOURCES as readonly string[]).includes(sourceRaw)) {
      return NextResponse.json(
        { success: false, error: 'Источник должен быть: tender, manual или site' },
        { status: 400 },
      );
    }
    const source = sourceRaw as LeadManualCreateSource;

    // Расширенное создание с площадки / торгов — только админ и специалист по торгам.
    // Простое manual/site (например с мобилки) — всем ролям раздела «Продажи».
    const tenderLike =
      source === 'tender' ||
      Boolean(
        String(body.platform || body.platform_name || '').trim() ||
          String(body.purchase_number || '').trim() ||
          String(body.law || '').trim() ||
          (body.nmck != null && body.nmck !== '') ||
          String(body.etp_url || '').trim() ||
          String(body.docs_url || '').trim(),
      );
    if (tenderLike && !canProcessTenders(auth.user)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Создание лидов с площадок — для админов и специалиста по торгам',
        },
        { status: 403 },
      );
    }

    let volume: number | null = null;
    if (body.volume_m3 != null && body.volume_m3 !== '') {
      const n = Number(body.volume_m3);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ success: false, error: 'Некорректный объём' }, { status: 400 });
      }
      volume = n;
    }

    let nmck: number | null = null;
    if (body.nmck != null && body.nmck !== '') {
      const n = Number(String(body.nmck).replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ success: false, error: 'Некорректная НМЦК' }, { status: 400 });
      }
      nmck = n;
    }

    let assignedTo: number | null = null;
    let assignedToName: string | null = null;
    const wantsAssignees =
      (body.assigned_to != null && body.assigned_to !== '') ||
      (Array.isArray(body.co_assignees) && body.co_assignees.length > 0) ||
      (typeof body.co_assignees === 'string' && body.co_assignees.trim() !== '');
    if (wantsAssignees && !canProcessTenders(auth.user)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Назначать исполнителей могут только админы и специалист по торгам',
        },
        { status: 403 },
      );
    }
    if (body.assigned_to != null && body.assigned_to !== '') {
      const id = Number(body.assigned_to);
      if (!Number.isFinite(id) || id <= 0) {
        return NextResponse.json({ success: false, error: 'Некорректный исполнитель' }, { status: 400 });
      }
      const refs = await resolveStaffRefs([id]);
      if (refs.length === 0) {
        return NextResponse.json({ success: false, error: 'Сотрудник не найден' }, { status: 400 });
      }
      assignedTo = refs[0].user_id;
      assignedToName = refs[0].name;
    }

    const coIdsRaw = parseIdList(body.co_assignees).filter((id) => id !== assignedTo);
    const coRefs = await resolveStaffRefs(coIdsRaw);
    if (coIdsRaw.length > 0 && coRefs.length !== coIdsRaw.length) {
      return NextResponse.json(
        { success: false, error: 'Один из соисполнителей не найден' },
        { status: 400 },
      );
    }
    let coAssigneeIds = coRefs.map((r) => r.user_id);
    let coAssigneeNames = coRefs.map((r) => r.name);

    // Простое manual/site без исполнителя — создатель ведёт лид сам.
    if (
      (source === 'manual' || source === 'site') &&
      !tenderLike &&
      assignedTo == null &&
      coAssigneeIds.length === 0
    ) {
      assignedTo = auth.user.user_id;
      assignedToName = auth.user.full_name || 'Сотрудник';
    }

    const organizationName = String(body.organization_name || '').trim() || null;
    const contactName = String(body.contact_name || body.name || '').trim() || null;
    const platform = String(body.platform || body.platform_name || '').trim() || null;
    const purchaseNumber = String(body.purchase_number || '').trim() || null;
    const law = String(body.law || '').trim() || null;
    const etpUrl = String(body.etp_url || '').trim() || null;
    const docsUrl = String(body.docs_url || '').trim() || null;
    const deadline = String(body.deadline || '').trim() || null;
    const comment = String(body.comment || '').trim() || null;
    const inn = String(body.inn || '').trim() || null;

    const summaryParts = [
      organizationName,
      purchaseNumber ? `№ ${purchaseNumber}` : null,
      law,
      platform,
      nmck != null ? `НМЦК ${nmck.toLocaleString('ru-RU')} ₽` : null,
      comment,
      String(body.raw_text || '').trim() || null,
    ].filter(Boolean);

    const draft: LeadDraft = {
      source,
      external_id: purchaseNumber ? `${source}:${purchaseNumber}` : null,
      phone: body.phone ?? null,
      name: contactName || organizationName,
      chat_url: etpUrl,
      raw_text: summaryParts.join('\n') || comment || '',
      grade: body.grade ?? null,
      volume_m3: volume,
      address: body.address ?? null,
      city: body.city ?? null,
      desired_date: body.desired_date || deadline || null,
      status: 'new',
      score: source === 'tender' ? 70 : 50,
      assigned_to: assignedTo,
      raw_payload: {
        created_by: auth.user.user_id,
        created_by_name: auth.user.full_name || 'Сотрудник',
        created_by_role: auth.user.role,
        customer_type:
          body.customer_type === 'legal' || body.customer_type === 'physical'
            ? body.customer_type
            : organizationName || inn
              ? 'legal'
              : 'physical',
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
      },
    };

    const result = await upsertLead(draft);
    if (!result) {
      return NextResponse.json({ success: false, error: 'Не удалось создать лид' }, { status: 400 });
    }

    const notifyIds = [
      ...(assignedTo ? [assignedTo] : []),
      ...coAssigneeIds,
    ].filter((id) => id !== auth.user.user_id);

    if (result.created && notifyIds.length > 0) {
      await notifyLeadTakeRequired({
        leadId: result.lead.id,
        userIds: notifyIds,
        preview: result.lead.raw_text || undefined,
      });
    }

    return NextResponse.json({
      success: true,
      lead: result.lead,
      created: result.created,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
