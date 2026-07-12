// app/api/adminCifra/force-logout-all/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { userId } = body;

    if (!userId) {
      return NextResponse.json({ 
        success: false, 
        message: 'userId required' 
      }, { status: 400 });
    }

    // Проверка, что это Главный Админ
    const { data: user } = await supabase
      .from('users')
      .select('role')
      .eq('user_id', parseInt(userId))
      .single();

    if (!user || user.role !== 'admin') {
      return NextResponse.json({ 
        success: false, 
        message: 'Доступ запрещён. Только Главный Администратор.' 
      }, { status: 403 });
    }

    // Принудительный logout всех сотрудников, КРОМЕ самого админа, который
    // нажал кнопку — иначе он тоже выкинет сам себя при следующей проверке
    // роли (force_logout_version проверяется без исключений по user_id).
    const { error } = await supabase
      .from('users')
      .update({ force_logout_version: 9999 })
      .in('role', ['admin', 'manager', 'dispatcher', 'operator'])
      .neq('user_id', parseInt(userId));

    if (error) {
      console.error('Update error:', error);
      return NextResponse.json({ 
        success: false, 
        message: error.message 
      }, { status: 500 });
    }

   // console.log(`🔴 Главный Админ ${userId} выполнил принудительный logout всех сотрудников`);

    return NextResponse.json({ 
      success: true, 
      message: 'Все сотрудники успешно выкинуты из системы' 
    });

  } catch (error: any) {
    console.error('Force logout all error:', error);
    return NextResponse.json({ 
      success: false, 
      message: error.message || 'Внутренняя ошибка сервера' 
    }, { status: 500 });
  }
}