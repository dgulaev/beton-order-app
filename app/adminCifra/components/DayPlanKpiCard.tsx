'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { volumeCardStyle } from '../cardStyles';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import {
  canEditDailyLogisticsPlan,
  formatPlanUpdatedAtLabel,
  loadLocalLogisticsPlanDraft,
  normalizePlanDateKey,
  type DailyLogisticsPlanPayload,
  type DailyLogisticsPlanRow,
} from '@/lib/dailyLogisticsPlan';
import {
  PICKUP_MIXER_NUMBER,
  type PlannedTrip,
} from '@/lib/logisticsPlanner';
import { useRealtimeDailyLogisticsPlan } from '@/hooks/useRealtimeDailyLogisticsPlan';
import { pluralRu } from '@/lib/ruLocale';

type DayTrip = {
  orderId?: number | string | null;
  order_id?: number | string | null;
  number?: string | null;
  mixer_name?: string | null;
  status?: string | null;
};

type Props = {
  dateKey: string;
  /** Активные миксеры дня (для бейджа). */
  activeMixersCount: number;
  dayTrips: DayTrip[];
  onOpenPlan: () => void;
};

function parsePayload(raw: unknown): DailyLogisticsPlanPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as DailyLogisticsPlanPayload;
  return {
    selectedMixerIds: Array.isArray(p.selectedMixerIds) ? p.selectedMixerIds.map(String) : [],
    lockedTrips: Array.isArray(p.lockedTrips) ? p.lockedTrips : [],
    manualDoneOrderIds: Array.isArray(p.manualDoneOrderIds)
      ? p.manualDoneOrderIds.map(String)
      : [],
    trips: Array.isArray(p.trips) ? p.trips : [],
    allowNight: Boolean(p.allowNight),
    useTraffic: Boolean(p.useTraffic),
    orderShifts: Array.isArray(p.orderShifts) ? p.orderShifts : [],
    warnings: Array.isArray(p.warnings) ? p.warnings : [],
  };
}

function mixerKey(raw: string): string {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.]/g, '');
}

function tripBucket(
  trip: PlannedTrip,
  dayTrips: DayTrip[],
): 'done' | 'in_work' | 'planned' {
  if (trip.done) return 'done';
  const oid = String(trip.orderId);
  const key = mixerKey(trip.mixerNumber);
  const isPu = Boolean(trip.pickup || trip.mixerNumber === PICKUP_MIXER_NUMBER);
  const live = dayTrips.find((d) => {
    if (String(d.orderId ?? d.order_id) !== oid) return false;
    if (isPu) return true;
    return mixerKey(String(d.number || d.mixer_name || '')) === key;
  });
  const st = String(live?.status || '');
  if (st === 'Разгружен' || st === 'Возврат') return 'done';
  if (['Загрузка', 'В пути', 'На объекте', 'Проблема'].includes(st)) return 'in_work';
  return 'planned';
}

function fmtVol(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export default function DayPlanKpiCard({
  dateKey,
  activeMixersCount,
  dayTrips,
  onOpenPlan,
}: Props) {
  const [plan, setPlan] = useState<DailyLogisticsPlanRow | null>(null);
  const [localPayload, setLocalPayload] = useState<DailyLogisticsPlanPayload | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  const applyRecord = useCallback((row: DailyLogisticsPlanRow | null) => {
    setPlan(row);
    if (row) setLocalPayload(null);
  }, []);

  const revisionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const apiDate = normalizePlanDateKey(dateKey) || dateKey;
    setLoading(true);
    revisionRef.current = 0;
    (async () => {
      const local = loadLocalLogisticsPlanDraft(dateKey);
      if (!cancelled && local?.trips?.length) setLocalPayload(local);

      try {
        const res = await fetch(
          `/api/adminCifra/logistics-plan?date=${encodeURIComponent(apiDate)}`,
          { headers: adminCifraAuthHeaders() },
        );
        if (cancelled) return;
        if (!res.ok) {
          setPlan(null);
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const shared = (data?.plan as DailyLogisticsPlanRow | null) || null;
        if (shared) revisionRef.current = Number(shared.revision) || 0;
        applyRecord(shared);

        // Старый расчёт только в браузере — один раз публикуем в общий план.
        const role =
          typeof window !== 'undefined' ? localStorage.getItem('userRole') : null;
        if (
          !shared &&
          local?.trips?.length &&
          canEditDailyLogisticsPlan(role)
        ) {
          const putRes = await fetch('/api/adminCifra/logistics-plan', {
            method: 'PUT',
            headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ date: apiDate, payload: local }),
          });
          if (putRes.ok && !cancelled) {
            const putData = await putRes.json().catch(() => ({}));
            if (putData?.plan) applyRecord(putData.plan as DailyLogisticsPlanRow);
          }
        }
      } catch {
        if (!cancelled) setPlan(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dateKey, applyRecord]);

  useRealtimeDailyLogisticsPlan(
    dateKey,
    (record) => {
      if (!record.payload || !record.revision) {
        setPlan(null);
        revisionRef.current = 0;
        return;
      }
      const rev = Number(record.revision) || 0;
      // Heartbeat soft-lock не меняет revision — не перерисовываем KPI зря
      if (rev > 0 && rev === revisionRef.current) return;
      revisionRef.current = rev;
      applyRecord({
        delivery_date: String(record.delivery_date || '').substring(0, 10),
        payload: parsePayload(record.payload) || {
          selectedMixerIds: [],
          lockedTrips: [],
          manualDoneOrderIds: [],
          trips: [],
        },
        max_text: record.max_text ?? null,
        revision: rev,
        updated_at: record.updated_at || '',
        updated_by_name: record.updated_by_name ?? null,
        updated_by_role: record.updated_by_role ?? null,
        updated_by_user_id: record.updated_by_user_id ?? null,
      });
    },
    { enabled: true },
  );

  const payload = useMemo(() => {
    if (plan) return parsePayload(plan.payload);
    return localPayload;
  }, [plan, localPayload]);

  const trips = payload?.trips || [];

  const fromLocalOnly = Boolean(!plan && localPayload?.trips?.length);
  const totalVol = useMemo(
    () => trips.reduce((s, t) => s + (Number(t.volume) || 0), 0),
    [trips],
  );

  const buckets = useMemo(() => {
    let done = 0;
    let inWork = 0;
    let planned = 0;
    for (const t of trips) {
      const b = tripBucket(t, dayTrips);
      if (b === 'done') done += 1;
      else if (b === 'in_work') inWork += 1;
      else planned += 1;
    }
    return { done, inWork, planned };
  }, [trips, dayTrips]);

  const nextSlots = useMemo(() => {
    return [...trips]
      .filter((t) => tripBucket(t, dayTrips) !== 'done')
      .sort((a, b) => {
        const am = a.loadAtMin ?? 0;
        const bm = b.loadAtMin ?? 0;
        if (am || bm) return am - bm;
        return String(a.loadTime).localeCompare(String(b.loadTime));
      })
      .slice(0, 2);
  }, [trips, dayTrips]);

  const updatedLabel =
    plan?.updated_by_name && plan.updated_at
      ? `обновил ${plan.updated_by_name} в ${formatPlanUpdatedAtLabel(plan.updated_at)}`
      : plan?.updated_by_name
        ? `обновил ${plan.updated_by_name}`
        : null;

  const hasPlan = trips.length > 0;

  return (
    <div
      onClick={onOpenPlan}
      style={volumeCardStyle({
        borderRadius: 18,
        padding: '16px 14px',
        minWidth: 0,
        overflow: 'hidden',
        cursor: 'pointer',
        transition: 'filter 0.2s',
        display: 'flex',
        flexDirection: 'column',
      })}
      onMouseEnter={(e) => {
        e.currentTarget.style.filter = 'brightness(1.08)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = 'none';
      }}
      title="Открыть интеллектуальное планирование"
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          marginBottom: 4,
          minWidth: 0,
        }}
      >
        <div
          style={{
            color: '#94A3B8',
            fontSize: 12,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            minWidth: 0,
          }}
        >
          План дня
          <span style={{ color: '#475569', marginLeft: 6, fontWeight: 600 }}>live</span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            window.location.href = '/adminCifra/mixers';
          }}
          title="Миксеры в работе — открыть парк"
          style={{
            flexShrink: 0,
            border: '1px solid rgba(96,165,250,0.45)',
            background: 'rgba(96,165,250,0.14)',
            color: '#93C5FD',
            borderRadius: 999,
            padding: '2px 8px',
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {activeMixersCount} в работе
        </button>
      </div>

      {loading ? (
        <div style={{ color: '#64748B', fontSize: 14, paddingTop: 10 }}>Загрузка…</div>
      ) : hasPlan ? (
        <>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              marginBottom: 2,
              whiteSpace: 'nowrap',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ fontSize: 36, fontWeight: 700, color: '#60A5FA', lineHeight: 1 }}>
              {trips.length}
            </span>
            <span style={{ color: '#94A3B8', fontSize: 13, flexShrink: 0 }}>
              {pluralRu(trips.length, 'рейс', 'рейса', 'рейсов')} · {fmtVol(totalVol)} м³
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px 10px',
              fontSize: 11,
              color: '#94A3B8',
              marginTop: 6,
            }}
          >
            <span style={{ color: '#6EE7B7' }}>✓ {buckets.done} отработ.</span>
            <span style={{ color: '#FDE047' }}>▶ {buckets.inWork} в работе</span>
            <span style={{ color: '#94A3B8' }}>○ {buckets.planned} в плане</span>
          </div>

          <div style={{ height: 1, background: '#334155', margin: '10px 0' }} />

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              fontSize: 12.5,
              minWidth: 0,
            }}
          >
            {nextSlots.map((t) => {
              const isPu = Boolean(t.pickup || t.mixerNumber === PICKUP_MIXER_NUMBER);
              return (
                <div
                  key={t.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 6,
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      color: '#CBD5E1',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      minWidth: 0,
                    }}
                  >
                    <span style={{ color: '#FDE047', fontWeight: 600 }}>{t.loadTime}</span>
                    {' · '}
                    {isPu ? 'самовывоз' : t.mixerNumber}
                    {' '}
                    {fmtVol(Number(t.volume) || 0)} м³
                  </span>
                </div>
              );
            })}
            {updatedLabel ? (
              <div
                style={{
                  color: '#475569',
                  fontSize: 11,
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {updatedLabel}
              </div>
            ) : fromLocalOnly ? (
              <div
                style={{
                  color: '#475569',
                  fontSize: 11,
                  marginTop: 2,
                }}
              >
                из черновика браузера → публикую…
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div
          style={{
            paddingTop: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            color: '#94A3B8',
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 600, color: '#CBD5E1' }}>Плана ещё нет</span>
          <span style={{ fontSize: 13 }}>Открой расчёт — появится здесь у всех</span>
          {activeMixersCount > 0 ? (
            <span style={{ fontSize: 12, color: '#64748B' }}>
              На линии сейчас {activeMixersCount}{' '}
              {pluralRu(activeMixersCount, 'миксер', 'миксера', 'миксеров')}
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}
