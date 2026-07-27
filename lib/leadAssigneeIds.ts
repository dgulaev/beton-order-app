import { isLeadWorkOpenToAll, type Lead } from '@/lib/leads';

/** Клиентский хелпер — без supabaseAdmin / server deps. */

export function getLeadAssigneeIds(lead: Pick<Lead, 'assigned_to' | 'raw_payload'>): number[] {
  const ids = new Set<number>();
  if (lead.assigned_to != null && Number.isFinite(Number(lead.assigned_to))) {
    ids.add(Number(lead.assigned_to));
  }
  const payload =
    lead.raw_payload && typeof lead.raw_payload === 'object' ? lead.raw_payload : null;
  const raw = payload?.co_assignees;
  if (Array.isArray(raw)) {
    for (const v of raw) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
  }
  return Array.from(ids);
}

/** Исполнитель или соисполнитель по лиду. */
export function isLeadAssignee(
  lead: Pick<Lead, 'assigned_to' | 'raw_payload'>,
  userId: number | null | undefined,
): boolean {
  if (userId == null || !Number.isFinite(Number(userId)) || Number(userId) <= 0) {
    return false;
  }
  return getLeadAssigneeIds(lead).includes(Number(userId));
}

/**
 * Можно ли брать лид в работу / создавать заказ:
 * — Авито / публичная форма → всем;
 * — иначе → назначенный исполнитель/соисполнитель;
 * — manual/site → также создатель лида (мобильное ручное создание).
 */
export function canActOnAssignedLeadWork(
  lead: Pick<Lead, 'source' | 'assigned_to' | 'raw_payload'>,
  userId: number | null | undefined,
): boolean {
  if (isLeadWorkOpenToAll(lead.source)) return true;
  if (isLeadAssignee(lead, userId)) return true;
  if (userId != null && (lead.source === 'manual' || lead.source === 'site')) {
    const payload =
      lead.raw_payload && typeof lead.raw_payload === 'object' ? lead.raw_payload : null;
    const createdBy = Number(payload?.created_by);
    if (Number.isFinite(createdBy) && createdBy === Number(userId)) return true;
  }
  return false;
}

export function getLeadCoAssigneeIds(lead: Pick<Lead, 'raw_payload'>): number[] {
  const payload =
    lead.raw_payload && typeof lead.raw_payload === 'object' ? lead.raw_payload : null;
  const raw = payload?.co_assignees;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function getLeadCoAssigneeNames(lead: Pick<Lead, 'raw_payload'>): string[] {
  const payload =
    lead.raw_payload && typeof lead.raw_payload === 'object' ? lead.raw_payload : null;
  const raw = payload?.co_assignee_names;
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v || '').trim()).filter(Boolean);
}

export function parseIdList(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  const ids = new Set<number>();
  for (const v of input) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) ids.add(n);
  }
  return Array.from(ids);
}
