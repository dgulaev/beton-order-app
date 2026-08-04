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

export type AdditiveOverviewPayload = {
  date: string;
  asOf: string;
  isToday: boolean;
  isFuture: boolean;
  additiveId: 1 | 2;
  name: string;
  tanks: Array<{
    additiveId: number;
    name: string;
    maxLiters: number;
    startLiters: number;
    currentLiters: number;
    consumedLiters: number;
    refillLiters: number;
  }>;
  totals: {
    startLiters: number;
    currentLiters: number;
    consumedLiters: number;
    consumedKg: number;
    maxLiters: number;
    refillLiters: number;
  };
  day: {
    planLiters: number;
    unloadedLiters: number;
    planKg: number;
    unloadedKg: number;
  };
  week: {
    dateFrom: string;
    dateTo: string;
    neededLiters: number;
    stockLiters: number;
    bringLiters: number;
    shortage: boolean;
    orderCount: number;
    remainingVolumeM3: number;
  };
  shortfallOrders: Array<{
    id: number;
    grade: string;
    client: string | null;
    deliveryDate: string;
    deliveryTime: string | null;
    volumeM3: number;
    remainingM3: number;
    additiveLiters: number;
    additiveKg: number;
    stockBeforeLiters: number;
    deficitLiters: number;
  }>;
};

type Props = {
  open: boolean;
  onClose: () => void;
  dateKey: string;
  additiveId: 1 | 2;
};

function parseLocalDate(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function fmtL(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const r = Math.round(n * 10) / 10;
  return r % 1 === 0 ? String(Math.round(r)) : r.toFixed(1);
}

function fmtKg(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const r = Math.round(n * 10) / 10;
  return r % 1 === 0 ? String(Math.round(r)) : r.toFixed(1);
}

function fmtDateShort(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}.${m}.${y}`;
}

function fmtTime(raw: string | null): string {
  if (!raw) return '';
  const s = String(raw);
  if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
  return s;
}

const ACCENT: Record<1 | 2, { main: string; bar: string; border: string }> = {
  1: {
    main: '#FACC15',
    bar: 'linear-gradient(90deg, #F59E0B, #FACC15)',
    border: 'rgba(250,204,21,0.35)',
  },
  2: {
    main: '#A78BFA',
    bar: 'linear-gradient(90deg, #8B5CF6, #A78BFA)',
    border: 'rgba(167,139,250,0.35)',
  },
};

export default function AdditiveKpiModal({ open, onClose, dateKey, additiveId }: Props) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AdditiveOverviewPayload | null>(null);
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
  const accent = ACCENT[additiveId];

  const load = useCallback(async () => {
    if (!dateKey) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/adminCifra/warehouse/additive-overview?date=${encodeURIComponent(dateKey)}&additiveId=${additiveId}`,
        { headers: adminCifraAuthHeaders(), cache: 'no-store' },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setData(json as AdditiveOverviewPayload);
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [dateKey, additiveId]);

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

  const week = data?.week;
  const shortage = Boolean(week?.shortage);
  const shortList = data?.shortfallOrders || [];
  const titleName = data?.name || (additiveId === 1 ? 'ПФМ-НЛК' : 'Линомикс ТипР');

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${titleName} — обзор и прогноз`}
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
          maxHeight: 'min(92vh, calc(100vh - 32px))',
          overflowY: 'auto',
          borderRadius: sp(22),
          padding: `clamp(${sp(20)}px, 2.2vw, ${sp(36)}px)`,
          border: shortage
            ? '1.5px solid rgba(239,68,68,0.45)'
            : `1.5px solid ${accent.border}`,
        })}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: sp(16),
            marginBottom: sp(22),
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
              {shortage ? (
                <AlertTriangle size={fs(26)} color="#F87171" />
              ) : (
                <CheckCircle2 size={fs(26)} color="#34D399" />
              )}
              <h2
                style={{
                  margin: 0,
                  fontSize: fs(28),
                  fontWeight: 800,
                  color: '#F1F5F9',
                  lineHeight: 1.15,
                }}
              >
                {titleName} — ёмкость и прогноз
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
                gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))',
                gap: sp(14),
                marginBottom: sp(22),
              }}
            >
              {[
                {
                  label: 'На начало дня',
                  value: `${fmtL(data.totals.startLiters)} л`,
                  color: '#E2E8F0',
                  compact: false,
                },
                {
                  label: data.isToday ? 'Сейчас (live)' : 'Остаток на день',
                  value: `${fmtL(data.totals.currentLiters)} л`,
                  color: accent.main,
                  compact: false,
                },
                {
                  label: 'Израсходовано',
                  value: `${fmtL(data.totals.consumedLiters)} л`,
                  color: '#FBBF24',
                  compact: false,
                },
                {
                  label: 'План дня / факт',
                  value: `${fmtKg(data.day.unloadedKg)} / ${fmtKg(data.day.planKg)} кг`,
                  color: '#A5B4FC',
                  compact: true,
                },
              ].map((card) => (
                <div
                  key={card.label}
                  style={volumeCardSoftStyle({
                    borderRadius: 16,
                    padding: `${sp(16)}px ${sp(18)}px`,
                    minWidth: 0,
                    border: '1px solid rgba(148,163,184,0.35)',
                  })}
                >
                  <div
                    style={{
                      color: '#94A3B8',
                      fontSize: fs(14),
                      fontWeight: 600,
                      marginBottom: sp(8),
                    }}
                  >
                    {card.label}
                  </div>
                  <div
                    style={{
                      fontSize: fs(card.compact ? 22 : 26),
                      fontWeight: 800,
                      color: card.color,
                      lineHeight: 1.15,
                      fontVariantNumeric: 'tabular-nums',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {card.value}
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                fontSize: fs(20),
                fontWeight: 800,
                color: '#F1F5F9',
                marginBottom: sp(12),
              }}
            >
              Ёмкость
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr',
                gap: sp(14),
                marginBottom: sp(24),
              }}
            >
              {data.tanks.map((s) => {
                const fillPct =
                  s.maxLiters > 0
                    ? Math.min(100, Math.round((Math.max(0, s.currentLiters) / s.maxLiters) * 100))
                    : 0;
                return (
                  <div
                    key={s.additiveId}
                    style={volumeCardSoftStyle({
                      borderRadius: 18,
                      padding: sp(20),
                      border: `1px solid ${accent.border}`,
                      maxWidth: 520,
                    })}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        marginBottom: sp(10),
                        gap: sp(8),
                      }}
                    >
                      <span style={{ fontSize: fs(20), fontWeight: 800, color: '#F8FAFC' }}>
                        {s.name}
                      </span>
                      <span style={{ fontSize: fs(14), color: '#64748B', fontWeight: 600 }}>
                        max {fmtL(s.maxLiters)} л
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: fs(32),
                        fontWeight: 800,
                        color: accent.main,
                        lineHeight: 1,
                        marginBottom: sp(10),
                      }}
                    >
                      {fmtL(s.currentLiters)}
                      <span style={{ fontSize: fs(18), color: '#94A3B8', fontWeight: 700 }}>
                        {' '}
                        л
                      </span>
                    </div>
                    <div
                      style={{
                        height: sp(12),
                        borderRadius: 9999,
                        background: '#334155',
                        overflow: 'hidden',
                        marginBottom: sp(12),
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${fillPct}%`,
                          borderRadius: 9999,
                          background: accent.bar,
                        }}
                      />
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: sp(8),
                        fontSize: fs(15),
                        fontWeight: 600,
                      }}
                    >
                      <div style={{ color: '#94A3B8' }}>
                        Начало дня:{' '}
                        <span style={{ color: '#E2E8F0' }}>{fmtL(s.startLiters)} л</span>
                      </div>
                      <div style={{ color: '#94A3B8' }}>
                        Расход:{' '}
                        <span style={{ color: '#FBBF24' }}>{fmtL(s.consumedLiters)} л</span>
                      </div>
                      {s.refillLiters > 0 ? (
                        <div style={{ color: '#94A3B8', gridColumn: '1 / -1' }}>
                          Внесено:{' '}
                          <span style={{ color: '#34D399' }}>{fmtL(s.refillLiters)} л</span>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <div
              style={volumeCardSoftStyle({
                borderRadius: 18,
                padding: sp(20),
                marginBottom: sp(22),
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
                  gap: sp(12),
                  marginBottom: sp(16),
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: fs(20), fontWeight: 800, color: '#F1F5F9' }}>
                    Неделя вперёд
                  </div>
                  <div style={{ color: '#94A3B8', fontSize: fs(15), fontWeight: 600, marginTop: 4 }}>
                    {fmtDateShort(data.week.dateFrom)} — {fmtDateShort(data.week.dateTo)}
                    {' · '}
                    {pluralWord(data.week.orderCount, 'заявка', 'заявки', 'заявок')}
                    {' · '}
                    {fmtL(data.week.remainingVolumeM3)} м³ осталось закрыть
                  </div>
                </div>
                {shortage ? (
                  <span
                    style={{
                      background: '#EF444425',
                      color: '#FCA5A5',
                      fontSize: fs(16),
                      fontWeight: 800,
                      borderRadius: 12,
                      padding: `${sp(8)}px ${sp(14)}px`,
                    }}
                  >
                    Не хватает {fmtL(data.week.bringLiters)} л
                  </span>
                ) : (
                  <span
                    style={{
                      background: '#10B98125',
                      color: '#34D399',
                      fontSize: fs(16),
                      fontWeight: 800,
                      borderRadius: 12,
                      padding: `${sp(8)}px ${sp(14)}px`,
                    }}
                  >
                    Хватает на неделю
                  </span>
                )}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                  gap: sp(14),
                }}
              >
                <div>
                  <div style={{ color: '#94A3B8', fontSize: fs(14), fontWeight: 600 }}>Нужно</div>
                  <div
                    style={{
                      fontSize: fs(30),
                      fontWeight: 800,
                      color: '#E2E8F0',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {fmtL(data.week.neededLiters)} л
                  </div>
                </div>
                <div>
                  <div style={{ color: '#94A3B8', fontSize: fs(14), fontWeight: 600 }}>На складе</div>
                  <div
                    style={{
                      fontSize: fs(30),
                      fontWeight: 800,
                      color: accent.main,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {fmtL(data.week.stockLiters)} л
                  </div>
                </div>
                <div>
                  <div style={{ color: '#94A3B8', fontSize: fs(14), fontWeight: 600 }}>
                    Привезти
                  </div>
                  <div
                    style={{
                      fontSize: fs(30),
                      fontWeight: 800,
                      color: shortage ? '#F87171' : '#34D399',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {fmtL(data.week.bringLiters)} л
                  </div>
                </div>
              </div>
            </div>

            <div
              style={{
                fontSize: fs(20),
                fontWeight: 800,
                color: '#F1F5F9',
                marginBottom: sp(12),
              }}
            >
              Заявки, на которые добавки не хватит
            </div>
            {shortList.length === 0 ? (
              <div
                style={volumeCardSoftStyle({
                  borderRadius: 16,
                  padding: sp(20),
                  color: '#34D399',
                  fontSize: fs(18),
                  fontWeight: 700,
                })}
              >
                При текущем остатке все открытые заявки на 7 дней закрываются.
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: sp(10),
                }}
              >
                {shortList.map((o) => (
                  <div
                    key={o.id}
                    style={volumeCardSoftStyle({
                      borderRadius: 14,
                      padding: `${sp(14)}px ${sp(16)}px`,
                      border: '1px solid rgba(239,68,68,0.3)',
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                      gap: sp(10),
                      alignItems: 'center',
                    })}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: fs(18), fontWeight: 800, color: '#F8FAFC' }}>
                        #{o.id}
                        <span style={{ color: '#94A3B8', fontWeight: 600 }}>
                          {' · '}
                          {fmtDateShort(o.deliveryDate)}
                          {o.deliveryTime ? ` ${fmtTime(o.deliveryTime)}` : ''}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: fs(15),
                          color: '#CBD5E1',
                          fontWeight: 600,
                          marginTop: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {o.grade}
                        {o.client ? ` · ${o.client}` : ''}
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#64748B', fontSize: fs(13), fontWeight: 600 }}>
                        Осталось
                      </div>
                      <div style={{ fontSize: fs(20), fontWeight: 800, color: '#E2E8F0' }}>
                        {fmtL(o.remainingM3)} м³
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#64748B', fontSize: fs(13), fontWeight: 600 }}>
                        Нужно добавки
                      </div>
                      <div style={{ fontSize: fs(20), fontWeight: 800, color: accent.main }}>
                        {fmtL(o.additiveLiters)} л
                      </div>
                    </div>
                    <div>
                      <div style={{ color: '#64748B', fontSize: fs(13), fontWeight: 600 }}>
                        Дефицит
                      </div>
                      <div style={{ fontSize: fs(20), fontWeight: 800, color: '#F87171' }}>
                        {fmtL(o.deficitLiters)} л
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div
              style={{
                marginTop: sp(20),
                color: '#64748B',
                fontSize: fs(14),
                fontWeight: 500,
                lineHeight: 1.45,
              }}
            >
              Расход «live» — фактические списания со склада при разгрузке рейсов за выбранный день.
              Прогноз недели — по остатку ёмкости сейчас и неразгруженным объёмам заявок. Симуляция
              идёт по дате и времени доставки.
            </div>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
