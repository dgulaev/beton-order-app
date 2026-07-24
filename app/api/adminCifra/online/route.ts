// app/api/adminCifra/online/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_CIFRA_STAFF_ROLES } from '@/lib/adminCifraAuth';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const STAFF_ROLE_SET = new Set(
  ADMIN_CIFRA_STAFF_ROLES.map((r) => r.toLowerCase()).filter((r) => r !== 'guest'),
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
        users!inner(full_name, role, organization_name, phone, force_logout_version)
      `)
      .gte('last_active', tenMinutesAgo)
      .order('last_active', { ascending: false });

    if (error) throw error;

    // Не показываем guest, клиентов и уже выкинутых force-logout
    // (на случай хвоста сессии, если delete не успел/упал).
    const online = (data || []).filter((session: any) => {
      const u = Array.isArray(session.users) ? session.users[0] : session.users;
      if (!u) return false;
      const role = String(u.role || '').toLowerCase();
      if (!STAFF_ROLE_SET.has(role)) return false;
      if (Number(u.force_logout_version || 0) > 0) return false;
      return true;
    });

    return NextResponse.json({ 
      success: true, 
      online,
    });

  } catch (error: any) {
    console.error('Online API error:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Ошибка сервера' 
    }, { status: 500 });
  }
}