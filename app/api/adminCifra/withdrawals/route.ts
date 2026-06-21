import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const userIdParam = request.nextUrl.searchParams.get('userId');
   // console.log('📡 [Withdrawals] Запрос от userId:', userIdParam);

    if (!userIdParam) {
      return NextResponse.json({ success: true, withdrawals: [] }); // мягкий ответ
    }

    const userId = parseInt(userIdParam, 10);

    // Проверка роли (мягкая)
    const { data: user } = await supabase
      .from('users')
      .select('role')
      .eq('user_id', userId)
      .single();

    if (!user || !['admin', 'manager'].includes(user.role)) {
      console.warn(`[Withdrawals] Доступ запрещён для роли: ${user?.role}`);
      return NextResponse.json({ success: true, withdrawals: [] });
    }

    // Основной запрос
    const { data: withdrawals, error } = await supabase
      .from('balance_redemptions')
      .select(`
        *,
        users!inner(full_name, phone, username)
      `)
      .eq('type', 'cash')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Supabase error in withdrawals:', error);
      return NextResponse.json({ success: true, withdrawals: [] });
    }

   // console.log(`✅ Успешно загружено ${withdrawals?.length || 0} запросов на вывод`);

    return NextResponse.json({
      success: true,
      withdrawals: withdrawals || []
    });

  } catch (error: any) {
    console.error('💥 CRITICAL Withdrawals Error:', error);
    return NextResponse.json({ 
      success: true, 
      withdrawals: [] 
    });
  }
}

// PATCH — отметить как выплачено (оставляем как было)
export async function PATCH(request: NextRequest) {
  try {
    const { id, status } = await request.json();
    if (!id) return NextResponse.json({ success: false, message: 'id required' }, { status: 400 });

    const { error } = await supabase
      .from('balance_redemptions')
      .update({ status: status || 'completed' })
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true, message: 'Статус обновлён' });
  } catch (error: any) {
    console.error('PATCH error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}