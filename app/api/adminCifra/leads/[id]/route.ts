import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { canActOnAssignedLeadWork, getLeadAssigneeIds, parseIdList } from '@/lib/leadAssigneeIds';
import { notifyLeadTakeRequired, resolveStaffRefs } from '@/lib/leadAssigneesServer';
import { canProcessTenders } from '@/lib/demandProcessAccess';
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

const LOCKED_FOR_NON_ADMIN: LeadStatus[] = ['rejected', 'spam'];

function asPayload(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {};
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
    if (body.status === 'converted') {
      return NextResponse.json(
        { success: false, error: 'Статус «В заказ» выставляется только при создании заявки' },
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

    if (
      existing.status === 'converted' &&
      body.status != null &&
      body.status !== 'converted'
    ) {
      return NextResponse.json(
        {
          success: false,
          error: existing.order_id
            ? `Лид уже в заказе #${existing.order_id} — статус менять нельзя`
            : 'Лид уже конвертирован — статус менять нельзя',
        },
        { status: 409 },
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
      const desiredDate = strOrNull(p.desired_date) || deadline;
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
      else if (
        LOCKED_FOR_NON_ADMIN.includes(existing.status as LeadStatus) &&
        (body.status === 'new' || body.status === 'in_progress')
      ) {
        action = 'Вернул из отказа/спама';
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
      statusLabel: data?.status ? leadStatusLabel(data.status) : null,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
