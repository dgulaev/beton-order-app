// app/api/auth/identify/route.ts
// Первый шаг унифицированного входа в мобильную версию (см. app/mobile/layout.tsx):
// по одному телефону определяем, кто пытается войти — сотрудник (users) и/или
// водитель (mixers), — чтобы форма показала нужный следующий шаг (пароль или
// выбор миксера). Собственно вход (проверка пароля / номера миксера) всё так
// же происходит через /api/auth/admin-login и /api/driver/auth.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { phonesMatch } from '@/lib/phone';

const ALLOWED_STAFF_ROLES = ['admin', 'manager', 'dispatcher', 'operator', 'guest'];

export async function POST(request: NextRequest) {
  try {
    const { phone } = await request.json();
    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      return NextResponse.json({ success: false, message: 'Укажите телефон' }, { status: 400 });
    }

    const trimmedPhone = phone.trim();

    // Сотрудник — сравниваем по нормализованному телефону (как и водителей
    // ниже), а не точным совпадением строки: сотрудник может ввести номер,
    // начиная с "8" или без "+7"/"8" вовсе, а в базе телефон может храниться
    // в другом формате ("+7...", "8...", просто 10 цифр и т.п.).
    const { data: staffUsers } = await supabase
      .from('users')
      .select('user_id, role, full_name, organization_name, phone')
      .not('phone', 'is', null);

    const staffUser = (staffUsers || []).find((u) => phonesMatch(u.phone, trimmedPhone)) || null;

    const staff =
      staffUser && staffUser.role && ALLOWED_STAFF_ROLES.includes(staffUser.role)
        ? {
            userId: staffUser.user_id,
            role: staffUser.role,
            name: staffUser.full_name || staffUser.organization_name || trimmedPhone,
          }
        : null;

    // Водитель — сравниваем по нормализованному телефону, т.к. формат ввода может отличаться.
    const { data: mixers } = await supabase
      .from('mixers')
      .select('number, model, driver, phone')
      .not('phone', 'is', null);

    const driverMixers = (mixers || [])
      .filter((m) => phonesMatch(m.phone, trimmedPhone))
      .map((m) => ({ number: m.number, model: m.model as string | null, driver: m.driver as string }));

    if (!staff && driverMixers.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Телефон не найден. Обратитесь к диспетчеру.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, staff, driverMixers });
  } catch (error: any) {
    console.error('Identify error:', error);
    return NextResponse.json({ success: false, message: 'Ошибка сервера' }, { status: 500 });
  }
}
