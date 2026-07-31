'use client';

import { useMemo } from 'react';
import type { PlannedTrip } from '@/lib/logisticsPlanner';
import { PICKUP_MIXER_NUMBER } from '@/lib/logisticsPlanner';
import {
  formatFactDeltaLabel,
  type PlanTripFact,
} from '@/lib/plannerFactMatch';

type Props = {
  dateLabel: string;
  trips: PlannedTrip[];
  planFactByTripId: Map<string, PlanTripFact>;
  uiScale?: number;
};

/**
 * Упрощённый вид оператора БСУ: очередь соски и ближайшие слоты.
 * Без расчёта / apply / правок плана.
 */
export default function PlannerOperatorView({
  dateLabel,
  trips,
  planFactByTripId,
  uiScale = 1,
}: Props) {
  const fs = (n: number) => Math.round(n * uiScale);
  const sp = (n: number) => Math.round(n * uiScale);

  const upcoming = useMemo(() => {
    return [...trips]
      .filter((t) => !t.done)
      .sort((a, b) => {
        const am = a.loadAtMin ?? 0;
        const bm = b.loadAtMin ?? 0;
        if (am || bm) return am - bm;
        return String(a.loadTime).localeCompare(String(b.loadTime));
      })
      .slice(0, 16);
  }, [trips]);

  const nozzleNext = upcoming[0] || null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: sp(12),
        minHeight: 0,
        flex: 1,
        overflow: 'hidden',
      }}
    >
      <div style={{ fontSize: fs(14), color: '#94A3B8', lineHeight: 1.45, flexShrink: 0 }}>
        {dateLabel}: очередь соски по общему плану дня. Расчёт и запись в заявки — у диспетчера.
      </div>

      <div
        style={{
          padding: `${sp(14)}px ${sp(16)}px`,
          borderRadius: 14,
          background: 'rgba(56,189,248,0.1)',
          border: '1px solid rgba(56,189,248,0.35)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            fontSize: fs(11),
            fontWeight: 700,
            color: '#38BDF8',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            marginBottom: sp(6),
          }}
        >
          Следующая соска
        </div>
        {nozzleNext ? (
          <>
            <div style={{ fontSize: fs(22), fontWeight: 800, color: '#E2E8F0' }}>
              {nozzleNext.loadTime}
              <span style={{ fontSize: fs(16), fontWeight: 600, color: '#94A3B8', marginLeft: 10 }}>
                {nozzleNext.pickup || nozzleNext.mixerNumber === PICKUP_MIXER_NUMBER
                  ? 'самовывоз'
                  : nozzleNext.mixerNumber}
              </span>
            </div>
            <div style={{ marginTop: sp(4), fontSize: fs(14), color: '#CBD5E1' }}>
              #{nozzleNext.orderId} {nozzleNext.client} · {nozzleNext.volume} м³
            </div>
          </>
        ) : (
          <div style={{ fontSize: fs(15), color: '#64748B' }}>
            {trips.length === 0 ? 'План дня ещё не опубликован' : 'Все рейсы плана отработаны'}
          </div>
        )}
      </div>

      <div
        style={{
          fontSize: fs(12),
          fontWeight: 700,
          color: '#64748B',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          flexShrink: 0,
        }}
      >
        Ближайшие слоты {upcoming.length > 0 ? `· ${upcoming.length}` : ''}
      </div>

      <div
        className="scroll-subtle"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: sp(6),
          paddingRight: 4,
        }}
      >
        {upcoming.length === 0 ? (
          <div style={{ color: '#64748B', fontSize: fs(14) }}>Нет ближайших слотов</div>
        ) : (
          upcoming.map((t, i) => {
            const fact = planFactByTripId.get(t.id);
            const delta = formatFactDeltaLabel(fact?.deltaLoadMin ?? fact?.deltaReleaseMin ?? null);
            const isPu = Boolean(t.pickup || t.mixerNumber === PICKUP_MIXER_NUMBER);
            return (
              <div
                key={t.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto',
                  gap: sp(10),
                  alignItems: 'center',
                  padding: `${sp(10)}px ${sp(12)}px`,
                  borderRadius: 12,
                  background:
                    i === 0 ? 'rgba(56,189,248,0.12)' : 'rgba(15,23,42,0.65)',
                  border:
                    i === 0
                      ? '1px solid rgba(56,189,248,0.4)'
                      : '1px solid rgba(51,65,85,0.8)',
                }}
              >
                <div
                  style={{
                    fontSize: fs(16),
                    fontWeight: 800,
                    color: '#F1F5F9',
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: fs(52),
                  }}
                >
                  {t.loadTime}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: fs(14),
                      fontWeight: 700,
                      color: '#E2E8F0',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {isPu ? 'самовывоз' : t.mixerNumber} · {t.volume} м³
                  </div>
                  <div
                    style={{
                      fontSize: fs(12),
                      color: '#94A3B8',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    #{t.orderId} {t.client}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: fs(12) }}>
                  {fact?.hasMatch ? (
                    <span style={{ color: fact.factRelease ? '#6EE7B7' : '#FCD34D' }}>
                      {fact.factStatus || 'факт'}
                      {delta ? ` ${delta}` : ''}
                    </span>
                  ) : (
                    <span style={{ color: '#475569' }}>—</span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
