/**
 * Общие правила смены статуса заявки: whitelist, финал, разгрузка,
 * побочные эффекты (логистика / рефералка / лиды).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { pruneGhostTripsFromLogisticsPlan } from '@/lib/pruneLogisticsPlanGhosts';

export const ORDER_STATUS_VALUES = ['new', 'processing', 'completed', 'cancelled'] as const;
export type OrderStatusValue = (typeof ORDER_STATUS_VALUES)[number];

export const FINAL_ORDER_STATUSES: readonly OrderStatusValue[] = ['completed', 'cancelled'];

export const ORDER_STATUS_RU: Record<string, string> = {
  new: 'Новая',
  processing: 'В работе',
  completed: 'Выполнена',
  cancelled: 'Отменена',
};

const VOLUME_EPSILON = 0.01;

export function isOrderStatus(value: unknown): value is OrderStatusValue {
  return typeof value === 'string' && (ORDER_STATUS_VALUES as readonly string[]).includes(value);
}

export function isFinalOrderStatus(status: string | null | undefined): boolean {
  return !!status && (FINAL_ORDER_STATUSES as readonly string[]).includes(status);
}

/** Ручной перевод в «Выполнена»: все рейсы разгружены и объём покрыт. */
export async function assertManualCompleteAllowed(
  supabase: SupabaseClient,
  orderId: number,
  effectiveVolume: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: mixersForCheck } = await supabase
    .from('order_mixers')
    .select('volume, status')
    .eq('order_id', orderId);

  const mixers = mixersForCheck || [];
  if (mixers.length === 0) return { ok: true };

  const allUnloaded = mixers.every((m: { status?: string | null }) => m?.status === 'Разгружен');
  const totalDelivered = mixers.reduce(
    (sum: number, m: { volume?: number | null }) => sum + Number(m?.volume || 0),
    0,
  );

  if (!allUnloaded || totalDelivered < effectiveVolume - VOLUME_EPSILON) {
    return {
      ok: false,
      message: allUnloaded
        ? `Нельзя завершить заявку — разгружено ${totalDelivered} м³ из ${effectiveVolume} м³. Добавьте недостающий объём или поправьте объём миксера.`
        : 'Нельзя завершить заявку — не все рейсы разгружены. Переведите миксеры в статус "Разгружен".',
    };
  }
  return { ok: true };
}

/**
 * Реферальные баллы при смене статуса.
 * completed → начислить; уход с completed → списать; cancelled → отменить tx.
 */
export async function syncReferralOnOrderStatusChange(
  supabase: SupabaseClient,
  order: { id: number; referred_by?: number | null; volume?: number | null },
  oldStatus: string,
  newStatus: string,
): Promise<void> {
  if (!order.referred_by || oldStatus === newStatus) return;

  const referrerId = order.referred_by;
  const bonusPoints = order.volume ? Math.round(Number(order.volume) * 100) : 0;
  const orderId = order.id;

  if (newStatus === 'completed' && oldStatus !== 'completed') {
    const { error: txError } = await supabase
      .from('referral_transactions')
      .update({
        status: 'completed',
        processed_at: new Date().toISOString(),
      })
      .eq('order_id', orderId)
      .eq('referrer_id', referrerId);
    if (txError) console.error('referral_transactions → completed:', txError);

    if (bonusPoints > 0) {
      const { error: incError } = await supabase.rpc('increment_balance', {
        user_id: referrerId,
        points: bonusPoints,
      });
      if (incError) console.error('increment_balance:', incError);
    }
    return;
  }

  if (oldStatus === 'completed' && newStatus !== 'completed') {
    if (bonusPoints > 0) {
      const { error: decError } = await supabase.rpc('decrement_balance', {
        p_user_id: referrerId,
        p_points: bonusPoints,
      });
      if (decError) console.error('decrement_balance:', decError);
    }
    const { error: txError } = await supabase
      .from('referral_transactions')
      .update({
        status: 'cancelled',
        processed_at: new Date().toISOString(),
      })
      .eq('order_id', orderId)
      .eq('referrer_id', referrerId);
    if (txError) console.error('referral_transactions revoke:', txError);
    return;
  }

  if (newStatus === 'cancelled' && oldStatus !== 'cancelled') {
    const { error: txError } = await supabase
      .from('referral_transactions')
      .update({ status: 'cancelled' })
      .eq('order_id', orderId)
      .eq('referrer_id', referrerId);
    if (txError) console.error('referral_transactions → cancelled:', txError);
  }
}

/** Prune плана + рефералка + auto-fulfill лида после смены статуса. */
export async function applyOrderStatusSideEffects(opts: {
  supabase: SupabaseClient;
  orderId: number;
  oldStatus: string;
  newStatus: string;
  deliveryDate?: string | null;
  referredBy?: number | null;
  volume?: number | null;
  actorName?: string;
}): Promise<void> {
  const {
    supabase,
    orderId,
    oldStatus,
    newStatus,
    deliveryDate,
    referredBy,
    volume,
    actorName = 'Система',
  } = opts;

  if (oldStatus === newStatus) return;

  await syncReferralOnOrderStatusChange(
    supabase,
    { id: orderId, referred_by: referredBy, volume },
    oldStatus,
    newStatus,
  );

  if (newStatus === 'completed' || newStatus === 'cancelled') {
    try {
      await pruneGhostTripsFromLogisticsPlan({
        supabase,
        orderIds: [orderId],
        deliveryDate,
        removeAllOrderIds: newStatus === 'cancelled' ? [orderId] : undefined,
        actorName,
      });
    } catch (e) {
      console.warn('pruneGhostTrips after order status:', e);
    }
  }

  try {
    const { maybeAutoFulfillLeadByOrderId } = await import('@/lib/leadShipments');
    await maybeAutoFulfillLeadByOrderId(orderId);
  } catch (e) {
    console.error('maybeAutoFulfillLeadByOrderId:', e);
  }
}
