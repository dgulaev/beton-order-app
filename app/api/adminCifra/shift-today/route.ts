// Смена для окна планирования:
// — диспетчеры: кто сегодня добавлял миксеры к заявкам (order_history «Добавил миксер…»);
// — оператор БСУ: кто нажал «на смене» (operator_shift_settings).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_CIFRA_STAFF_ROLES } from '@/lib/adminCifraAuth';
import { moscowDateKey } from '@/lib/operatorShiftSilo';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const STAFF_OK = new Set(
  ADMIN_CIFRA_STAFF_ROLES.map((r) => r.toLowerCase()).filter((r) => r !== 'guest'),
);

/** Кто считается диспетчерской ролью в истории добавления миксеров. */
const DISPATCH_ROLES = new Set(['dispatcher', 'manager', 'admin', 'logist']);

export async function GET(request: NextRequest) {
  try {
    const rawHeader = request.headers.get('x-user-id');
    const userId = rawHeader ? parseInt(rawHeader, 10) : NaN;
    if (!Number.isFinite(userId) || userId <= 0) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    const { data: me, error: meErr } = await supabase
      .from('users')
      .select('role')
      .eq('user_id', userId)
      .maybeSingle();
    if (meErr) {
      console.error('shift-today users lookup', meErr);
      return NextResponse.json(
        { error: 'Сервис временно недоступен', code: 'auth_upstream' },
        { status: 503 },
      );
    }
    const myRole = String(me?.role || '').toLowerCase();
    if (!STAFF_OK.has(myRole)) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const qDate = String(searchParams.get('date') || '').trim();
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(qDate) ? qDate : moscowDateKey();
    const isToday = dateKey === moscowDateKey();

    // Заявки выбранного дня отгрузки.
    const { data: dayOrders, error: ordersErr } = await supabase
      .from('orders')
      .select('id')
      .eq('delivery_date', dateKey);

    if (ordersErr) {
      return NextResponse.json({ error: ordersErr.message }, { status: 500 });
    }

    const orderIds = (dayOrders || []).map((o) => o.id).filter((id) => id != null);
    const dispatcherNames: string[] = [];

    if (orderIds.length > 0) {
      // Кто назначал миксеры на заявки этого дня (история «Добавил миксер…»).
      const { data: history, error: histErr } = await supabase
        .from('order_history')
        .select('user_name, user_role, created_at, action')
        .in('order_id', orderIds)
        .ilike('action', 'Добавил миксер%')
        .order('created_at', { ascending: false });

      if (histErr) {
        return NextResponse.json({ error: histErr.message }, { status: 500 });
      }

      const seen = new Set<string>();
      for (const row of history || []) {
        const role = String(row.user_role || '').toLowerCase();
        if (role === 'system' || role === 'operator' || role === 'driver') continue;
        if (role && !DISPATCH_ROLES.has(role)) continue;
        const name = String(row.user_name || '').trim();
        if (!name || name === 'Система' || name === 'Диспетчер') continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        dispatcherNames.push(name);
      }
    }

    // Оператор — только если день = сегодня и он нажал «на смене».
    let operatorName: string | null = null;
    if (isToday) {
      const { data: shift } = await supabase
        .from('operator_shift_settings')
        .select('active_operator_name, active_operator_set_at')
        .eq('id', 1)
        .maybeSingle();

      if (shift?.active_operator_name) {
        const setAt = shift.active_operator_set_at
          ? new Date(shift.active_operator_set_at)
          : null;
        if (
          setAt &&
          !Number.isNaN(setAt.getTime()) &&
          moscowDateKey(setAt) === dateKey
        ) {
          operatorName = String(shift.active_operator_name).trim() || null;
        }
      }
    }

    return NextResponse.json({
      dateKey,
      dispatchers: dispatcherNames,
      operatorName,
    });
  } catch (e: any) {
    console.error('shift-today GET', e);
    return NextResponse.json(
      { error: e?.message || 'Ошибка сервера' },
      { status: 500 },
    );
  }
}
