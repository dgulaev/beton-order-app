'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { volumeCardSoftStyle, volumeCardStyle } from '../cardStyles';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import {
  isVehicleKind,
  specialSubtypeLabel,
  vehicleKindMeta,
  type VehicleKind,
} from '@/lib/fleetCatalog';
import {
  formatRub,
  mergeTariffIntoSpecs,
  pickTariffSpecs,
  tariffFieldsForUnit,
  unitShiftOrTripTotal,
} from '@/lib/fleetTariffs';

type FleetRow = {
  id: number;
  number: string;
  model: string | null;
  driver: string | null;
  phone: string | null;
  type: 'own' | 'rented' | string;
  volume: number | null;
  vehicle_kind: string | null;
  status: string | null;
  unload_allowance_min: number | null;
  specs: Record<string, any> | null;
};

const KIND_ORDER: VehicleKind[] = [
  'dump_truck',
  'tonar',
  'cement_truck',
  'tractor_unit',
  'special',
];

const inputStyle: React.CSSProperties = {
  width: '100%',
  minWidth: 88,
  padding: '8px 10px',
  background: '#25334A',
  border: '1px solid #334155',
  borderRadius: 10,
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  textAlign: 'right',
  boxSizing: 'border-box',
};

export default function FleetTariffsSettingsTab() {
  const [rows, setRows] = useState<FleetRow[]>([]);
  /** Локальные правки тарифов: id → тарифные ключи */
  const [drafts, setDrafts] = useState<Record<number, Record<string, number | ''>>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | 'all' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/adminCifra/mixers?kind=all', {
        headers: adminCifraAuthHeaders(),
      });
      if (!res.ok) throw new Error('Не удалось загрузить парк');
      const data = await res.json();
      const list: FleetRow[] = (Array.isArray(data) ? data : [])
        .filter((u: any) => u.vehicle_kind && u.vehicle_kind !== 'mixer')
        .map((u: any) => ({
          id: Number(u.id),
          number: String(u.number || ''),
          model: u.model ?? null,
          driver: u.driver ?? null,
          phone: u.phone ?? null,
          type: u.type || 'own',
          volume: u.volume != null ? Number(u.volume) : null,
          vehicle_kind: u.vehicle_kind || null,
          status: u.status ?? null,
          unload_allowance_min:
            u.unload_allowance_min != null ? Number(u.unload_allowance_min) : null,
          specs: u.specs && typeof u.specs === 'object' ? u.specs : {},
        }));
      setRows(list);
      const next: Record<number, Record<string, number | ''>> = {};
      for (const u of list) {
        next[u.id] = pickTariffSpecs(u.specs) as Record<string, number | ''>;
      }
      setDrafts(next);
    } catch (e: any) {
      setError(e.message || 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<VehicleKind, FleetRow[]>();
    for (const k of KIND_ORDER) map.set(k, []);
    for (const u of rows) {
      const kind = isVehicleKind(u.vehicle_kind) ? u.vehicle_kind : null;
      if (!kind || kind === 'mixer') continue;
      if (!map.has(kind)) map.set(kind, []);
      map.get(kind)!.push(u);
    }
    return KIND_ORDER.map((k) => ({
      kind: k,
      label: vehicleKindMeta(k).label,
      items: map.get(k) || [],
    })).filter((g) => g.items.length > 0);
  }, [rows]);

  const setField = (id: number, key: string, raw: string) => {
    let next: number | '' = '';
    if (raw !== '') {
      const n = Number(raw);
      if (!Number.isFinite(n)) return; // игнор мусора вроде «1e»
      next = n;
    }
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        ...(prev[id] || {}),
        [key]: next,
      },
    }));
    setOkMsg(null);
  };

  const effectiveSpecs = (u: FleetRow) =>
    mergeTariffIntoSpecs(u.specs, drafts[u.id] || {});

  /** Только tariff_patch — API мержит в актуальные specs в БД, не затирая физику. */
  const saveUnit = async (u: FleetRow) => {
    setSavingId(u.id);
    setError(null);
    setOkMsg(null);
    try {
      const tariff_patch = drafts[u.id] || {};
      const res = await fetch('/api/adminCifra/mixers', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ id: u.id, tariff_patch }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Ошибка сохранения');
      const savedSpecs =
        json.data?.specs && typeof json.data.specs === 'object'
          ? json.data.specs
          : mergeTariffIntoSpecs(u.specs, tariff_patch);
      setRows((prev) =>
        prev.map((r) => (r.id === u.id ? { ...r, specs: savedSpecs } : r)),
      );
      setDrafts((prev) => ({
        ...prev,
        [u.id]: pickTariffSpecs(savedSpecs) as Record<string, number | ''>,
      }));
      setOkMsg(`Сохранено: ${u.number}`);
    } catch (e: any) {
      setError(e.message || 'Ошибка');
    } finally {
      setSavingId(null);
    }
  };

  const saveAll = async () => {
    setSavingId('all');
    setError(null);
    setOkMsg(null);
    let ok = 0;
    let fail = 0;
    try {
      for (const u of rows) {
        try {
          const tariff_patch = drafts[u.id] || {};
          const res = await fetch('/api/adminCifra/mixers', {
            method: 'POST',
            headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ id: u.id, tariff_patch }),
          });
          if (!res.ok) {
            fail += 1;
            continue;
          }
          const json = await res.json().catch(() => ({}));
          const savedSpecs =
            json.data?.specs && typeof json.data.specs === 'object'
              ? json.data.specs
              : mergeTariffIntoSpecs(u.specs, tariff_patch);
          ok += 1;
          setRows((prev) => prev.map((r) => (r.id === u.id ? { ...r, specs: savedSpecs } : r)));
          setDrafts((prev) => ({
            ...prev,
            [u.id]: pickTariffSpecs(savedSpecs) as Record<string, number | ''>,
          }));
        } catch {
          fail += 1;
        }
      }
      setOkMsg(fail ? `Сохранено ${ok}, ошибок ${fail}` : `Сохранено единиц: ${ok}`);
    } finally {
      setSavingId(null);
    }
  };

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: '#64748B' }}>
        <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', marginBottom: 8 }} />
        <div>Загрузка парка…</div>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div style={{ padding: 24, color: '#94A3B8', fontSize: 14, lineHeight: 1.5 }}>
        Нет единиц кроме миксеров. Добавь самосвалы, тоннары, цементовозы, головы или спецтехнику в разделе Техника —
        здесь появятся их тарифы.
      </div>
    );
  }

  return (
    <div>
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
      }}>
        <p style={{ margin: 0, color: '#94A3B8', fontSize: 13, lineHeight: 1.45, maxWidth: 520 }}>
          Централизованное редактирование тарифов уже добавленной техники (те же поля, что в карточке Техники).
          Миксеры здесь не показываются — у них вкладка «Доставка и тарифы».
        </p>
        <button
          type="button"
          onClick={() => void saveAll()}
          disabled={savingId !== null}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 16px',
            borderRadius: 12,
            border: 'none',
            background: '#10B981',
            color: '#fff',
            fontWeight: 700,
            fontSize: 14,
            cursor: savingId !== null ? 'wait' : 'pointer',
            opacity: savingId !== null ? 0.7 : 1,
          }}
        >
          <Save size={16} />
          {savingId === 'all' ? 'Сохраняем…' : 'Сохранить все'}
        </button>
      </div>

      {error && (
        <div style={{
          marginBottom: 12, padding: '10px 14px', borderRadius: 10,
          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)',
          color: '#FCA5A5', fontSize: 13,
        }}>
          {error}
        </div>
      )}
      {okMsg && (
        <div style={{
          marginBottom: 12, padding: '10px 14px', borderRadius: 10,
          background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.35)',
          color: '#6EE7B7', fontSize: 13,
        }}>
          {okMsg}
        </div>
      )}

      {grouped.map((group) => (
        <div key={group.kind} style={{ marginBottom: 20 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: '#E2E8F0', marginBottom: 10,
            letterSpacing: '0.04em',
          }}>
            {group.label}
            <span style={{ color: '#64748B', fontWeight: 500, marginLeft: 8 }}>{group.items.length}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {group.items.map((u) => {
              const kind = (isVehicleKind(u.vehicle_kind) ? u.vehicle_kind : 'special') as VehicleKind;
              const fields = tariffFieldsForUnit(kind, effectiveSpecs(u));
              const total = unitShiftOrTripTotal(kind, effectiveSpecs(u));
              const draft = drafts[u.id] || {};
              const busy = savingId === u.id || savingId === 'all';

              return (
                <div
                  key={u.id}
                  style={volumeCardStyle({
                    borderRadius: 14,
                    padding: '14px 16px',
                    border: total
                      ? '1px solid rgba(251,191,36,0.28)'
                      : undefined,
                  })}
                >
                  <div style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 12,
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    marginBottom: 12,
                  }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 16, fontWeight: 800, color: '#F1F5F9' }}>{u.number}</span>
                        <span style={{
                          fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 9999,
                          background: u.type === 'own' ? '#10B98120' : '#FACC1520',
                          color: u.type === 'own' ? '#10B981' : '#FACC15',
                        }}>
                          {u.type === 'own' ? 'Свой' : 'Наёмный'}
                        </span>
                        {kind === 'special' && (
                          <span style={{ fontSize: 12, color: '#94A3B8' }}>
                            {specialSubtypeLabel(String(u.specs?.subtype || ''))}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: '#94A3B8', marginTop: 4 }}>
                        {u.model || '—'}
                        {u.driver ? ` · ${u.driver}` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#64748B', letterSpacing: '0.05em' }}>
                        {(total?.label || 'Итого').toUpperCase()}
                      </div>
                      {total?.cash && (
                        <div style={{ fontSize: 16, fontWeight: 800, color: '#FBBF24', whiteSpace: 'nowrap' }}>
                          {formatRub(total.cash.amount)}
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', marginLeft: 6 }}>нал</span>
                        </div>
                      )}
                      {total?.noncash && (
                        <div style={{ fontSize: 15, fontWeight: 800, color: '#FDE68A', marginTop: 2, whiteSpace: 'nowrap' }}>
                          {formatRub(total.noncash.amount)}
                          <span style={{ fontSize: 11, fontWeight: 600, color: '#94A3B8', marginLeft: 6 }}>безнал</span>
                        </div>
                      )}
                      {!total && (
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#64748B' }}>—</div>
                      )}
                    </div>
                  </div>

                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                    gap: 10,
                    alignItems: 'end',
                  }}>
                    {fields.map((f) => (
                      <div key={f.key}>
                        <div style={{
                          color: '#94A3B8', fontSize: 11, fontWeight: 600, marginBottom: 5,
                          lineHeight: 1.25, minHeight: 28,
                        }}>
                          {f.label}
                          {f.unit ? ` (${f.unit})` : ''}
                        </div>
                        <input
                          type="number"
                          placeholder={f.placeholder}
                          value={draft[f.key] ?? ''}
                          disabled={busy}
                          onChange={(e) => setField(u.id, f.key, e.target.value)}
                          style={inputStyle}
                        />
                      </div>
                    ))}
                    <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => void saveUnit(u)}
                        disabled={busy}
                        style={volumeCardSoftStyle({
                          width: '100%',
                          padding: '10px 12px',
                          borderRadius: 10,
                          color: '#E2E8F0',
                          fontWeight: 700,
                          fontSize: 13,
                          cursor: busy ? 'wait' : 'pointer',
                          border: '1px solid #475569',
                        })}
                      >
                        {savingId === u.id ? '…' : 'Сохранить'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ color: '#475569', fontSize: 12, marginTop: 8 }}>
        Всего единиц: {rows.length}. Пустые виды скрыты.
      </div>
    </div>
  );
}
