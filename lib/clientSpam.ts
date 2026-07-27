import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { findClientByPhone } from '@/lib/clientUsers';
import { toStoredPhone } from '@/lib/phone';

export type MarkClientSpamResult = {
  marked: boolean;
  skippedReason?: 'no_client' | 'has_orders' | 'already_spam' | 'error';
  userId?: number;
};

type LeadLike = {
  phone?: string | null;
  raw_payload?: Record<string, unknown> | null;
};

/**
 * Пометить клиента is_spam=true, если у него нет заказов (кроме cancelled).
 * Ищем по raw_payload.user_id или по телефону лида.
 */
export async function maybeMarkClientSpamFromLead(lead: LeadLike): Promise<MarkClientSpamResult> {
  try {
    let userId: number | null = null;
    const payload = lead.raw_payload && typeof lead.raw_payload === 'object' ? lead.raw_payload : {};
    const fromPayload = Number(payload.user_id);
    if (Number.isFinite(fromPayload) && fromPayload > 0) {
      userId = fromPayload;
    }

    if (userId == null && lead.phone) {
      const stored = toStoredPhone(lead.phone) || lead.phone;
      const client = await findClientByPhone(supabaseAdmin, stored);
      if (client?.user_id) userId = Number(client.user_id);
    }

    if (userId == null || !Number.isFinite(userId)) {
      return { marked: false, skippedReason: 'no_client' };
    }

    const { data: user, error: userErr } = await supabaseAdmin
      .from('users')
      .select('user_id, role, is_spam')
      .eq('user_id', userId)
      .eq('role', 'client')
      .maybeSingle();

    if (userErr || !user) {
      return { marked: false, skippedReason: 'no_client' };
    }
    if (user.is_spam) {
      return { marked: false, skippedReason: 'already_spam', userId };
    }

    const { count, error: ordErr } = await supabaseAdmin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .neq('status', 'cancelled');

    if (ordErr) {
      console.error('[maybeMarkClientSpamFromLead] orders', ordErr);
      return { marked: false, skippedReason: 'error', userId };
    }
    if ((count ?? 0) > 0) {
      return { marked: false, skippedReason: 'has_orders', userId };
    }

    const { error: updErr } = await supabaseAdmin
      .from('users')
      .update({ is_spam: true })
      .eq('user_id', userId)
      .eq('role', 'client');

    if (updErr) {
      console.error('[maybeMarkClientSpamFromLead] update', updErr);
      return { marked: false, skippedReason: 'error', userId };
    }

    return { marked: true, userId };
  } catch (e) {
    console.error('[maybeMarkClientSpamFromLead]', e);
    return { marked: false, skippedReason: 'error' };
  }
}
