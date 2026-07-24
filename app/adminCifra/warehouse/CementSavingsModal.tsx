'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronRight, PiggyBank, X } from 'lucide-react';
import {
  CARD_BORDER,
  modalCloseButtonStyle,
  volumeCardSoftStyle,
  volumeModalStyle,
} from '../cardStyles';

type Entry = {
  id: number;
  siloId: number;
  siloName: string;
  amountKg: number;
  reason: 'reset' | 'refill';
  balanceBeforeTons: number;
  userName: string | null;
  createdAt: string;
  dateKey: string;
};

type DayAgg = {
  dateKey: string;
  totalKg: number;
  bySilo: Record<string, number>;
  count: number;
};

type Props = {
  onClose: () => void;
};

function adminAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof window !== 'undefined') {
    const userId = localStorage.getItem('userId');
    if (userId) headers['x-user-id'] = userId;
  }
  return headers;
}

function moscowDateKey(d: Date | string = new Date()): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function shiftMoscowDate(dateKey: string, deltaDays: number): string {
  const ms = Date.parse(`${dateKey}T12:00:00+03:00`) + deltaDays * 86400000;
  return moscowDateKey(new Date(ms));
}

function formatDayLabel(dateKey: string): string {
  const today = moscowDateKey();
  const yesterday = shiftMoscowDate(today, -1);
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  const base = date.toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
  if (dateKey === today) return `Сегодня · ${base}`;
  if (dateKey === yesterday) return `Вчера · ${base}`;
  return base;
}

function formatKg(n: number): string {
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

function formatTons(kg: number): string {
  return (kg / 1000).toLocaleString('ru-RU', { maximumFractionDigits: 3 });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function CementSavingsModal({ onClose }: Props) {
  const today = moscowDateKey();
  const [from, setFrom] = useState(() => shiftMoscowDate(today, -6));
  const [to, setTo] = useState(today);
  const [days, setDays] = useState<DayAgg[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [totalKg, setTotalKg] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const applyPreset = (preset: 'today' | '7d' | '30d') => {
    const end = moscowDateKey();
    if (preset === 'today') {
      setFrom(end);
      setTo(end);
    } else if (preset === '7d') {
      setFrom(shiftMoscowDate(end, -6));
      setTo(end);
    } else {
      setFrom(shiftMoscowDate(end, -29));
      setTo(end);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ from, to });
      const res = await fetch(`/api/adminCifra/warehouse/cement-savings?${qs}`, {
        headers: adminAuthHeaders(),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Не удалось загрузить');
        setDays([]);
        setEntries([]);
        setTotalKg(0);
        return;
      }
      setDays(Array.isArray(data.days) ? data.days : []);
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setTotalKg(Number(data.totalKg || 0));
      const keys = (Array.isArray(data.days) ? data.days : []).map((d: DayAgg) => d.dateKey);
      setExpanded(new Set(keys.slice(0, 1)));
    } catch (err) {
      console.error(err);
      setError('Не удалось загрузить');
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const entriesByDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      const list = map.get(e.dateKey) || [];
      list.push(e);
      map.set(e.dateKey, list);
    }
    return map;
  }, [entries]);

  const toggleDay = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 6, 23, 0.72)',
        backdropFilter: 'blur(4px)',
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={volumeModalStyle({
          width: 'min(720px, 100%)',
          maxHeight: 'min(88vh, 860px)',
          display: 'flex',
          flexDirection: 'column',
          padding: 0,
          overflow: 'hidden',
        })}
      >
        <div style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
          padding: '18px 20px 14px',
          borderBottom: '1px solid rgba(148, 163, 184, 0.18)',
          flexShrink: 0,
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <PiggyBank size={18} color="#34D399" />
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#F1F5F9' }}>
                Экономия цемента
              </h2>
            </div>
            <div style={{ fontSize: 12.5, color: '#94A3B8' }}>
              Минус на силосе при обнулении или внесении · только для администратора
            </div>
          </div>
          <button type="button" onClick={onClose} style={modalCloseButtonStyle()} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>

        <div style={{
          padding: '12px 20px',
          borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {([
              { id: 'today' as const, label: 'Сегодня' },
              { id: '7d' as const, label: '7 дней' },
              { id: '30d' as const, label: '30 дней' },
            ]).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 999,
                  border: '1px solid rgba(148, 163, 184, 0.25)',
                  background: 'rgba(15, 23, 42, 0.55)',
                  color: '#CBD5E1',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {p.label}
              </button>
            ))}
            <label style={fieldLabel}>
              с
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                style={dateInput}
              />
            </label>
            <label style={fieldLabel}>
              по
              <input
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(e) => setTo(e.target.value)}
                style={dateInput}
              />
            </label>
          </div>

          <div style={volumeCardSoftStyle({
            borderRadius: 12,
            padding: '12px 14px',
            border: CARD_BORDER,
            background: 'rgba(16, 185, 129, 0.10)',
          })}>
            <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 600, marginBottom: 4 }}>
              Итого за период
            </div>
            <div style={{
              fontSize: 22,
              fontWeight: 800,
              color: '#34D399',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {formatTons(totalKg)} т
              <span style={{ fontSize: 14, fontWeight: 600, color: '#6EE7B7', marginLeft: 10 }}>
                ({formatKg(totalKg)} кг)
              </span>
            </div>
          </div>
        </div>

        <div
          className="scroll-hidden"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '14px 20px 20px',
          }}
        >
          {loading ? (
            <div style={{ color: '#94A3B8', padding: '28px 0', textAlign: 'center' }}>Загрузка…</div>
          ) : error ? (
            <div style={{ color: '#F87171', padding: '28px 0', textAlign: 'center' }}>{error}</div>
          ) : days.length === 0 ? (
            <div style={{ color: '#64748B', padding: '28px 0', textAlign: 'center' }}>
              За этот период экономии не зафиксировано
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {days.map((day) => {
                const open = expanded.has(day.dateKey);
                const dayEntries = entriesByDay.get(day.dateKey) || [];
                return (
                  <section key={day.dateKey}>
                    <button
                      type="button"
                      onClick={() => toggleDay(day.dateKey)}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 12px',
                        borderRadius: 12,
                        border: CARD_BORDER,
                        background: 'rgba(15, 23, 42, 0.65)',
                        color: '#E2E8F0',
                        cursor: 'pointer',
                      }}
                    >
                      {open ? <ChevronDown size={16} color="#94A3B8" /> : <ChevronRight size={16} color="#94A3B8" />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13.5 }}>{formatDayLabel(day.dateKey)}</div>
                        <div style={{ marginTop: 2, fontSize: 12, color: '#64748B' }}>
                          Силос 1: {formatKg(day.bySilo['1'] || 0)} ·{' '}
                          Силос 2: {formatKg(day.bySilo['2'] || 0)} ·{' '}
                          Силос 3: {formatKg(day.bySilo['3'] || 0)} кг
                          {' · '}{day.count} зап.
                        </div>
                      </div>
                      <div style={{
                        fontWeight: 800,
                        fontSize: 14,
                        color: '#34D399',
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      }}>
                        +{formatKg(day.totalKg)} кг
                      </div>
                    </button>

                    {open ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, paddingLeft: 8 }}>
                        {dayEntries.map((e) => (
                          <div
                            key={e.id}
                            style={volumeCardSoftStyle({
                              borderRadius: 10,
                              padding: '8px 12px',
                              border: CARD_BORDER,
                            })}
                          >
                            <div style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              gap: 10,
                              alignItems: 'baseline',
                            }}>
                              <div style={{ fontSize: 13, fontWeight: 700, color: '#F1F5F9' }}>
                                {formatTime(e.createdAt)}
                                <span style={{ color: '#94A3B8', fontWeight: 500 }}>
                                  {' · '}{e.siloName}
                                  {' · '}
                                  {e.reason === 'refill' ? 'при внесении' : 'при обнулении'}
                                </span>
                              </div>
                              <div style={{
                                fontSize: 13.5,
                                fontWeight: 700,
                                color: '#34D399',
                                fontVariantNumeric: 'tabular-nums',
                              }}>
                                +{formatKg(e.amountKg)} кг
                              </div>
                            </div>
                            <div style={{ marginTop: 2, fontSize: 12, color: '#64748B' }}>
                              было {e.balanceBeforeTons.toFixed(3)} т
                              {e.userName ? ` · ${e.userName}` : ''}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const fieldLabel: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: '#94A3B8',
  fontWeight: 600,
  marginLeft: 'auto',
};

const dateInput: CSSProperties = {
  background: 'rgba(15, 23, 42, 0.75)',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  borderRadius: 8,
  color: '#E2E8F0',
  fontSize: 12.5,
  padding: '5px 8px',
  colorScheme: 'dark',
};
