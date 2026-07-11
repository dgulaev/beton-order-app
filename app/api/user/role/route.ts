import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// service_role, т.к. таблица users закрыта RLS от anon (там password_hash).
// Роут серверный, ключ на клиент не уходит — это безопасно.
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    let userId: number | null = null;

    // 1. Пытаемся получить userId из тела запроса (для совместимости)
    try {
      const body = await request.json();
      if (body.userId) {
        userId = parseInt(body.userId.toString(), 10);
      }
    } catch {}

    // 2. Если нет — берём из заголовка (для нового хука)
    if (!userId) {
      const headerUserId = request.headers.get('x-user-id');
      if (headerUserId) {
        userId = parseInt(headerUserId, 10);
      }
    }

    console.log('🔍 [Role API] Received userId:', userId);

    if (!userId) {
      console.log('⚠️ No userId found');
      return NextResponse.json({ 
        success: true, 
        role: 'client',
        full_name: 'Сотрудник',
        forceLogoutVersion: 0 
      });
    }

    const parsedUserId = userId;

    // Получаем данные
    const { data, error } = await supabase
      .from('users')
      .select('role, full_name, username, force_logout_version')
      .eq('user_id', parsedUserId)
      .maybeSingle();

    console.log('📊 Query data:', data);
    console.log('📊 Query error:', error);

    if (error) {
      console.error('❌ Role fetch error:', error);
    }

    const role = data?.role || 'client';
    const full_name = data?.full_name || data?.username || 'Сотрудник';
    const forceLogoutVersion = data?.force_logout_version || 0;

    console.log(`✅ [Role API] Final role for ${parsedUserId}: ${role} | name: ${full_name}`);

    return NextResponse.json({ 
      success: true, 
      role,
      full_name,
      force_logout_version: forceLogoutVersion   // нормализуем имя поля
    });

  } catch (e: any) {
    console.error('💥 Role API crash:', e);
    return NextResponse.json({ 
      success: true, 
      role: 'client', 
      full_name: 'Сотрудник',
      force_logout_version: 0 
    });
  }
}