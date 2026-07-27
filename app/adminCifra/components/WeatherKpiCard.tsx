'use client';

import { useEffect, useMemo, useState } from 'react';
import { volumeCardStyle } from '../cardStyles';
import WeatherIcon from './WeatherIcon';
import WeatherForecastModal from './WeatherForecastModal';
import type { WeatherForecastPayload } from '@/lib/weather/types';

type Props = {
  /** YYYY-MM-DD — выбранный день страницы */
  dateKey: string;
  /** Чуть компактнее для ряда «Заявки» */
  compact?: boolean;
};

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function WeatherKpiCard({ dateKey, compact = false }: Props) {
  const [forecast, setForecast] = useState<WeatherForecastPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/weather', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as WeatherForecastPayload;
        if (!cancelled) setForecast(data);
      } catch {
        if (!cancelled) {
          setError('Нет связи');
          setForecast(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const day = useMemo(() => {
    if (!forecast?.days?.length) return null;
    return forecast.days.find((d) => d.date === dateKey) || null;
  }, [forecast, dateKey]);

  const todayKey = toDateKey(new Date());
  const isPast = dateKey < todayKey;
  const isBeyond = !loading && !error && forecast && !day && dateKey > todayKey;

  const dateShort = useMemo(() => {
    const [y, m, d] = dateKey.split('-').map(Number);
    if (!y || !m || !d) return dateKey;
    return new Date(y, m - 1, d).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'short',
    });
  }, [dateKey]);

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setModalOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setModalOpen(true);
          }
        }}
        style={volumeCardStyle({
          borderRadius: 18,
          padding: compact ? '14px 16px' : '16px 18px',
          cursor: 'pointer',
          transition: 'filter 0.2s',
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          height: '100%',
        })}
        onMouseEnter={(e) => {
          e.currentTarget.style.filter = 'brightness(1.08)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.filter = 'none';
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: compact ? 6 : 8,
          }}
        >
          <div
            style={{
              color: '#94A3B8',
              fontSize: compact ? 13 : 13,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600,
            }}
          >
            Погода
          </div>
          <span style={{ color: '#475569', fontSize: 12 }}>{dateShort}</span>
        </div>

        {loading ? (
          <div style={{ color: '#64748B', fontSize: 13, padding: '8px 0' }}>Загрузка…</div>
        ) : error ? (
          <div style={{ color: '#F87171', fontSize: 13 }}>{error}</div>
        ) : !day ? (
          <div style={{ color: '#94A3B8', fontSize: 13, lineHeight: 1.35 }}>
            {isPast
              ? 'Прогноз только вперёд'
              : isBeyond
                ? 'Нет прогноза на этот день'
                : 'Нет данных'}
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
              <WeatherIcon kind={day.kind} size={compact ? 34 : 40} strokeWidth={1.75} />
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: compact ? 26 : 30,
                    fontWeight: 700,
                    color: '#F8FAFC',
                    lineHeight: 1.05,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {day.tempMax ?? '—'}°
                  <span style={{ color: '#64748B', fontWeight: 600, fontSize: compact ? 18 : 20 }}>
                    {' '}
                    / {day.tempMin ?? '—'}°
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: '#CBD5E1',
                    fontWeight: 600,
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {day.labelRu}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: '#64748B', fontWeight: 500 }}>
              Брянск · Open-Meteo · подробнее →
            </div>
          </>
        )}
      </div>

      <WeatherForecastModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        forecast={forecast}
        initialDateKey={dateKey}
      />
    </>
  );
}
