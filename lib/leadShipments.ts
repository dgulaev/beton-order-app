import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { writeLeadHistory } from '@/lib/leadHistory';

/** Рейсы, которые считаем отгруженными (как у оператора / дашборда). */
export const SHIPPED_MIXER_STATUSES = ['В пути', 'На объекте', 'Разгружен', 'Возврат'] as const;

export type LeadShipmentOrder = {
  order_id: number;
  status: string;
  grade: string | null;
  volume: number | null;
  delivery_date: string | null;
  delivery_time: string | null;
  address: string | null;
  shipped_m3: number;
  mixer_count: number;
};

export type LeadShipmentsSummary = {
  lead_id: number;
  plan_m3: number | null;
  /** Сумма volume по заявкам (заказано), не отгрузка. */
  ordered_m3: number;
  shipped_m3: number;
  /** Остаток плана под новые заявки: plan − ordered. */
  remaining_m3: number | null;
  percent: number | null;
  orders: LeadShipmentOrder[];
};

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Сумма отгруженных м³ по заявкам лида. */
export async function getLeadShipmentsSummary(leadId: number): Promise<LeadShipmentsSummary | null> {
  const { data: lead, error: leadError } = await supabaseAdmin
    .from('leads')
    .select('id, volume_m3')
    .eq('id', leadId)
    .maybeSingle();

  if (leadError || !lead) return null;

  const { data: orders, error: ordersError } = await supabaseAdmin
    .from('orders')
    .select('id, status, grade, volume, delivery_date, delivery_time, address')
    .eq('lead_id', leadId)
    .order('id', { ascending: true });

  if (ordersError) {
    console.error('[leadShipments] orders', ordersError);
    return null;
  }

  const orderList = orders ?? [];
  const orderIds = orderList.map((o) => o.id);

  const shippedByOrder = new Map<number, { shipped_m3: number; mixer_count: number }>();
  for (const id of orderIds) {
    shippedByOrder.set(id, { shipped_m3: 0, mixer_count: 0 });
  }

  if (orderIds.length > 0) {
    const { data: mixers, error: mixersError } = await supabaseAdmin
      .from('order_mixers')
      .select('order_id, volume, status')
      .in('order_id', orderIds);

    if (mixersError) {
      console.error('[leadShipments] mixers', mixersError);
    } else {
      for (const m of mixers ?? []) {
        const oid = Number(m.order_id);
        const entry = shippedByOrder.get(oid);
        if (!entry) continue;
        const st = String(m.status || '');
        if ((SHIPPED_MIXER_STATUSES as readonly string[]).includes(st)) {
          entry.shipped_m3 += Number(m.volume) || 0;
          entry.mixer_count += 1;
        }
      }
    }
  }

  const resultOrders: LeadShipmentOrder[] = orderList.map((o) => {
    const stats = shippedByOrder.get(o.id) || { shipped_m3: 0, mixer_count: 0 };
    return {
      order_id: o.id,
      status: String(o.status || ''),
      grade: o.grade ?? null,
      volume: o.volume != null ? Number(o.volume) : null,
      delivery_date: o.delivery_date ?? null,
      delivery_time: o.delivery_time ?? null,
      address: o.address ?? null,
      shipped_m3: round1(stats.shipped_m3),
      mixer_count: stats.mixer_count,
    };
  });

  const shipped_m3 = round1(resultOrders.reduce((s, o) => s + o.shipped_m3, 0));
  // Отменённые заявки не едят остаток плана
  const ordered_m3 = round1(
    resultOrders.reduce((s, o) => {
      if (String(o.status || '').toLowerCase() === 'cancelled') return s;
      return s + (o.volume != null && Number.isFinite(o.volume) ? o.volume : 0);
    }, 0),
  );
  const plan_m3 =
    lead.volume_m3 != null && Number.isFinite(Number(lead.volume_m3))
      ? Number(lead.volume_m3)
      : null;
  const remaining_m3 =
    plan_m3 != null ? round1(Math.max(0, plan_m3 - ordered_m3)) : null;
  const percent =
    plan_m3 != null && plan_m3 > 0
      ? Math.min(100, Math.round((shipped_m3 / plan_m3) * 1000) / 10)
      : null;

  return {
    lead_id: leadId,
    plan_m3,
    ordered_m3,
    shipped_m3,
    remaining_m3,
    percent,
    orders: resultOrders,
  };
}

/**
 * Если план задан и отгружено ≥ плана — переводит лид в fulfilled.
 * Идемпотентно: уже fulfilled / без plan / spam/rejected не трогает.
 */
export async function maybeAutoFulfillLead(leadId: number): Promise<boolean> {
  const { data: lead, error } = await supabaseAdmin
    .from('leads')
    .select('id, status, volume_m3')
    .eq('id', leadId)
    .maybeSingle();

  if (error || !lead) return false;
  // Только из «В отгрузке» — иначе ручной возврат из fulfilled в in_progress
  // сразу снова закрывается авто-правилом.
  if (lead.status !== 'converted') return false;

  const plan = lead.volume_m3 != null ? Number(lead.volume_m3) : NaN;
  if (!Number.isFinite(plan) || plan <= 0) return false;

  const summary = await getLeadShipmentsSummary(leadId);
  if (!summary || summary.shipped_m3 < plan - 0.05) return false;

  const { data: updated, error: updError } = await supabaseAdmin
    .from('leads')
    .update({ status: 'fulfilled', updated_at: new Date().toISOString() })
    .eq('id', leadId)
    .eq('status', 'converted')
    .select('id')
    .maybeSingle();

  if (updError || !updated) return false;

  await writeLeadHistory({
    lead_id: leadId,
    action: 'Авто: объём отгружен',
    user_name: 'Система',
    user_role: 'system',
    field_name: 'status',
    old_value: lead.status,
    new_value: 'fulfilled',
  });

  return true;
}

/** По order_id найти лид и попробовать авто-закрытие. */
export async function maybeAutoFulfillLeadByOrderId(orderId: number): Promise<void> {
  try {
    const { data: order } = await supabaseAdmin
      .from('orders')
      .select('lead_id')
      .eq('id', orderId)
      .maybeSingle();
    const leadId = order?.lead_id != null ? Number(order.lead_id) : null;
    if (!leadId) return;
    await maybeAutoFulfillLead(leadId);
  } catch (e) {
    console.error('[maybeAutoFulfillLeadByOrderId]', e);
  }
}
