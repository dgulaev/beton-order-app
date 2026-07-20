// app/api/auth/identify/route.ts
// Первый шаг унифицированного входа в мобильную версию (см. app/mobile/layout.tsx):
// по одному телефону определяем, кто пытается войти — сотрудник (users) и/или
// водитель (mixers), — чтобы форма показала нужный следующий шаг (пароль или
// выбор миксера). Собственно вход (проверка пароля / номера миксера) всё так
// же происходит через /api/auth/admin-login и /api/driver/auth.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { phonesMatch } from '@/lib/phone';

const ALLOWED_STAFF_ROLES = ['admin', 'manager', 'dispatcher', 'operator', 'laborant', 'guest'];

export async function POST(request: NextRequest) {
  try {
    const { phone } = await request.json();
    if (!phone || typeof phone !== 'string' || !phone.trim()) {
      return NextResponse.json({ success: false, message: 'Укажите телефон' }, { status: 400 });
    }

    const trimmedPhone = phone.trim();

    // Сотрудник и водитель — сравниваем по нормализованному телефону (не
    // точным совпадением строки): сотрудник может ввести номер, начиная с
    // "8" или без "+7"/"8" вовсе, а в базе телефон может храниться в другом
    // формате ("+7...", "8...", просто 10 цифр и т.п.). Оба запроса
    // независимы — грузим параллельно, а не по очереди, чтобы не платить
    // задержкой сети дважды.
    const [{ data: staffUsers }, { data: mixers }, { data: extraDriverRows }] = await Promise.all([
      supabase
        .from('users')
        .select('user_id, role, full_name, organization_name, phone')
        .not('phone', 'is', null),
      supabase
        .from('mixers')
        .select('number, model, driver, phone')
        .not('phone', 'is', null),
      // Дополнительные водители из mixer_drivers (нужен JOIN с mixers)
      supabase
        .from('mixer_drivers')
        .select('driver_name, phone, mixers!inner(number, model)')
        .not('phone', 'is', null),
    ]);

    const staffUser = (staffUsers || []).find((u) => phonesMatch(u.phone, trimmedPhone)) || null;

    const staff =
      staffUser && staffUser.role && ALLOWED_STAFF_ROLES.includes(staffUser.role)
        ? {
            userId: staffUser.user_id,
            role: staffUser.role,
            name: staffUser.full_name || staffUser.organization_name || trimmedPhone,
          }
        : null;

    // Основные водители
    const primaryMatches = (mixers || [])
      .filter((m) => phonesMatch(m.phone, trimmedPhone))
      .map((m) => ({ number: m.number, model: m.model as string | null, driver: m.driver as string }));

    // Дополнительные водители из mixer_drivers
    const extraMatches = (extraDriverRows || [])
      .filter((r) => phonesMatch(r.phone, trimmedPhone))
      .map((r) => {
        const mx = r.mixers as any;
        return { number: mx.number as string, model: mx.model as string | null, driver: r.driver_name as string };
      });

    // Объединяем, убирая дубли по номеру миксера (основной приоритетнее)
    const seen = new Set(primaryMatches.map((m) => m.number));
    const driverMixers = [
      ...primaryMatches,
      ...extraMatches.filter((m) => !seen.has(m.number)),
    ];

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
