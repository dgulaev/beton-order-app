// app/api/auth/admin-login/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';   // ← нужно будет установить: npm install bcryptjs

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json();

    console.log('🔑 [Admin Login] Попытка входа по логину:', username);

    if (!username || !password) {
      return NextResponse.json({ success: false, message: 'Логин и пароль обязательны' }, { status: 400 });
    }

    // Ищем пользователя по username
    const { data: user, error } = await supabase
      .from('users')
      .select('user_id, role, username, password_hash, full_name, phone')
      .eq('username', username.toLowerCase().trim())
      .single();

    if (error || !user) {
      console.warn(`❌ Пользователь не найден: ${username}`);
      return NextResponse.json({ success: false, message: 'Неверный логин или пароль' }, { status: 401 });
    }

    // Проверяем пароль
    const isPasswordValid = await bcrypt.compare(password, user.password_hash || '');
    if (!isPasswordValid) {
      console.warn(`❌ Неверный пароль для: ${username}`);
      return NextResponse.json({ success: false, message: 'Неверный логин или пароль' }, { status: 401 });
    }

    // Проверка роли
    const allowedRoles = ['admin', 'manager', 'dispatcher'];
    if (!user.role || !allowedRoles.includes(user.role)) {
      return NextResponse.json({ success: false, message: 'Доступ запрещён' }, { status: 403 });
    }

    console.log(`✅ Успешный вход: ${username} (${user.role})`);

    return NextResponse.json({
      success: true,
      userId: user.user_id,
      role: user.role,
      name: user.full_name || user.phone || username,
      username: user.username,
      message: 'Вход выполнен успешно'
    });

  } catch (error: any) {
    console.error('Admin login error:', error);
    return NextResponse.json({ success: false, message: 'Ошибка сервера' }, { status: 500 });
  }
}