import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { LowRateAlertInfo } from '@/lib/siloConfig';
import {
  SILO_LOW_RATE_ADMIN_TYPE,
  siloLowRateEpisodeTag,
} from '@/lib/siloLowRateAdminNotif';

export { SILO_LOW_RATE_ADMIN_TYPE, siloLowRateEpisodeTag } from '@/lib/siloLowRateAdminNotif';

/**
 * Персистентный one-shot алерт админам: записаться в admin_notifications,
 * даже если админ сейчас офлайн. На каждый эпизод (silo + alertAt) — не больше
 * одного уведомления на админа; после прочтения повторно не создаём.
 */
export async function notifySiloLowRateAdmins(
  info: LowRateAlertInfo,
): Promise<void> {
  if (!info.pending && !info.fired) return;
  if (!info.alertAt) return;
  if (![1, 2, 3].includes(Number(info.siloId))) return;

  // Нормализуем время эпизода — иначе дедуп ломается из‑за разного формата timestamptz
  const alertAtIso = new Date(info.alertAt).toISOString();
  if (Number.isNaN(Date.parse(alertAtIso))) return;
  const episodeTag = siloLowRateEpisodeTag(info.siloId, alertAtIso);
  const cur = info.currentTons.toLocaleString('ru-RU', {
    maximumFractionDigits: 2,
  });
  const thr = info.thresholdTons.toLocaleString('ru-RU', {
    maximumFractionDigits: 0,
  });
  const title = `${info.siloName}: глубокий минус — дайте задание оператору`;
  const message =
    `Остаток ${cur} т (порог −${thr} т). `
    + 'Попросите оператора проверить оборудование (весы, шнек, рабочий силос).\n'
    + episodeTag;

  try {
    // Уже писали по этому эпизоду (даже если прочитали) — не дублируем
    const { data: existing, error: existErr } = await supabaseAdmin
      .from('admin_notifications')
      .select('id, user_id')
      .eq('type', SILO_LOW_RATE_ADMIN_TYPE)
      .ilike('message', `%${episodeTag}%`)
      .limit(50);
    if (existErr) {
      console.error('[notifySiloLowRateAdmins] exist check:', existErr.message);
      return;
    }
    const alreadyFor = new Set(
      (existing || [])
        .map((r) => Number(r.user_id))
        .filter((id) => Number.isFinite(id) && id > 0),
    );

    const { data: admins, error: adminsErr } = await supabaseAdmin
      .from('users')
      .select('user_id')
      .eq('role', 'admin');
    if (adminsErr) {
      console.error('[notifySiloLowRateAdmins] admins:', adminsErr.message);
      return;
    }

    const rows = (admins || [])
      .map((u) => Number(u.user_id))
      .filter((id) => Number.isFinite(id) && id > 0 && !alreadyFor.has(id))
      .map((userId) => ({
        user_id: userId,
        type: SILO_LOW_RATE_ADMIN_TYPE,
        title,
        message,
        order_id: null,
        priority: 'high',
        is_read: false,
      }));

    if (rows.length === 0) return;

    const { error: insErr } = await supabaseAdmin
      .from('admin_notifications')
      .insert(rows);
    if (insErr) {
      console.error('[notifySiloLowRateAdmins] insert:', insErr.message);
    }
  } catch (err) {
    console.error('[notifySiloLowRateAdmins]', err);
  }
}
