'use client';

import { useEffect, useMemo, useState } from 'react';
import { ScrollText, X } from 'lucide-react';
import { SILO_SPEC } from '@/lib/siloConfig';
import {
  CARD_BORDER,
  modalCloseButtonStyle,
  volumeCardSoftStyle,
  volumeModalStyle,
} from '../cardStyles';

type Op = {
  id?: number;
  operation_type?: string;
  item_type?: string;
  amount?: number;
  old_value?: number;
  new_value?: number;
  unit?: string;
  user_name?: string | null;
  created_at?: string;
};

type DayGroup = {
  dateKey: string;
  label: string;
  ops: Op[];
  addedKg: number;
  subtractedKg: number;
  resetCount: number;
};

type Props = {
  onClose: () => void;
};

function moscowDateKey(iso: string | undefined): string {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function formatDayLabel(dateKey: string): string {
  if (dateKey === 'unknown') return 'Без даты';
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  const todayKey = moscowDateKey(new Date().toISOString());
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = moscowDateKey(yesterday.toISOString());

  const base = date.toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  });
  if (dateKey === todayKey) return `Сегодня · ${base}`;
  if (dateKey === yesterdayKey) return `Вчера · ${base}`;
  return base;
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('ru-RU', {
    timeZone: 'Europe/Moscow',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatKg(n: number): string {
  return Math.abs(n).toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

function opMeta(op: Op) {
  const type = op.operation_type || 'unknown';
  if (type === 'add') {
    return { label: 'Внесено', accent: '#34D399', bg: 'rgba(16, 185, 129, 0.10)', sign: '+' };
  }
  if (type === 'subtract') {
    return { label: 'Списано', accent: '#F87171', bg: 'rgba(239, 68, 68, 0.10)', sign: '−' };
  }
  if (type === 'reset') {
    return { label: 'Обнулено', accent: '#94A3B8', bg: 'rgba(100, 116, 139, 0.14)', sign: '' };
  }
  return { label: 'Операция', accent: '#94A3B8', bg: 'rgba(100, 116, 139, 0.12)', sign: '' };
}

function matchesSiloFilter(itemType: string | undefined, filter: string): boolean {
  if (filter === 'all') return true;
  const t = String(itemType || '');
  if (filter === '1') return /силос\s*№?\s*1\b/i.test(t) || t === 'Силос 1';
  if (filter === '2') return /силос\s*№?\s*2\b/i.test(t) || t === 'Силос 2';
  if (filter === '3') return /силос\s*№?\s*3\b/i.test(t) || t === 'Силос 3';
  return true;
}

export default function SiloJournalModal({ onClose }: Props) {
  const [ops, setOps] = useState<Op[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [siloFilter, setSiloFilter] = useState<'all' | '1' | '2' | '3'>('all');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/adminCifra/warehouse/history?scope=silos&limit=500', {
          cache: 'no-store',
        });
        const data = res.ok ? await res.json() : [];
        if (!cancelled) setOps(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
        if (!cancelled) setError('Не удалось загрузить журнал');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const days = useMemo(() => {
    const filtered = ops.filter((op) => matchesSiloFilter(op.item_type, siloFilter));
    const map = new Map<string, DayGroup>();

    for (const op of filtered) {
      const key = moscowDateKey(op.created_at);
      let group = map.get(key);
      if (!group) {
        group = {
          dateKey: key,
          label: formatDayLabel(key),
          ops: [],
          addedKg: 0,
          subtractedKg: 0,
          resetCount: 0,
        };
        map.set(key, group);
      }
      group.ops.push(op);
      const amount = Number(op.amount || 0);
      if (op.operation_type === 'add') group.addedKg += amount;
      else if (op.operation_type === 'subtract') group.subtractedKg += amount;
      else if (op.operation_type === 'reset') group.resetCount += 1;
    }

    return Array.from(map.values()).sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }, [ops, siloFilter]);

  const totals = useMemo(() => {
    let added = 0;
    let subtracted = 0;
    let count = 0;
    for (const day of days) {
      added += day.addedKg;
      subtracted += day.subtractedKg;
      count += day.ops.length;
    }
    return {
      added: Math.round(added * 10) / 10,
      subtracted: Math.round(subtracted * 10) / 10,
      count,
    };
  }, [days]);

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
        padding: '24px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={volumeModalStyle({
          width: 'min(720px, 100%)',
          maxHeight: 'min(86vh, 820px)',
          display: 'flex',
          flexDirection: 'column',
          padding: '0',
          overflow: 'hidden',
        })}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '18px 20px 14px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.18)',
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <ScrollText size={18} color="#FBBF24" />
              <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#F1F5F9' }}>
                Журнал силосов
              </h2>
            </div>
            <div style={{ fontSize: '12.5px', color: '#94A3B8' }}>
              Внесения, списания и обнуления по дням · до 500 последних операций
            </div>
          </div>
          <button type="button" onClick={onClose} style={modalCloseButtonStyle()} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
            padding: '12px 20px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
            flexShrink: 0,
          }}
        >
          {([
            { id: 'all' as const, label: 'Все' },
            ...SILO_SPEC.map((s) => ({ id: String(s.silo_id) as '1' | '2' | '3', label: s.name })),
          ]).map((chip) => {
            const active = siloFilter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setSiloFilter(chip.id)}
                style={{
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: active
                    ? '1px solid rgba(251, 191, 36, 0.55)'
                    : '1px solid rgba(148, 163, 184, 0.25)',
                  background: active ? 'rgba(251, 191, 36, 0.14)' : 'rgba(15, 23, 42, 0.55)',
                  color: active ? '#FBBF24' : '#CBD5E1',
                  fontSize: '12.5px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {chip.label}
              </button>
            );
          })}
          <div style={{
            marginLeft: 'auto',
            alignSelf: 'center',
            fontSize: '12px',
            color: '#64748B',
            fontVariantNumeric: 'tabular-nums',
          }}>
            {totals.count} оп. · +{formatKg(totals.added)} / −{formatKg(totals.subtracted)} кг
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
              Пока нет операций по силосам
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {days.map((day) => (
                <section key={day.dateKey}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      gap: '10px',
                      marginBottom: '8px',
                    }}
                  >
                    <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: '#E2E8F0' }}>
                      {day.label}
                    </h3>
                    <div style={{ fontSize: '12px', color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ color: '#34D399' }}>+{formatKg(day.addedKg)}</span>
                      {' · '}
                      <span style={{ color: '#F87171' }}>−{formatKg(day.subtractedKg)}</span>
                      {' кг'}
                      {day.resetCount > 0 ? ` · обнул. ${day.resetCount}` : ''}
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {day.ops.map((op, index) => {
                      const meta = opMeta(op);
                      const unit = op.unit || 'кг';
                      const backfill = String(op.user_name || '').includes('задним числом');
                      return (
                        <div
                          key={op.id ?? `${day.dateKey}-${index}`}
                          style={volumeCardSoftStyle({
                            borderRadius: 12,
                            padding: '10px 12px',
                            background: meta.bg,
                            border: CARD_BORDER,
                          })}
                        >
                          <div style={{
                            display: 'grid',
                            gridTemplateColumns: '52px 1fr auto',
                            gap: '10px',
                            alignItems: 'start',
                          }}>
                            <div style={{
                              fontSize: '13px',
                              fontWeight: 700,
                              color: '#94A3B8',
                              fontVariantNumeric: 'tabular-nums',
                            }}>
                              {formatTime(op.created_at)}
                            </div>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#F1F5F9' }}>
                                <span style={{ color: meta.accent }}>{meta.label}</span>
                                <span style={{ color: '#94A3B8', fontWeight: 500 }}>
                                  {' · '}{op.item_type || 'Силос'}
                                </span>
                                {backfill ? (
                                  <span style={{
                                    marginLeft: 8,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: '#FBBF24',
                                  }}>
                                    задним числом
                                  </span>
                                ) : null}
                              </div>
                              <div style={{ marginTop: 3, fontSize: '12px', color: '#94A3B8' }}>
                                <span style={{ color: '#CBD5E1', fontWeight: 600 }}>
                                  {op.user_name?.replace(/\s*\(задним числом\)\s*$/, '') || '—'}
                                </span>
                                <span style={{ color: '#64748B' }}>
                                  {' · '}
                                  {formatKg(Number(op.old_value || 0))} → {formatKg(Number(op.new_value || 0))} {unit}
                                </span>
                              </div>
                            </div>
                            <div style={{
                              fontSize: '14px',
                              fontWeight: 700,
                              color: meta.accent,
                              fontVariantNumeric: 'tabular-nums',
                              whiteSpace: 'nowrap',
                            }}>
                              {meta.sign}{formatKg(Number(op.amount || 0))} {unit}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
