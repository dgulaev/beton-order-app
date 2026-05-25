import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { userIds } = await request.json();

    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json({});
    }

    const { data, error } = await supabase
      .from('orders')
      .select('user_id, volume')
      .in('user_id', userIds);

    if (error) throw error;

    // Группируем объём по user_id
    const result: Record<number | string, number> = {};

    data.forEach((order: any) => {
      const uid = order.user_id;
      result[uid] = (result[uid] || 0) + Number(order.volume || 0);
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('client-volumes error:', error);
    return NextResponse.json({});
  }
}