import { supabaseAdmin } from '@/lib/supabaseAdmin';

export type StaffRef = {
  user_id: number;
  name: string;
};

/** Резолв имён сотрудников по user_id. Несуществующие id не возвращаются. */
export async function resolveStaffRefs(userIds: number[]): Promise<StaffRef[]> {
  const unique = Array.from(new Set(userIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (unique.length === 0) return [];

  const { data } = await supabaseAdmin
    .from('users')
    .select('user_id, full_name, organization_name')
    .in('user_id', unique);

  const map = new Map<number, StaffRef>();
  for (const u of data ?? []) {
    const name =
      (u.organization_name && String(u.organization_name).trim())
      || u.full_name
      || `Сотрудник #${u.user_id}`;
    map.set(u.user_id, { user_id: u.user_id, name });
  }
  // Только реально найденные сотрудники — иначе проверки «не найден» бесполезны.
  return unique
    .map((id) => map.get(id))
    .filter((r): r is StaffRef => Boolean(r));
}

/** Персональные уведомления: взять лид в работу (только admin_notifications по user_id). */
export async function notifyLeadTakeRequired(opts: {
  leadId: number;
  userIds: number[];
  preview?: string;
}): Promise<void> {
  const ids = Array.from(new Set(opts.userIds.filter((id) => Number.isFinite(id) && id > 0)));
  if (ids.length === 0) return;

  const title = `Вам необходимо взять лид №${opts.leadId} в работу!`;
  const body = (opts.preview || 'Новый лид ожидает взятия в работу').slice(0, 240);

  const rows = ids.map((userId) => ({
    user_id: userId,
    type: 'lead_take',
    title,
    message: body,
    order_id: null,
    priority: 'high',
    is_read: false,
  }));

  const { error } = await supabaseAdmin.from('admin_notifications').insert(rows);
  if (error) console.error('[notifyLeadTakeRequired]', error.message);

  // Не пишем в mobile_notifications: таблица без адресата, текст видели бы все.
  // Персональные алерты идут через admin_notifications (+ desktop realtime).
}
