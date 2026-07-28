'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import { pluralRu } from '@/lib/ruLocale';
import {
  modalCloseButtonStyle,
  modalFieldStyle,
  volumeCardSoftStyle,
  volumeModalStyle,
} from '../cardStyles';

export type OperatorStatsRow = {
  name: string;
  trips: number;
  volume: number;
  avgDurationMinutes: number | null;
  minDurationMinutes?: number | null;
  maxDurationMinutes?: number | null;
};

export type OperatorStatsPresets = {
  today: { from: string; to: string };
  yesterday: { from: string; to: string };
  week: { from: string; to: string };
  month: { from: string; to: string };
  quarter: { from: string; to: string };
};

export type OperatorTripDetail = {
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

export type OperatorStatsPeriodId =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'quarter'
  | 'custom';

export const OPERATOR_STATS_PERIODS: Array<{ id: OperatorStatsPeriodId; label: string }> = [
  { id: 'today', label: 'Сегодня' },
  { id: 'yesterday', label: 'Вчера' },
  { id: 'week', label: '7 дней' },
  { id: 'month', label: '30 дней' },
  { id: 'quarter', label: '90 дней' },
  { id: 'custom', label: 'Период' },
];

const pillBtn = (active: boolean): CSSProperties => ({
  padding: '8px 14px',
  borderRadius: 9999,
  border: 'none',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  background: active ? '#10B981' : '#25334A',
  color: active ? '#0F172A' : '#94A3B8',
});

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDateRu(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  if (!y || !m || !d) return dateKey;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

type Props = {
  open: boolean;
  operatorName: string;
  initialPeriod: OperatorStatsPeriodId;
  initialFrom: string;
  initialTo: string;
  presets: OperatorStatsPresets | null;
  onClose: () => void;
};

export default function OperatorStatsDetailModal({
  open,
  operatorName,
  initialPeriod,
  initialFrom,
  initialTo,
  presets,
  onClose,
}: Props) {
  const [period, setPeriod] = useState<OperatorStatsPeriodId>(initialPeriod);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [summary, setSummary] = useState<OperatorStatsRow | null>(null);
  const [trips, setTrips] = useState<OperatorTripDetail[]>([]);
  const [tripsTruncated, setTripsTruncated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPeriod(initialPeriod);
    setFrom(initialFrom);
    setTo(initialTo);
  }, [open, initialPeriod, initialFrom, initialTo, operatorName]);

  const applyPreset = (id: OperatorStatsPeriodId) => {
    setPeriod(id);
    if (id === 'custom' || !presets?.[id as keyof OperatorStatsPresets]) return;
    const range = presets[id as keyof OperatorStatsPresets];
    setFrom(range.from);
    setTo(range.to);
  };

  const load = useCallback(async () => {
    if (!open || !operatorName || !from || !to) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        from,
        to,
        name: operatorName,
        details: '1',
      });
      const res = await fetch(`/api/adminCifra/staff/operator-stats?${qs}`);
      const json = await res.json();
      if (!res.ok || json.success === false) {
        setError(json.error || 'Не удалось загрузить статистику');
        setSummary(null);
        setTrips([]);
        return;
      }
      setSummary(json.summary || null);
      setTrips(Array.isArray(json.trips) ? json.trips : []);
      setTripsTruncated(!!json.tripsTruncated);
    } catch {
      setError('Ошибка соединения с сервером');
      setSummary(null);
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }, [open, operatorName, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const tripsByDay = useMemo(() => {
    const map = new Map<string, OperatorTripDetail[]>();
    for (const t of trips) {
      const key = t.delivery_date || '—';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [trips]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.82)',
        zIndex: 11000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
      }}
      onClick={onClose}
    >
      <div
        style={volumeModalStyle({
          width: '100%',
          maxWidth: 820,
          maxHeight: '92vh',
          overflowY: 'auto',
          padding: '20px 22px',
          color: '#E2E8F0',
        })}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
            marginBottom: 14,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: '#F8FAFC' }}>{operatorName}</h2>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#94A3B8' }}>
              Подробная статистика по рейсам · день заявки (МСК)
            </p>
          </div>
          <button type="button" aria-label="Закрыть" onClick={onClose} style={modalCloseButtonStyle()}>
            <X size={18} />
          </button>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {OPERATOR_STATS_PERIODS.map((p) => (
            <button key={p.id} type="button" onClick={() => applyPreset(p.id)} style={pillBtn(period === p.id)}>
              {p.label}
            </button>
          ))}
        </div>

        {period === 'custom' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10,
              marginBottom: 12,
            }}
          >
            <label style={{ fontSize: 13, color: '#94A3B8' }}>
              С
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                style={modalFieldStyle({ marginTop: 4 })}
              />
            </label>
            <label style={{ fontSize: 13, color: '#94A3B8' }}>
              По
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                style={modalFieldStyle({ marginTop: 4 })}
              />
            </label>
          </div>
        )}

        <div style={{ fontSize: 12, color: '#64748B', marginBottom: 12 }}>
          {formatDateRu(from)}
          {from !== to ? ` — ${formatDateRu(to)}` : ''}
        </div>

        {loading && !summary ? (
          <div style={{ color: '#94A3B8', textAlign: 'center', padding: '28px 0' }}>Загрузка…</div>
        ) : error ? (
          <div style={{ color: '#FCA5A5', padding: '12px 0' }}>{error}</div>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 10,
                marginBottom: 16,
              }}
            >
              <div style={volumeCardSoftStyle({ padding: '14px 16px', borderRadius: 14 })}>
                <div style={{ fontSize: 26, fontWeight: 700, color: '#60A5FA' }}>
                  {summary?.volume ?? 0}
                </div>
                <div style={{ fontSize: 12, color: '#94A3B8' }}>м³ отгружено</div>
              </div>
              <div style={volumeCardSoftStyle({ padding: '14px 16px', borderRadius: 14 })}>
                <div style={{ fontSize: 26, fontWeight: 700, color: '#F8FAFC' }}>
                  {summary?.trips ?? 0}
                </div>
                <div style={{ fontSize: 12, color: '#94A3B8' }}>
                  {pluralRu(summary?.trips || 0, 'рейс', 'рейса', 'рейсов')}
                </div>
              </div>
              <div style={volumeCardSoftStyle({ padding: '14px 16px', borderRadius: 14 })}>
                <div style={{ fontSize: 26, fontWeight: 700, color: '#FBBF24' }}>
                  {summary?.avgDurationMinutes != null ? `${summary.avgDurationMinutes} мин` : '—'}
                </div>
                <div style={{ fontSize: 12, color: '#94A3B8' }}>среднее время</div>
              </div>
              <div style={volumeCardSoftStyle({ padding: '14px 16px', borderRadius: 14 })}>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#CBD5E1' }}>
                  {summary?.minDurationMinutes != null ? `${summary.minDurationMinutes}` : '—'}
                  {' / '}
                  {summary?.maxDurationMinutes != null ? `${summary.maxDurationMinutes}` : '—'}
                </div>
                <div style={{ fontSize: 12, color: '#94A3B8' }}>мин · мин / макс</div>
              </div>
            </div>

            {trips.length === 0 ? (
              <div style={{ color: '#64748B', textAlign: 'center', padding: '20px 0' }}>
                Нет рейсов за выбранный период
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {tripsByDay.map(([day, dayTrips]) => {
                  const dayVol = dayTrips.reduce((s, t) => s + (Number(t.volume) || 0), 0);
                  return (
                    <div key={day}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 8,
                          marginBottom: 8,
                          fontSize: 13,
                          color: '#94A3B8',
                        }}
                      >
                        <span style={{ fontWeight: 700, color: '#E2E8F0' }}>{formatDateRu(day)}</span>
                        <span>
                          {dayTrips.length}{' '}
                          {pluralRu(dayTrips.length, 'рейс', 'рейса', 'рейсов')} ·{' '}
                          {Math.round(dayVol * 10) / 10} м³
                        </span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {dayTrips.map((t) => (
                          <div
                            key={t.id || `${t.created_at}-${t.mixer_name}-${t.volume}`}
                            style={volumeCardSoftStyle({
                              padding: '10px 12px',
                              borderRadius: 12,
                              display: 'grid',
                              gridTemplateColumns: '64px 1fr auto',
                              gap: 10,
                              alignItems: 'center',
                            })}
                          >
                            <div style={{ color: '#94A3B8', fontSize: 13 }}>
                              {formatTime(t.end_time || t.created_at)}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div
                                style={{
                                  fontWeight: 600,
                                  color: '#F8FAFC',
                                  fontSize: 14,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {t.mixer_name || 'Миксер'}
                                {t.concrete_grade ? ` · ${t.concrete_grade}` : ''}
                              </div>
                              <div style={{ fontSize: 12, color: '#64748B' }}>
                                {t.order_id ? `Заявка #${t.order_id}` : 'Без заявки'}
                                {t.duration_minutes != null ? ` · ${t.duration_minutes} мин` : ''}
                              </div>
                            </div>
                            <div style={{ fontWeight: 700, color: '#60A5FA', fontSize: 15 }}>
                              {Number(t.volume) || 0} м³
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {tripsTruncated && (
                  <div style={{ color: '#FDE68A', fontSize: 12, textAlign: 'center' }}>
                    Показаны первые {trips.length} рейсов — сузьте период
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
