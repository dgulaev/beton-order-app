'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ArrowRightLeft, X } from 'lucide-react';
import { SILO_SPEC, siloNameById } from '@/lib/siloConfig';
import {
  CARD_BORDER,
  modalCloseButtonStyle,
  volumeCardSoftStyle,
  volumeModalStyle,
} from '../cardStyles';
import { appAlert, appConfirm } from './appDialog';

type Trip = {
  id: number;
  orderId: number;
  mixerName: string;
  volume: number;
  status: string;
  grade: string | null;
  siloId: number;
  siloName: string;
  cementKg: number;
  writeOffAt: string | null;
};

type Props = {
  onClose: () => void;
  onDone?: () => void;
};

function adminAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const userId = localStorage.getItem('userId');
    if (userId) headers['x-user-id'] = userId;
  }
  return headers;
}

function moscowDateKey(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function formatTime(iso: string | null): string {
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
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });
}

export default function CementTransferModal({ onClose, onDone }: Props) {
  const [date, setDate] = useState(moscowDateKey);
  const [fromSilo, setFromSilo] = useState<'all' | '1' | '2' | '3'>('all');
  const [orderIdInput, setOrderIdInput] = useState('');
  const [orderFilter, setOrderFilter] = useState<number | null>(null);
  const [toSiloId, setToSiloId] = useState<number | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyOrderFilter = () => {
    const orderNum = Number(orderIdInput.trim());
    setOrderFilter(Number.isFinite(orderNum) && orderNum > 0 ? orderNum : null);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ date });
      if (fromSilo !== 'all') qs.set('fromSilo', fromSilo);
      if (orderFilter != null) qs.set('orderId', String(orderFilter));

      const res = await fetch(`/api/adminCifra/warehouse/cement-transfer?${qs}`, {
        headers: adminAuthHeaders(),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Не удалось загрузить рейсы');
        setTrips([]);
        setSelected(new Set());
        return;
      }
      const list: Trip[] = Array.isArray(data.trips) ? data.trips : [];
      setTrips(list);
      setSelected(new Set(list.map((t) => t.id)));
    } catch (err) {
      console.error(err);
      setError('Не удалось загрузить рейсы');
      setTrips([]);
      setSelected(new Set());
    } finally {
      setLoading(false);
    }
  }, [date, fromSilo, orderFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Рейсы, которые реально можно перенести на выбранный целевой силос. */
  const transferableSelected = useMemo(
    () => trips.filter((t) => (
      selected.has(t.id)
      && (toSiloId == null || t.siloId !== toSiloId)
    )),
    [trips, selected, toSiloId],
  );

  const selectedKg = useMemo(
    () => Math.round(transferableSelected.reduce((s, t) => s + t.cementKg, 0) * 10) / 10,
    [transferableSelected],
  );

  const canSubmit =
    !busy
    && !loading
    && toSiloId != null
    && transferableSelected.length > 0;

  // При смене целевого силоса снимаем выбор с рейсов, которые уже на нём
  useEffect(() => {
    if (toSiloId == null) return;
    setSelected((prev) => {
      let changed = false;
      const next = new Set<number>();
      for (const id of prev) {
        const trip = trips.find((t) => t.id === id);
        if (trip && trip.siloId === toSiloId) {
          changed = true;
          continue;
        }
        next.add(id);
      }
      return changed ? next : prev;
    });
  }, [toSiloId, trips]);

  const toggle = (id: number) => {
    const trip = trips.find((t) => t.id === id);
    if (trip && toSiloId != null && trip.siloId === toSiloId) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const eligible = trips.filter((t) => toSiloId == null || t.siloId !== toSiloId);
    const allSelected = eligible.length > 0 && eligible.every((t) => selected.has(t.id));
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(eligible.map((t) => t.id)));
  };

  const handleSubmit = async () => {
    if (!canSubmit || toSiloId == null) return;

    const fromLabels = [...new Set(transferableSelected.map((t) => t.siloName))].join(', ');
    const confirmed = await appConfirm(
      `Перенести списание ${transferableSelected.length} рейс(ов), ${formatKg(selectedKg)} кг?\n\n`
      + `С: ${fromLabels}\n`
      + `На: ${siloNameById(toSiloId)}\n\n`
      + 'Остатки силосов и метки на рейсах будут исправлены. В журнале появятся записи «Корректировка».',
      {
        title: 'Исправить силос списания',
        okLabel: 'Перенести',
        cancelLabel: 'Отмена',
        variant: 'warning',
      },
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      const res = await fetch('/api/adminCifra/warehouse/cement-transfer', {
        method: 'POST',
        headers: adminAuthHeaders(),
        body: JSON.stringify({
          mixerIds: transferableSelected.map((t) => t.id),
          toSiloId,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) {
        await appAlert(result.error || 'Не удалось перенести', {
          title: 'Ошибка',
          variant: 'danger',
        });
        return;
      }

      const errNote = Array.isArray(result.errors) && result.errors.length
        ? `\n\nНе перенесено:\n${result.errors.slice(0, 8).join('\n')}`
        : '';

      await appAlert(
        `Перенесено: ${result.moved || 0} рейс(ов), ${formatKg(Number(result.totalKg || 0))} кг\n`
        + `На: ${result.toSiloName || siloNameById(toSiloId)}`
        + (result.failed ? `\nОшибок: ${result.failed}` : '')
        + errNote,
        {
          title: 'Корректировка силоса',
          variant: result.failed ? 'warning' : 'success',
          okLabel: 'Ок',
        },
      );

      onDone?.();
      await load();
      if (!result.failed) onClose();
    } catch (err) {
      console.error(err);
      await appAlert('Ошибка переноса списания', {
        title: 'Ошибка',
        variant: 'danger',
      });
    } finally {
      setBusy(false);
    }
  };

  const today = moscowDateKey();

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
          width: 'min(760px, 100%)',
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
              <ArrowRightLeft size={18} color="#FBBF24" />
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#F1F5F9' }}>
                Исправить силос списания
              </h2>
            </div>
            <div style={{ fontSize: 12.5, color: '#94A3B8' }}>
              Вернуть кг на ошибочный силос и списать с правильного · по рейсам за день
            </div>
          </div>
          <button type="button" onClick={onClose} style={modalCloseButtonStyle()} aria-label="Закрыть">
            <X size={18} />
          </button>
        </div>

        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          padding: '12px 20px',
          borderBottom: '1px solid rgba(148, 163, 184, 0.12)',
          flexShrink: 0,
          alignItems: 'flex-end',
        }}>
          <label style={fieldLabelStyle}>
            День списания
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              style={inputStyle}
            />
          </label>

          <label style={fieldLabelStyle}>
            Заявка #
            <input
              type="text"
              inputMode="numeric"
              placeholder="все · Enter"
              value={orderIdInput}
              onChange={(e) => setOrderIdInput(e.target.value.replace(/[^\d]/g, ''))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyOrderFilter();
              }}
              onBlur={applyOrderFilter}
              style={{ ...inputStyle, width: 110 }}
            />
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>С силоса</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {([
                { id: 'all' as const, label: 'Все' },
                ...SILO_SPEC.map((s) => ({
                  id: String(s.silo_id) as '1' | '2' | '3',
                  label: `Силос ${s.silo_id}`,
                })),
              ]).map((chip) => {
                const active = fromSilo === chip.id;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setFromSilo(chip.id)}
                    style={{
                      padding: '6px 10px',
                      borderRadius: 999,
                      border: active
                        ? '1px solid rgba(251, 191, 36, 0.55)'
                        : '1px solid rgba(148, 163, 184, 0.25)',
                      background: active ? 'rgba(251, 191, 36, 0.14)' : 'rgba(15, 23, 42, 0.55)',
                      color: active ? '#FBBF24' : '#CBD5E1',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {chip.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 'auto' }}>
            <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>Перенести на</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {SILO_SPEC.map((s) => {
                const active = toSiloId === s.silo_id;
                return (
                  <button
                    key={s.silo_id}
                    type="button"
                    onClick={() => setToSiloId(s.silo_id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 999,
                      border: active
                        ? '1px solid rgba(52, 211, 153, 0.55)'
                        : '1px solid rgba(148, 163, 184, 0.25)',
                      background: active ? 'rgba(16, 185, 129, 0.16)' : 'rgba(15, 23, 42, 0.55)',
                      color: active ? '#34D399' : '#CBD5E1',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {s.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div
          className="scroll-hidden"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: '12px 20px 16px',
          }}
        >
          {loading ? (
            <div style={{ color: '#94A3B8', padding: '28px 0', textAlign: 'center' }}>Загрузка…</div>
          ) : error ? (
            <div style={{ color: '#F87171', padding: '28px 0', textAlign: 'center' }}>{error}</div>
          ) : trips.length === 0 ? (
            <div style={{ color: '#64748B', padding: '28px 0', textAlign: 'center' }}>
              Нет рейсов со списанием цемента за этот день
            </div>
          ) : (
            <>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
                gap: 8,
              }}>
                <button
                  type="button"
                  onClick={toggleAll}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94A3B8',
                    fontSize: 12.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  {(() => {
                    const eligible = trips.filter((t) => toSiloId == null || t.siloId !== toSiloId);
                    const allSelected = eligible.length > 0 && eligible.every((t) => selected.has(t.id));
                    return allSelected ? 'Снять все' : 'Выбрать все';
                  })()}
                  {' · '}
                  {transferableSelected.length}/{trips.length}
                </button>
                <div style={{ fontSize: 12, color: '#64748B', fontVariantNumeric: 'tabular-nums' }}>
                  выбрано {formatKg(selectedKg)} кг
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {trips.map((trip) => {
                  const checked = selected.has(trip.id);
                  const sameTarget = toSiloId != null && trip.siloId === toSiloId;
                  return (
                    <label
                      key={trip.id}
                      style={volumeCardSoftStyle({
                        borderRadius: 12,
                        padding: '10px 12px',
                        display: 'grid',
                        gridTemplateColumns: '22px 1fr auto',
                        gap: 10,
                        alignItems: 'center',
                        cursor: sameTarget ? 'not-allowed' : 'pointer',
                        opacity: sameTarget ? 0.45 : 1,
                        border: CARD_BORDER,
                        background: checked && !sameTarget
                          ? 'rgba(251, 191, 36, 0.08)'
                          : undefined,
                      })}
                    >
                      <input
                        type="checkbox"
                        checked={checked && !sameTarget}
                        disabled={sameTarget}
                        onChange={() => toggle(trip.id)}
                        style={{ width: 16, height: 16, accentColor: '#FBBF24' }}
                      />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#F1F5F9' }}>
                          #{trip.orderId}
                          <span style={{ color: '#94A3B8', fontWeight: 500 }}>
                            {' · '}{trip.mixerName}
                            {trip.grade ? ` · ${trip.grade}` : ''}
                          </span>
                        </div>
                        <div style={{ marginTop: 2, fontSize: 12, color: '#94A3B8' }}>
                          {formatTime(trip.writeOffAt)}
                          {' · '}
                          <span style={{ color: '#F87171', fontWeight: 600 }}>{trip.siloName}</span>
                          {sameTarget ? (
                            <span style={{ color: '#64748B' }}> · уже на целевом</span>
                          ) : null}
                          {' · '}
                          {trip.status}
                          {' · '}
                          {trip.volume} м³
                        </div>
                      </div>
                      <div style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#F87171',
                        fontVariantNumeric: 'tabular-nums',
                        whiteSpace: 'nowrap',
                      }}>
                        −{formatKg(trip.cementKg)} кг
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 20px 16px',
          borderTop: '1px solid rgba(148, 163, 184, 0.14)',
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 12.5, color: '#94A3B8' }}>
            {toSiloId == null
              ? 'Выбери целевой силос сверху'
              : transferableSelected.length === 0
                ? 'Выбери рейсы'
                : `→ ${siloNameById(toSiloId)} · ${transferableSelected.length} рейс. · ${formatKg(selectedKg)} кг`}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '8px 14px',
                borderRadius: 10,
                border: '1px solid rgba(148, 163, 184, 0.28)',
                background: 'rgba(15, 23, 42, 0.55)',
                color: '#CBD5E1',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={() => { void handleSubmit(); }}
              disabled={!canSubmit}
              style={{
                padding: '8px 16px',
                borderRadius: 10,
                border: '1px solid rgba(251, 191, 36, 0.45)',
                background: canSubmit ? 'rgba(251, 191, 36, 0.18)' : 'rgba(251, 191, 36, 0.06)',
                color: canSubmit ? '#FBBF24' : '#64748B',
                fontSize: 13,
                fontWeight: 700,
                cursor: canSubmit ? 'pointer' : 'not-allowed',
              }}
            >
              {busy ? 'Перенос…' : 'Перенести списание'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const fieldLabelStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 11,
  color: '#94A3B8',
  fontWeight: 600,
};

const inputStyle: CSSProperties = {
  background: 'rgba(15, 23, 42, 0.75)',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  borderRadius: 8,
  color: '#E2E8F0',
  fontSize: 12.5,
  padding: '6px 8px',
  colorScheme: 'dark',
  fontWeight: 500,
};
