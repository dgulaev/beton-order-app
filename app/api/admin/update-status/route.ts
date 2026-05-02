import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nhudnzdgtidocwwzpqge.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function POST(request: NextRequest) {
  try {
    const { orderId, status, userId } = await request.json(); // userId от админа

    if (!orderId || !status || !userId) {
      return NextResponse.json({ success: false, message: 'Missing parameters' }, { status: 400 });
    }

    // ←←← Важно для RLS (используем userId админа)
    await supabase.rpc('set_current_user_id', { p_user_id: userId });

    // Получаем текущий заказ
    const { data: currentOrder, error: fetchError } = await supabase
      .from('orders')
      .select('referred_by, volume, status')
      .eq('id', orderId)
      .single();

    if (fetchError) throw fetchError;

    // Обновляем статус
    const { error: updateError } = await supabase
      .from('orders')
      .update({ status })
      .eq('id', orderId);

    if (updateError) throw updateError;

    // Логика баллов
    if (status === 'completed' && currentOrder.referred_by && currentOrder.volume) {
      const bonusPoints = Math.round(currentOrder.volume * 100);
      await supabase.rpc('increment_balance', {
        user_id: currentOrder.referred_by,
        points: bonusPoints
      });
    } 
    else if (status === 'cancelled' && currentOrder.referred_by && currentOrder.volume) {
      const pointsToRemove = Math.round(currentOrder.volume * 100);
      await supabase.rpc('increment_balance', {
        user_id: currentOrder.referred_by,
        points: -pointsToRemove
      });
    }

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Update status error:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}