'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  Suspense,
  type CSSProperties,
} from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Brain, ChevronLeft, ChevronRight } from 'lucide-react';
import LogisticsPlannerTab, {
  type LogisticsPlannerOrderInput,
  type LogisticsPlannerTripInput,
} from '../components/LogisticsPlannerTab';
import MaxPlanPublishModal from '../components/MaxPlanPublishModal';
import PageHelpButton from '../components/help/PageHelpButton';
import PlannerWeatherChip from '../components/PlannerWeatherChip';
import { volumeCardSoftStyle, volumeCardStyle } from '../cardStyles';
import {
  buildDailyMixerReportGroups,
  buildUnifiedLiveDayPlanText,
  formatDailyReportDateLabel,
} from '@/lib/dailyMixerReport';
import { normalizePlanDateKey } from '@/lib/dailyLogisticsPlan';
import { mergeFetchedOrderMixers } from '@/lib/orderLogistics';
import { formatRuDateWithWeekday } from '@/lib/ruLocale';
import {
  formatOrderMixer,
  useRealtimeOrderMixers,
  useRealtimeOrders,
} from '@/hooks/useRealtimeOrders';

type OrderRow = LogisticsPlannerOrderInput & {
  delivery_date?: string | null;
  road_time_min?: number | null;
  comments?: string | null;
  phone?: string | null;
  contact_phone?: string | null;
};

function parseDateKey(raw: string | null): string {
  const norm = normalizePlanDateKey(raw || '');
  if (norm) return norm;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateKeyToLocalDate(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map((x) => parseInt(x, 10));
  return new Date(y, (m || 1) - 1, d || 1);
}

function shiftDateKey(dateKey: string, deltaDays: number): string {
  const d = dateKeyToLocalDate(dateKey);
  d.setDate(d.getDate() + deltaDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function PlanningPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dateKey = parseDateKey(searchParams.get('date'));
  const selectedDate = useMemo(() => dateKeyToLocalDate(dateKey), [dateKey]);

  const [allOrders, setAllOrders] = useState<OrderRow[]>([]);
  const [mixerAssignments, setMixerAssignments] = useState<any[]>([]);
  const [roadTimes, setRoadTimes] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [viewportW, setViewportW] = useState(1920);
  const [shiftDispatchers, setShiftDispatchers] = useState<string[]>([]);
  const [shiftOperator, setShiftOperator] = useState<string | null>(null);
  const [maxModalOpen, setMaxModalOpen] = useState(false);
  const [maxInitialText, setMaxInitialText] = useState('');
  const [maxFullDayText, setMaxFullDayText] = useState('');

  const allOrdersRef = useRef<OrderRow[]>([]);
  useEffect(() => {
    allOrdersRef.current = allOrders;
  }, [allOrders]);

  useEffect(() => {
    const sync = () => setViewportW(window.innerWidth);
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  const uiScale = viewportW >= 2500 ? 1.2 : viewportW >= 1900 ? 1.1 : 1;
  const fs = (n: number) => Math.round(n * uiScale);
  const sp = (n: number) => Math.round(n * uiScale);

  const setDateKey = useCallback(
    (next: string) => {
      const norm = parseDateKey(next);
      router.replace(`/adminCifra/planning?date=${encodeURIComponent(norm)}`);
    },
    [router],
  );

  const fetchOrdersForMonth = useCallback(async (year: number, month: number) => {
    const res = await fetch(`/api/adminCifra/orders?year=${year}&month=${month}`);
    if (!res.ok) return;
    const data: OrderRow[] = await res.json();
    setAllOrders((prev) => {
      const prefix = `${year}-${String(month).padStart(2, '0')}`;
      const others = prev.filter((o) => !String(o.delivery_date || '').startsWith(prefix));
      return [...others, ...data].sort((a, b) =>
        String(a.delivery_date || '').localeCompare(String(b.delivery_date || '')),
      );
    });
    const ids = data.map((o) => o.id).join(',');
    if (!ids) return;
    const mr = await fetch(`/api/adminCifra/order-mixers?orderIds=${ids}`);
    if (!mr.ok) return;
    const mixers: any[] = await mr.json();
    setMixerAssignments((prev) =>
      mergeFetchedOrderMixers(
        prev,
        mixers,
        data.map((o) => o.id),
      ),
    );
  }, []);

  const monthKey = `${selectedDate.getFullYear()}-${selectedDate.getMonth() + 1}`;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const [y, m] = monthKey.split('-').map(Number);
    fetchOrdersForMonth(y, m).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [monthKey, fetchOrdersForMonth]);

  useRealtimeOrders(setAllOrders);
  useRealtimeOrderMixers(setMixerAssignments, {
    orders: allOrders,
    onReload: () => {
      const [y, m] = monthKey.split('-').map(Number);
      void fetchOrdersForMonth(y, m);
    },
  });

  useEffect(() => {
    if (!allOrders.length) return;
    setMixerAssignments((prev) => prev.map((m) => formatOrderMixer(m, allOrders)));
  }, [allOrders]);

  const dayOrders = useMemo(() => {
    return allOrders
      .filter((o) => String(o.delivery_date || '').substring(0, 10) === dateKey)
      .filter((o) => String(o.status || '').toLowerCase() !== 'cancelled')
      .sort((a, b) =>
        String(a.delivery_time || '00:00').localeCompare(String(b.delivery_time || '00:00')),
      );
  }, [allOrders, dateKey]);

  const todayOrderIds = useMemo(
    () => new Set(dayOrders.map((o) => String(o.id))),
    [dayOrders],
  );

  const dayTrips = useMemo(
    () =>
      mixerAssignments.filter((m) =>
        todayOrderIds.has(String(m.orderId ?? m.order_id)),
      ) as LogisticsPlannerTripInput[],
    [mixerAssignments, todayOrderIds],
  );

  const onLineCount = useMemo(() => {
    const active = new Set(['Загрузка', 'В пути', 'На объекте', 'Проблема']);
    const nums = new Set<string>();
    for (const t of dayTrips) {
      if (!active.has(String(t.status || ''))) continue;
      const n = String(t.number || t.mixer_name || '').trim();
      if (n) nums.add(n);
    }
    return nums.size;
  }, [dayTrips]);

  // Фоновый расчёт дорог для заявок дня
  useEffect(() => {
    const controller = new AbortController();
    const calcMissing = async () => {
      const orders = allOrdersRef.current.filter(
        (o) =>
          String(o.delivery_date || '').substring(0, 10) === dateKey &&
          (o.status === 'new' || o.status === 'processing'),
      );
      for (const order of orders) {
        if (controller.signal.aborted) break;
        const orderId = String(order.id);
        if (roadTimes[orderId] !== undefined) continue;
        if (order.road_time_min != null) {
          setRoadTimes((prev) => ({ ...prev, [orderId]: Number(order.road_time_min) }));
          continue;
        }
        try {
          const res = await fetch('/api/adminCifra/travel-time', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: order.id, address: order.address || '' }),
            signal: controller.signal,
          });
          if (res.ok) {
            const { road_time_min } = await res.json();
            if (typeof road_time_min === 'number') {
              setRoadTimes((prev) => ({ ...prev, [orderId]: road_time_min }));
            }
          }
        } catch (e: any) {
          if (e?.name === 'AbortError') break;
        }
      }
    };
    const timer = setTimeout(calcMissing, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateKey]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const userId =
          typeof window !== 'undefined' ? localStorage.getItem('userId') : null;
        if (!userId) return;
        const res = await fetch(
          `/api/adminCifra/shift-today?date=${encodeURIComponent(dateKey)}`,
          { headers: { 'x-user-id': userId } },
        );
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        setShiftDispatchers(
          Array.isArray(data.dispatchers)
            ? data.dispatchers.map((n: unknown) => String(n || '').trim()).filter(Boolean)
            : [],
        );
        setShiftOperator(
          typeof data.operatorName === 'string' && data.operatorName.trim()
            ? data.operatorName.trim()
            : null,
        );
      } catch {
        /* ignore */
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [dateKey]);

  const reportGroups = useMemo(
    () =>
      buildDailyMixerReportGroups({
        orders: dayOrders as any,
        mixers: dayTrips as any,
      }),
    [dayOrders, dayTrips],
  );

  const autoReport = useMemo(
    () =>
      buildUnifiedLiveDayPlanText({
        dateLabel: formatDailyReportDateLabel(selectedDate),
        groups: reportGroups,
        onLineCount,
        excludeCompleted: true,
      }),
    [selectedDate, reportGroups, onLineCount],
  );

  const autoReportFullDay = useMemo(
    () =>
      buildUnifiedLiveDayPlanText({
        dateLabel: formatDailyReportDateLabel(selectedDate),
        groups: reportGroups,
        onLineCount,
        excludeCompleted: false,
      }),
    [selectedDate, reportGroups, onLineCount],
  );

  const dateLabel = formatRuDateWithWeekday(selectedDate, 'nominative');
  const narrow = viewportW < 1100;

  return (
    <div
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: sp(12),
        padding: `${sp(12)}px ${sp(16)}px ${sp(10)}px`,
        boxSizing: 'border-box',
        overflow: 'hidden',
        background: 'linear-gradient(180deg, #0B1220 0%, #0F172A 40%, #0B1220 100%)',
      }}
    >
      <header
        style={volumeCardStyle({
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: sp(12),
          flexShrink: 0,
          padding: `${sp(12)}px ${sp(16)}px`,
          borderRadius: 18,
        })}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: sp(10), minWidth: 0 }}>
          <Brain size={fs(22)} color="#6EE7B7" />
          <div
            style={{
              fontSize: fs(20),
              fontWeight: 800,
              color: '#F1F5F9',
              lineHeight: 1.2,
            }}
          >
            Интеллектуальное планирование
          </div>
          <PageHelpButton compact title="Инструкция по планированию" />
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: sp(6),
            marginLeft: 'auto',
          }}
        >
          <button
            type="button"
            aria-label="Предыдущий день"
            onClick={() => setDateKey(shiftDateKey(dateKey, -1))}
            style={navDayBtn}
          >
            <ChevronLeft size={18} />
          </button>
          <input
            type="date"
            value={dateKey}
            onChange={(e) => setDateKey(e.target.value)}
            style={volumeCardSoftStyle({
              padding: '8px 12px',
              borderRadius: 10,
              color: '#E2E8F0',
              fontSize: fs(14),
              fontWeight: 700,
            })}
          />
          <button
            type="button"
            aria-label="Следующий день"
            onClick={() => setDateKey(shiftDateKey(dateKey, 1))}
            style={navDayBtn}
          >
            <ChevronRight size={18} />
          </button>
          <button
            type="button"
            onClick={() => setDateKey(parseDateKey(null))}
            style={{
              ...navDayBtn,
              padding: '8px 12px',
              fontSize: fs(13),
              fontWeight: 700,
            }}
          >
            Сегодня
          </button>
        </div>

        <PlannerWeatherChip dateKey={dateKey} uiScale={uiScale} />

        {shiftDispatchers.map((name) => (
          <span key={`d-${name}`} style={pillStyle('#60A5FA', '#BFDBFE')}>
            Диспетчер: {name}
          </span>
        ))}
        {shiftOperator ? (
          <span style={pillStyle('#FB923C', '#FDBA74')}>Оператор: {shiftOperator}</span>
        ) : null}

        {loading ? (
          <span style={{ fontSize: fs(13), color: '#64748B' }}>Загружаю заявки…</span>
        ) : (
          <span style={{ fontSize: fs(13), color: '#64748B' }}>
            {dayOrders.length} заявок · {dayTrips.length} рейс. в заявках
          </span>
        )}
      </header>

      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {loading ? (
          <div
            style={volumeCardStyle({
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94A3B8',
              fontSize: fs(15),
              borderRadius: 18,
            })}
          >
            Загружаю заявки дня…
          </div>
        ) : (
          <LogisticsPlannerTab
            key={dateKey}
            layout="page"
            dateKey={dateKey}
            dateLabel={dateLabel}
            orders={dayOrders}
            dayTrips={dayTrips}
            roadTimes={roadTimes}
            onRoadTimesUpdate={(times) => {
              setRoadTimes((prev) => ({ ...prev, ...times }));
              setAllOrders((prev) =>
                prev.map((o) => {
                  const m = times[String(o.id)];
                  return typeof m === 'number' ? { ...o, road_time_min: m } : o;
                }),
              );
            }}
            reportGroups={reportGroups}
            reportDateLabel={formatDailyReportDateLabel(selectedDate)}
            onLineCount={onLineCount}
            uiScale={uiScale}
            compactSide={narrow}
            onApplyMaxText={({ activeText, fullDayText }) => {
              setMaxInitialText(activeText);
              setMaxFullDayText(fullDayText);
              setMaxModalOpen(true);
            }}
          />
        )}
      </div>

      <MaxPlanPublishModal
        open={maxModalOpen}
        onClose={() => setMaxModalOpen(false)}
        dateKey={dateKey}
        dateLabel={dateLabel}
        initialText={maxInitialText}
        fullDayText={maxFullDayText || autoReportFullDay}
        autoReport={autoReport}
      />
    </div>
  );
}

const navDayBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 36,
  height: 36,
  borderRadius: 10,
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'linear-gradient(165deg, #1E2937 0%, #0F172A 100%)',
  boxShadow: '0 4px 10px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.08)',
  color: '#E2E8F0',
  cursor: 'pointer',
};

function pillStyle(border: string, color: string): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 12px',
    borderRadius: 999,
    border: `1px solid ${border}66`,
    background: `${border}22`,
    color,
    fontSize: 13,
    fontWeight: 700,
    whiteSpace: 'nowrap',
  };
}

export default function PlanningPage() {
  return (
    <Suspense
      fallback={
        <div style={{ padding: 24, color: '#94A3B8' }}>Открываю планирование…</div>
      }
    >
      <PlanningPageInner />
    </Suspense>
  );
}
