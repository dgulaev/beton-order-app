'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  X,
  FileText,
  MapPin,
  Navigation,
  Clock,
  Upload,
  Trash2,
  Save,
  AlertTriangle,
  Pencil,
} from 'lucide-react';
import FleetTripsPanel from './FleetTripsPanel';
import FleetServicePanel from './FleetServicePanel';
import FleetFuelPanel from './FleetFuelPanel';
import FleetExpensesPanel from './FleetExpensesPanel';
import FleetTripRoutesModal from './FleetTripRoutesModal';
import FleetMap from '../components/FleetMap';
import { buildYandexPlaceUrl } from '@/lib/fleetMapLinks';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { requestScoutSync } from '@/lib/scoutSyncClient';
import { appConfirm } from '../components/appDialog';
import {
  FLEET_DOC_TYPES,
  FUEL_TYPE_OPTIONS,
  LIFECYCLE_STATUSES,
  lifecycleMeta,
  pickFresherTelemetry,
  scoutIsStale,
  type FleetDocument,
  type FleetReminder,
  type FleetTelemetrySnapshot,
  type LifecycleStatus,
} from '@/lib/fleetLifecycle';
import type { Ownership, VehicleKind } from '@/lib/fleetCatalog';

export type FleetDrawerUnit = {
  id: number;
  number: string;
  model: string;
  driver: string;
  phone: string;
  volume: number;
  type: Ownership;
  status: string;
  vehicle_kind?: VehicleKind;
  specs?: Record<string, unknown>;
  lifecycle_status?: LifecycleStatus | string | null;
  odometer_km?: number | null;
  engine_hours?: number | null;
  scout_unit_id?: number | null;
};

type Tab = 'passport' | 'trips' | 'service' | 'fuel' | 'expenses' | 'documents' | 'telemetry';

interface Props {
  unit: FleetDrawerUnit | null;
  telemetry?: FleetTelemetrySnapshot | null;
  onClose: () => void;
  onUpdated: () => void;
  onDeleted: () => void;
  onEdit?: () => void;
  canMutate: boolean;
}

const TAB_LABELS: Record<Tab, string> = {
  passport: 'Паспорт',
  telemetry: 'Телематика',
  trips: 'Рейсы',
  service: 'Сервис',
  fuel: 'Топливо',
  expenses: 'Расходы',
  documents: 'Документы',
};

function formatDt(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr.slice(0, 10));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - today.getTime()) / 86_400_000);
}

export default function FleetUnitDrawer({
  unit,
  telemetry,
  onClose,
  onUpdated,
  onDeleted,
  onEdit,
  canMutate,
}: Props) {
  const [tab, setTab] = useState<Tab>('passport');
  const [saving, setSaving] = useState(false);
  const [documents, setDocuments] = useState<(FleetDocument & { url?: string })[]>([]);
  const [reminders, setReminders] = useState<FleetReminder[]>([]);
  const [docLoading, setDocLoading] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [lifecycle, setLifecycle] = useState<LifecycleStatus>('active');
  const [odometer, setOdometer] = useState('');
  const [engineHours, setEngineHours] = useState('');
  const [vin, setVin] = useState('');
  const [year, setYear] = useState('');
  const [fuelType, setFuelType] = useState('');
  const [tankVolume, setTankVolume] = useState('');
  const [fuelNorm, setFuelNorm] = useState('');
  const [scoutUnitId, setScoutUnitId] = useState('');
  const [docType, setDocType] = useState('sts');
  const [docExpires, setDocExpires] = useState('');
  const [localTelemetry, setLocalTelemetry] = useState<FleetTelemetrySnapshot | null>(null);
  const [telemetryLoading, setTelemetryLoading] = useState(false);
  const [syncingGps, setSyncingGps] = useState(false);
  const [trackDay, setTrackDay] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  });
  const [routesModalOpen, setRoutesModalOpen] = useState(false);

  const activeTelemetry = pickFresherTelemetry(localTelemetry, telemetry ?? null);

  // Broadcast/prop не должен «глушиться» локальным fetch — берём более свежий
  useEffect(() => {
    if (!telemetry) return;
    setLocalTelemetry((prev) => pickFresherTelemetry(prev, telemetry));
  }, [telemetry]);

  const fetchTelemetryForUnit = useCallback(async () => {
    if (!unit) return;
    setTelemetryLoading(true);
    try {
      const res = await fetch(`/api/adminCifra/fleet/telemetry?mixer_id=${unit.id}`, {
        headers: adminCifraAuthHeaders(),
      });
      const data = await res.json();
      if (data.success) {
        setLocalTelemetry((prev) => pickFresherTelemetry(prev, data.telemetry ?? null));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setTelemetryLoading(false);
    }
  }, [unit]);

  const refreshScoutGps = useCallback(async () => {
    if (!unit || !canMutate) return;
    setSyncingGps(true);
    try {
      const result = await requestScoutSync();
      if (!result.ok) {
        alert(result.error || 'Не удалось обновить GPS');
        return;
      }
      await fetchTelemetryForUnit();
      onUpdated();
    } catch {
      alert('Не удалось обновить GPS');
    } finally {
      setSyncingGps(false);
    }
  }, [unit, canMutate, fetchTelemetryForUnit, onUpdated]);

  const resetForm = useCallback(() => {
    if (!unit) return;
    setLifecycle((unit.lifecycle_status as LifecycleStatus) || 'active');
    setOdometer(unit.odometer_km != null ? String(unit.odometer_km) : '');
    setEngineHours(unit.engine_hours != null ? String(unit.engine_hours) : '');
    setVin(String(unit.specs?.vin ?? ''));
    setYear(String(unit.specs?.year ?? ''));
    setFuelType(String(unit.specs?.fuel_type ?? ''));
    setTankVolume(String(unit.specs?.tank_volume_l ?? ''));
    setFuelNorm(String(unit.specs?.fuel_norm_l_per_100km ?? ''));
    setScoutUnitId(unit.scout_unit_id != null ? String(unit.scout_unit_id) : '');
  }, [unit]);

  useEffect(() => {
    resetForm();
    setTab('passport');
    setLocalTelemetry(null);
    setRoutesModalOpen(false);
  }, [unit, resetForm]);

  const loadDocuments = useCallback(async () => {
    if (!unit) return;
    setDocLoading(true);
    try {
      const res = await fetch(`/api/adminCifra/fleet/documents?mixer_id=${unit.id}`, {
        headers: adminCifraAuthHeaders(),
      });
      const data = await res.json();
      if (data.success) setDocuments(data.documents ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setDocLoading(false);
    }
  }, [unit]);

  const loadReminders = useCallback(async () => {
    if (!unit) return;
    try {
      const res = await fetch(
        `/api/adminCifra/fleet/reminders?mixer_id=${unit.id}&status=pending`,
        { headers: adminCifraAuthHeaders() },
      );
      const data = await res.json();
      if (data.success) setReminders(data.reminders ?? []);
    } catch (e) {
      console.error(e);
    }
  }, [unit]);

  useEffect(() => {
    if (!unit) return;
    if (tab === 'documents') {
      void loadDocuments();
      void loadReminders();
    }
    if (tab === 'telemetry') {
      void fetchTelemetryForUnit();
    }
  }, [unit, tab, loadDocuments, loadReminders, fetchTelemetryForUnit]);

  const savePassport = async () => {
    if (!unit || !canMutate) return;
    let scoutId: number | null = null;
    if (scoutUnitId.trim()) {
      const n = Number(scoutUnitId.trim());
      if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
        alert('UnitId СКАУТ — целое положительное число');
        return;
      }
      scoutId = n;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/adminCifra/mixers', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          id: unit.id,
          lifecycle_status: lifecycle,
          odometer_km: odometer === '' ? null : Number(odometer),
          engine_hours: engineHours === '' ? null : Number(engineHours),
          scout_unit_id: scoutId,
          specs: {
            vin: vin || undefined,
            year: year || undefined,
            fuel_type: fuelType || undefined,
            tank_volume_l: tankVolume === '' ? undefined : Number(tankVolume),
            fuel_norm_l_per_100km: fuelNorm === '' ? null : Number(fuelNorm),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Ошибка сохранения');
        return;
      }
      onUpdated();
      if (scoutUnitId.trim()) {
        await refreshScoutGps();
      }
    } catch {
      alert('Ошибка соединения');
    } finally {
      setSaving(false);
    }
  };

  const uploadDocument = async (file: File) => {
    if (!unit || !canMutate) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('mixer_id', String(unit.id));
      form.append('doc_type', docType);
      form.append('file', file);
      if (docExpires) form.append('expires_at', docExpires);
      const res = await fetch('/api/adminCifra/fleet/documents', {
        method: 'POST',
        headers: adminCifraAuthHeaders(),
        body: form,
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Ошибка загрузки');
        return;
      }
      setDocExpires('');
      await loadDocuments();
      onUpdated();
    } catch {
      alert('Ошибка соединения');
    } finally {
      setUploading(false);
    }
  };

  const deleteDocument = async (doc: FleetDocument) => {
    if (!canMutate) return;
    if (!(await appConfirm('Удалить документ?', { variant: 'danger', okLabel: 'Удалить' }))) return;
    const res = await fetch(`/api/adminCifra/fleet/documents?id=${doc.id}`, {
      method: 'DELETE',
      headers: adminCifraAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Ошибка');
      return;
    }
    await loadDocuments();
  };

  const deleteUnit = async () => {
    if (!unit || !canMutate) return;
    if (
      !(await appConfirm(`Удалить «${unit.number}» из справочника?`, {
        variant: 'danger',
        okLabel: 'Удалить',
        title: 'Удаление техники',
      }))
    ) {
      return;
    }
    const res = await fetch(`/api/adminCifra/mixers?id=${unit.id}`, {
      method: 'DELETE',
      headers: adminCifraAuthHeaders(),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Ошибка удаления');
      return;
    }
    onDeleted();
    onClose();
  };

  if (!unit) return null;

  const lc = lifecycleMeta(lifecycle);
  const stale = activeTelemetry ? scoutIsStale(activeTelemetry.last_message_at) : false;
  const mapsUrl =
    activeTelemetry?.lat != null && activeTelemetry?.lon != null
      ? buildYandexPlaceUrl(
          activeTelemetry.lat,
          activeTelemetry.lon,
          unit.number,
          16,
        )
      : null;

  const telemetryMarker =
    activeTelemetry?.lat != null && activeTelemetry?.lon != null
      ? [
          {
            id: unit.id,
            lat: activeTelemetry.lat,
            lon: activeTelemetry.lon,
            label: unit.number,
            subtitle: [unit.model, unit.driver].filter(Boolean).join(' · ') || undefined,
            isOnline: activeTelemetry.is_online,
            speedKmh: activeTelemetry.speed_kmh,
            address: activeTelemetry.address,
            lastMessageAt: activeTelemetry.last_message_at,
            vehicleKind: unit.vehicle_kind || 'mixer',
          },
        ]
      : [];

  const fieldStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid #334155',
    background: '#0F172A',
    color: '#E2E8F0',
    fontSize: 14,
    boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    color: '#64748B',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    marginBottom: 6,
  };

  return (
    <>
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(0,0,0,0.45)' }}
        onClick={onClose}
      />
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 901,
          width: 'min(560px, 100vw)',
          background: '#0F172A',
          borderLeft: '1px solid #1E2937',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
        }}
      >
        <div
          style={{
            padding: '20px 20px 12px',
            borderBottom: '1px solid #1E2937',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ color: '#fff', fontSize: 20, fontWeight: 700 }}>{unit.number}</div>
              <div style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>
                {unit.model || '—'}
                {unit.driver ? ` · ${unit.driver}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <span
                  style={{
                    padding: '3px 10px',
                    borderRadius: 9999,
                    fontSize: 11,
                    fontWeight: 600,
                    color: lc.color,
                    background: lc.bg,
                  }}
                >
                  {lc.label}
                </span>
                <span
                  style={{
                    padding: '3px 10px',
                    borderRadius: 9999,
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#4ADE80',
                    background: 'rgba(74,222,128,0.15)',
                  }}
                >
                  Свой
                </span>
                {activeTelemetry && (
                  <span
                    style={{
                      padding: '3px 10px',
                      borderRadius: 9999,
                      fontSize: 11,
                      fontWeight: 600,
                      color: activeTelemetry.is_online ? '#4ADE80' : stale ? '#F87171' : '#94A3B8',
                      background: activeTelemetry.is_online
                        ? 'rgba(74,222,128,0.15)'
                        : stale
                          ? 'rgba(248,113,113,0.15)'
                          : 'rgba(148,163,184,0.15)',
                    }}
                  >
                    {activeTelemetry.is_online ? '● Online' : stale ? '● Offline >24ч' : '● Offline'}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{ background: 'transparent', border: 'none', color: '#64748B', cursor: 'pointer' }}
            >
              <X size={20} />
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
            {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 9999,
                  border: 'none',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: tab === t ? '#4ADE80' : '#1E2937',
                  color: tab === t ? '#0F172A' : '#94A3B8',
                }}
              >
                {TAB_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 24px' }}>
          {tab === 'passport' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={labelStyle}>Статус эксплуатации</label>
                <select
                  value={lifecycle}
                  disabled={!canMutate}
                  onChange={(e) => setLifecycle(e.target.value as LifecycleStatus)}
                  style={fieldStyle}
                >
                  {LIFECYCLE_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Одометр, км</label>
                  <input
                    type="number"
                    value={odometer}
                    disabled={!canMutate}
                    onChange={(e) => setOdometer(e.target.value)}
                    style={fieldStyle}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Моточасы</label>
                  <input
                    type="number"
                    value={engineHours}
                    disabled={!canMutate}
                    onChange={(e) => setEngineHours(e.target.value)}
                    style={fieldStyle}
                  />
                </div>
              </div>
              <div>
                <label style={labelStyle}>VIN</label>
                <input value={vin} disabled={!canMutate} onChange={(e) => setVin(e.target.value)} style={fieldStyle} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Год выпуска</label>
                  <input value={year} disabled={!canMutate} onChange={(e) => setYear(e.target.value)} style={fieldStyle} />
                </div>
                <div>
                  <label style={labelStyle}>Объём бака, л</label>
                  <input
                    type="number"
                    value={tankVolume}
                    disabled={!canMutate}
                    onChange={(e) => setTankVolume(e.target.value)}
                    style={fieldStyle}
                  />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>Топливо</label>
                  <select
                    value={fuelType}
                    disabled={!canMutate}
                    onChange={(e) => setFuelType(e.target.value)}
                    style={fieldStyle}
                  >
                    <option value="">—</option>
                    {FUEL_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>Норма, л/100 км</label>
                  <input
                    type="number"
                    value={fuelNorm}
                    disabled={!canMutate}
                    onChange={(e) => setFuelNorm(e.target.value)}
                    style={fieldStyle}
                    placeholder="напр. 35"
                  />
                </div>
              </div>
              <div>
                <label style={labelStyle}>СКАУТ UnitId</label>
                <input
                  value={scoutUnitId}
                  disabled={!canMutate}
                  onChange={(e) => setScoutUnitId(e.target.value)}
                  style={fieldStyle}
                  placeholder="Автопривязка при sync"
                />
              </div>
              {canMutate && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void savePassport()}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '10px 16px',
                    borderRadius: 10,
                    border: 'none',
                    background: '#10B981',
                    color: '#fff',
                    fontWeight: 700,
                    cursor: saving ? 'wait' : 'pointer',
                  }}
                >
                  <Save size={16} />
                  {saving ? 'Сохранение…' : 'Сохранить паспорт'}
                </button>
              )}
            </div>
          )}

          {tab === 'trips' && <FleetTripsPanel unitNumber={unit.number} />}

          {tab === 'service' && (
            <FleetServicePanel
              mixerId={unit.id}
              odometerKm={odometer === '' ? unit.odometer_km : Number(odometer)}
              engineHours={engineHours === '' ? unit.engine_hours : Number(engineHours)}
              canMutate={canMutate}
              onLifecycleMaybeChanged={onUpdated}
            />
          )}

          {tab === 'fuel' && (
            <FleetFuelPanel
              mixerId={unit.id}
              odometerKm={odometer === '' ? unit.odometer_km : Number(odometer)}
              canMutate={canMutate}
              onUpdated={onUpdated}
            />
          )}

          {tab === 'expenses' && (
            <FleetExpensesPanel mixerId={unit.id} canMutate={canMutate} />
          )}

          {tab === 'documents' && (
            <div>
              {reminders.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  {reminders.map((r) => (
                    <div
                      key={r.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '10px 12px',
                        borderRadius: 10,
                        background: 'rgba(250,204,21,0.08)',
                        border: '1px solid rgba(250,204,21,0.2)',
                        color: '#FDE68A',
                        fontSize: 13,
                        marginBottom: 8,
                      }}
                    >
                      <AlertTriangle size={14} />
                      {r.title}
                      {r.due_date ? ` · до ${r.due_date.slice(0, 10)}` : ''}
                    </div>
                  ))}
                </div>
              )}

              {canMutate && (
                <div
                  style={{
                    padding: 14,
                    borderRadius: 12,
                    background: '#1E2937',
                    marginBottom: 16,
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                    <select value={docType} onChange={(e) => setDocType(e.target.value)} style={fieldStyle}>
                      {FLEET_DOC_TYPES.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="date"
                      value={docExpires}
                      onChange={(e) => setDocExpires(e.target.value)}
                      style={fieldStyle}
                      title="Срок действия"
                    />
                  </div>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      padding: '10px',
                      borderRadius: 10,
                      border: '1px dashed #475569',
                      color: '#94A3B8',
                      cursor: uploading ? 'wait' : 'pointer',
                    }}
                  >
                    <Upload size={16} />
                    {uploading ? 'Загрузка…' : 'Загрузить PDF или фото'}
                    <input
                      type="file"
                      accept=".pdf,image/jpeg,image/png,image/webp"
                      hidden
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadDocument(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              )}

              {docLoading ? (
                <div style={{ color: '#64748B', textAlign: 'center', padding: 24 }}>Загрузка…</div>
              ) : documents.length === 0 ? (
                <div style={{ color: '#64748B', textAlign: 'center', padding: 24 }}>Документов пока нет</div>
              ) : (
                documents.map((doc) => {
                  const days = daysUntil(doc.expires_at);
                  const expiring = days != null && days >= 0 && days <= 14;
                  return (
                    <div
                      key={doc.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        padding: '12px 14px',
                        borderRadius: 12,
                        background: '#1E2937',
                        marginBottom: 8,
                      }}
                    >
                      <FileText size={18} color="#64748B" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ color: '#E2E8F0', fontSize: 14, fontWeight: 600 }}>
                          {FLEET_DOC_TYPES.find((d) => d.value === doc.doc_type)?.label ?? doc.doc_type}
                          {doc.title ? ` — ${doc.title}` : ''}
                        </div>
                        <div style={{ color: '#64748B', fontSize: 12 }}>{doc.file_name}</div>
                        {doc.expires_at && (
                          <div style={{ color: expiring ? '#FBBF24' : '#64748B', fontSize: 11, marginTop: 2 }}>
                            до {doc.expires_at.slice(0, 10)}
                            {expiring ? ` (${days} дн.)` : ''}
                          </div>
                        )}
                      </div>
                      {doc.url && (
                        <a
                          href={doc.url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#4ADE80', fontSize: 12, flexShrink: 0 }}
                        >
                          Открыть
                        </a>
                      )}
                      {canMutate && (
                        <button
                          type="button"
                          onClick={() => void deleteDocument(doc)}
                          style={{ background: 'none', border: 'none', color: '#F87171', cursor: 'pointer' }}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {tab === 'telemetry' && (
            <div>
              {canMutate && (
                <button
                  type="button"
                  disabled={syncingGps}
                  onClick={() => void refreshScoutGps()}
                  style={{
                    marginBottom: 14,
                    padding: '8px 14px',
                    borderRadius: 10,
                    border: '1px solid rgba(74,222,128,0.35)',
                    background: 'rgba(74,222,128,0.1)',
                    color: '#4ADE80',
                    fontWeight: 600,
                    fontSize: 13,
                    cursor: syncingGps ? 'wait' : 'pointer',
                  }}
                >
                  {syncingGps ? 'Обновление…' : '↻ Обновить GPS из СКАУТ'}
                </button>
              )}

              {/* Маршруты рейсов за день */}
              <div
                style={{
                  marginBottom: 14,
                  padding: 12,
                  borderRadius: 12,
                  background: '#1E2937',
                  border: '1px solid #334155',
                }}
              >
                <div style={{ fontWeight: 700, color: '#E2E8F0', fontSize: 13, marginBottom: 8 }}>
                  Маршруты рейсов
                </div>
                <div style={{ color: '#64748B', fontSize: 12, marginBottom: 10 }}>
                  От завода (Орловский тупик) до адресов заявок — каждый рейс отдельной линией
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    type="date"
                    value={trackDay}
                    onChange={(e) => setTrackDay(e.target.value)}
                    style={{
                      ...fieldStyle,
                      padding: '8px 10px',
                      width: 'auto',
                      flex: '1 1 140px',
                    }}
                  />
                  <button
                    type="button"
                    disabled={!unit}
                    onClick={() => setRoutesModalOpen(true)}
                    style={{
                      padding: '8px 14px',
                      borderRadius: 10,
                      border: '1px solid rgba(56,189,248,0.4)',
                      background: 'rgba(56,189,248,0.12)',
                      color: '#38BDF8',
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Открыть на карте
                  </button>
                </div>
              </div>

              {telemetryLoading ? (
                <div style={{ color: '#64748B', textAlign: 'center', padding: 32 }}>Загрузка…</div>
              ) : !activeTelemetry ? (
                <div style={{ color: '#64748B', textAlign: 'center', padding: 32 }}>
                  <Navigation size={32} style={{ opacity: 0.4, marginBottom: 12 }} />
                  <div>Нет данных телематики</div>
                  <div style={{ fontSize: 12, marginTop: 8 }}>
                    Укажите UnitId в паспорте и нажмите «Сохранить» — GPS подтянется автоматически
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {telemetryMarker.length > 0 && (
                    <FleetMap
                      markers={telemetryMarker}
                      highlightId={unit?.id}
                      markerTooltips={false}
                      height={220}
                      externalHref={mapsUrl}
                      externalLabel="Яндекс.Карты"
                      emptyMessage="Нет координат"
                    />
                  )}
                  {activeTelemetry && (
                    <>
                      <div
                        style={{
                          padding: 14,
                          borderRadius: 12,
                          background: activeTelemetry.is_online
                            ? 'rgba(74,222,128,0.08)'
                            : 'rgba(248,113,113,0.08)',
                          border: `1px solid ${
                            activeTelemetry.is_online
                              ? 'rgba(74,222,128,0.25)'
                              : 'rgba(248,113,113,0.25)'
                          }`,
                        }}
                      >
                        <div
                          style={{
                            fontWeight: 700,
                            color: activeTelemetry.is_online ? '#4ADE80' : '#F87171',
                          }}
                        >
                          {activeTelemetry.is_online
                            ? 'На связи'
                            : stale
                              ? 'Долго offline'
                              : 'Offline'}
                        </div>
                        <div style={{ color: '#94A3B8', fontSize: 12, marginTop: 4 }}>
                          <Clock size={12} style={{ display: 'inline', verticalAlign: 'middle' }} />{' '}
                          {formatDt(activeTelemetry.last_message_at)}
                        </div>
                      </div>
                      {activeTelemetry.address && (
                        <div style={{ display: 'flex', gap: 8, color: '#CBD5E1', fontSize: 14 }}>
                          <MapPin size={16} color="#64748B" style={{ flexShrink: 0, marginTop: 2 }} />
                          {activeTelemetry.address}
                        </div>
                      )}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div style={{ background: '#1E2937', borderRadius: 10, padding: 12 }}>
                          <div style={{ color: '#64748B', fontSize: 11 }}>Скорость</div>
                          <div style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>
                            {activeTelemetry.speed_kmh != null
                              ? `${Math.round(activeTelemetry.speed_kmh)} км/ч`
                              : '—'}
                          </div>
                        </div>
                        <div style={{ background: '#1E2937', borderRadius: 10, padding: 12 }}>
                          <div style={{ color: '#64748B', fontSize: 11 }}>UnitId</div>
                          <div style={{ color: '#fff', fontSize: 18, fontWeight: 700 }}>
                            {activeTelemetry.scout_unit_id ?? '—'}
                          </div>
                        </div>
                      </div>
                      {activeTelemetry.lat != null && activeTelemetry.lon != null && (
                        <div
                          style={{
                            background: '#1E2937',
                            borderRadius: 10,
                            padding: 12,
                            fontSize: 13,
                            color: '#94A3B8',
                          }}
                        >
                          {activeTelemetry.lat.toFixed(5)}, {activeTelemetry.lon.toFixed(5)}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {(onEdit || canMutate) && (
          <div style={{ padding: '12px 20px 20px', borderTop: '1px solid #1E2937', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '10px',
                  borderRadius: 10,
                  border: 'none',
                  background: '#334155',
                  color: '#E2E8F0',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Pencil size={16} />
                Редактировать
              </button>
            )}
            {canMutate && (
              <button
                type="button"
                onClick={() => void deleteUnit()}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '10px',
                  borderRadius: 10,
                  border: '1px solid rgba(248,113,113,0.35)',
                  background: 'transparent',
                  color: '#F87171',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Trash2 size={16} />
                Удалить единицу техники
              </button>
            )}
          </div>
        )}
      </div>

      <FleetTripRoutesModal
        open={routesModalOpen}
        onClose={() => setRoutesModalOpen(false)}
        mixerId={unit.id}
        mixerNumber={unit.number}
        day={trackDay}
        onDayChange={setTrackDay}
        liveMarker={telemetryMarker[0] ?? null}
      />
    </>
  );
}
