// app/api/referrals/history/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const userIdParam = request.nextUrl.searchParams.get('userId');
    const userId = parseInt(userIdParam || '0', 10);

    if (isNaN(userId)) {
      return NextResponse.json({ success: false, message: 'Invalid userId' }, { status: 400 });
    }

    await supabase.rpc('set_current_user_id', { p_user_id: userId });

    const { data: transactions } = await supabase
      .from('referral_transactions')
      .select(`
        id, created_at, volume, potential_bonus, status,
        orders(id, full_name, organization_name, phone, status)
      `)
      .eq('referrer_id', userId)
      .order('created_at', { ascending: false });

    const { data: redemptions } = await supabase
      .from('balance_redemptions')
      .select(`id, created_at, amount, type, status, payout_details`)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    const operations: any[] = [];
    const groupedMap = new Map();

    // 1. Группируем заказы и считаем earnedBonus
    (transactions || []).forEach((item: any) => {
      const order = item.orders || {};
      const phone = order.phone || 'unknown';
      const name = order.full_name || order.organization_name || 'Клиент';

      if (!groupedMap.has(phone)) {
        groupedMap.set(phone, {
          type: 'referral_group',
          referrerName: name,
          referrerPhone: phone,
          totalVolume: 0,
          earnedBonus: 0,
          count: 0,
          lastDate: item.created_at,
          orders: []
        });
      }

      const group = groupedMap.get(phone);
      const bonus = Number(item.potential_bonus || 0);

      group.totalVolume += Number(item.volume || 0);
      group.count += 1;

      if (bonus > 0) {
        const isCompleted = (item.status === 'completed') || (order.status === 'completed');
        if (isCompleted) group.earnedBonus += bonus;
      } else if (bonus < 0) {
        group.earnedBonus += bonus;
      }

      group.orders.push({
        id: order.id || '—',
        volume: Number(item.volume || 0),
        bonus_amount: bonus,
        status: order.status || item.status || 'new',
        title: `Заказ №${order.id || '—'}`
      });
    });

    // 2. Выводы — вычитаем из группы реферала + добавляем в общий список
    (redemptions || []).forEach((item: any) => {
      const sourceName = item.payout_details?.source_referrer_name || '';
      const sourcePhone = item.payout_details?.source_referrer_id || 'unknown';
      const redeemAmount = Number(item.amount || 0);

      if (sourcePhone !== 'unknown' && redeemAmount > 0 && groupedMap.has(sourcePhone)) {
        // ← Вычитаем из общей суммы группы
        const group = groupedMap.get(sourcePhone);
        group.earnedBonus -= redeemAmount;
      }

      // Добавляем в общий список операций
      operations.push({
        type: 'cash_withdrawal',
        date: item.created_at,
        title: sourceName ? `Вывод от реферала ${sourceName}` : 'Вывод наличными',
        subtitle: item.payout_details?.comment || '',
        amount: -redeemAmount,
        isNegative: true
      });
    });

    // Добавляем группы
    operations.push(...Array.from(groupedMap.values()));

    // Сортировка
    operations.sort((a, b) => {
      const dateA = a.date || a.lastDate || 0;
      const dateB = b.date || b.lastDate || 0;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    return NextResponse.json({ success: true, history: operations });

  } catch (error: any) {
    console.error('Referral history error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}