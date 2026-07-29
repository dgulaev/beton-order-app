'use client';

import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { bulkVolumeUnit, bulkVolumeUnitLabel } from '@/lib/orderLogistics';
import { modalFieldStyle, volumeCardSoftStyle } from '../cardStyles';
import { appAlert, appConfirm } from './appDialog';

type Props = {
  orderId: number | string;
  orderVolume: number;
  productCode?: string | null;
  loadingPointId?: number | null;
  vehicleKind?: string | null;
  /** После записи / удаления — чтобы обновить статус заявки в модалке */
  onChanged?: (meta: { shippedTotal: number; orderStatus: string }) => void;
};

/** Учёт отгрузок для bulk-заявок (Фаза 5). */
export default function BulkShipmentBlock({
  orderId,
  orderVolume,
  productCode,
  loadingPointId,
  vehicleKind,
  onChanged,
}: Props) {
  const [rows, setRows] = useState<any[]>([]);
  const [volume, setVolume] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const load = async () => {
    try {
      const res = await fetch(`/api/adminCifra/bulk-shipments?order_id=${orderId}`, {
        headers: adminCifraAuthHeaders(),
      });
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    }
  };

  useEffect(() => {
    load();
  }, [orderId]);

  const unit = bulkVolumeUnit(vehicleKind);
  const unitLabel = bulkVolumeUnitLabel(vehicleKind);
  const shipped = rows.reduce((s, r) => s + Number(r.volume || 0), 0);

  const save = async () => {
    const v = Number(volume);
    if (!v || v <= 0) {
      await appAlert(`Укажите объём отгрузки (${unitLabel})`, { title: 'Ошибка', variant: 'danger' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/adminCifra/bulk-shipments', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          order_id: Number(orderId),
          volume: v,
          unit,
          vehicle_number: vehicleNumber || null,
          vehicle_kind: vehicleKind || null,
          loading_point_id: loadingPointId || null,
          product_code: productCode || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        await appAlert(json.error || 'Ошибка. Выполните scripts/bulk-shipments.sql', {
          title: 'Ошибка',
          variant: 'danger',
        });
        return;
      }
      setVolume('');
      setVehicleNumber('');
      await load();
      if (typeof json.shippedTotal === 'number' && json.orderStatus) {
        onChanged?.({ shippedTotal: json.shippedTotal, orderStatus: json.orderStatus });
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: { id: number; volume?: number; vehicle_number?: string | null }) => {
    const label = `${row.vehicle_number || 'без номера'} · ${row.volume ?? '—'}`;
    if (
      !(await appConfirm(`Удалить отгрузку «${label}»?`, {
        title: 'Удаление отгрузки',
        okLabel: 'Удалить',
        cancelLabel: 'Отмена',
        variant: 'danger',
      }))
    ) {
      return;
    }

    setDeletingId(row.id);
    try {
      const res = await fetch(`/api/adminCifra/bulk-shipments?id=${row.id}`, {
        method: 'DELETE',
        headers: adminCifraAuthHeaders(),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        await appAlert(json.error || 'Не удалось удалить отгрузку', {
          title: 'Ошибка',
          variant: 'danger',
        });
        return;
      }
      await load();
      if (typeof json.shippedTotal === 'number' && json.orderStatus) {
        onChanged?.({ shippedTotal: json.shippedTotal, orderStatus: json.orderStatus });
      }
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div style={volumeCardSoftStyle({ borderRadius: 12, padding: 14, marginBottom: 14 })}>
      <div style={{ fontWeight: 700, color: '#CBD5E1', marginBottom: 8 }}>Отгрузки (склад)</div>
      <div style={{ color: '#94A3B8', fontSize: 13, marginBottom: 10 }}>
        Отгружено: <strong style={{ color: '#10B981' }}>{shipped}</strong> / {orderVolume} {unitLabel}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <input
          type="number"
          placeholder={`Объём, ${unitLabel}`}
          value={volume}
          onChange={(e) => setVolume(e.target.value)}
          style={modalFieldStyle({ width: 110, marginBottom: 0, padding: '8px 10px' })}
        />
        <input
          type="text"
          placeholder="Госномер"
          value={vehicleNumber}
          onChange={(e) => setVehicleNumber(e.target.value)}
          style={modalFieldStyle({ flex: 1, minWidth: 120, marginBottom: 0, padding: '8px 10px' })}
        />
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          style={{
            padding: '8px 14px',
            background: '#10B981',
            border: 'none',
            borderRadius: 10,
            color: '#fff',
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {saving ? '…' : 'Записать'}
        </button>
      </div>
      {rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
          {rows.map((r) => (
            <div
              key={r.id}
              style={{
                fontSize: 12,
                color: '#94A3B8',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flex: 1,
                }}
              >
                {r.vehicle_number || '—'} · {r.volume} {r.unit === 't' ? 'т' : unitLabel}
              </span>
              <span style={{ flexShrink: 0, whiteSpace: 'nowrap', color: '#64748B' }}>
                {r.shipped_at ? new Date(r.shipped_at).toLocaleString('ru-RU') : ''}
              </span>
              <button
                type="button"
                title="Удалить отгрузку"
                disabled={deletingId === r.id}
                onClick={() => void remove(r)}
                style={{
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 28,
                  height: 28,
                  padding: 0,
                  borderRadius: 8,
                  border: '1px solid rgba(248,113,113,0.35)',
                  background: 'rgba(127,29,29,0.35)',
                  color: '#FCA5A5',
                  cursor: deletingId === r.id ? 'wait' : 'pointer',
                  opacity: deletingId === r.id ? 0.6 : 1,
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
