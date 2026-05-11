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

    await supabase.rpc('set_current_user_id', { p_user_id: userId });

    // Простой запрос без сложных join
    const { data, error } = await supabase
      .from('referral_transactions')
      .select(`
        id,
        created_at,
        volume,
        potential_bonus,
        orders (
          id,
          full_name,
          organization_name,
          phone,
          status
        )
      `)
      .eq('referrer_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }

    console.log('Raw referral data:', JSON.stringify(data, null, 2)); // для отладки

    const groupedMap = new Map();

    (data || []).forEach((item: any) => {
      const order = item.orders || {};
      const phone = order.phone || 'Неизвестный';
      const name = order.full_name || order.organization_name || 'Клиент';

      const key = phone;

      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          referrerName: name,
          referrerPhone: phone,
          totalVolume: 0,
          totalBonus: 0,
          count: 0,
          lastDate: item.created_at,
          orders: []
        });
      }

      const group = groupedMap.get(key);
      group.totalVolume += Number(item.volume || 0);
      group.totalBonus += Number(item.potential_bonus || 0);
      group.count += 1;
      group.orders.push({
        id: order.id,
        volume: Number(item.volume || 0),
        bonus_amount: Number(item.potential_bonus || 0),
        status: order.status || 'new'
      });
    });

    const history = Array.from(groupedMap.values())
      .sort((a, b) => new Date(b.lastDate).getTime() - new Date(a.lastDate).getTime());

    return NextResponse.json({ success: true, history, count: history.length });

  } catch (error: any) {
    console.error('Referral history error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}