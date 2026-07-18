// app/api/driver/trips/status/route.ts
// Водитель может сменить статус СВОЕГО рейса только на "На объекте" или
// "Разгружен". Остальные переходы (Загрузка → В пути и т.д.) выполняют
// оператор/диспетчер. Логика самого перехода и расчёт простоя — общие
// с диспетчерским API (lib/orderMixers.ts), чтобы правила не расходились.
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { requireDriver } from '@/lib/driverAuth';
import { updateOrderMixerStatus } from '@/lib/orderMixers';

const DRIVER_ALLOWED_STATUSES = ['На объекте', 'Разгружен'] as const;

export async function POST(request: NextRequest) {
  try {
    const driver = await requireDriver(request);
    if (!driver) {
      return NextResponse.json({ success: false, message: 'Доступ запрещён' }, { status: 403 });
    }

    const { tripId, status, timestamp } = await request.json();

    if (!tripId || !status) {
      return NextResponse.json({ success: false, message: 'tripId и status обязательны' }, { status: 400 });
    }

    if (!DRIVER_ALLOWED_STATUSES.includes(status)) {
      return NextResponse.json({ success: false, message: 'Водитель может установить только статус "На объекте" или "Разгружен"' }, { status: 400 });
    }

    // ==================== ПРОВЕРКА ВЛАДЕНИЯ РЕЙСОМ ====================
    // Водитель может менять статус только своего собственного рейса.
    const { data: trip, error: tripError } = await supabase
      .from('order_mixers')
      .select('id, mixer_name, status')
      .eq('id', tripId)
      .maybeSingle();

    if (tripError || !trip) {
      return NextResponse.json({ success: false, message: 'Рейс не найден' }, { status: 404 });
    }

    if (trip.mixer_name !== driver.number) {
      return NextResponse.json({ success: false, message: 'Этот рейс принадлежит другому миксеру' }, { status: 403 });
    }

    // Не даём "перепрыгнуть" этап — на объект нельзя раньше, чем миксер выехал.
    if (status === 'На объекте' && trip.status !== 'В пути' && trip.status !== 'На объекте') {
      return NextResponse.json({ success: false, message: `Нельзя отметить "На объекте" из статуса "${trip.status}"` }, { status: 400 });
    }
    if (status === 'Разгружен' && trip.status !== 'На объекте' && trip.status !== 'Разгружен') {
      return NextResponse.json({ success: false, message: `Сначала отметьте "На объекте"` }, { status: 400 });
    }

    const result = await updateOrderMixerStatus({
      id: tripId,
      status,
      userName: driver.driver,
      userRole: 'driver',
      allowedStatusesOverride: DRIVER_ALLOWED_STATUSES,
      timestampOverride: typeof timestamp === 'string' ? timestamp : undefined,
      expectedStatus: trip.status,
    });

    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (error: any) {
    console.error('Driver trip status error:', error);
    return NextResponse.json({ success: false, message: error.message || 'Ошибка сервера' }, { status: 500 });
  }
}
