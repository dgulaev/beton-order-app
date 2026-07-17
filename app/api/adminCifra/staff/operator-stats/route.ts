// app/api/adminCifra/staff/operator-stats/route.ts
// Статистика по операторам смены (Семён/Максим — общая учётка "Оператор" на
// всех). Используется в карточке "Оператор" на странице Клиенты → Стафф,
// чтобы показать реальную активность каждого, а не общую "статистику куратора"
// (у оператора нет клиентов/продаж — эти метрики там были бессмысленны).
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DEFAULT_NAMES = ['Семён', 'Максим'];

interface OperatorPeriodStats {
  name: string;
  trips: number;
  volume: number;
  avgDurationMinutes: number | null;
}

export async function GET() {
  try {
    const { data: settings } = await supabase
      .from('operator_shift_settings')
      .select('available_names')
      .eq('id', 1)
      .maybeSingle();

    const names: string[] =
      Array.isArray(settings?.available_names) && settings.available_names.length > 0
        ? settings.available_names
        : DEFAULT_NAMES;

    // Тянем разом самый широкий период (30 дней) — дальше периоды поменьше
    // (сегодня/7 дней) считаются в памяти, без повторных запросов к базе.
    const monthStart = new Date();
    monthStart.setDate(monthStart.getDate() - 30);
    monthStart.setHours(0, 0, 0, 0);

    const { data: logs, error } = await supabase
      .from('production_logs')
      .select('operator_name, volume, duration_minutes, created_at')
      .not('operator_name', 'is', null)
      .gte('created_at', monthStart.toISOString());

    if (error) throw error;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);

    const buildPeriod = (since: Date): OperatorPeriodStats[] => {
      const byName = new Map<string, { trips: number; volume: number; durationSum: number; durationCount: number }>();
      names.forEach((n) => byName.set(n, { trips: 0, volume: 0, durationSum: 0, durationCount: 0 }));

      for (const log of logs || []) {
        if (!log.operator_name) continue;
        if (new Date(log.created_at) < since) continue;

        // Имя могло быть удалено из текущего списка available_names, но
        // исторические данные по нему всё равно должны отображаться.
        if (!byName.has(log.operator_name)) {
          byName.set(log.operator_name, { trips: 0, volume: 0, durationSum: 0, durationCount: 0 });
        }
        const entry = byName.get(log.operator_name)!;
        entry.trips += 1;
        entry.volume += Number(log.volume) || 0;
        if (log.duration_minutes != null) {
          entry.durationSum += Number(log.duration_minutes);
          entry.durationCount += 1;
        }
      }

      return Array.from(byName.entries())
        .map(([name, e]) => ({
          name,
          trips: e.trips,
          volume: Math.round(e.volume * 10) / 10,
          avgDurationMinutes: e.durationCount > 0 ? Math.round(e.durationSum / e.durationCount) : null,
        }))
        .sort((a, b) => b.volume - a.volume);
    };

    return NextResponse.json({
      operators: names,
      today: buildPeriod(todayStart),
      week: buildPeriod(weekStart),
      month: buildPeriod(monthStart),
    });
  } catch (error: any) {
    console.error('Operator stats error:', error);
    return NextResponse.json(
      { error: error.message || 'Не удалось посчитать статистику операторов' },
      { status: 500 }
    );
  }
}
