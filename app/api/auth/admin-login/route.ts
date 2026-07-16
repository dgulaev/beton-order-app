// app/api/auth/admin-login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import { phonesMatch } from '@/lib/phone';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { phone, password } = await request.json();

    if (!phone || !password) {
      return NextResponse.json({ 
        success: false, 
        message: 'Телефон и пароль обязательны' 
      }, { status: 400 });
    }

    // Ищем пользователя по НОРМАЛИЗОВАННОМУ телефону — сотрудник может ввести
    // номер начиная с "8" или без "+7"/"8" вовсе, а в базе телефон может
    // храниться в другом формате. Точное сравнение строк ловило это как
    // "пользователь не найден", хотя телефон был правильный.
    const { data: candidates, error } = await supabase
      .from('users')
      .select('user_id, role, phone, password_hash, full_name, organization_name, force_logout_version')
      .not('phone', 'is', null);

    const user = !error ? (candidates || []).find((u) => phonesMatch(u.phone, phone)) : null;

    if (!user) {
      console.warn(`❌ Пользователь не найден по телефону: ${phone}`);
      return NextResponse.json({ 
        success: false, 
        message: 'Неверный телефон или пароль' 
      }, { status: 401 });
    }

    // Проверяем пароль
    const isPasswordValid = await bcrypt.compare(password, user.password_hash || '');
    if (!isPasswordValid) {
      console.warn(`❌ Неверный пароль для телефона: ${phone}`);
      return NextResponse.json({ 
        success: false, 
        message: 'Неверный телефон или пароль' 
      }, { status: 401 });
    }

    // Проверка роли
    const allowedRoles = ['admin', 'manager', 'dispatcher', 'operator', 'laborant', 'guest'];
    if (!user.role || !allowedRoles.includes(user.role)) {
      return NextResponse.json({ 
        success: false, 
        message: 'Доступ запрещён' 
      }, { status: 403 });
    }

    // === АВТОМАТИЧЕСКИЙ СБРОС force_logout_version ===
    if (user.force_logout_version && user.force_logout_version >= 9999) {
      await supabase
        .from('users')
        .update({ force_logout_version: 0 })
        .eq('user_id', user.user_id);
      
      console.log(`🔄 Сброшен force_logout_version для пользователя ${user.user_id}`);
    }

    console.log(`✅ Успешный вход: ${user.full_name || user.organization_name} (${user.role})`);

    return NextResponse.json({
      success: true,
      userId: user.user_id,
      role: user.role,
      name: user.full_name || user.organization_name || user.phone,
      phone: user.phone,
      message: 'Вход выполнен успешно'
    });

  } catch (error: any) {
    console.error('Admin login error:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Ошибка сервера' 
    }, { status: 500 });
  }
}