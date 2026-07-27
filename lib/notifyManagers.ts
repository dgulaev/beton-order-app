import { supabaseAdmin } from '@/lib/supabaseAdmin';

export type ManagerNotifyPayload = {
  type: string;
  title: string;
  body: string;
  /** id сущности для mobile_notifications.entity_id (lead id / demand id / order id) */
  entityId?: number | null;
  orderId?: number | null;
  priority?: 'low' | 'medium' | 'high';
  /** Если false — не писать mobile_notifications */
  mobile?: boolean;
  /** Если false — не писать admin_notifications */
  admin?: boolean;
};

/**
 * Единый notifier для менеджеров: только adminCifra + mobile
 * (admin_notifications + mobile_notifications). Max/Telegram не используются.
 */
export async function notifyManagers(payload: ManagerNotifyPayload): Promise<void> {
  const {
    type,
    title,
    body,
    entityId = null,
    orderId = null,
    priority = 'high',
    mobile = true,
    admin = true,
  } = payload;

  const tasks: PromiseLike<unknown>[] = [];

  if (admin) {
    tasks.push(
      supabaseAdmin.from('admin_notifications').insert({
        type,
        title,
        message: body,
        user_id: null,
        order_id: orderId,
        priority,
        is_read: false,
      }),
    );
  }

  if (mobile) {
    tasks.push(
      supabaseAdmin.from('mobile_notifications').insert({
        type,
        title,
        body,
        entity_id: entityId,
        field_name: null,
        old_value: null,
        new_value: null,
      }),
    );
  }

  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === 'rejected') {
      console.error('[notifyManagers]', r.reason);
    } else if (r.value && typeof r.value === 'object' && 'error' in r.value && (r.value as { error?: unknown }).error) {
      console.error('[notifyManagers]', (r.value as { error: unknown }).error);
    }
  }
}
