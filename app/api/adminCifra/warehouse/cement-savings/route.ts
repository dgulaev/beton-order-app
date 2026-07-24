// Admin-only: экономия цемента за период (по дням МСК + общий итог).
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { siloNameById } from '@/lib/siloConfig';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

function moscowDateStr(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function moscowDayBounds(dateKey: string): { start: string; end: string } {
  const start = new Date(`${dateKey}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function moscowDateKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ['admin']);
  if (auth.error) return auth.error;

  try {
    const fromParam = request.nextUrl.searchParams.get('from');
    const toParam = request.nextUrl.searchParams.get('to');
    const today = moscowDateStr();
    const fromKey = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : today;
    const toKey = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? toParam : today;

    if (fromKey > toKey) {
      return NextResponse.json({ error: 'from не может быть позже to' }, { status: 400 });
    }

    const { start } = moscowDayBounds(fromKey);
    const { end } = moscowDayBounds(toKey);

    const { data, error } = await supabase
      .from('warehouse_cement_savings')
      .select('id, silo_id, amount_kg, reason, balance_before_tons, user_name, created_at')
      .gte('created_at', start)
      .lt('created_at', end)
      .order('created_at', { ascending: false })
      .limit(2000);

    if (error) {
      console.error('cement-savings GET:', error);
      return NextResponse.json(
        {
          error: error.message.includes('warehouse_cement_savings')
            ? 'Не применена таблица экономии (scripts/warehouse-cement-savings.sql)'
            : error.message,
        },
        { status: 500 },
      );
    }

    const entries = (data || []).map((row) => {
      const rawReason = String(row.reason || '');
      const reason =
        rawReason === 'refill'
          ? 'refill'
          : rawReason === 'meka_reconcile'
            ? 'meka_reconcile'
            : 'reset';
      return {
        id: Number(row.id),
        siloId: Number(row.silo_id),
        siloName: siloNameById(Number(row.silo_id)),
        amountKg: Math.round(Number(row.amount_kg || 0) * 10) / 10,
        reason: reason as 'reset' | 'refill' | 'meka_reconcile',
        balanceBeforeTons: Number(row.balance_before_tons || 0),
        userName: row.user_name || null,
        createdAt: row.created_at,
        dateKey: moscowDateKey(String(row.created_at)),
      };
    });

    type DayAgg = {
      dateKey: string;
      totalKg: number;
      bySilo: Record<string, number>;
      count: number;
    };

    const dayMap = new Map<string, DayAgg>();
    let totalKg = 0;

    for (const e of entries) {
      totalKg += e.amountKg;
      let day = dayMap.get(e.dateKey);
      if (!day) {
        day = {
          dateKey: e.dateKey,
          totalKg: 0,
          bySilo: { '1': 0, '2': 0, '3': 0 },
          count: 0,
        };
        dayMap.set(e.dateKey, day);
      }
      day.totalKg += e.amountKg;
      day.count += 1;
      const key = String(e.siloId);
      if (key in day.bySilo) {
        day.bySilo[key] = Math.round((day.bySilo[key] + e.amountKg) * 10) / 10;
      }
    }

    const days = Array.from(dayMap.values())
      .map((d) => ({
        ...d,
        totalKg: Math.round(d.totalKg * 10) / 10,
      }))
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey));

    return NextResponse.json({
      from: fromKey,
      to: toKey,
      totalKg: Math.round(totalKg * 10) / 10,
      entryCount: entries.length,
      days,
      entries,
    });
  } catch (err: any) {
    console.error('cement-savings GET:', err);
    return NextResponse.json({ error: err.message || 'Ошибка' }, { status: 500 });
  }
}
