// app/api/adminCifra/staff/operator-stats/route.ts
// Статистика по операторам смены. День учёта = orders.delivery_date (МСК).
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { moscowDateKey } from '@/lib/operatorShiftSilo';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const DEFAULT_NAMES = ['Семён', 'Максим'];
const MAX_AVG_DURATION_MINUTES = 180;
const MAX_RANGE_DAYS = 366;
const MAX_TRIPS = 500;

function shiftMoscowDate(dateKey: string, deltaDays: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + deltaDays * 86_400_000;
  return moscowDateKey(new Date(ms));
}

function normalizeDateStr(value: unknown): string {
  return String(value ?? '')
    .split('T')[0]
    .substring(0, 10)
    .trim();
}

function isDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function orderDeliveryDate(orders: unknown): string {
  if (!orders) return '';
  if (Array.isArray(orders)) {
    return normalizeDateStr(
      (orders[0] as { delivery_date?: string } | undefined)?.delivery_date,
    );
  }
  return normalizeDateStr((orders as { delivery_date?: string }).delivery_date);
}

type Acc = {
  trips: number;
  volume: number;
  durationSum: number;
  durationCount: number;
  minDuration: number | null;
  maxDuration: number | null;
};

function emptyAcc(): Acc {
  return {
    trips: 0,
    volume: 0,
    durationSum: 0,
    durationCount: 0,
    minDuration: null,
    maxDuration: null,
  };
}

function accToRow(name: string, e: Acc) {
  return {
    name,
    trips: e.trips,
    volume: Math.round(e.volume * 10) / 10,
    avgDurationMinutes:
      e.durationCount > 0 ? Math.round(e.durationSum / e.durationCount) : null,
    minDurationMinutes: e.minDuration,
    maxDurationMinutes: e.maxDuration,
  };
}

function bumpAcc(entry: Acc, volume: number, durationMinutes: unknown) {
  entry.trips += 1;
  entry.volume += Number(volume) || 0;
  const dur = durationMinutes == null ? null : Number(durationMinutes);
  if (dur != null && Number.isFinite(dur) && dur >= 0 && dur <= MAX_AVG_DURATION_MINUTES) {
    entry.durationSum += dur;
    entry.durationCount += 1;
    entry.minDuration =
      entry.minDuration == null ? dur : Math.min(entry.minDuration, dur);
    entry.maxDuration =
      entry.maxDuration == null ? dur : Math.max(entry.maxDuration, dur);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const todayKey = moscowDateKey();

    let fromKey = normalizeDateStr(searchParams.get('from')) || todayKey;
    let toKey = normalizeDateStr(searchParams.get('to')) || todayKey;
    if (!isDateKey(fromKey)) fromKey = todayKey;
    if (!isDateKey(toKey)) toKey = todayKey;
    if (fromKey > toKey) {
      const tmp = fromKey;
      fromKey = toKey;
      toKey = tmp;
    }

    // Ограничим диапазон, чтобы не тянуть всю историю.
    const earliest = shiftMoscowDate(todayKey, -(MAX_RANGE_DAYS - 1));
    if (fromKey < earliest) fromKey = earliest;

    const operatorName = String(searchParams.get('name') || '').trim();
    const wantTrips = searchParams.get('details') === '1' || !!operatorName;

    const { data: settings } = await supabase
      .from('operator_shift_settings')
      .select('available_names')
      .eq('id', 1)
      .maybeSingle();

    const names: string[] =
      Array.isArray(settings?.available_names) && settings.available_names.length > 0
        ? settings.available_names
        : DEFAULT_NAMES;

    const { data: logs, error } = await supabase
      .from('production_logs')
      .select(
        `
        id,
        operator_name,
        volume,
        duration_minutes,
        created_at,
        start_time,
        end_time,
        mixer_name,
        concrete_grade,
        order_id,
        orders!inner ( delivery_date, grade )
      `,
      )
      .not('operator_name', 'is', null)
      .gte('orders.delivery_date', fromKey)
      .lte('orders.delivery_date', toKey)
      .order('created_at', { ascending: false })
      .limit(wantTrips ? 2000 : 5000);

    if (error) throw error;

    const byName = new Map<string, Acc>();
    names.forEach((n) => byName.set(n, emptyAcc()));

    type TripRow = {
      id: number;
      operator_name: string;
      volume: number;
      duration_minutes: number | null;
      created_at: string;
      start_time: string | null;
      end_time: string | null;
      mixer_name: string | null;
      concrete_grade: string | null;
      order_id: number | null;
      delivery_date: string;
    };

    const trips: TripRow[] = [];

    for (const raw of logs || []) {
      const log = raw as {
        id?: number;
        operator_name?: string | null;
        volume?: number | string | null;
        duration_minutes?: number | string | null;
        created_at?: string | null;
        start_time?: string | null;
        end_time?: string | null;
        mixer_name?: string | null;
        concrete_grade?: string | null;
        order_id?: number | null;
        orders?:
          | { delivery_date?: string; grade?: string }
          | Array<{ delivery_date?: string; grade?: string }>;
      };

      const op = String(log.operator_name || '').trim();
      if (!op) continue;
      const delivery = orderDeliveryDate(log.orders);
      if (!delivery || delivery < fromKey || delivery > toKey) continue;

      if (!byName.has(op)) byName.set(op, emptyAcc());
      bumpAcc(byName.get(op)!, Number(log.volume) || 0, log.duration_minutes);

      if (wantTrips && (!operatorName || op === operatorName)) {
        const orderGrade = Array.isArray(log.orders)
          ? log.orders[0]?.grade
          : log.orders?.grade;
        trips.push({
          id: Number(log.id) || 0,
          operator_name: op,
          volume: Number(log.volume) || 0,
          duration_minutes:
            log.duration_minutes == null ? null : Number(log.duration_minutes),
          created_at: String(log.created_at || ''),
          start_time: log.start_time || null,
          end_time: log.end_time || null,
          mixer_name: log.mixer_name || null,
          concrete_grade: log.concrete_grade || orderGrade || null,
          order_id: log.order_id != null ? Number(log.order_id) : null,
          delivery_date: delivery,
        });
      }
    }

    const rows = Array.from(byName.entries())
      .map(([name, e]) => accToRow(name, e))
      .sort(
        (a, b) =>
          b.volume - a.volume || b.trips - a.trips || a.name.localeCompare(b.name, 'ru'),
      );

    const summary = operatorName
      ? rows.find((r) => r.name === operatorName) || accToRow(operatorName, emptyAcc())
      : null;

    // Пресеты для UI (от сегодня МСК).
    const presets = {
      today: { from: todayKey, to: todayKey },
      yesterday: {
        from: shiftMoscowDate(todayKey, -1),
        to: shiftMoscowDate(todayKey, -1),
      },
      week: { from: shiftMoscowDate(todayKey, -6), to: todayKey },
      month: { from: shiftMoscowDate(todayKey, -29), to: todayKey },
      quarter: { from: shiftMoscowDate(todayKey, -89), to: todayKey },
    };

    return NextResponse.json({
      success: true,
      operators: names,
      dayBasis: 'orders.delivery_date',
      timezone: 'Europe/Moscow',
      todayKey,
      from: fromKey,
      to: toKey,
      presets,
      rows,
      // Совместимость со старым UI (если кто-то ещё ждёт эти ключи).
      today: undefined,
      week: undefined,
      month: undefined,
      summary,
      trips: wantTrips ? trips.slice(0, MAX_TRIPS) : undefined,
      tripsTruncated: wantTrips ? trips.length > MAX_TRIPS : false,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Не удалось посчитать статистику операторов';
    console.error('Operator stats error:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
