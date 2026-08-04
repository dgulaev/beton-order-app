'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, X } from 'lucide-react';
import { modalCloseButtonStyle, volumeCardSoftStyle, volumeModalStyle } from '../cardStyles';
import WeatherIcon from './WeatherIcon';
import type { WeatherDay, WeatherForecastPayload } from '@/lib/weather/types';
import { formatDaylightDuration } from '@/lib/weather/format';
import { formatRuDateWithWeekday } from '@/lib/ruLocale';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

type RangeDays = 7 | 10;

type Props = {
  open: boolean;
  onClose: () => void;
  forecast: WeatherForecastPayload | null;
  /** YYYY-MM-DD — день, с которого открыли карточку */
  initialDateKey: string;
  /** Полноэкранная адаптация под смартфон */
  mobile?: boolean;
};

function parseLocalDate(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export default function WeatherForecastModal({
  open,
  onClose,
  forecast,
  initialDateKey,
  mobile = false,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [range, setRange] = useState<RangeDays>(7);
  const [activeDate, setActiveDate] = useState(initialDateKey);
  /** Якорь полоски «N дней»: день открытия модалки, не сдвигается кликом по чипу. */
  const [rangeAnchor, setRangeAnchor] = useState(initialDateKey);

  useBodyScrollLock(open);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) {
      setActiveDate(initialDateKey);
      setRangeAnchor(initialDateKey);
    }
  }, [open, initialDateKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // После past_days в API days[] начинается ~3 месяца назад.
  // «7/10 дней» — окно от выбранного дня (календарь / сегодня), не slice(0, N).
  const daysInRange = useMemo(() => {
    const all = forecast?.days || [];
    if (!all.length) return [];
    const startIdx = all.findIndex((d) => d.date >= rangeAnchor);
    const idx = startIdx >= 0 ? startIdx : Math.max(0, all.length - range);
    return all.slice(idx, idx + range);
  }, [forecast, range, rangeAnchor]);

  const activeDay: WeatherDay | null = useMemo(() => {
    const all = forecast?.days || [];
    return all.find((d) => d.date === activeDate) || daysInRange[0] || null;
  }, [forecast, activeDate, daysInRange]);

  if (!open || !mounted) return null;

  const dateLabel = activeDay
    ? formatRuDateWithWeekday(parseLocalDate(activeDay.date), 'nominative')
    : '—';
  const daylightLabel = activeDay
    ? formatDaylightDuration(activeDay.daylightDurationSec)
    : null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Прогноз погоды"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(2, 6, 23, 0.72)',
        display: 'flex',
        alignItems: mobile ? 'stretch' : 'center',
        justifyContent: 'center',
        padding: mobile ? 0 : 'clamp(16px, 2.5vw, 40px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={volumeModalStyle({
          width: mobile
            ? '100%'
            : 'min(1180px, max(720px, 56vw), calc(100vw - 48px))',
          maxHeight: mobile ? '100%' : 'min(90vh, calc(100vh - 48px))',
          height: mobile ? '100%' : undefined,
          borderRadius: mobile ? 0 : undefined,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: mobile
            ? 'max(12px, env(safe-area-inset-top)) 14px max(12px, env(safe-area-inset-bottom))'
            : '22px 24px 18px',
          boxSizing: 'border-box',
        })}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: mobile ? 10 : 14,
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: mobile ? 17 : 20, fontWeight: 700, color: '#F1F5F9' }}>
              Погода · {dateLabel}
            </div>
            <div style={{ fontSize: mobile ? 12 : 13, color: '#94A3B8', marginTop: 4 }}>
              {forecast?.locationLabel || 'Брянск'} · данные Open-Meteo
            </div>
          </div>
          <button type="button" onClick={onClose} style={modalCloseButtonStyle()} aria-label="Закрыть">
            <X size={mobile ? 18 : 20} />
          </button>
        </div>

        {/* Переключатель 7 / 10 */}
        <div
          style={{
            display: 'flex',
            gap: 6,
            marginBottom: 12,
            flexShrink: 0,
          }}
        >
          {([7, 10] as const).map((n) => {
            const on = range === n;
            return (
              <button
                key={n}
                type="button"
                onClick={() => setRange(n)}
                style={{
                  padding: mobile ? '6px 12px' : '7px 14px',
                  borderRadius: 9999,
                  border: on ? '1px solid rgba(96,165,250,0.55)' : '1px solid rgba(148,163,184,0.28)',
                  background: on ? 'rgba(59,130,246,0.22)' : 'rgba(15,23,42,0.65)',
                  color: on ? '#BFDBFE' : '#94A3B8',
                  fontSize: mobile ? 12 : 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {n} дней
              </button>
            );
          })}
        </div>

        {/* Дни: на десктопе сетка, на мобиле — горизонтальный скролл */}
        <div
          className={mobile ? 'scroll-hidden' : undefined}
          style={
            mobile
              ? {
                  display: 'flex',
                  gap: 8,
                  overflowX: 'auto',
                  WebkitOverflowScrolling: 'touch',
                  paddingBottom: 4,
                  marginBottom: 12,
                  flexShrink: 0,
                }
              : {
                  display: 'grid',
                  gridTemplateColumns: `repeat(${daysInRange.length || 1}, minmax(0, 1fr))`,
                  gap: range === 10 ? 6 : 8,
                  marginBottom: 14,
                  flexShrink: 0,
                }
          }
        >
          {daysInRange.map((d) => {
            const on = d.date === activeDay?.date;
            return (
              <button
                key={d.date}
                type="button"
                onClick={() => setActiveDate(d.date)}
                style={{
                  ...volumeCardSoftStyle({
                    minWidth: mobile ? 80 : 0,
                    width: mobile ? undefined : '100%',
                    flex: mobile ? '0 0 auto' : undefined,
                    padding: mobile ? '10px 10px' : range === 10 ? '10px 8px' : '12px 10px',
                    cursor: 'pointer',
                    border: on
                      ? '1px solid rgba(96,165,250,0.65)'
                      : '1px solid rgba(148,163,184,0.35)',
                    background: on
                      ? 'linear-gradient(165deg, rgba(59,130,246,0.28) 0%, rgba(15,23,42,0.95) 100%)'
                      : 'linear-gradient(165deg, #1E2937 0%, #0F172A 100%)',
                    textAlign: 'left',
                    color: '#F1F5F9',
                    WebkitTapHighlightColor: 'transparent',
                  }),
                }}
              >
                <div
                  style={{
                    fontSize: mobile ? 11 : range === 10 ? 11 : 12,
                    color: on ? '#BFDBFE' : '#CBD5E1',
                    fontWeight: 600,
                    marginBottom: 5,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {parseLocalDate(d.date).toLocaleDateString('ru-RU', {
                    weekday: 'short',
                    day: 'numeric',
                    month: mobile ? 'numeric' : 'short',
                  })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                  <WeatherIcon kind={d.kind} size={mobile ? 22 : range === 10 ? 22 : 24} />
                  <span
                    style={{
                      fontSize: mobile ? 14 : range === 10 ? 14 : 15,
                      fontWeight: 700,
                      color: '#F8FAFC',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {d.tempMax ?? '—'}°
                    <span style={{ color: '#94A3B8', fontWeight: 600 }}>/{d.tempMin ?? '—'}°</span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Детали дня */}
        <div className="scroll-hidden" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
          {!activeDay ? (
            <div style={{ color: '#94A3B8', fontSize: 15 }}>Нет данных по выбранному дню</div>
          ) : (
            <>
              <div
                style={volumeCardSoftStyle({
                  padding: mobile ? '14px 16px' : '16px 18px',
                  marginBottom: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: mobile ? 14 : 16,
                })}
              >
                <WeatherIcon kind={activeDay.kind} size={mobile ? 44 : 52} strokeWidth={1.7} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: mobile ? 30 : 34,
                      fontWeight: 700,
                      color: '#F8FAFC',
                      lineHeight: 1.1,
                    }}
                  >
                    {activeDay.tempMax ?? '—'}° / {activeDay.tempMin ?? '—'}°
                  </div>
                  <div
                    style={{
                      fontSize: mobile ? 15 : 16,
                      color: '#CBD5E1',
                      marginTop: 4,
                      fontWeight: 600,
                    }}
                  >
                    {activeDay.labelRu}
                  </div>
                  <div style={{ fontSize: mobile ? 12 : 13, color: '#94A3B8', marginTop: 5 }}>
                    {[
                      `Осадки ${activeDay.precipSum ?? 0} мм`,
                      activeDay.precipProbMax != null
                        ? `макс. вер. осадков ${activeDay.precipProbMax}%`
                        : null,
                      activeDay.windMax != null ? `ветер до ${activeDay.windMax} м/с` : null,
                      daylightLabel ? `свет ${daylightLabel}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: mobile ? 6 : 10,
                  marginBottom: 16,
                }}
              >
                {activeDay.parts.map((p) => (
                  <div
                    key={p.key}
                    style={volumeCardSoftStyle({ padding: mobile ? '10px 10px' : '12px 14px' })}
                  >
                    <div
                      style={{
                        fontSize: mobile ? 11 : 12,
                        color: '#94A3B8',
                        fontWeight: 600,
                        marginBottom: 8,
                      }}
                    >
                      {p.label}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: mobile ? 6 : 10,
                        minWidth: 0,
                      }}
                    >
                      <WeatherIcon kind={p.kind} size={mobile ? 22 : 26} />
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: mobile ? 18 : 20,
                            fontWeight: 700,
                            color: '#E2E8F0',
                            lineHeight: 1,
                          }}
                        >
                          {p.tempAvg != null ? `${Math.round(p.tempAvg)}°` : '—'}
                        </div>
                        <div
                          style={{
                            fontSize: mobile ? 11 : 12,
                            color: '#94A3B8',
                            marginTop: 3,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {p.labelRu}
                          {p.precipProb != null ? ` · ${p.precipProb}%` : ''}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div
                style={{
                  fontSize: mobile ? 12 : 13,
                  color: '#94A3B8',
                  fontWeight: 600,
                  marginBottom: 10,
                }}
              >
                По часам (00:00–23:00)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: mobile ? 4 : 5 }}>
                {activeDay.hours.map((h) => (
                  <div
                    key={h.time}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: mobile
                        ? '48px 28px minmax(0, 1fr) auto'
                        : '56px 32px minmax(0, 1fr) auto',
                      gap: mobile ? 8 : 12,
                      alignItems: 'center',
                      padding: mobile ? '9px 10px' : '8px 12px',
                      borderRadius: 10,
                      background: 'rgba(15,23,42,0.45)',
                    }}
                  >
                    <span
                      style={{
                        fontSize: mobile ? 13 : 14,
                        color: '#CBD5E1',
                        fontVariantNumeric: 'tabular-nums',
                        fontWeight: 600,
                      }}
                    >
                      {h.time}
                    </span>
                    <WeatherIcon kind={h.kind} size={mobile ? 20 : 24} />
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        minWidth: 0,
                        overflow: 'hidden',
                      }}
                    >
                      <span
                        style={{
                          fontSize: mobile ? 13 : 14,
                          color: '#94A3B8',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          minWidth: 0,
                        }}
                      >
                        {h.labelRu}
                      </span>
                      {h.precipProb != null && (
                        <span
                          style={{
                            fontSize: mobile ? 12 : 13,
                            color: '#64748B',
                            fontWeight: 600,
                            fontVariantNumeric: 'tabular-nums',
                            flexShrink: 0,
                          }}
                        >
                          {h.precipProb}%
                        </span>
                      )}
                    </span>
                    <span
                      style={{
                        fontSize: mobile ? 14 : 15,
                        fontWeight: 700,
                        color: '#E2E8F0',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {h.temp != null ? `${h.temp}°` : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: mobile ? 'column' : 'row',
            justifyContent: 'space-between',
            alignItems: mobile ? 'stretch' : 'center',
            gap: 10,
            marginTop: 14,
            flexShrink: 0,
            paddingTop: 12,
            borderTop: '1px solid rgba(51,65,85,0.8)',
          }}
        >
          <a
            href={forecast?.yandexUrl || 'https://yandex.ru/pogoda/bryansk'}
            target="_blank"
            rel="noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: mobile ? 'center' : 'flex-start',
              gap: 6,
              color: '#93C5FD',
              fontSize: mobile ? 12 : 13,
              fontWeight: 600,
              textDecoration: 'none',
              padding: mobile ? '10px 12px' : 0,
            }}
          >
            <ExternalLink size={mobile ? 14 : 15} />
            Открыть в Яндекс.Погоде
          </a>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: mobile ? '12px 14px' : '9px 16px',
              borderRadius: 10,
              border: '1px solid rgba(148,163,184,0.35)',
              background: 'rgba(15,23,42,0.8)',
              color: '#E2E8F0',
              fontSize: mobile ? 14 : 15,
              fontWeight: 600,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
