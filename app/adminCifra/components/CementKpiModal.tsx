'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, X } from 'lucide-react';
import {
  modalCloseButtonStyle,
  volumeCardSoftStyle,
  volumeModalStyle,
} from '../cardStyles';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { formatRuDateWithWeekday, pluralWord } from '@/lib/ruLocale';

type HorizonBlock = {
  dateFrom: string;
  dateTo: string;
  neededTons: number;
  stockTons: number;
  bringTons: number;
  shortage: boolean;
  orderCount: number;
  remainingVolumeM3: number;
  remainingStockTons?: number;
};

export type CementOverviewPayload = {
  date: string;
  asOf: string;
  isToday: boolean;
  isFuture: boolean;
  silos: Array<{
    siloId: number;
    name: string;
    maxTons: number;
    startTons: number;
    currentTons: number;
    usableTons?: number;
    consumedTons: number;
    refillTons: number;
    isNegative?: boolean;
  }>;
  totals: {
    startTons: number;
    currentTons: number;
    usableTons?: number;
    consumedTons: number;
    maxTons: number;
    refillTons: number;
    negativeSilosTons?: number;
  };
  day: { planTons: number; unloadedTons: number };
  dayAhead?: HorizonBlock;
  tomorrow?: HorizonBlock;
  week: HorizonBlock;
};

type Props = {
  open: boolean;
  onClose: () => void;
  dateKey: string;
};

function parseLocalDate(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** Точность до кг: 63.863 т; без лишних нулей. */
function fmtTons(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const r = Math.round(n * 1000) / 1000;
  if (Math.abs(r) < 1e-9) return '0';
  return r.toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
}

function fmtKgFromTons(tons: number): string {
  if (!Number.isFinite(tons)) return '—';
  const kg = Math.round(tons * 1000);
  return kg.toLocaleString('ru-RU');
}

function fmtDateShort(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}

function HorizonCard({
  title,
  subtitle,
  horizon,
  fs,
  sp,
  stockLabel = 'Доступно на складе',
}: {
  title: string;
  subtitle: string;
  horizon: HorizonBlock;
  fs: (n: number) => number;
  sp: (n: number) => number;
  stockLabel?: string;
}) {
  const shortage = horizon.shortage;
  return (
    <div
      style={volumeCardSoftStyle({
        borderRadius: 16,
        padding: sp(14),
        height: '100%',
        border: shortage
          ? '1px solid rgba(239,68,68,0.4)'
          : '1px solid rgba(52,211,153,0.3)',
      })}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          gap: sp(8),
          marginBottom: sp(12),
          alignItems: 'flex-start',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: fs(17), fontWeight: 800, color: '#F1F5F9' }}>{title}</div>
          <div
            style={{
              color: '#94A3B8',
              fontSize: fs(13),
              fontWeight: 600,
              marginTop: 3,
              lineHeight: 1.35,
            }}
          >
            {subtitle}
          </div>
        </div>
        {shortage ? (
          <span
            style={{
              background: '#EF444425',
              color: '#FCA5A5',
              fontSize: fs(13),
              fontWeight: 800,
              borderRadius: 10,
              padding: `${sp(5)}px ${sp(10)}px`,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            −{fmtTons(horizon.bringTons)} т
          </span>
        ) : (
          <span
            style={{
              background: '#10B98125',
              color: '#34D399',
              fontSize: fs(13),
              fontWeight: 800,
              borderRadius: 10,
              padding: `${sp(5)}px ${sp(10)}px`,
              flexShrink: 0,
            }}
          >
            Хватает
          </span>
        )}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: sp(8),
        }}
      >
        <div>
          <div style={{ color: '#94A3B8', fontSize: fs(12), fontWeight: 600 }}>Нужно</div>
          <div style={{ fontSize: fs(20), fontWeight: 800, color: '#E2E8F0', lineHeight: 1.2 }}>
            {fmtTons(horizon.neededTons)}
          </div>
        </div>
        <div>
          <div style={{ color: '#94A3B8', fontSize: fs(12), fontWeight: 600, lineHeight: 1.25 }}>
            {stockLabel}
          </div>
          <div style={{ fontSize: fs(20), fontWeight: 800, color: '#60A5FA', lineHeight: 1.2 }}>
            {fmtTons(horizon.stockTons)}
          </div>
        </div>
        <div>
          <div style={{ color: '#94A3B8', fontSize: fs(12), fontWeight: 600 }}>Привезти</div>
          <div
            style={{
              fontSize: fs(20),
              fontWeight: 800,
              color: shortage ? '#F87171' : '#34D399',
              lineHeight: 1.2,
            }}
          >
            {fmtTons(horizon.bringTons)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CementKpiModal({ open, onClose, dateKey }: Props) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CementOverviewPayload | null>(null);
  const [viewportW, setViewportW] = useState(1280);

  useBodyScrollLock(open);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const sync = () => setViewportW(window.innerWidth);
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  const uiScale = viewportW >= 2500 ? 1.25 : viewportW >= 1900 ? 1.12 : viewportW >= 1400 ? 1.05 : 1;
  const fs = (n: number) => Math.round(n * uiScale);
  const sp = (n: number) => Math.round(n * uiScale);

  const load = useCallback(async () => {
    if (!dateKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/adminCifra/warehouse/cement-overview?date=${encodeURIComponent(dateKey)}`,
        { headers: adminCifraAuthHeaders(), cache: 'no-store' },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json as CementOverviewPayload);
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [dateKey]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const dateLabel = useMemo(
    () => formatRuDateWithWeekday(parseLocalDate(dateKey), 'nominative'),
    [dateKey],
  );

  const asOfLabel = useMemo(() => {
    if (!data?.asOf) return '';
    try {
      return new Date(data.asOf).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Moscow',
      });
    } catch {
      return '';
    }
  }, [data?.asOf]);

  if (!open || !mounted) return null;

  const usable =
    data?.totals.usableTons ??
    data?.silos.reduce((s, x) => s + Math.max(0, x.currentTons), 0) ??
    data?.totals.currentTons ??
    0;
  const anyShortage = Boolean(
    data?.dayAhead?.shortage || data?.tomorrow?.shortage || data?.week?.shortage,
  );

  const weekBlock: HorizonBlock | null = data?.week ?? null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Цемент — обзор силосов"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(2, 6, 23, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: `clamp(${sp(12)}px, 2.5vw, ${sp(40)}px)`,
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div
        onClick={(e) => e.stopPropagation()}
        className="scroll-hidden"
        style={volumeModalStyle({
          width: 'min(1280px, max(640px, 72vw), calc(100vw - 32px))',
          overflow: 'visible',
          borderRadius: sp(22),
          padding: `clamp(${sp(16)}px, 1.8vw, ${sp(28)}px)`,
          border: anyShortage
            ? '1.5px solid rgba(239,68,68,0.45)'
            : '1.5px solid rgba(96,165,250,0.35)',
        })}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: sp(16),
            marginBottom: sp(16),
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: sp(10),
                marginBottom: sp(6),
                flexWrap: 'wrap',
              }}
            >
              {anyShortage ? (
                <AlertTriangle size={fs(26)} color="#F87171" />
              ) : (
                <CheckCircle2 size={fs(26)} color="#34D399" />
              )}
              <h2
                style={{
                  margin: 0,
                  fontSize: fs(24),
                  fontWeight: 800,
                  color: '#F1F5F9',
                  lineHeight: 1.15,
                }}
              >
                Цемент — силосы и прогноз
              </h2>
            </div>
            <div style={{ color: '#94A3B8', fontSize: fs(16), fontWeight: 600 }}>
              {dateLabel}
              {asOfLabel ? ` · обновлено ${asOfLabel}` : ''}
              {data?.isToday ? ' · live' : data?.isFuture ? ' · будущий день' : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: sp(8), flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              title="Обновить"
              style={{
                ...modalCloseButtonStyle({ color: '#94A3B8' }),
                width: fs(44),
                height: fs(44),
                borderRadius: 12,
              }}
            >
              {loading ? (
                <Loader2 size={fs(20)} style={{ animation: 'spin 0.9s linear infinite' }} />
              ) : (
                <RefreshCw size={fs(20)} />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Закрыть"
              style={{
                ...modalCloseButtonStyle({ color: '#94A3B8' }),
                width: fs(44),
                height: fs(44),
                borderRadius: 12,
              }}
            >
              <X size={fs(22)} />
            </button>
          </div>
        </div>

        {error ? (
          <div
            style={volumeCardSoftStyle({
              padding: sp(20),
              borderRadius: 16,
              color: '#FCA5A5',
              fontSize: fs(18),
              fontWeight: 600,
            })}
          >
            {error}
          </div>
        ) : null}

        {loading && !data ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: sp(12),
              padding: sp(48),
              color: '#94A3B8',
              fontSize: fs(18),
            }}
          >
            <Loader2 size={fs(28)} style={{ animation: 'spin 0.9s linear infinite' }} />
            Считаю остатки и прогноз…
          </div>
        ) : null}

        {data ? (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: sp(10),
                marginBottom: sp(14),
              }}
            >
              {[
                {
                  label: 'На начало дня',
                  value: `${fmtTons(data.totals.startTons)} т`,
                  sub: `${fmtKgFromTons(data.totals.startTons)} кг`,
                  color: '#E2E8F0',
                },
                {
                  label: data.isToday ? 'Доступно сейчас' : 'Доступный остаток',
                  value: `${fmtTons(usable)} т`,
                  sub: `${fmtKgFromTons(usable)} кг · без минусов в силосах`,
                  color: '#60A5FA',
                },
                {
                  label: 'Израсходовано',
                  value: `${fmtTons(data.totals.consumedTons)} т`,
                  sub: `${fmtKgFromTons(data.totals.consumedTons)} кг`,
                  color: '#FBBF24',
                },
              ].map((card) => (
                <div
                  key={card.label}
                  style={volumeCardSoftStyle({
                    borderRadius: 14,
                    padding: `${sp(12)}px ${sp(14)}px`,
                    minWidth: 0,
                  })}
                >
                  <div
                    style={{
                      color: '#94A3B8',
                      fontSize: fs(13),
                      fontWeight: 600,
                      marginBottom: sp(4),
                    }}
                  >
                    {card.label}
                  </div>
                  <div
                    style={{
                      fontSize: fs(22),
                      fontWeight: 800,
                      color: card.color,
                      lineHeight: 1.15,
                    }}
                  >
                    {card.value}
                  </div>
                  <div
                    style={{
                      marginTop: sp(4),
                      color: '#64748B',
                      fontSize: fs(12),
                      fontWeight: 600,
                    }}
                  >
                    {card.sub}
                  </div>
                </div>
              ))}
              <div
                style={volumeCardSoftStyle({
                  borderRadius: 14,
                  padding: `${sp(12)}px ${sp(14)}px`,
                  minWidth: 0,
                })}
              >
                <div
                  style={{
                    color: '#94A3B8',
                    fontSize: fs(13),
                    fontWeight: 600,
                    marginBottom: sp(4),
                  }}
                >
                  Факт / план
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: sp(6),
                    flexWrap: 'nowrap',
                    whiteSpace: 'nowrap',
                    fontSize: fs(20),
                    fontWeight: 800,
                    color: '#A5B4FC',
                    lineHeight: 1.15,
                  }}
                >
                  <span>{fmtTons(data.day.unloadedTons)}</span>
                  <span style={{ color: '#64748B', fontWeight: 700 }}>/</span>
                  <span>
                    {fmtTons(data.day.planTons)}
                    <span style={{ fontSize: fs(14), color: '#94A3B8', fontWeight: 700 }}> т</span>
                  </span>
                </div>
                <div
                  style={{
                    marginTop: sp(4),
                    color: '#64748B',
                    fontSize: fs(12),
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  разгружено · план дня
                </div>
              </div>
            </div>

            <div
              style={{
                fontSize: fs(16),
                fontWeight: 800,
                color: '#F1F5F9',
                marginBottom: sp(8),
              }}
            >
              По силосам
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${Math.max(1, data.silos.length)}, minmax(0, 1fr))`,
                gap: sp(10),
                marginBottom: sp(14),
              }}
            >
              {data.silos.map((s) => {
                const usableSilo = s.usableTons ?? Math.max(0, s.currentTons);
                const fillPct =
                  s.maxTons > 0
                    ? Math.min(100, Math.round((usableSilo / s.maxTons) * 100))
                    : 0;
                const neg = Boolean(s.isNegative || s.currentTons < 0);
                return (
                  <div
                    key={s.siloId}
                    style={volumeCardSoftStyle({
                      borderRadius: 14,
                      padding: sp(12),
                      border: neg
                        ? '1px solid rgba(248,113,113,0.4)'
                        : '1px solid rgba(96,165,250,0.22)',
                    })}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        marginBottom: sp(6),
                        gap: sp(6),
                      }}
                    >
                      <span style={{ fontSize: fs(16), fontWeight: 800, color: '#F8FAFC' }}>
                        {s.name}
                      </span>
                      <span style={{ fontSize: fs(12), color: '#64748B', fontWeight: 600 }}>
                        max {fmtTons(s.maxTons)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: fs(24),
                        fontWeight: 800,
                        color: neg ? '#F87171' : '#60A5FA',
                        lineHeight: 1,
                        marginBottom: sp(4),
                      }}
                    >
                      {fmtTons(s.currentTons)}
                      <span style={{ fontSize: fs(14), color: '#94A3B8', fontWeight: 700 }}>
                        {' '}
                        т
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: fs(11),
                        color: '#64748B',
                        fontWeight: 600,
                        marginBottom: sp(6),
                      }}
                    >
                      {fmtKgFromTons(s.currentTons)} кг
                      {neg ? ' · в прогнозе 0' : ''}
                    </div>
                    <div
                      style={{
                        height: sp(8),
                        borderRadius: 9999,
                        background: '#334155',
                        overflow: 'hidden',
                        marginBottom: sp(8),
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${fillPct}%`,
                          borderRadius: 9999,
                          background: 'linear-gradient(90deg, #2563EB, #60A5FA)',
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: `${sp(4)}px ${sp(10)}px`,
                        fontSize: fs(12),
                        fontWeight: 600,
                        color: '#94A3B8',
                      }}
                    >
                      <span>
                        нач. <span style={{ color: '#E2E8F0' }}>{fmtTons(s.startTons)}</span>
                      </span>
                      <span>
                        расх. <span style={{ color: '#FBBF24' }}>{fmtTons(s.consumedTons)}</span>
                      </span>
                      {s.refillTons > 0 ? (
                        <span>
                          + <span style={{ color: '#34D399' }}>{fmtTons(s.refillTons)}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={{
                fontSize: fs(16),
                fontWeight: 800,
                color: '#F1F5F9',
                marginBottom: sp(8),
              }}
            >
              Прогноз: день → завтра → неделя
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: sp(10),
              }}
            >
              {data.dayAhead ? (
                <HorizonCard
                  title="Выбранный день"
                  subtitle={`${fmtDateShort(data.dayAhead.dateFrom)} · ${pluralWord(data.dayAhead.orderCount, 'заявка', 'заявки', 'заявок')} · ${fmtTons(data.dayAhead.remainingVolumeM3)} м³`}
                  horizon={data.dayAhead}
                  fs={fs}
                  sp={sp}
                />
              ) : null}

              {data.tomorrow ? (
                <HorizonCard
                  title="Следующий день"
                  subtitle={`${fmtDateShort(data.tomorrow.dateFrom)} · ${pluralWord(data.tomorrow.orderCount, 'заявка', 'заявки', 'заявок')} · ${fmtTons(data.tomorrow.remainingVolumeM3)} м³`}
                  horizon={data.tomorrow}
                  fs={fs}
                  sp={sp}
                  stockLabel="После дня"
                />
              ) : null}

              {weekBlock ? (
                <HorizonCard
                  title="Неделя"
                  subtitle={`${fmtDateShort(weekBlock.dateFrom)} — ${fmtDateShort(weekBlock.dateTo)} · ${pluralWord(weekBlock.orderCount, 'заявка', 'заявки', 'заявок')} · ${fmtTons(weekBlock.remainingVolumeM3)} м³`}
                  horizon={weekBlock}
                  fs={fs}
                  sp={sp}
                />
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
