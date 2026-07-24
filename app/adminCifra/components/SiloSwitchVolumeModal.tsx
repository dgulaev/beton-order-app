'use client';

import { useEffect, useMemo, useState } from 'react';
import { siloNameById } from '@/lib/siloConfig';
import { modalCloseButtonStyle, volumeModalStyle } from '../cardStyles';
import { adminAuthHeaders } from '@/lib/adminCifraFetch';

export type SiloSwitchTrip = {
  id: number;
  mixerName: string;
  orderId: number;
  grade: string;
  volumeM3: number;
};

type Props = {
  open: boolean;
  fromSiloId: number;
  toSiloId: number;
  trips: SiloSwitchTrip[];
  onCancel: () => void;
  onConfirm: (result: { orderMixerId: number; volumeM3: number }) => Promise<void>;
};

export default function SiloSwitchVolumeModal({
  open,
  fromSiloId,
  toSiloId,
  trips,
  onCancel,
  onConfirm,
}: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [volumeStr, setVolumeStr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setSelectedId(trips[0]?.id ?? null);
    setVolumeStr('');
    setBusy(false);
    setError('');
  }, [open, trips]);

  const selected = useMemo(
    () => trips.find((t) => t.id === selectedId) || null,
    [trips, selectedId],
  );

  if (!open) return null;

  const submit = async () => {
    if (!selected) {
      setError('Выбери рейс');
      return;
    }
    const volumeM3 = Number(String(volumeStr).replace(',', '.'));
    if (!(volumeM3 > 0)) {
      setError('Введи объём больше 0');
      return;
    }
    if (volumeM3 > selected.volumeM3 + 0.001) {
      setError(`Не больше плана рейса (${selected.volumeM3} м³)`);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onConfirm({ orderMixerId: selected.id, volumeM3 });
    } catch (err: any) {
      setError(err?.message || 'Не удалось списать и переключить');
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 400,
        background: 'rgba(2, 6, 23, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={onCancel}
    >
      <div
        style={volumeModalStyle({
          width: 'min(480px, 100%)',
          padding: '22px 22px 18px',
          color: '#E2E8F0',
        })}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
              Смена силоса {siloNameById(fromSiloId)} → {siloNameById(toSiloId)}
            </div>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, lineHeight: 1.35, color: '#F8FAFC' }}>
              Сколько было отгружено бетона в этот рейс перед переключением?
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={modalCloseButtonStyle({ width: 32, height: 32, borderRadius: 10 })}
            title="Отмена"
          >
            ✕
          </button>
        </div>

        {trips.length > 1 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 6, fontWeight: 600 }}>Рейс</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {trips.map((t) => {
                const active = t.id === selectedId;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSelectedId(t.id)}
                    disabled={busy}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: active
                        ? '1px solid rgba(52, 211, 153, 0.55)'
                        : '1px solid rgba(148, 163, 184, 0.25)',
                      background: active ? 'rgba(16, 185, 129, 0.12)' : 'rgba(15, 23, 42, 0.55)',
                      color: '#E2E8F0',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {t.mixerName} · заявка #{t.orderId}
                    </div>
                    <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
                      {t.grade || '—'} · план {t.volumeM3} м³
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {trips.length === 1 && selected && (
          <div style={{
            marginBottom: 14,
            padding: '10px 12px',
            borderRadius: 12,
            background: 'rgba(15, 23, 42, 0.55)',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            fontSize: 13,
            color: '#CBD5E1',
          }}>
            <strong style={{ color: '#F8FAFC' }}>{selected.mixerName}</strong>
            {' · '}заявка #{selected.orderId}
            {' · '}{selected.grade || '—'}
            {' · '}план {selected.volumeM3} м³
          </div>
        )}

        <label style={{ display: 'block', marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 6, fontWeight: 600 }}>
            Уже в миксере (м³)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              autoFocus
              inputMode="decimal"
              value={volumeStr}
              disabled={busy}
              onChange={(e) => setVolumeStr(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
                if (e.key === 'Escape') onCancel();
              }}
              placeholder="например 6"
              style={{
                flex: 1,
                padding: '12px 14px',
                borderRadius: 12,
                border: '1px solid rgba(148, 163, 184, 0.35)',
                background: '#0F172A',
                color: '#F8FAFC',
                fontSize: 18,
                fontWeight: 700,
                outline: 'none',
              }}
            />
            <span style={{ color: '#94A3B8', fontWeight: 700 }}>м³</span>
          </div>
        </label>

        <div style={{ fontSize: 12, color: '#6EE7B7', lineHeight: 1.4, marginBottom: 14 }}>
          Укажи <strong>общий</strong> объём уже в миксере (не долив с прошлого
          переключения). С «{siloNameById(fromSiloId)}» спишется только прирост;
          остаток уйдёт на «{siloNameById(toSiloId)}» при «В пути».
        </div>

        {error && (
          <div style={{
            marginBottom: 12,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'rgba(248, 113, 113, 0.12)',
            border: '1px solid rgba(248, 113, 113, 0.35)',
            color: '#FCA5A5',
            fontSize: 13,
          }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              border: '1px solid rgba(148, 163, 184, 0.35)',
              background: 'transparent',
              color: '#CBD5E1',
              fontWeight: 700,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            style={{
              padding: '10px 16px',
              borderRadius: 12,
              border: 'none',
              background: busy ? '#475569' : 'linear-gradient(135deg, #059669 0%, #10B981 100%)',
              color: '#ECFDF5',
              fontWeight: 800,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {busy ? 'Сохраняю…' : 'Списать и переключить'}
          </button>
        </div>
      </div>
    </div>
  );
}

export type PostCementSegmentResult = {
  skipped: boolean;
  volumeM3: number;
  totalInMixerM3: number;
  cementKg: number;
  remainingM3: number;
};

/** Утилита для POST сегмента — вынесена для тестов/переиспользования. */
export async function postCementSegment(opts: {
  orderMixerId: number;
  siloId: number;
  volumeM3: number;
}): Promise<PostCementSegmentResult> {
  const res = await fetch('/api/adminCifra/warehouse/cement-segment', {
    method: 'POST',
    headers: adminAuthHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(opts),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return {
    skipped: Boolean(data.skipped),
    volumeM3: Number(data.volumeM3 || 0),
    totalInMixerM3: Number(data.totalInMixerM3 || opts.volumeM3),
    cementKg: Number(data.cementKg || 0),
    remainingM3: Number(data.remainingM3 || 0),
  };
}
