import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { canActOnAssignedLeadWork, getLeadAssigneeIds, parseIdList } from '@/lib/leadAssigneeIds';
import { notifyLeadTakeRequired, resolveStaffRefs } from '@/lib/leadAssigneesServer';
import { canProcessTenders } from '@/lib/demandProcessAccess';
import { removeLeadContractStorageForLead } from '@/lib/leadContractsServer';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { maybeMarkClientSpamFromLead } from '@/lib/clientSpam';
import { leadStatusLabel, writeLeadHistory } from '@/lib/leadHistory';
import {
  canManagerRejectOrSpamLead,
  isLeadWorkOpenToAll,
  LEAD_STATUSES,
  LEAD_STATUS_LABEL,
  type Lead,
  type LeadStatus,
} from '@/lib/leads';

function strOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

type Ctx = { params: Promise<{ id: string }> };

const LOCKED_FOR_NON_ADMIN: LeadStatus[] = ['rejected', 'spam', 'fulfilled'];

function asPayload(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {};
}

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  const { data: lead, error } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[leads GET id]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  if (!lead) {
    return NextResponse.json({ success: false, error: 'Лид не найден' }, { status: 404 });
  }

  return NextResponse.json({ success: true, lead });
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const patch: Record<string, unknown> = {};
    let nextPayload = asPayload(null);
    let payloadDirty = false;

    if (body.order_id !== undefined) {
      return NextResponse.json(
        { success: false, error: 'order_id меняется только при создании заявки из лида' },
        { status: 400 },
      );
    }
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('leads')
      .select('id, status, order_id, assigned_to, raw_payload, raw_text, source')
      .eq('id', id)
      .maybeSingle();

    if (existingError || !existing) {
      return NextResponse.json({ success: false, error: 'Лид не найден' }, { status: 404 });
    }

    nextPayload = asPayload(existing.raw_payload);
    const oldAssigneeIds = getLeadAssigneeIds(existing as Lead);

    let assigneeNameForHistory: string | null = null;
    let assigneeChanged = false;
    let coChanged = false;
    let coNamesForHistory: string | null = null;

    // «В отгрузке» вручную — только reopen из fulfilled (админ/торги).
    if (body.status === 'converted' && body.status !== existing.status) {
      if (existing.status !== 'fulfilled' || !canProcessTenders(auth.user)) {
        return NextResponse.json(
          {
            success: false,
            error:
              existing.status === 'fulfilled'
                ? 'Вернуть в отгрузку могут админ и специалист по торгам'
                : 'Статус «В отгрузке» выставляется при создании заявки',
          },
          { status: existing.status === 'fulfilled' ? 403 : 400 },
        );
      }
    }

    // Из converted нельзя уйти в произвольный статус — только fulfilled.
    if (
      existing.status === 'converted' &&
      body.status != null &&
      body.status !== 'converted' &&
      body.status !== 'fulfilled'
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Лид в отгрузке — можно только отметить «Исполнен»',
        },
        { status: 409 },
      );
    }

    if (
      existing.status === 'fulfilled' &&
      body.status != null &&
      body.status !== 'fulfilled' &&
      body.status !== 'converted' &&
      !canProcessTenders(auth.user)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Исполненный лид могут вернуть только админ и специалист по торгам',
        },
        { status: 403 },
      );
    }

    if (
      body.status != null &&
      body.status !== existing.status &&
      LOCKED_FOR_NON_ADMIN.includes(existing.status as LeadStatus) &&
      !canProcessTenders(auth.user)
    ) {
      return NextResponse.json(
        {
          success: false,
          error: `Лид в статусе «${LEAD_STATUS_LABEL[existing.status as LeadStatus] || existing.status}» — вернуть могут админ и специалист по торгам`,
        },
        { status: 403 },
      );
    }

    if (body.status != null) {
      if (!LEAD_STATUSES.includes(body.status)) {
        return NextResponse.json({ success: false, error: 'Некорректный статус' }, { status: 400 });
      }

      // «Взять в работу»: Авито/публичная форма — всем; иначе — назначенный или админ/торги.
      if (
        body.status === 'in_progress' &&
        body.status !== existing.status &&
        !canProcessTenders(auth.user) &&
        !canActOnAssignedLeadWork(existing as Lead, auth.user.user_id)
      ) {
        return NextResponse.json(
          {
            success: false,
            error: 'Сначала вас должны назначить исполнителем или соисполнителем',
          },
          { status: 403 },
        );
      }

      // Отказ/спам по спросу/тендеру/площадке — только админ и специалист по торгам.
      if (
        (body.status === 'rejected' || body.status === 'spam') &&
        body.status !== existing.status &&
        !canProcessTenders(auth.user) &&
        !canManagerRejectOrSpamLead(String(existing.source || ''))
      ) {
        return NextResponse.json(
          {
            success: false,
            error: 'Отказ и спам по этим лидам ставят админы и специалист по торгам',
          },
          { status: 403 },
        );
      }

      // «Исполнен» — назначенный / админ / торги; нужен converted или хотя бы одна заявка.
      if (body.status === 'fulfilled' && body.status !== existing.status) {
        if (
          !canProcessTenders(auth.user) &&
          !canActOnAssignedLeadWork(existing as Lead, auth.user.user_id)
        ) {
          return NextResponse.json(
            { success: false, error: 'Отметить исполненным может назначенный исполнитель или админ' },
            { status: 403 },
          );
        }
        let hasOrders = existing.status === 'converted' || existing.order_id != null;
        if (!hasOrders) {
          const { count } = await supabaseAdmin
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('lead_id', id);
          hasOrders = (count ?? 0) > 0;
        }
        if (!hasOrders) {
          return NextResponse.json(
            { success: false, error: 'Нельзя отметить исполненным лид без заявок' },
            { status: 400 },
          );
        }
        if (existing.status !== 'converted' && existing.status !== 'in_progress') {
          return NextResponse.json(
            { success: false, error: 'Исполненным можно отметить лид в отгрузке' },
            { status: 400 },
          );
        }
      }

      patch.status = body.status;
      if (body.status === 'in_progress') {
        // Автоназначение себе — только Авито / публичная форма (менеджер берёт себе).
        // Админ / Екатерина по спросу-тендеру себя не назначают.
        if (existing.assigned_to == null && isLeadWorkOpenToAll(String(existing.source || ''))) {
          patch.assigned_to = auth.user.user_id;
          nextPayload.assigned_to = auth.user.user_id;
          nextPayload.assigned_to_name = auth.user.full_name || 'Сотрудник';
        }
        nextPayload.taken_by = auth.user.user_id;
        nextPayload.taken_by_name = auth.user.full_name || 'Сотрудник';
        nextPayload.taken_at = new Date().toISOString();
        payloadDirty = true;
      }
    }

    // «Отправить в работу» — задание назначенным, без смены статуса и без самоназначения.
    if (body.send_to_work === true) {
      if (!canProcessTenders(auth.user)) {
        return NextResponse.json(
          { success: false, error: 'Отправлять в работу могут админы и специалист по торгам' },
          { status: 403 },
        );
      }
      const assigneeIds = getLeadAssigneeIds(existing as Lead);
      if (assigneeIds.length === 0) {
        return NextResponse.json(
          { success: false, error: 'Сначала назначьте исполнителя или соисполнителя' },
          { status: 400 },
        );
      }

      const notifyIds = assigneeIds.filter((uid) => uid !== auth.user.user_id);
      if (notifyIds.length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Назначьте исполнителя (не себя), чтобы отправить задание в работу',
          },
          { status: 400 },
        );
      }

      const prevSentAt = String(nextPayload.sent_to_work_at || '').trim();
      const prevSentMs = prevSentAt ? Date.parse(prevSentAt) : NaN;
      const recentlySent =
        Number.isFinite(prevSentMs) && Date.now() - prevSentMs < 20_000;

      if (recentlySent) {
        return NextResponse.json({
          success: true,
          lead: existing,
          sent_to_work: true,
          already: true,
        });
      }

      await notifyLeadTakeRequired({
        leadId: id,
        userIds: notifyIds,
        preview: existing.raw_text || undefined,
      });

      nextPayload.sent_to_work_at = new Date().toISOString();
      nextPayload.sent_to_work_by = auth.user.user_id;
      nextPayload.sent_to_work_by_name = auth.user.full_name || 'Сотрудник';
      payloadDirty = true;

      const { data: sentLead, error: sentError } = await supabaseAdmin
        .from('leads')
        .update({ raw_payload: nextPayload })
        .eq('id', id)
        .select('*')
        .single();

      if (sentError) {
        return NextResponse.json({ success: false, error: sentError.message }, { status: 500 });
      }

      const actorName = auth.user.full_name || 'Сотрудник';
      const notifyNames = notifyIds
        .map((uid) => {
          const names = Array.isArray(nextPayload.co_assignee_names)
            ? (nextPayload.co_assignee_names as unknown[])
            : [];
          const coIds = Array.isArray(nextPayload.co_assignees)
            ? (nextPayload.co_assignees as unknown[]).map((x) => Number(x))
            : [];
          const idx = coIds.indexOf(uid);
          if (idx >= 0 && names[idx]) return String(names[idx]);
          if (Number(nextPayload.assigned_to) === uid) {
            return String(nextPayload.assigned_to_name || `#${uid}`);
          }
          return `#${uid}`;
        })
        .join(', ');
      await writeLeadHistory({
        lead_id: id,
        action: 'Отправил в работу',
        user_id: auth.user.user_id,
        user_name: actorName,
        user_role: auth.user.role,
        field_name: 'send_to_work',
        old_value: null,
        new_value: notifyNames ? `уведомлены: ${notifyNames}` : null,
      });

      return NextResponse.json({ success: true, lead: sentLead, sent_to_work: true });
    }

    // Назначение исполнителя / соисполнителей — только админ и специалист по торгам.
    // «Взять в работу» (status → in_progress) по-прежнему может любой sales: там assigned_to
    // выставляется себе автоматически выше, без body.assigned_to.
    if (body.assigned_to !== undefined || body.co_assignees !== undefined) {
      if (!canProcessTenders(auth.user)) {
        return NextResponse.json(
          {
            success: false,
            error: 'Назначать исполнителей могут только админы и специалист по торгам',
          },
          { status: 403 },
        );
      }
    }

    if (body.assigned_to !== undefined) {
      const nextAssigned =
        body.assigned_to === null || body.assigned_to === ''
          ? null
          : Number(body.assigned_to);
      if (nextAssigned != null && (!Number.isFinite(nextAssigned) || nextAssigned <= 0)) {
        return NextResponse.json({ success: false, error: 'Некорректный исполнитель' }, { status: 400 });
      }
      if (nextAssigned !== existing.assigned_to) {
        assigneeChanged = true;
        patch.assigned_to = nextAssigned;
        if (nextAssigned != null) {
          const refs = await resolveStaffRefs([nextAssigned]);
          if (refs.length === 0) {
            return NextResponse.json({ success: false, error: 'Сотрудник не найден' }, { status: 400 });
          }
          assigneeNameForHistory = refs[0].name;
          nextPayload.assigned_to = nextAssigned;
          nextPayload.assigned_to_name = assigneeNameForHistory;
          // Новый основной не должен оставаться в соисполнителях
          if (body.co_assignees === undefined) {
            const prevCo = parseIdList(nextPayload.co_assignees);
            const nextCo = prevCo.filter((uid) => uid !== nextAssigned);
            if (nextCo.length !== prevCo.length) {
              const coRefs = await resolveStaffRefs(nextCo);
              nextPayload.co_assignees = coRefs.map((r) => r.user_id);
              nextPayload.co_assignee_names = coRefs.map((r) => r.name);
              coChanged = true;
              coNamesForHistory = coRefs.map((r) => r.name).join(', ') || '—';
            }
          }
        } else {
          assigneeNameForHistory = '—';
          nextPayload.assigned_to = null;
          nextPayload.assigned_to_name = null;
        }
        payloadDirty = true;
      }
    }

    if (body.co_assignees !== undefined) {
      const primary =
        patch.assigned_to !== undefined
          ? (patch.assigned_to as number | null)
          : existing.assigned_to;
      const coIds = parseIdList(body.co_assignees).filter((uid) => uid !== primary);
      const refs = await resolveStaffRefs(coIds);
      if (coIds.length > 0 && refs.length !== coIds.length) {
        return NextResponse.json(
          { success: false, error: 'Один из соисполнителей не найден' },
          { status: 400 },
        );
      }
      const prevCo = parseIdList(nextPayload.co_assignees).slice().sort((a, b) => a - b);
      const nextCo = refs.map((r) => r.user_id).slice().sort((a, b) => a - b);
      if (prevCo.join(',') !== nextCo.join(',')) {
        coChanged = true;
        nextPayload.co_assignees = nextCo;
        nextPayload.co_assignee_names = refs.map((r) => r.name);
        coNamesForHistory = refs.map((r) => r.name).join(', ') || '—';
        payloadDirty = true;
      }
    }

    if (body.phone !== undefined) patch.phone = body.phone;
    if (body.name !== undefined) patch.name = body.name;
    if (body.grade !== undefined) patch.grade = body.grade;
    if (body.volume_m3 !== undefined) patch.volume_m3 = body.volume_m3;
    if (body.address !== undefined) patch.address = body.address;
    if (body.city !== undefined) patch.city = body.city;
    if (body.desired_date !== undefined) patch.desired_date = body.desired_date;
    if (body.raw_text !== undefined) patch.raw_text = body.raw_text;

    // Обработка торгов: реквизиты закупки / заказчик / ссылки (админ + специалист по торгам).
    if (body.processing != null && typeof body.processing === 'object') {
      if (!canProcessTenders(auth.user)) {
        return NextResponse.json(
          { success: false, error: 'Обработку ведут админы и специалист по торгам' },
          { status: 403 },
        );
      }

      const p = body.processing as Record<string, unknown>;
      const organizationName = strOrNull(p.organization_name);
      const contactName = strOrNull(p.contact_name) || strOrNull(p.name);
      const platform = strOrNull(p.platform) || strOrNull(p.platform_name);
      const purchaseNumber = strOrNull(p.purchase_number);
      const law = strOrNull(p.law);
      const etpUrl = strOrNull(p.etp_url);
      const docsUrl = strOrNull(p.docs_url);
      const deadline = strOrNull(p.deadline);
      const comment = strOrNull(p.comment);
      const inn = strOrNull(p.inn);
      const phone = strOrNull(p.phone);
      const grade = strOrNull(p.grade);
      const city = strOrNull(p.city);
      const address = strOrNull(p.address);
      const desiredDate = strOrNull(p.desired_date);
      const volume = numOrNull(p.volume_m3);
      const nmck = numOrNull(p.nmck);

      if (p.volume_m3 != null && p.volume_m3 !== '' && volume == null) {
        return NextResponse.json({ success: false, error: 'Некорректный объём' }, { status: 400 });
      }
      if (p.nmck != null && p.nmck !== '' && nmck == null) {
        return NextResponse.json({ success: false, error: 'Некорректная НМЦК' }, { status: 400 });
      }

      nextPayload.organization_name = organizationName;
      nextPayload.contact_name = contactName;
      nextPayload.full_name = contactName;
      nextPayload.inn = inn;
      nextPayload.platform = platform;
      nextPayload.platform_name = platform;
      nextPayload.purchase_number = purchaseNumber;
      nextPayload.law = law;
      nextPayload.nmck = nmck;
      nextPayload.etp_url = etpUrl;
      nextPayload.docs_url = docsUrl;
      nextPayload.deadline = deadline;
      nextPayload.comment = comment;
      nextPayload.customer_type = organizationName || inn ? 'legal' : nextPayload.customer_type;
      nextPayload.processing_updated_at = new Date().toISOString();
      nextPayload.processing_updated_by = auth.user.user_id;
      nextPayload.processing_updated_by_name = auth.user.full_name || 'Сотрудник';
      payloadDirty = true;

      if (phone !== undefined) patch.phone = phone;
      if (contactName || organizationName) {
        patch.name = contactName || organizationName;
      }
      if (grade !== undefined) patch.grade = grade;
      if (volume !== undefined) patch.volume_m3 = volume;
      if (address !== undefined) patch.address = address;
      if (city !== undefined) patch.city = city;
      if (desiredDate !== undefined) patch.desired_date = desiredDate;
      if (etpUrl !== undefined) patch.chat_url = etpUrl;

      const summaryParts = [
        organizationName,
        purchaseNumber ? `№ ${purchaseNumber}` : null,
        law,
        platform,
        nmck != null ? `НМЦК ${nmck.toLocaleString('ru-RU')} ₽` : null,
        comment,
      ].filter(Boolean);
      if (summaryParts.length > 0) {
        patch.raw_text = summaryParts.join('\n');
      }
    }

    if (payloadDirty) patch.raw_payload = nextPayload;

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ success: false, error: 'Нет полей для обновления' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('leads')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    const actorName = auth.user.full_name || 'Сотрудник';

    if (body.status != null && body.status !== existing.status) {
      let action = 'Изменил статус';
      if (body.status === 'in_progress') action = 'Взял в работу';
      else if (body.status === 'rejected') action = 'Отметил отказ';
      else if (body.status === 'spam') action = 'Отметил спам';
      else if (body.status === 'fulfilled') action = 'Отметил исполненным';
      else if (body.status === 'converted' && existing.status === 'fulfilled') {
        action = 'Вернул в отгрузку';
      }
      else if (
        LOCKED_FOR_NON_ADMIN.includes(existing.status as LeadStatus) &&
        (body.status === 'new' || body.status === 'in_progress')
      ) {
        action =
          existing.status === 'fulfilled'
            ? 'Вернул из исполненных'
            : 'Вернул из отказа/спама';
      }

      await writeLeadHistory({
        lead_id: id,
        action,
        user_id: auth.user.user_id,
        user_name: actorName,
        user_role: auth.user.role,
        field_name: 'status',
        old_value: existing.status,
        new_value: body.status,
      });
    }

    if (assigneeChanged) {
      const prevName =
        String(asPayload(existing.raw_payload).assigned_to_name ?? '').trim()
        || (existing.assigned_to ? `#${existing.assigned_to}` : '—');
      await writeLeadHistory({
        lead_id: id,
        action: 'Назначил исполнителя',
        user_id: auth.user.user_id,
        user_name: actorName,
        user_role: auth.user.role,
        field_name: 'assigned_to',
        old_value: prevName,
        new_value: assigneeNameForHistory || '—',
      });
    }

    if (coChanged) {
      const prevCoNames = Array.isArray(asPayload(existing.raw_payload).co_assignee_names)
        ? (asPayload(existing.raw_payload).co_assignee_names as unknown[])
            .map((n) => String(n || '').trim())
            .filter(Boolean)
            .join(', ')
        : '—';
      await writeLeadHistory({
        lead_id: id,
        action: 'Обновил соисполнителей',
        user_id: auth.user.user_id,
        user_name: actorName,
        user_role: auth.user.role,
        field_name: 'co_assignees',
        old_value: prevCoNames || '—',
        new_value: coNamesForHistory || '—',
      });
    }

    let calloutWatch: {
      ok: boolean;
      message: string;
      tender_id?: number;
      prospect_id?: number;
    } | null = null;

    if (body.processing != null && typeof body.processing === 'object') {
      await writeLeadHistory({
        lead_id: id,
        action: 'Обновил обработку (реквизиты / документы)',
        user_id: auth.user.user_id,
        user_name: actorName,
        user_role: auth.user.role,
        field_name: 'processing',
        old_value: null,
        new_value: strOrNull((body.processing as Record<string, unknown>).purchase_number)
          || strOrNull((body.processing as Record<string, unknown>).organization_name)
          || 'реквизиты',
      });

      // Тендер после обработки → обзвон (контракт сразу с победителем)
      const leadSource = String((data as Lead)?.source || existing.source || '');
      if (leadSource === 'tender' || leadSource === 'demand') {
        const p = body.processing as Record<string, unknown>;
        const etpUrl = strOrNull(p.etp_url) || strOrNull(p.docs_url);
        const purchaseNumber = strOrNull(p.purchase_number);
        if (etpUrl || purchaseNumber) {
          try {
            const { watchLeadForCallout } = await import('@/lib/callout/calloutService');
            const { extractContractReestrFromUrl } = await import('@/lib/callout/parseContacts');
            calloutWatch = await watchLeadForCallout({
              leadId: id,
              purchaseUrl: etpUrl,
              purchaseNumber,
              contractReestrNumber: extractContractReestrFromUrl(etpUrl),
              law: strOrNull(p.law),
              objectInfo: strOrNull(p.comment) || (data as Lead)?.raw_text,
              customerName: strOrNull(p.organization_name),
              nmck: numOrNull(p.nmck),
              deadline: strOrNull(p.deadline),
            });
          } catch (e) {
            console.error('[leads PATCH] callout watch', e);
            calloutWatch = {
              ok: false,
              message: e instanceof Error ? e.message : 'Ошибка постановки в обзвон',
            };
          }
        }
      }
    }

    // Авто-уведомление при назначении — только Авито / публичная форма.
    // Спрос / тендер / площадка: задание уходит кнопкой «Отправить в работу».
    const nextStatus = (data?.status || existing.status) as LeadStatus;
    if (
      nextStatus === 'new' &&
      data &&
      isLeadWorkOpenToAll(String((data as Lead).source || existing.source || ''))
    ) {
      const nextIds = getLeadAssigneeIds(data as Lead);
      const newlyAssigned = nextIds.filter(
        (uid) => !oldAssigneeIds.includes(uid) && uid !== auth.user.user_id,
      );
      if (newlyAssigned.length > 0) {
        await notifyLeadTakeRequired({
          leadId: id,
          userIds: newlyAssigned,
          preview: data.raw_text || existing.raw_text || undefined,
        });
      }
    }

    let clientSpam: Awaited<ReturnType<typeof maybeMarkClientSpamFromLead>> | null = null;
    if (data?.status === 'spam') {
      clientSpam = await maybeMarkClientSpamFromLead({
        phone: data.phone,
        raw_payload: data.raw_payload as Record<string, unknown> | null,
      });
    }

    return NextResponse.json({
      success: true,
      lead: data,
      ...(clientSpam
        ? {
            clientSpamMarked: clientSpam.marked,
            clientSpamUserId: clientSpam.userId ?? null,
            clientSpamSkipped: clientSpam.skippedReason ?? null,
          }
        : {}),
      ...(calloutWatch ? { callout_watch: calloutWatch } : {}),
      statusLabel: data?.status ? leadStatusLabel(data.status) : null,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

/** Удаление лида — только админ или специалист по торгам (can_process_tenders). */
export async function DELETE(request: NextRequest, context: Ctx) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  if (!canProcessTenders(auth.user)) {
    return NextResponse.json(
      { success: false, error: 'Удалять лиды могут только админ и специалист по торгам' },
      { status: 403 },
    );
  }

  const { id: idRaw } = await context.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
  }

  const { data: existing, error: loadError } = await supabaseAdmin
    .from('leads')
    .select('id')
    .eq('id', id)
    .maybeSingle();

  if (loadError) {
    console.error('[leads DELETE load]', loadError);
    return NextResponse.json({ success: false, error: loadError.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ success: false, error: 'Лид не найден' }, { status: 404 });
  }

  try {
    await removeLeadContractStorageForLead(id);
  } catch (e) {
    console.error('[leads DELETE storage]', e);
  }

  let calloutCleanup: { deletedTenders: number; deletedProspects: number } | null =
    null;
  try {
    const { removeCalloutForLead } = await import('@/lib/callout/calloutService');
    calloutCleanup = await removeCalloutForLead(id);
  } catch (e) {
    console.error('[leads DELETE callout]', e);
  }

  const { error: delError } = await supabaseAdmin.from('leads').delete().eq('id', id);
  if (delError) {
    console.error('[leads DELETE]', delError);
    return NextResponse.json({ success: false, error: delError.message }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    id,
    ...(calloutCleanup ? { calloutCleanup } : {}),
  });
}
