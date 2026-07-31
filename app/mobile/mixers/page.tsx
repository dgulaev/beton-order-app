'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Phone, Plus, X, Save, Truck, DollarSign, Trash2, RotateCcw, MapPin, ExternalLink, Link2, Unlink } from 'lucide-react';
import Link from 'next/link';
import MobileExitButton from '../components/MobileExitButton';
import { useUserRole } from '../../providers/UserRoleProvider';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import ModalActionButton from '@/app/adminCifra/components/ModalActionButton';
import { appConfirm } from '@/app/adminCifra/components/appDialog';
import { DEFAULT_DELIVERY_SETTINGS, type DeliverySettings } from '@/lib/deliveryPricing';
import { OWN_UNLOAD_ALLOWANCE_MIN } from '@/lib/mixerConfig';
import { useRealtimeOrderMixers } from '@/hooks/useRealtimeOrders';
import { useWakeRefresh } from '@/hooks/useWakeReload';
import { CARD_BORDER, volumeCardSoftStyle, volumeCardStyle, volumeModalStyle } from '@/app/adminCifra/cardStyles';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import {
  VEHICLE_KINDS,
  TRAILER_KINDS,
  SPECIAL_SUBTYPE_OPTIONS,
  applyModelTemplate,
  formatSpecsChips,
  isTrailerKind,
  isVehicleKind,
  formatRub,
  modelTemplatesForKind,
  specialListMetric,
  specialShowsVolumeField,
  specialSubtypeLabel,
  syncVolumeIntoSpecs,
  vehicleKindMeta,
  vehicleRequiresDriver,
  visibleSpecFields,
  type SpecChip,
  type VehicleKind,
} from '@/lib/fleetCatalog';
import {
  sanitizeFleetSpecs,
  specsAfterSpecialSubtypeChange,
  tariffFieldsForUnit,
  unitHasFleetTariffs,
  unitShiftOrTripTotal,
} from '@/lib/fleetTariffs';

function SpecChipsRow({ chips }: { chips: SpecChip[] }) {
  if (!chips.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
      {chips.map((c, i) => (
        <span
          key={`${c.text}-${i}`}
          style={{
            display: 'inline-flex',
            padding: '1px 7px',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: c.tone === 'accent' ? 650 : 500,
            whiteSpace: 'nowrap',
            background: c.tone === 'accent' ? 'rgba(96,165,250,0.14)' : 'rgba(148,163,184,0.10)',
            color: c.tone === 'accent' ? '#93C5FD' : '#94A3B8',
            border:
              c.tone === 'accent'
                ? '1px solid rgba(96,165,250,0.28)'
                : '1px solid rgba(148,163,184,0.14)',
          }}
        >
          {c.text}
        </span>
      ))}
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface FleetUnit {
  id: number;
  number: string;
  model: string;
  driver: string;
  phone: string;
  volume: number;
  type: 'own' | 'rented';
  status: string;
  unload_allowance_min?: number | null;
  vehicle_kind?: VehicleKind | string | null;
  specs?: Record<string, any> | null;
}

type CoupleInfo = {
  id: number;
  couple_id?: number;
  tractor_id: number;
  trailer_id: number;
  label: string;
};

type FilterType = 'all' | 'own' | 'rented';
type PageTab = VehicleKind | 'tariffs';
type FormData = {
  number: string;
  model: string;
  driver: string;
  phone: string;
  volume: number;
  type: 'own' | 'rented';
  unload_allowance_min: number | '';
  vehicle_kind: VehicleKind;
  specs: Record<string, any>;
};

function emptyForm(kind: VehicleKind): FormData {
  return {
    number: '',
    model: '',
    driver: '',
    phone: '',
    volume: kind === 'mixer' ? 10 : 0,
    type: 'own',
    unload_allowance_min: 50,
    vehicle_kind: kind,
    specs: kind === 'special' ? { subtype: 'loader' } : {},
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: string): { color: string; bg: string } {
  if (status === 'Загрузка') return { color: '#FACC15', bg: '#FACC1520' };
  if (status === 'В пути') return { color: '#3B82F6', bg: '#3B82F620' };
  if (status === 'На объекте') return { color: '#10B981', bg: '#10B98120' };
  if (status === 'Проблема') return { color: '#EF4444', bg: '#EF444420' };
  return { color: '#64748B', bg: '#334155' };
}

function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '—';
}

function volumeDisplay(unit: FleetUnit, kind: VehicleKind): string {
  if (kind === 'tractor_unit') return '—';
  if (kind === 'special') return specialListMetric(unit.volume, unit.specs);
  const meta = vehicleKindMeta(kind);
  const unitLabel = meta.volumeUnit || '';
  return `${unit.volume}${unitLabel ? ` ${unitLabel}` : ''}`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FilterBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '5px 14px',
        borderRadius: '9999px',
        border: `1px solid ${active ? '#10B981' : '#334155'}`,
        background: 'transparent',
        color: active ? '#10B981' : '#64748B',
        fontWeight: 600,
        fontSize: '13px',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function FieldInput({
  label, placeholder, value, onChange, type = 'text', hint,
}: {
  label: string;
  placeholder?: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  hint?: string;
}) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ color: '#94A3B8', fontSize: '12px', marginBottom: '6px', fontWeight: 600 }}>{label}</div>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={volumeCardSoftStyle({
          width: '100%',
          padding: '14px 16px',
          borderRadius: 12,
          color: '#fff',
          fontSize: '15px',
          colorScheme: 'dark',
        })}
      />
      {hint && <div style={{ color: '#475569', fontSize: '12px', marginTop: '5px' }}>{hint}</div>}
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '12px 0', borderBottom: '1px solid #334155', gap: 12,
    }}>
      <span style={{ color: '#475569', fontSize: '13px', flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#CBD5E1', fontSize: '14px', fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

// ─── Delivery Settings Tab ────────────────────────────────────────────────────

function TariffsTab() {
  const [settings, setSettings] = useState<DeliverySettings>(DEFAULT_DELIVERY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/adminCifra/delivery-settings');
        if (res.ok) {
          const d = await res.json();
          setSettings({
            price_tier_10: Number(d.price_tier_10) || DEFAULT_DELIVERY_SETTINGS.price_tier_10,
            price_tier_12: Number(d.price_tier_12) || DEFAULT_DELIVERY_SETTINGS.price_tier_12,
            price_tier_trip: Number(d.price_tier_trip) || DEFAULT_DELIVERY_SETTINGS.price_tier_trip,
            price_per_m3_over_50: Number(d.price_per_m3_over_50) || DEFAULT_DELIVERY_SETTINGS.price_per_m3_over_50,
            price_per_km: Number(d.price_per_km) || DEFAULT_DELIVERY_SETTINGS.price_per_km,
            road_curvature_coefficient: Number(d.road_curvature_coefficient) || DEFAULT_DELIVERY_SETTINGS.road_curvature_coefficient,
          });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const upd = (field: keyof DeliverySettings) => (v: string) =>
    setSettings((prev) => ({ ...prev, [field]: parseFloat(v) || 0 }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/adminCifra/delivery-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        alert('✅ Тарифы сохранены');
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Ошибка сохранения');
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '60px', color: '#475569' }}>Загрузка тарифов...</div>;
  }

  const inputStyle: React.CSSProperties = volumeCardSoftStyle({
    width: '100%',
    padding: '10px 12px',
    borderRadius: 10,
    color: '#fff',
    fontSize: '15px',
    fontWeight: 600,
    textAlign: 'right',
    colorScheme: 'dark',
  });

  function Row({ label, hint, field, suffix }: { label: string; hint?: string; field: keyof DeliverySettings; suffix: string }) {
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 120px',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 0',
        borderBottom: '1px solid #334155',
      }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: '14px', color: '#E2E8F0' }}>{label}</div>
          {hint && <div style={{ color: '#475569', fontSize: '11px', marginTop: '2px' }}>{hint}</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            type="number"
            min="0"
            step="1"
            value={settings[field]}
            onChange={(e) => upd(field)(e.target.value)}
            style={inputStyle}
          />
          <span style={{ color: '#64748B', fontSize: '12px', whiteSpace: 'nowrap', minWidth: '28px' }}>{suffix}</span>
        </div>
      </div>
    );
  }

  const exampleKm = Math.round(130 * settings.road_curvature_coefficient);
  const exampleCost = Math.round(exampleKm * settings.price_per_km);

  return (
    <div style={{ padding: '0 16px 100px' }}>
      <div style={{ color: '#475569', fontSize: '13px', marginBottom: '16px', lineHeight: 1.5 }}>
        Применяется во всех формах создания заявки. Изменения — только для новых заявок.
      </div>

      <div style={volumeCardStyle({ borderRadius: 16, padding: '16px', marginBottom: '12px' })}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <Truck size={16} color="#10B981" />
          <div style={{ fontWeight: 700, fontSize: '15px', color: '#E2E8F0' }}>В черте Брянска</div>
        </div>
        <div style={{ color: '#475569', fontSize: '12px', marginBottom: '8px' }}>
          Если в адресе указан Брянск или населённый пункт не указан
        </div>
        <Row label="До 10 м³" hint="Один рейс" field="price_tier_10" suffix="₽/рейс" />
        <Row label="От 10 до 12 м³" hint="Вместительный миксер" field="price_tier_12" suffix="₽/рейс" />
        <Row label="От 12 до 50 м³" hint="Кол-во рейсов = ⌈объём ÷ 10⌉" field="price_tier_trip" suffix="₽/рейс" />
        <Row label="Более 50 м³" hint="Тариф за кубометр" field="price_per_m3_over_50" suffix="₽/м³" />
      </div>

      <div style={volumeCardStyle({ borderRadius: 16, padding: '16px', marginBottom: '16px' })}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <MapPin size={16} color="#3B82F6" />
          <div style={{ fontWeight: 700, fontSize: '15px', color: '#E2E8F0' }}>За пределами Брянска</div>
        </div>
        <div style={{ color: '#475569', fontSize: '12px', marginBottom: '8px' }}>
          Если в адресе явно указан другой населённый пункт — считается по км
        </div>
        <Row label="Ставка за км" hint="В одну сторону × кол-во рейсов" field="price_per_km" suffix="₽/км" />
        <Row label="Коэф. дорог" hint="Прямая × коэффициент = реальный путь" field="road_curvature_coefficient" suffix="×" />

        <div style={volumeCardSoftStyle({ marginTop: '12px', borderRadius: 10, padding: '12px', color: '#64748B', fontSize: '12px', lineHeight: 1.5 })}>
          Пример: 130 км по прямой, коэф. {settings.road_curvature_coefficient} → ≈{exampleKm} км.
          Один рейс: {exampleKm} × {settings.price_per_km.toLocaleString('ru-RU')} ₽ = <b style={{ color: '#CBD5E1' }}>{exampleCost.toLocaleString('ru-RU')} ₽</b>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <ModalActionButton
          onClick={save}
          disabled={saving}
          color="#10B981"
          icon={<Save size={18} />}
          label={saving ? 'Сохраняем...' : 'Сохранить'}
          fullWidth
          size="lg"
        />
        {confirmReset ? (
          <button
            type="button"
            onClick={() => { setSettings(DEFAULT_DELIVERY_SETTINGS); setConfirmReset(false); }}
            style={{
              flex: 1, padding: '14px', background: '#EF4444', color: '#fff', border: 'none',
              borderRadius: '12px', fontWeight: 700, fontSize: '14px', cursor: 'pointer',
            }}
          >
            Подтвердить
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              padding: '14px', background: 'transparent', color: '#64748B',
              border: '1px solid #334155', borderRadius: '12px', fontWeight: 600, fontSize: '14px', cursor: 'pointer',
            }}
          >
            <RotateCcw size={14} />
            Сброс
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MobileMixersPage() {
  const { isAdmin, user } = useUserRole();
  const role = (user?.role || '').toLowerCase();
  const canEditFleet = ['admin', 'manager', 'dispatcher', 'operator', 'laborant'].includes(role);
  const canEditCouples = role === 'admin' || role === 'manager' || role === 'dispatcher';

  const [tab, setTab] = useState<PageTab>('mixer');
  const vehicleKind: VehicleKind = tab === 'tariffs' ? 'mixer' : tab;
  const kindMeta = vehicleKindMeta(vehicleKind);
  const needsDriver = vehicleRequiresDriver(vehicleKind);
  const couplesEnabled = vehicleKind === 'tractor_unit' || isTrailerKind(vehicleKind);

  const [units, setUnits] = useState<FleetUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [couples, setCouples] = useState<CoupleInfo[]>([]);
  const [tractors, setTractors] = useState<FleetUnit[]>([]);
  const [trailerPickList, setTrailerPickList] = useState<FleetUnit[]>([]);

  const [sheet, setSheet] = useState<'add' | 'edit' | 'view' | 'couple' | null>(null);
  const [selected, setSelected] = useState<FleetUnit | null>(null);
  const [form, setForm] = useState<FormData>(() => emptyForm('mixer'));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [couplePickId, setCouplePickId] = useState('');
  const [coupleSaving, setCoupleSaving] = useState(false);

  const [activeTrips, setActiveTrips] = useState<any[]>([]);
  const [showTripSheet, setShowTripSheet] = useState(false);

  useBodyScrollLock(!!sheet || showTripSheet);

  const coupleByTrailerId = useMemo(() => {
    const m = new Map<number, CoupleInfo>();
    for (const c of couples) m.set(Number(c.trailer_id), c);
    return m;
  }, [couples]);

  const coupleByTractorId = useMemo(() => {
    const m = new Map<number, CoupleInfo>();
    for (const c of couples) m.set(Number(c.tractor_id), c);
    return m;
  }, [couples]);

  const fetchCouples = useCallback(async () => {
    try {
      const res = await fetch('/api/adminCifra/fleet-couples', {
        headers: adminCifraAuthHeaders(),
      });
      if (!res.ok) { setCouples([]); return; }
      const data = await res.json();
      setCouples(Array.isArray(data.couples) ? data.couples : []);
    } catch {
      setCouples([]);
    }
  }, []);

  const fetchUnits = useCallback(async (kind: VehicleKind) => {
    setLoading(true);
    try {
      const tasks: Promise<Response>[] = [
        fetch(`/api/adminCifra/mixers?kind=${kind}`),
      ];
      if (kind === 'mixer') {
        tasks.push(fetch('/api/adminCifra/active-mixers'));
      }
      const [unitsRes, tripsRes] = await Promise.all(tasks);
      if (unitsRes.ok) {
        const data = await unitsRes.json();
        setUnits(Array.isArray(data) ? data : []);
      } else {
        setUnits([]);
      }
      if (kind === 'mixer' && tripsRes?.ok) {
        setActiveTrips(await tripsRes.json());
      }
      if (kind === 'tractor_unit' || isTrailerKind(kind)) {
        await fetchCouples();
      }
    } catch (e) {
      console.error('Ошибка загрузки техники:', e);
    } finally {
      setLoading(false);
    }
  }, [fetchCouples]);

  useEffect(() => {
    if (tab === 'tariffs') return;
    setFilter('all');
    void fetchUnits(tab);
  }, [tab, fetchUnits]);

  useRealtimeOrderMixers(setActiveTrips, {
    activeOnly: true,
    onReload: () => {
      fetch('/api/adminCifra/active-mixers')
        .then((res) => (res.ok ? res.json() : null))
        .then((trips) => {
          if (Array.isArray(trips)) setActiveTrips(trips);
        })
        .catch(() => {});
    },
  });

  useWakeRefresh(() => {
    if (vehicleKind !== 'mixer') return;
    fetch('/api/adminCifra/active-mixers')
      .then((res) => (res.ok ? res.json() : null))
      .then((trips) => { if (Array.isArray(trips)) setActiveTrips(trips); })
      .catch(() => {});
  });

  const coupleStatusLine = (unit: FleetUnit): string | null => {
    if (vehicleKind === 'tractor_unit') {
      const c = coupleByTractorId.get(unit.id);
      return c ? `Сцеплен: ${c.label}` : 'Свободна';
    }
    if (isTrailerKind(vehicleKind)) {
      const c = coupleByTrailerId.get(unit.id);
      return c ? `Сцеплен: ${c.label}` : 'Без сцепки';
    }
    return null;
  };

  const openAdd = () => {
    setSelected(null);
    setForm(emptyForm(vehicleKind));
    setConfirmDelete(false);
    setSheet('add');
  };

  const openCard = (unit: FleetUnit) => {
    setSelected(unit);
    setConfirmDelete(false);
    if (canEditFleet) {
      const kind = isVehicleKind(unit.vehicle_kind) ? unit.vehicle_kind : vehicleKind;
      setForm({
        number: unit.number || '',
        model: unit.model || '',
        driver: unit.driver || '',
        phone: unit.phone || '',
        volume: Number(unit.volume) || 0,
        type: unit.type === 'rented' ? 'rented' : 'own',
        unload_allowance_min: unit.unload_allowance_min ?? 50,
        vehicle_kind: kind,
        specs: unit.specs && typeof unit.specs === 'object' ? { ...unit.specs } : {},
      });
      setSheet('edit');
    } else {
      setSheet('view');
    }
  };

  const closeSheet = () => {
    setSheet(null);
    setSelected(null);
    setConfirmDelete(false);
    setCouplePickId('');
  };

  const applyModel = (modelName: string) => {
    const applied = applyModelTemplate(form.vehicle_kind, modelName);
    setForm((prev) => ({
      ...prev,
      model: modelName,
      volume: applied?.volume != null ? Number(applied.volume) : prev.volume,
      specs: applied?.specs ? { ...prev.specs, ...applied.specs } : prev.specs,
    }));
  };

  const saveUnit = async () => {
    if (!form.number.trim()) {
      alert('Госномер обязателен');
      return;
    }
    if (needsDriver && !form.driver.trim()) {
      alert('Водитель обязателен');
      return;
    }
    if (needsDriver && !form.phone.trim()) {
      alert('Телефон водителя обязателен — по нему водитель входит в приложение');
      return;
    }
    if (
      form.vehicle_kind === 'mixer' &&
      form.type === 'rented' &&
      (!form.unload_allowance_min || Number(form.unload_allowance_min) <= 0)
    ) {
      alert('Укажите норму разгрузки для наёмного миксера');
      return;
    }
    setSaving(true);
    try {
      const synced = {
        ...form,
        specs: sanitizeFleetSpecs(
          form.vehicle_kind,
          syncVolumeIntoSpecs(form.vehicle_kind, form.volume, form.specs),
        ),
      };
      const payload = sheet === 'edit' && selected ? { ...synced, id: selected.id } : synced;
      const res = await fetch('/api/adminCifra/mixers', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        await fetchUnits(vehicleKind);
        closeSheet();
        if (json.warning) alert(json.warning);
      } else {
        alert(json.error || 'Ошибка при сохранении');
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteUnit = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/adminCifra/mixers?id=${selected.id}`, {
        method: 'DELETE',
        headers: adminCifraAuthHeaders(),
      });
      if (res.ok) {
        await fetchUnits(vehicleKind);
        closeSheet();
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || 'Ошибка удаления');
        setConfirmDelete(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const openCoupleSheet = async (unit: FleetUnit) => {
    setSelected(unit);
    setCouplePickId('');
    if (vehicleKind === 'tractor_unit') {
      const existing = coupleByTractorId.get(unit.id);
      setCouplePickId(existing ? String(existing.trailer_id) : '');
      const lists: FleetUnit[] = [];
      for (const kind of TRAILER_KINDS) {
        const res = await fetch(`/api/adminCifra/mixers?kind=${kind}`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data)) lists.push(...data);
        }
      }
      setTrailerPickList(lists);
      setTractors([]);
    } else {
      const existing = coupleByTrailerId.get(unit.id);
      setCouplePickId(existing ? String(existing.tractor_id) : '');
      const res = await fetch('/api/adminCifra/mixers?kind=tractor_unit');
      if (res.ok) {
        const data = await res.json();
        setTractors(Array.isArray(data) ? data : []);
      } else {
        setTractors([]);
      }
      setTrailerPickList([]);
    }
    setSheet('couple');
  };

  const saveCouple = async () => {
    if (!selected || !couplePickId) {
      alert('Выберите пару для сцепки');
      return;
    }
    const tractor_id = vehicleKind === 'tractor_unit' ? selected.id : Number(couplePickId);
    const trailer_id = vehicleKind === 'tractor_unit' ? Number(couplePickId) : selected.id;

    const existingTractor = coupleByTractorId.get(tractor_id);
    const existingTrailer = coupleByTrailerId.get(trailer_id);
    const conflicts: string[] = [];
    if (existingTractor && Number(existingTractor.trailer_id) !== trailer_id) {
      conflicts.push(`Голова уже сцеплена: ${existingTractor.label}`);
    }
    if (existingTrailer && Number(existingTrailer.tractor_id) !== tractor_id) {
      conflicts.push(`Прицеп уже сцеплен: ${existingTrailer.label}`);
    }
    if (conflicts.length > 0) {
      const ok = await appConfirm(
        `${conflicts.join('\n')}\n\nСтарые сцепки будут разорваны. Продолжить?`,
        { title: 'Перецепка', okLabel: 'Сцепить', cancelLabel: 'Отмена' },
      );
      if (!ok) return;
    }

    setCoupleSaving(true);
    try {
      const res = await fetch('/api/adminCifra/fleet-couples', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ tractor_id, trailer_id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || 'Не удалось сцепить');
        return;
      }
      await fetchCouples();
      closeSheet();
    } finally {
      setCoupleSaving(false);
    }
  };

  const uncoupleUnit = async (unit: FleetUnit) => {
    const asTrailer = isTrailerKind(vehicleKind);
    const c = asTrailer ? coupleByTrailerId.get(unit.id) : coupleByTractorId.get(unit.id);
    if (!c) return;
    if (!(await appConfirm(`Отцепить?\n${c.label}`, {
      title: 'Сцепка',
      okLabel: 'Отцепить',
      cancelLabel: 'Отмена',
    }))) {
      return;
    }
    const qs = asTrailer ? `trailer_id=${unit.id}` : `tractor_id=${unit.id}`;
    const res = await fetch(`/api/adminCifra/fleet-couples?${qs}`, {
      method: 'DELETE',
      headers: adminCifraAuthHeaders(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(json.error || 'Не удалось отцепить');
      return;
    }
    await fetchCouples();
  };

  const filtered = units.filter((m) => filter === 'all' || m.type === filter);

  // ── Активные рейсы (только миксеры) ─────────────────────────────────────────
  const _now = new Date();
  const todayStr = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
  const todayActiveTrips = activeTrips.filter((t: any) => {
    const d = t.deliveryDate || t.delivery_date || '';
    return String(d).slice(0, 10) === todayStr;
  });
  const enrichedTrips = todayActiveTrips.map((trip: any) => {
    const mixer = units.find((m) => m.number === trip.number);
    return { ...trip, driver: mixer?.driver || '', mixerId: mixer?.id };
  });

  const selectStyle: React.CSSProperties = volumeCardSoftStyle({
    width: '100%',
    padding: '14px 16px',
    borderRadius: 12,
    color: '#fff',
    fontSize: '15px',
    colorScheme: 'dark',
  });

  return (
    <div style={{ minHeight: '100vh', paddingBottom: '100px', background: '#0F172A' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Truck size={22} color="#10B981" />
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#E2E8F0' }}>Техника</h1>
        </div>
        <MobileExitButton />
      </div>

      {/* Kind tabs */}
      <div style={{ display: 'flex', gap: '8px', padding: '16px 16px 0', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
        {VEHICLE_KINDS.map((k) => {
          const active = tab === k.key;
          return (
            <button
              key={k.key}
              type="button"
              onClick={() => setTab(k.key)}
              style={{
                padding: '9px 14px',
                borderRadius: '9999px',
                border: `1px solid ${active ? '#10B981' : '#334155'}`,
                background: active ? '#10B98120' : 'transparent',
                color: active ? '#10B981' : '#64748B',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              {k.label}
            </button>
          );
        })}
        {isAdmin && (
          <button
            type="button"
            onClick={() => setTab('tariffs')}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '9px 14px', borderRadius: '9999px',
              border: `1px solid ${tab === 'tariffs' ? '#3B82F6' : '#334155'}`,
              background: tab === 'tariffs' ? '#3B82F620' : 'transparent',
              color: tab === 'tariffs' ? '#3B82F6' : '#64748B',
              fontWeight: 600, fontSize: '13px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}
          >
            <DollarSign size={14} /> Тарифы
          </button>
        )}
      </div>

      {/* ══════════════ TAB: FLEET KIND ══════════════ */}
      {tab !== 'tariffs' && (
        <>
          {/* Виджет рейсов — только миксеры */}
          {vehicleKind === 'mixer' && !loading && enrichedTrips.length > 0 && (() => {
            const allUnique = Array.from(new Map(enrichedTrips.map((t: any) => [t.number, t])).values());
            const countByStatus = (s: string) => allUnique.filter((t: any) => t.status === s).length;
            const totalActive = allUnique.length;
            const ownCount = allUnique.filter((t: any) => {
              const mx = units.find((m) => m.number === (t as any).number);
              return mx?.type === 'own';
            }).length;
            const rentedCount = totalActive - ownCount;
            const statCells = [
              { label: 'В пути', color: '#3B82F6', count: countByStatus('В пути') },
              { label: 'Загрузка', color: '#FACC15', count: countByStatus('Загрузка') },
              { label: 'На объекте', color: '#10B981', count: countByStatus('На объекте') },
              { label: 'Проблема', color: '#EF4444', count: countByStatus('Проблема') },
            ].filter((s) => s.count > 0);

            return (
              <div style={{ padding: '14px 16px 0' }}>
                <button
                  type="button"
                  onClick={() => setShowTripSheet(true)}
                  style={volumeCardSoftStyle({
                    width: '100%',
                    borderRadius: 14,
                    padding: '12px 14px',
                    cursor: 'pointer',
                    textAlign: 'left',
                  })}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div style={{
                        width: '8px', height: '8px', borderRadius: '50%', background: '#10B981',
                        boxShadow: '0 0 6px rgba(16,185,129,0.8)',
                        animation: 'pulse 2s infinite', flexShrink: 0,
                      }} />
                      <span style={{ fontSize: '13px', fontWeight: 700, color: '#E2E8F0' }}>В рейсе сегодня</span>
                      <span style={{
                        padding: '1px 8px', borderRadius: '9999px', fontSize: '12px', fontWeight: 700,
                        background: '#10B98120', color: '#10B981',
                      }}>{totalActive}</span>
                    </div>
                    <span style={{ fontSize: '11px', color: '#64748B' }}>
                      {ownCount > 0 && `${ownCount} св.`}{ownCount > 0 && rentedCount > 0 && ' · '}{rentedCount > 0 && `${rentedCount} наём.`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                    {statCells.map((cell) => (
                      <div key={cell.label} style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        padding: '5px 10px', borderRadius: '8px',
                        background: `${cell.color}12`, border: `1px solid ${cell.color}30`,
                      }}>
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: cell.color, flexShrink: 0 }} />
                        <span style={{ fontSize: '12px', fontWeight: 700, color: cell.color }}>{cell.count}</span>
                        <span style={{ fontSize: '11px', color: '#94A3B8' }}>{cell.label}</span>
                      </div>
                    ))}
                  </div>
                </button>
              </div>
            );
          })()}

          {/* Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '14px 16px' }}>
            <FilterBtn active={filter === 'all'} onClick={() => setFilter('all')} label="Все" />
            <FilterBtn active={filter === 'own'} onClick={() => setFilter('own')} label="Свои" />
            <FilterBtn active={filter === 'rented'} onClick={() => setFilter('rented')} label="Наёмные" />
          </div>

          {/* List */}
          <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {loading && (
              <div style={{ textAlign: 'center', padding: '60px', color: '#475569', fontSize: '14px' }}>
                Загрузка…
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: '60px', color: '#475569', fontSize: '14px' }}>
                {kindMeta.label} не найдены
              </div>
            )}
            {filtered.map((unit) => {
              const isOwn = unit.type === 'own';
              const activeTrip = vehicleKind === 'mixer'
                ? enrichedTrips.find((t: any) => t.number === unit.number)
                : null;
              const tripStatus = activeTrip?.status || unit.status || 'Доступен';
              const sc = statusColor(tripStatus);
              const hasActiveTrip = !!activeTrip;
              const coupleLine = coupleStatusLine(unit);
              const coupled = coupleByTrailerId.has(unit.id) || coupleByTractorId.has(unit.id);
              const specsChips = formatSpecsChips(vehicleKind, unit.specs);
              const tariffTotal = unitShiftOrTripTotal(vehicleKind, unit.specs);

              return (
                <div
                  key={unit.id}
                  style={volumeCardSoftStyle({
                    borderRadius: 14,
                    border: hasActiveTrip
                      ? `1px solid ${sc.color}50`
                      : tariffTotal
                        ? '1px solid rgba(251,191,36,0.35)'
                      : coupled
                        ? '1px solid rgba(74,222,128,0.35)'
                        : CARD_BORDER,
                    overflow: 'hidden',
                    display: 'flex',
                  })}
                >
                  <div style={{
                    width: '4px', flexShrink: 0,
                    background: tariffTotal ? '#FBBF24' : coupled ? '#4ADE80' : sc.color,
                  }} />

                  <div style={{ flex: 1, padding: '11px 12px', minWidth: 0 }}>
                    <button
                      type="button"
                      onClick={() => openCard(unit)}
                      style={{
                        display: 'block', width: '100%', background: 'none', border: 'none',
                        padding: 0, margin: 0, cursor: 'pointer', textAlign: 'left', color: 'inherit',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                          <span style={{ fontSize: '16px', fontWeight: 700, color: '#E2E8F0', whiteSpace: 'nowrap' }}>
                            {unit.number}
                          </span>
                          <span style={{ fontSize: '13px', color: '#CBD5E1', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {unit.model || ''}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                          <span style={{ fontSize: '11px', fontWeight: 600, color: isOwn ? '#10B981' : '#FACC15' }}>
                            {isOwn ? 'свой' : 'наём.'}
                          </span>
                          {vehicleKind !== 'tractor_unit' && !tariffTotal && (
                            <span style={{ fontSize: '15px', fontWeight: 700, color: '#CBD5E1', whiteSpace: 'nowrap' }}>
                              {volumeDisplay(unit, vehicleKind)}
                            </span>
                          )}
                        </div>
                      </div>

                      <SpecChipsRow chips={specsChips} />

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: specsChips.length ? 6 : 0 }}>
                        <span style={{ fontSize: '13px', color: '#94A3B8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {unit.driver || (isTrailerKind(vehicleKind) ? 'без водителя' : '—')}
                        </span>
                        {vehicleKind === 'mixer' && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: sc.color, flexShrink: 0 }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: sc.color, display: 'inline-block' }} />
                            {tripStatus}
                          </span>
                        )}
                      </div>

                      {coupleLine && (
                        <div style={{
                          marginTop: 5,
                          fontSize: 11,
                          color: coupleLine.startsWith('Сцеплен') ? '#4ADE80' : '#64748B',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}>
                          {coupleLine}
                        </div>
                      )}

                      {tariffTotal ? (
                        <div style={{
                          marginTop: 8,
                          padding: '8px 10px',
                          borderRadius: 10,
                          background: 'rgba(251,191,36,0.10)',
                          border: '1px solid rgba(251,191,36,0.25)',
                        }}>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#FBBF24', letterSpacing: '0.05em', marginBottom: 6 }}>
                            {tariffTotal.label.toUpperCase()}
                          </div>
                          {tariffTotal.cash && (
                            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 6, marginBottom: 3 }}>
                              <span style={{ fontSize: 15, fontWeight: 800, color: '#FBBF24' }}>{formatRub(tariffTotal.cash.amount)}</span>
                              <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>нал</span>
                            </div>
                          )}
                          {tariffTotal.noncash && (
                            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 6 }}>
                              <span style={{ fontSize: 15, fontWeight: 800, color: '#FDE68A' }}>{formatRub(tariffTotal.noncash.amount)}</span>
                              <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>безнал</span>
                            </div>
                          )}
                        </div>
                      ) : null}
                    </button>

                    {/* Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {unit.phone && (
                        <a
                          href={`tel:${unit.phone}`}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: '3px',
                            padding: '5px 10px', borderRadius: '9999px',
                            background: '#10B98115', color: '#10B981',
                            fontSize: '11px', fontWeight: 600, textDecoration: 'none',
                          }}
                        >
                          <Phone size={10} /> Звонок
                        </a>
                      )}
                      {vehicleKind === 'mixer' && (
                        <Link
                          href={`/mobile/mixers/driver-view/${unit.id}`}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: '3px',
                            padding: '5px 10px', borderRadius: '9999px',
                            background: '#60A5FA15', color: '#60A5FA',
                            fontSize: '11px', fontWeight: 600, textDecoration: 'none',
                          }}
                        >
                          <ExternalLink size={10} /> Кабинет
                        </Link>
                      )}
                      {canEditCouples && couplesEnabled && (
                        <button
                          type="button"
                          onClick={() => void openCoupleSheet(unit)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: '3px',
                            padding: '5px 10px', borderRadius: '9999px',
                            background: 'rgba(59,130,246,0.15)', color: '#93C5FD',
                            border: '1px solid rgba(59,130,246,0.35)',
                            fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                          }}
                        >
                          <Link2 size={10} /> Сцепка
                        </button>
                      )}
                      {canEditCouples && couplesEnabled && coupled && (
                        <button
                          type="button"
                          onClick={() => void uncoupleUnit(unit)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: '3px',
                            padding: '5px 10px', borderRadius: '9999px',
                            background: 'rgba(248,113,113,0.12)', color: '#F87171',
                            border: '1px solid rgba(248,113,113,0.35)',
                            fontSize: '11px', fontWeight: 600, cursor: 'pointer',
                          }}
                        >
                          <Unlink size={10} /> Отцепить
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* FAB */}
      {canEditFleet && tab !== 'tariffs' && !sheet && (
        <button
          type="button"
          onClick={openAdd}
          style={{
            position: 'fixed',
            bottom: '90px',
            right: '20px',
            zIndex: 9000,
            width: '42px',
            height: '42px',
            borderRadius: '9999px',
            background: 'rgba(16,185,129,0.35)',
            border: '1.5px solid rgba(16,185,129,0.55)',
            backdropFilter: 'blur(6px)',
            boxShadow: '0 2px 12px rgba(16,185,129,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          aria-label={kindMeta.addLabel}
        >
          <Plus size={20} color="#10B981" strokeWidth={2.5} />
        </button>
      )}

      {/* Tariffs */}
      {tab === 'tariffs' && isAdmin && (
        <div style={{ marginTop: '16px' }}>
          <TariffsTab />
        </div>
      )}

      {/* VIEW sheet */}
      {sheet === 'view' && selected && (
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000 }} onClick={closeSheet} />
          <div style={volumeModalStyle({
            position: 'fixed', bottom: '74px', left: 0, right: 0, zIndex: 10001,
            borderRadius: '20px 20px 0 0', maxHeight: 'calc(80vh - 74px)',
            overflow: 'hidden', display: 'flex', flexDirection: 'column',
          })}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0' }}>
              <div style={{ width: '40px', height: '4px', background: '#334155', borderRadius: '9999px' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#E2E8F0' }}>{selected.number}</div>
              <button type="button" onClick={closeSheet} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={20} color="#64748B" />
              </button>
            </div>
            <div style={{ padding: '0 20px 24px', overflowY: 'auto' }}>
              <InfoRow label="Вид" value={kindMeta.singular} />
              {vehicleKind === 'special' && (
                <InfoRow label="Тип техники" value={specialSubtypeLabel(String(selected.specs?.subtype || ''))} />
              )}
              <InfoRow label="Модель" value={selected.model || '—'} />
              <InfoRow label="Водитель" value={selected.driver || '—'} />
              <InfoRow label="Телефон" value={selected.phone || '—'} />
              {vehicleKind !== 'tractor_unit' &&
                (vehicleKind !== 'special' || specialShowsVolumeField(selected.specs?.subtype)) && (
                <InfoRow label={kindMeta.volumeLabel || 'Объём'} value={volumeDisplay(selected, vehicleKind)} />
              )}
              <InfoRow label="Принадлежность" value={selected.type === 'own' ? 'Свой' : 'Наёмный'} />
              {coupleStatusLine(selected) && (
                <InfoRow label="Сцепка" value={coupleStatusLine(selected)!} />
              )}
              {formatSpecsChips(vehicleKind, selected.specs).length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: '#64748B', marginBottom: 4, fontWeight: 600 }}>Параметры</div>
                  <SpecChipsRow chips={formatSpecsChips(vehicleKind, selected.specs)} />
                </div>
              )}
              {(() => {
                const tariff = unitShiftOrTripTotal(vehicleKind, selected.specs);
                if (!tariff) return null;
                const fields = tariffFieldsForUnit(vehicleKind, selected.specs);
                return (
                  <>
                    {fields.map((f) => {
                      const v = selected.specs?.[f.key];
                      if (v === undefined || v === null || v === '') return null;
                      return (
                        <InfoRow
                          key={f.key}
                          label={f.label}
                          value={`${Number(v).toLocaleString('ru-RU')}${f.unit ? ` ${f.unit}` : ''}`}
                        />
                      );
                    })}
                    {tariff.cash && (
                      <InfoRow label={`${tariff.label} · нал`} value={formatRub(tariff.cash.amount)} />
                    )}
                    {tariff.noncash && (
                      <InfoRow label={`${tariff.label} · безнал`} value={formatRub(tariff.noncash.amount)} />
                    )}
                  </>
                );
              })()}
              {vehicleKind === 'mixer' && (
                <InfoRow
                  label="Норма разгрузки"
                  value={selected.type === 'own'
                    ? `${OWN_UNLOAD_ALLOWANCE_MIN} мин (общая)`
                    : `${selected.unload_allowance_min ?? '—'} мин`}
                />
              )}
              {selected.phone && (
                <a
                  href={`tel:${selected.phone}`}
                  style={{
                    marginTop: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                    padding: '14px', background: '#10B981', color: '#fff', borderRadius: '12px',
                    fontWeight: 700, fontSize: '15px', textDecoration: 'none',
                  }}
                >
                  <Phone size={18} /> Позвонить
                </a>
              )}
            </div>
          </div>
        </>
      )}

      {/* ADD / EDIT sheet */}
      {(sheet === 'add' || sheet === 'edit') && (
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000 }} onClick={closeSheet} />
          <div style={volumeModalStyle({
            position: 'fixed', bottom: '74px', left: 0, right: 0, zIndex: 10001,
            borderRadius: '20px 20px 0 0', maxHeight: 'calc(90vh - 74px)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          })}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0', flexShrink: 0 }}>
              <div style={{ width: '40px', height: '4px', background: '#334155', borderRadius: '9999px' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', flexShrink: 0 }}>
              <div style={{ fontSize: '17px', fontWeight: 700, color: '#E2E8F0' }}>
                {sheet === 'add' ? kindMeta.addLabel.replace(/^\+\s*/, '') : `Редактировать — ${selected?.number}`}
              </div>
              <button type="button" onClick={closeSheet} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={20} color="#64748B" />
              </button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1, padding: '0 20px 20px' }}>
              <FieldInput
                label="Госномер *"
                placeholder="Например: А123БВ 32"
                value={form.number}
                onChange={(v) => setForm((p) => ({ ...p, number: v }))}
              />

              {form.vehicle_kind === 'special' && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ color: '#94A3B8', fontSize: '12px', marginBottom: '6px', fontWeight: 600 }}>Тип техники</div>
                  <select
                    value={String(form.specs?.subtype || 'loader')}
                    onChange={(e) => setForm((prev) => ({
                      ...prev,
                      model: '',
                      volume: 0,
                      specs: specsAfterSpecialSubtypeChange(prev.specs, e.target.value),
                    }))}
                    style={selectStyle}
                  >
                    {SPECIAL_SUBTYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div style={{ marginBottom: 16 }}>
                <div style={{ color: '#94A3B8', fontSize: '12px', marginBottom: '6px', fontWeight: 600 }}>Модель</div>
                <select
                  value={modelTemplatesForKind(form.vehicle_kind, form.specs).some((t) => t.model === form.model) ? form.model : ''}
                  onChange={(e) => { if (e.target.value) applyModel(e.target.value); }}
                  style={{ ...selectStyle, marginBottom: 8 }}
                >
                  <option value="">— шаблон —</option>
                  {modelTemplatesForKind(form.vehicle_kind, form.specs).map((t) => (
                    <option key={t.model} value={t.model}>{t.model}</option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Или введите модель вручную"
                  value={form.model}
                  onChange={(e) => {
                    const model = e.target.value;
                    const applied = applyModelTemplate(form.vehicle_kind, model);
                    setForm((prev) => ({
                      ...prev,
                      model,
                      volume: applied?.volume != null ? Number(applied.volume) : prev.volume,
                      specs: applied?.specs ? { ...prev.specs, ...applied.specs } : prev.specs,
                    }));
                  }}
                  style={selectStyle}
                />
                {isTrailerKind(form.vehicle_kind) && (
                  <div style={{ color: '#64748B', fontSize: 12, marginTop: 8, lineHeight: 1.4 }}>
                    {form.vehicle_kind === 'cement_truck'
                      ? '«Бочка (прицеп)» — под сцепку с головой. «Моноблок» — машина целиком.'
                      : '«Тоннар (прицеп)» — полуприцеп под сцепку с головой.'}
                  </div>
                )}
              </div>

              <FieldInput
                label={needsDriver ? 'ФИО водителя *' : 'ФИО водителя'}
                placeholder={needsDriver ? 'Обязательно' : 'Необязательно для прицепа'}
                value={form.driver}
                onChange={(v) => setForm((p) => ({ ...p, driver: v }))}
              />
              <FieldInput
                label={needsDriver ? 'Телефон *' : 'Телефон'}
                placeholder="+7..."
                value={form.phone}
                onChange={(v) => setForm((p) => ({ ...p, phone: v }))}
                type="tel"
                hint={needsDriver ? 'Используется для входа водителя в приложение' : 'Для бочки/тоннара водитель ведёт голова'}
              />

              {form.vehicle_kind !== 'tractor_unit' &&
                (form.vehicle_kind !== 'special' || specialShowsVolumeField(form.specs?.subtype)) && (
                <FieldInput
                  label={`${kindMeta.volumeLabel || 'Объём'}${kindMeta.volumeUnit ? `, ${kindMeta.volumeUnit}` : ''}`}
                  value={form.volume}
                  onChange={(v) => setForm((p) => ({ ...p, volume: Number(v) || 0 }))}
                  type="number"
                />
              )}

              {visibleSpecFields(form.vehicle_kind, form.specs).map((field) => (
                <div key={field.key} style={{ marginBottom: 16 }}>
                  <div style={{ color: '#94A3B8', fontSize: '12px', marginBottom: '6px', fontWeight: 600 }}>
                    {field.label}{field.unit ? `, ${field.unit}` : ''}
                  </div>
                  {field.type === 'select' ? (
                    <select
                      value={String(form.specs[field.key] ?? '')}
                      onChange={(e) => setForm((p) => ({
                        ...p,
                        specs: { ...p.specs, [field.key]: e.target.value },
                      }))}
                      style={selectStyle}
                    >
                      {(field.options || []).map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type === 'number' ? 'number' : 'text'}
                      placeholder={field.placeholder}
                      value={form.specs[field.key] ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (field.type === 'number') {
                          if (raw === '') {
                            setForm((p) => ({ ...p, specs: { ...p.specs, [field.key]: '' } }));
                            return;
                          }
                          const n = Number(raw);
                          if (!Number.isFinite(n)) return;
                          setForm((p) => ({ ...p, specs: { ...p.specs, [field.key]: n } }));
                          return;
                        }
                        setForm((p) => ({ ...p, specs: { ...p.specs, [field.key]: raw } }));
                      }}
                      style={selectStyle}
                    />
                  )}
                </div>
              ))}

              {unitHasFleetTariffs(form.vehicle_kind) && (() => {
                const priceFields = tariffFieldsForUnit(form.vehicle_kind, form.specs);
                const formTariff = unitShiftOrTripTotal(form.vehicle_kind, form.specs);
                return (
                  <div style={volumeCardSoftStyle({
                    borderRadius: 14,
                    padding: '14px',
                    marginBottom: 16,
                    border: '1px solid rgba(251,191,36,0.28)',
                    background: 'linear-gradient(165deg, rgba(251,191,36,0.10) 0%, rgba(15,23,42,0.55) 70%)',
                  })}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: '#FBBF24',
                      letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 12,
                    }}>
                      Тариф
                    </div>
                    {priceFields.map((field) => (
                      <div key={field.key} style={{ marginBottom: 16 }}>
                        <div style={{ color: '#94A3B8', fontSize: '12px', marginBottom: '6px', fontWeight: 600 }}>
                          {field.label}{field.unit ? `, ${field.unit}` : ''}
                        </div>
                        <input
                          type="number"
                          placeholder={field.placeholder}
                          value={form.specs[field.key] ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw === '') {
                              setForm((p) => ({ ...p, specs: { ...p.specs, [field.key]: '' } }));
                              return;
                            }
                            const n = Number(raw);
                            if (!Number.isFinite(n)) return;
                            setForm((p) => ({ ...p, specs: { ...p.specs, [field.key]: n } }));
                          }}
                          style={selectStyle}
                        />
                      </div>
                    ))}
                    <div style={{
                      marginTop: 4, paddingTop: 12,
                      borderTop: '1px solid rgba(148,163,184,0.18)',
                      display: 'flex', flexDirection: 'column', gap: 6,
                    }}>
                      <div style={{ fontSize: 12, color: '#94A3B8', fontWeight: 600 }}>
                        {formTariff?.label || 'Итого'}
                      </div>
                      {formTariff?.cash && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 6 }}>
                          <span style={{ fontSize: 18, fontWeight: 800, color: '#FBBF24' }}>{formatRub(formTariff.cash.amount)}</span>
                          <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 600 }}>нал</span>
                        </div>
                      )}
                      {formTariff?.noncash && (
                        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 6 }}>
                          <span style={{ fontSize: 18, fontWeight: 800, color: '#FDE68A' }}>{formatRub(formTariff.noncash.amount)}</span>
                          <span style={{ fontSize: 12, color: '#94A3B8', fontWeight: 600 }}>безнал</span>
                        </div>
                      )}
                      {!formTariff && (
                        <div style={{ fontSize: 11, color: '#64748B' }}>Заполните нал и/или безнал</div>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div style={{ marginBottom: '16px' }}>
                <div style={{ color: '#94A3B8', fontSize: '12px', marginBottom: '8px', fontWeight: 600 }}>Принадлежность</div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {(['own', 'rented'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, type: t }))}
                      style={
                        form.type === t
                          ? {
                              flex: 1, padding: '12px',
                              background: t === 'own' ? '#10B981' : '#FACC15',
                              border: 'none', borderRadius: 12,
                              color: t === 'rented' ? '#000' : '#fff',
                              fontWeight: 700, fontSize: '14px', cursor: 'pointer',
                            }
                          : volumeCardSoftStyle({
                              flex: 1, padding: '12px', borderRadius: 12, color: '#fff',
                              fontWeight: 700, fontSize: '14px', cursor: 'pointer',
                            })
                      }
                    >
                      {t === 'own' ? 'Свой' : 'Наёмный'}
                    </button>
                  ))}
                </div>
              </div>

              {form.vehicle_kind === 'mixer' && (
                form.type === 'rented' ? (
                  <FieldInput
                    label="Норма разгрузки, мин *"
                    placeholder="Например: 50"
                    value={form.unload_allowance_min}
                    onChange={(v) => setForm((p) => ({ ...p, unload_allowance_min: v === '' ? '' : Number(v) }))}
                    type="number"
                    hint="Время сверх нормы считается простоем водителя"
                  />
                ) : (
                  <div style={volumeCardSoftStyle({ padding: '12px 14px', borderRadius: 10, color: '#475569', fontSize: '13px', marginBottom: '16px' })}>
                    Норма разгрузки для своих — {OWN_UNLOAD_ALLOWANCE_MIN} мин (общая настройка)
                  </div>
                )
              )}

              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <ModalActionButton onClick={closeSheet} color="#94A3B8" icon={<X size={18} />} label="Отмена" fullWidth size="lg" />
                <ModalActionButton
                  onClick={saveUnit}
                  disabled={saving}
                  color="#10B981"
                  icon={<Save size={18} />}
                  label={saving ? 'Сохраняем...' : (sheet === 'add' ? 'Добавить' : 'Сохранить')}
                  fullWidth
                  size="lg"
                />
              </div>

              {sheet === 'edit' && selected && (
                <div style={{ marginTop: '16px' }}>
                  {confirmDelete ? (
                    <div style={volumeCardSoftStyle({ borderRadius: 12, padding: '14px' })}>
                      <div style={{ color: '#EF4444', fontWeight: 600, fontSize: '14px', marginBottom: '10px', textAlign: 'center' }}>
                        Удалить «{selected.number}»?
                      </div>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(false)}
                          style={volumeCardSoftStyle({ flex: 1, padding: '12px', color: '#94A3B8', borderRadius: 10, fontWeight: 600, cursor: 'pointer' })}
                        >
                          Нет
                        </button>
                        <button
                          type="button"
                          onClick={deleteUnit}
                          disabled={saving}
                          style={{ flex: 1, padding: '12px', background: '#EF4444', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 700, cursor: 'pointer' }}
                        >
                          Да, удалить
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(true)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                        padding: '13px', background: 'transparent', color: '#EF4444',
                        border: '1px solid #EF444440', borderRadius: '12px',
                        fontWeight: 600, fontSize: '14px', cursor: 'pointer',
                      }}
                    >
                      <Trash2 size={15} /> Удалить
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* COUPLE sheet */}
      {sheet === 'couple' && selected && (
        <>
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000 }} onClick={closeSheet} />
          <div style={volumeModalStyle({
            position: 'fixed', bottom: '74px', left: 0, right: 0, zIndex: 10001,
            borderRadius: '20px 20px 0 0', maxHeight: 'calc(80vh - 74px)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
          })}>
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0' }}>
              <div style={{ width: '40px', height: '4px', background: '#334155', borderRadius: '9999px' }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px' }}>
              <div style={{ fontSize: '17px', fontWeight: 700, color: '#E2E8F0' }}>
                {vehicleKind === 'tractor_unit' ? 'Сцепить с прицепом' : 'Сцепить с головой'}
              </div>
              <button type="button" onClick={closeSheet} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={20} color="#64748B" />
              </button>
            </div>
            <div style={{ padding: '0 20px 24px', overflowY: 'auto' }}>
              <div style={{ color: '#94A3B8', fontSize: 13, marginBottom: 14 }}>
                {selected.model ? `${selected.model} · ` : ''}{selected.number}
              </div>
              <div style={{ color: '#94A3B8', fontSize: 12, marginBottom: 6, fontWeight: 600 }}>
                {vehicleKind === 'tractor_unit' ? 'Прицеп (бочка / тоннар)' : 'Голова'}
              </div>
              <select
                value={couplePickId}
                onChange={(e) => setCouplePickId(e.target.value)}
                style={{ ...selectStyle, marginBottom: 18 }}
              >
                <option value="">— выберите —</option>
                {vehicleKind === 'tractor_unit'
                  ? trailerPickList.map((t) => {
                      const linked = coupleByTrailerId.get(t.id);
                      const kindLabel = t.vehicle_kind === 'cement_truck' ? 'Бочка' : 'Тоннар';
                      return (
                        <option key={t.id} value={String(t.id)}>
                          {kindLabel} {t.number} · {t.volume} т{linked ? ` · уже: ${linked.label}` : ''}
                        </option>
                      );
                    })
                  : tractors.map((t) => (
                      <option key={t.id} value={String(t.id)}>
                        {t.model || 'Голова'} {t.number}{t.driver ? ` · ${t.driver}` : ''}
                      </option>
                    ))}
              </select>
              <div style={{ display: 'flex', gap: 10 }}>
                <ModalActionButton onClick={closeSheet} color="#94A3B8" icon={<X size={18} />} label="Отмена" fullWidth size="lg" />
                <ModalActionButton
                  onClick={saveCouple}
                  disabled={coupleSaving || !couplePickId}
                  color="#3B82F6"
                  icon={<Link2 size={18} />}
                  label={coupleSaving ? 'Сцепляем…' : 'Сцепить'}
                  fullWidth
                  size="lg"
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Trip sheet */}
      {showTripSheet && vehicleKind === 'mixer' && (() => {
        const allUnique: any[] = Array.from(
          new Map(enrichedTrips.map((t: any) => [t.number, t])).values(),
        );
        const order = ['Проблема', 'Загрузка', 'В пути', 'На объекте'];
        const sorted = [...allUnique].sort((a, b) => {
          const ai = order.indexOf(a.status);
          const bi = order.indexOf(b.status);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        });

        return (
          <>
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000 }} onClick={() => setShowTripSheet(false)} />
            <div style={volumeModalStyle({
              position: 'fixed', bottom: '74px', left: 0, right: 0, zIndex: 10001,
              borderRadius: '20px 20px 0 0', maxHeight: 'calc(85vh - 74px)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            })}>
              <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0', flexShrink: 0 }}>
                <div style={{ width: '40px', height: '4px', background: '#334155', borderRadius: '9999px' }} />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px 10px', flexShrink: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '17px', fontWeight: 700, color: '#E2E8F0' }}>В рейсе сегодня</span>
                  <span style={{
                    padding: '1px 8px', borderRadius: '9999px', fontSize: '12px', fontWeight: 700,
                    background: '#10B98120', color: '#10B981',
                  }}>{sorted.length}</span>
                </div>
                <button type="button" onClick={() => setShowTripSheet(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                  <X size={20} color="#64748B" />
                </button>
              </div>
              <div style={{ overflowY: 'auto', flex: 1, padding: '0 16px 20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {sorted.map((trip: any) => {
                  const sc = statusColor(trip.status);
                  const mx = units.find((m) => m.number === trip.number);
                  const isOwn = mx?.type === 'own';
                  return (
                    <button
                      key={trip.number}
                      type="button"
                      onClick={() => { if (mx) { openCard(mx); setShowTripSheet(false); } }}
                      style={volumeCardSoftStyle({
                        display: 'flex', alignItems: 'center', gap: '12px',
                        padding: '12px 14px', borderRadius: 12,
                        border: `1px solid ${sc.color}40`,
                        cursor: mx ? 'pointer' : 'default', textAlign: 'left', width: '100%',
                      })}
                    >
                      <div style={{
                        width: '36px', height: '36px', borderRadius: '9999px', flexShrink: 0,
                        background: `${sc.color}20`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '13px', fontWeight: 700, color: sc.color,
                      }}>
                        {initials(trip.driver || mx?.driver || '')}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                          <span style={{ fontSize: '15px', fontWeight: 700, color: '#E2E8F0' }}>{trip.number}</span>
                          <span style={{
                            fontSize: '11px', fontWeight: 600, padding: '1px 7px', borderRadius: '9999px',
                            background: isOwn ? '#10B98118' : '#FACC1518',
                            color: isOwn ? '#10B981' : '#FACC15',
                          }}>
                            {isOwn ? 'Свой' : 'Наёмный'}
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#94A3B8' }}>
                          {trip.driver || mx?.driver || '—'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: sc.color }}>{trip.status}</span>
                        {trip.volume > 0 && (
                          <div style={{ fontSize: '11px', color: '#64748B' }}>{trip.volume} м³</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        );
      })()}
    </div>
  );
}
