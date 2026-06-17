// app/api/adminCifra/online/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ success: false, message: 'userId required' }, { status: 400 });
    }

    // Проверяем роль — только админы могут видеть онлайн
    const { data: currentUser } = await supabase
      .from('users')
      .select('role')
      .eq('user_id', parseInt(userId))
      .single();

    if (!currentUser || currentUser.role !== 'admin') {
      return NextResponse.json({ 
        success: false, 
        message: 'Доступ запрещён. Только администраторы могут видеть онлайн пользователей.' 
      }, { status: 403 });
    }

    // Получаем пользователей, которые были активны за последние 10 минут
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    const { data, error } = await supabase
      .from('active_sessions')
      .select(`
        user_id,
        ip,
        user_agent,
        last_active,
        users!inner(full_name, role, organization_name, phone)
      `)
      .gte('last_active', tenMinutesAgo)
      .order('last_active', { ascending: false });

    if (error) throw error;

    return NextResponse.json({ 
      success: true, 
      online: data || [] 
    });

  } catch (error: any) {
    console.error('Online API error:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Ошибка сервера' 
    }, { status: 500 });
  }
}