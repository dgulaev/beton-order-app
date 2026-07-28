'use client';

import { useEffect, useMemo, useState } from 'react';
import { volumeCardStyle } from '../cardStyles';
import WeatherIcon from './WeatherIcon';
import WeatherForecastModal from './WeatherForecastModal';
import type { WeatherForecastPayload } from '@/lib/weather/types';
import { formatDaylightDuration } from '@/lib/weather/format';

type Props = {
  /** YYYY-MM-DD — выбранный день страницы */
  dateKey: string;
  /** Чуть компактнее для ряда «Заявки» (десктоп) */
  compact?: boolean;
  /** Адаптация под смартфон: горизонтальная карточка + мобильная модалка */
  mobile?: boolean;
};

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export default function WeatherKpiCard({ dateKey, compact = false, mobile = false }: Props) {
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

  const openModal = () => setModalOpen(true);

  const daylightLabel = day ? formatDaylightDuration(day.daylightDurationSec) : null;
  const precipProbLabel =
    day?.precipProbMax != null ? `${day.precipProbMax}%` : null;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={openModal}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openModal();
          }
        }}
        style={volumeCardStyle({
          borderRadius: mobile ? 16 : 18,
          padding: mobile ? '14px 16px' : compact ? '14px 16px' : '16px 18px',
          cursor: 'pointer',
          transition: 'filter 0.2s',
          minWidth: 0,
          width: mobile ? '100%' : undefined,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          height: mobile ? 'auto' : '100%',
          WebkitTapHighlightColor: 'transparent',
          touchAction: 'manipulation',
        })}
        onMouseEnter={(e) => {
          if (!mobile) e.currentTarget.style.filter = 'brightness(1.08)';
        }}
        onMouseLeave={(e) => {
          if (!mobile) e.currentTarget.style.filter = 'none';
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: mobile ? 8 : compact ? 6 : 8,
          }}
        >
          <div
            style={{
              color: '#94A3B8',
              fontSize: 13,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 600,
            }}
          >
            Погода
          </div>
          <span style={{ color: '#94A3B8', fontSize: 12, fontWeight: 600 }}>{dateShort}</span>
        </div>

        {loading ? (
          <div style={{ color: '#64748B', fontSize: 13, padding: '4px 0' }}>Загрузка…</div>
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
        ) : mobile ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <WeatherIcon kind={day.kind} size={36} strokeWidth={1.75} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: '#F8FAFC',
                  lineHeight: 1.05,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {day.tempMax ?? '—'}°
                <span style={{ color: '#94A3B8', fontWeight: 600, fontSize: 17 }}>
                  {' '}
                  / {day.tempMin ?? '—'}°
                </span>
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: '#E2E8F0',
                  fontWeight: 600,
                  marginTop: 2,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {day.labelRu}
                <span style={{ color: '#64748B', fontWeight: 500 }}> · подробнее</span>
              </div>
            </div>
            {(daylightLabel || precipProbLabel) && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  flexShrink: 0,
                  paddingLeft: 8,
                  borderLeft: '1px solid rgba(51,65,85,0.85)',
                  minWidth: 0,
                }}
              >
                {daylightLabel && (
                  <div style={{ lineHeight: 1.15 }}>
                    <div style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>Свет</div>
                    <div
                      style={{
                        fontSize: 12,
                        color: '#CBD5E1',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {daylightLabel}
                    </div>
                  </div>
                )}
                {precipProbLabel && (
                  <div style={{ lineHeight: 1.15 }}>
                    <div style={{ fontSize: 10, color: '#64748B', fontWeight: 600 }}>Осадки</div>
                    <div
                      style={{
                        fontSize: 12,
                        color: '#CBD5E1',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      до {precipProbLabel}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: compact ? 10 : 14,
                marginBottom: compact ? 6 : 8,
                flex: 1,
                minWidth: 0,
              }}
            >
              <WeatherIcon kind={day.kind} size={compact ? 34 : 48} strokeWidth={compact ? 1.75 : 1.6} />
              <div style={{ minWidth: 0, flex: '1 1 auto' }}>
                <div
                  style={{
                    fontSize: compact ? 24 : 40,
                    fontWeight: 700,
                    color: '#F8FAFC',
                    lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums',
                    letterSpacing: compact ? undefined : '-0.02em',
                  }}
                >
                  {day.tempMax ?? '—'}°
                  <span
                    style={{
                      color: '#94A3B8',
                      fontWeight: 600,
                      fontSize: compact ? 16 : 22,
                      marginLeft: 4,
                    }}
                  >
                    / {day.tempMin ?? '—'}°
                  </span>
                </div>
                <div
                  style={{
                    fontSize: compact ? 12 : 14,
                    color: '#E2E8F0',
                    fontWeight: 600,
                    marginTop: compact ? 2 : 4,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {day.labelRu}
                </div>
              </div>

              {(daylightLabel || precipProbLabel) && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: compact ? 5 : 7,
                    flex: '0 0 auto',
                    paddingLeft: compact ? 8 : 10,
                    borderLeft: '1px solid rgba(51,65,85,0.9)',
                    minWidth: 0,
                  }}
                >
                  {daylightLabel && (
                    <div style={{ lineHeight: 1.15, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: compact ? 9 : 10,
                          color: '#64748B',
                          fontWeight: 600,
                          letterSpacing: '0.02em',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Свет
                      </div>
                      <div
                        style={{
                          fontSize: compact ? 11 : 12,
                          color: '#CBD5E1',
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {daylightLabel}
                      </div>
                    </div>
                  )}
                  {precipProbLabel && (
                    <div style={{ lineHeight: 1.15, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: compact ? 9 : 10,
                          color: '#64748B',
                          fontWeight: 600,
                          letterSpacing: '0.02em',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        Осадки
                      </div>
                      <div
                        style={{
                          fontSize: compact ? 11 : 12,
                          color: '#CBD5E1',
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        до {precipProbLabel}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div style={{ fontSize: compact ? 11 : 12, color: '#64748B', fontWeight: 500 }}>
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
        mobile={mobile}
      />
    </>
  );
}
