// app/api/adminCifra/force-logout-all/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_CIFRA_STAFF_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/** Все staff-роли, включая guest/laborant — иначе «Разлогинить всех» их не трогает. */
const FORCE_LOGOUT_ROLES = [...ADMIN_CIFRA_STAFF_ROLES];

export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ['admin']);
  if (auth.error) {
    return NextResponse.json(
      { success: false, message: 'Доступ запрещён. Только администратор.' },
      { status: 403 },
    );
  }

  try {
    const actorId = auth.user.user_id;
    // Монотонная версия: всегда > предыдущей (в т.ч. старых 9999), клиентский kick по `>`.
    const version = Date.now();

    const { data: targets, error: selectError } = await supabase
      .from('users')
      .select('user_id')
      .in('role', FORCE_LOGOUT_ROLES)
      .neq('user_id', actorId);

    if (selectError) {
      console.error('Force logout select error:', selectError);
      return NextResponse.json(
        { success: false, message: selectError.message },
        { status: 500 },
      );
    }

    const targetIds = (targets || []).map((u) => Number(u.user_id)).filter((id) => id > 0);

    if (targetIds.length > 0) {
      const { error } = await supabase
        .from('users')
        .update({ force_logout_version: version })
        .in('user_id', targetIds);

      if (error) {
        console.error('Force logout update error:', error);
        return NextResponse.json(
          { success: false, message: error.message },
          { status: 500 },
        );
      }

      // Сразу убираем из «Кто в онлайн»
      const { error: sessError } = await supabase
        .from('active_sessions')
        .delete()
        .in('user_id', targetIds);
      if (sessError) {
        console.error('Force logout sessions cleanup:', sessError);
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Все сотрудники успешно выкинуты из системы',
      version,
      kicked: targetIds.length,
      actorId,
    });
  } catch (error: any) {
    console.error('Force logout all error:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Внутренняя ошибка сервера' },
      { status: 500 },
    );
  }
}
