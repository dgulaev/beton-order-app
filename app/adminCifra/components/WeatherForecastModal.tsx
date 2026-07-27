'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, X } from 'lucide-react';
import { modalCloseButtonStyle, volumeCardSoftStyle, volumeModalStyle } from '../cardStyles';
import WeatherIcon from './WeatherIcon';
import type { WeatherDay, WeatherForecastPayload } from '@/lib/weather/types';
import { formatRuDateWithWeekday } from '@/lib/ruLocale';

type RangeDays = 7 | 10;

type Props = {
  open: boolean;
  onClose: () => void;
  forecast: WeatherForecastPayload | null;
  /** YYYY-MM-DD — день, с которого открыли карточку */
  initialDateKey: string;
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
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [range, setRange] = useState<RangeDays>(7);
  const [activeDate, setActiveDate] = useState(initialDateKey);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) setActiveDate(initialDateKey);
  }, [open, initialDateKey]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const daysInRange = useMemo(() => {
    const all = forecast?.days || [];
    return all.slice(0, range);
  }, [forecast, range]);

  const activeDay: WeatherDay | null = useMemo(() => {
    const all = forecast?.days || [];
    return all.find((d) => d.date === activeDate) || daysInRange[0] || null;
  }, [forecast, activeDate, daysInRange]);

  if (!open || !mounted) return null;

  const dateLabel = activeDay
    ? formatRuDateWithWeekday(parseLocalDate(activeDay.date), 'nominative')
    : '—';

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
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'clamp(16px, 2.5vw, 40px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={volumeModalStyle({
          // 1920 ≈ 54vw (~1030px), 4K упирается в 1120 — без «гигантского» окна
          width: 'min(1120px, max(680px, 54vw), calc(100vw - 48px))',
          maxHeight: 'min(90vh, 900px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          padding: '20px 22px 16px',
          boxSizing: 'border-box',
        })}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            marginBottom: 14,
            flexShrink: 0,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#F1F5F9' }}>
              Погода · {dateLabel}
            </div>
            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>
              {forecast?.locationLabel || 'Брянск'} · данные Open-Meteo
            </div>
          </div>
          <button type="button" onClick={onClose} style={modalCloseButtonStyle()} aria-label="Закрыть">
            <X size={18} />
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
                  padding: '6px 12px',
                  borderRadius: 9999,
                  border: on ? '1px solid rgba(96,165,250,0.55)' : '1px solid rgba(148,163,184,0.28)',
                  background: on ? 'rgba(59,130,246,0.22)' : 'rgba(15,23,42,0.65)',
                  color: on ? '#BFDBFE' : '#94A3B8',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                {n} дней
              </button>
            );
          })}
        </div>

        {/* Список дней — сетка на всю ширину, без обрезания */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${daysInRange.length || 1}, minmax(0, 1fr))`,
            gap: range === 10 ? 6 : 8,
            marginBottom: 14,
            flexShrink: 0,
          }}
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
                    minWidth: 0,
                    width: '100%',
                    padding: range === 10 ? '8px 6px' : '10px 8px',
                    cursor: 'pointer',
                    border: on
                      ? '1px solid rgba(96,165,250,0.65)'
                      : '1px solid rgba(148,163,184,0.35)',
                    // Не передавать background: undefined — button тогда становится белым
                    background: on
                      ? 'linear-gradient(165deg, rgba(59,130,246,0.28) 0%, rgba(15,23,42,0.95) 100%)'
                      : 'linear-gradient(165deg, #1E2937 0%, #0F172A 100%)',
                    textAlign: 'left',
                    color: '#F1F5F9',
                  }),
                }}
              >
                <div
                  style={{
                    fontSize: range === 10 ? 10 : 11,
                    color: on ? '#BFDBFE' : '#CBD5E1',
                    fontWeight: 600,
                    marginBottom: 4,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {parseLocalDate(d.date).toLocaleDateString('ru-RU', {
                    weekday: 'short',
                    day: 'numeric',
                    month: 'short',
                  })}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
                  <WeatherIcon kind={d.kind} size={range === 10 ? 18 : 22} />
                  <span
                    style={{
                      fontSize: range === 10 ? 12 : 14,
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
            <div style={{ color: '#94A3B8', fontSize: 14 }}>Нет данных по выбранному дню</div>
          ) : (
            <>
              <div
                style={volumeCardSoftStyle({
                  padding: '14px 16px',
                  marginBottom: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                })}
              >
                <WeatherIcon kind={activeDay.kind} size={40} strokeWidth={1.75} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 28, fontWeight: 700, color: '#F8FAFC', lineHeight: 1.1 }}>
                    {activeDay.tempMax ?? '—'}° / {activeDay.tempMin ?? '—'}°
                  </div>
                  <div style={{ fontSize: 14, color: '#CBD5E1', marginTop: 4, fontWeight: 600 }}>
                    {activeDay.labelRu}
                  </div>
                  <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 4 }}>
                    Осадки {activeDay.precipSum ?? 0} мм
                    {activeDay.precipProbMax != null ? ` · вер. ${activeDay.precipProbMax}%` : ''}
                    {activeDay.windMax != null ? ` · ветер до ${activeDay.windMax} м/с` : ''}
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: 8,
                  marginBottom: 14,
                }}
              >
                {activeDay.parts.map((p) => (
                  <div key={p.key} style={volumeCardSoftStyle({ padding: '10px 12px' })}>
                    <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600, marginBottom: 6 }}>
                      {p.label}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <WeatherIcon kind={p.kind} size={22} />
                      <div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#E2E8F0', lineHeight: 1 }}>
                          {p.tempAvg != null ? `${Math.round(p.tempAvg)}°` : '—'}
                        </div>
                        <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{p.labelRu}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 600, marginBottom: 8 }}>
                По часам (6:00–22:00)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {activeDay.hours.map((h) => (
                  <div
                    key={h.time}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '48px 28px 1fr auto auto',
                      gap: 10,
                      alignItems: 'center',
                      padding: '6px 8px',
                      borderRadius: 10,
                      background: 'rgba(15,23,42,0.45)',
                    }}
                  >
                    <span style={{ fontSize: 13, color: '#CBD5E1', fontVariantNumeric: 'tabular-nums' }}>
                      {h.time}
                    </span>
                    <WeatherIcon kind={h.kind} size={18} />
                    <span style={{ fontSize: 12, color: '#94A3B8' }}>{h.labelRu}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#E2E8F0' }}>
                      {h.temp != null ? `${h.temp}°` : '—'}
                    </span>
                    <span style={{ fontSize: 11, color: '#64748B', minWidth: 42, textAlign: 'right' }}>
                      {h.precipProb != null ? `${h.precipProb}%` : ''}
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
            justifyContent: 'space-between',
            alignItems: 'center',
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
              gap: 6,
              color: '#93C5FD',
              fontSize: 12,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <ExternalLink size={14} />
            Открыть в Яндекс.Погоде
          </a>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: '1px solid rgba(148,163,184,0.35)',
              background: 'rgba(15,23,42,0.8)',
              color: '#E2E8F0',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
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
