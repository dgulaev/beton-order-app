'use client';

import { useState, useEffect, useCallback } from 'react';
import { Phone, Plus, X, Save, Truck, DollarSign, Trash2, RotateCcw, MapPin } from 'lucide-react';
import MobileExitButton from '../components/MobileExitButton';
import { useUserRole } from '../../providers/UserRoleProvider';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import ModalActionButton from '@/app/adminCifra/components/ModalActionButton';
import { DEFAULT_DELIVERY_SETTINGS, type DeliverySettings } from '@/lib/deliveryPricing';
import { OWN_UNLOAD_ALLOWANCE_MIN } from '@/lib/mixerConfig';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Mixer {
  id: number;
  number: string;
  model: string;
  driver: string;
  phone: string;
  volume: number;
  type: 'own' | 'rented';
  status: string;
  unload_allowance_min?: number | null;
}

type FilterType = 'all' | 'own' | 'rented';
type Tab = 'fleet' | 'tariffs';
type FormData = {
  number: string;
  model: string;
  driver: string;
  phone: string;
  volume: number;
  type: 'own' | 'rented';
  unload_allowance_min: number | '';
};

const EMPTY_FORM: FormData = {
  number: '',
  model: '',
  driver: '',
  phone: '',
  volume: 10,
  type: 'own',
  unload_allowance_min: 50,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: string): { color: string; bg: string } {
  if (status === 'В пути')      return { color: '#3B82F6', bg: '#3B82F620' };
  if (status === 'На объекте')  return { color: '#10B981', bg: '#10B98120' };
  if (status === 'Загрузка')    return { color: '#FACC15', bg: '#FACC1520' };
  if (status === 'Проблема')    return { color: '#EF4444', bg: '#EF444420' };
  return { color: '#64748B', bg: '#1E2937' };
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FilterBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '8px 18px',
        borderRadius: '9999px',
        border: `1px solid ${active ? '#10B981' : '#334155'}`,
        background: active ? '#10B98120' : 'transparent',
        color: active ? '#10B981' : '#64748B',
        fontWeight: 600,
        fontSize: '14px',
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
        onChange={e => onChange(e.target.value)}
        style={{
          width: '100%',
          padding: '14px 16px',
          background: '#25334A',
          border: 'none',
          borderRadius: '12px',
          color: '#fff',
          fontSize: '15px',
          boxSizing: 'border-box',
        }}
      />
      {hint && <div style={{ color: '#475569', fontSize: '12px', marginTop: '5px' }}>{hint}</div>}
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
    setSettings(prev => ({ ...prev, [field]: parseFloat(v) || 0 }));

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

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    background: '#25334A',
    border: '1px solid #334155',
    borderRadius: '10px',
    color: '#fff',
    fontSize: '15px',
    fontWeight: 600,
    textAlign: 'right',
    boxSizing: 'border-box',
  };

  function Row({ label, hint, field, suffix }: { label: string; hint?: string; field: keyof DeliverySettings; suffix: string }) {
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 120px',
        alignItems: 'center',
        gap: '12px',
        padding: '12px 0',
        borderBottom: '1px solid #1E2937',
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
            onChange={e => upd(field)(e.target.value)}
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

      {/* В черте Брянска */}
      <div style={{ background: '#131C2B', borderRadius: '16px', padding: '16px', marginBottom: '12px' }}>
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

      {/* За городом */}
      <div style={{ background: '#131C2B', borderRadius: '16px', padding: '16px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <MapPin size={16} color="#3B82F6" />
          <div style={{ fontWeight: 700, fontSize: '15px', color: '#E2E8F0' }}>За пределами Брянска</div>
        </div>
        <div style={{ color: '#475569', fontSize: '12px', marginBottom: '8px' }}>
          Если в адресе явно указан другой населённый пункт — считается по км
        </div>
        <Row label="Ставка за км" hint="В одну сторону × кол-во рейсов" field="price_per_km" suffix="₽/км" />
        <Row label="Коэф. дорог" hint="Прямая × коэффициент = реальный путь" field="road_curvature_coefficient" suffix="×" />

        <div style={{ marginTop: '12px', background: '#25334A', borderRadius: '10px', padding: '12px', color: '#64748B', fontSize: '12px', lineHeight: 1.5 }}>
          Пример: 130 км по прямой, коэф. {settings.road_curvature_coefficient} → ≈{exampleKm} км.
          Один рейс: {exampleKm} × {settings.price_per_km.toLocaleString('ru-RU')} ₽ = <b style={{ color: '#CBD5E1' }}>{exampleCost.toLocaleString('ru-RU')} ₽</b>
        </div>
      </div>

      {/* Кнопки */}
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
            onClick={() => { setSettings(DEFAULT_DELIVERY_SETTINGS); setConfirmReset(false); }}
            style={{
              flex: 1,
              padding: '14px',
              background: '#EF4444',
              color: '#fff',
              border: 'none',
              borderRadius: '12px',
              fontWeight: 700,
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            Подтвердить
          </button>
        ) : (
          <button
            onClick={() => setConfirmReset(true)}
            style={{
              flex: 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              padding: '14px',
              background: 'transparent',
              color: '#64748B',
              border: '1px solid #334155',
              borderRadius: '12px',
              fontWeight: 600,
              fontSize: '14px',
              cursor: 'pointer',
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
  const { isAdmin } = useUserRole();

  const [tab, setTab] = useState<Tab>('fleet');
  const [mixers, setMixers] = useState<Mixer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');

  // Sheet state
  const [sheet, setSheet] = useState<'add' | 'edit' | 'view' | null>(null);
  const [selected, setSelected] = useState<Mixer | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useBodyScrollLock(!!sheet);

  // ── Fetch mixers ────────────────────────────────────────────────────────────
  const fetchMixers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/adminCifra/mixers');
      if (res.ok) setMixers(await res.json());
    } catch (e) {
      console.error('Ошибка загрузки миксеров:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMixers(); }, [fetchMixers]);

  // ── Open sheet ──────────────────────────────────────────────────────────────
  const openAdd = () => {
    setSelected(null);
    setForm(EMPTY_FORM);
    setConfirmDelete(false);
    setSheet('add');
  };

  const openCard = (mixer: Mixer) => {
    setSelected(mixer);
    setConfirmDelete(false);
    if (isAdmin) {
      setForm({
        number: mixer.number,
        model: mixer.model,
        driver: mixer.driver,
        phone: mixer.phone,
        volume: mixer.volume,
        type: mixer.type,
        unload_allowance_min: mixer.unload_allowance_min ?? 50,
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
  };

  // ── Save ────────────────────────────────────────────────────────────────────
  const saveMixer = async () => {
    if (!form.number.trim() || !form.driver.trim()) {
      alert('Номер миксера и ФИО водителя обязательны');
      return;
    }
    if (!form.phone.trim()) {
      alert('Телефон водителя обязателен — по нему водитель входит в приложение');
      return;
    }
    if (form.type === 'rented' && (!form.unload_allowance_min || Number(form.unload_allowance_min) <= 0)) {
      alert('Укажите норму разгрузки для наёмного миксера');
      return;
    }
    setSaving(true);
    try {
      const payload = sheet === 'edit' && selected
        ? { ...form, id: selected.id }
        : form;
      const res = await fetch('/api/adminCifra/mixers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        await fetchMixers();
        closeSheet();
      } else {
        alert('Ошибка при сохранении');
      }
    } finally {
      setSaving(false);
    }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const deleteMixer = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/adminCifra/mixers?id=${selected.id}`, { method: 'DELETE' });
      if (res.ok) {
        await fetchMixers();
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

  // ── Filtered list ───────────────────────────────────────────────────────────
  const filtered = mixers.filter(m => filter === 'all' || m.type === filter);

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', paddingBottom: '100px', background: '#0D1520' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 16px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Truck size={22} color="#10B981" />
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#E2E8F0' }}>Миксеры</h1>
        </div>
        <MobileExitButton />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '8px', padding: '16px 16px 0', overflowX: 'auto' }}>
        <button
          onClick={() => setTab('fleet')}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '9px 18px', borderRadius: '9999px',
            border: `1px solid ${tab === 'fleet' ? '#10B981' : '#334155'}`,
            background: tab === 'fleet' ? '#10B98120' : 'transparent',
            color: tab === 'fleet' ? '#10B981' : '#64748B',
            fontWeight: 600, fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap',
          }}
        >
          <Truck size={14} /> Парк
        </button>
        {isAdmin && (
          <button
            onClick={() => setTab('tariffs')}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '9px 18px', borderRadius: '9999px',
              border: `1px solid ${tab === 'tariffs' ? '#3B82F6' : '#334155'}`,
              background: tab === 'tariffs' ? '#3B82F620' : 'transparent',
              color: tab === 'tariffs' ? '#3B82F6' : '#64748B',
              fontWeight: 600, fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            <DollarSign size={14} /> Тарифы
          </button>
        )}
      </div>

      {/* ══════════════ TAB: FLEET ══════════════ */}
      {tab === 'fleet' && (
        <>
          {/* Filters */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '14px 16px' }}>
            <FilterBtn active={filter === 'all'}    onClick={() => setFilter('all')}    label="Все" />
            <FilterBtn active={filter === 'own'}    onClick={() => setFilter('own')}    label="Свои" />
            <FilterBtn active={filter === 'rented'} onClick={() => setFilter('rented')} label="Наёмные" />
          </div>

          {/* List */}
          <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {loading && (
              <div style={{ textAlign: 'center', padding: '60px', color: '#475569', fontSize: '14px' }}>
                Загрузка миксеров...
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: '60px', color: '#475569', fontSize: '14px' }}>
                Миксеры не найдены
              </div>
            )}
            {filtered.map(mixer => {
              const sc = statusColor(mixer.status);
              const isOwn = mixer.type === 'own';
              return (
                <div
                  key={mixer.id}
                  onClick={() => openCard(mixer)}
                  style={{
                    background: '#131C2B',
                    borderRadius: '16px',
                    padding: '16px',
                    cursor: 'pointer',
                    border: '1px solid #1E2937',
                  }}
                >
                  {/* Row 1: номер + тип + статус */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#E2E8F0' }}>{mixer.number}</div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span style={{
                        padding: '4px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600,
                        background: isOwn ? '#10B98120' : '#FACC1520',
                        color: isOwn ? '#10B981' : '#FACC15',
                      }}>
                        {isOwn ? 'Свой' : 'Наёмный'}
                      </span>
                      <span style={{
                        padding: '4px 10px', borderRadius: '9999px', fontSize: '12px', fontWeight: 600,
                        background: sc.bg, color: sc.color,
                      }}>
                        {mixer.status}
                      </span>
                    </div>
                  </div>

                  {/* Row 2: водитель + объём */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      {/* Аватар + имя */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{
                          width: '36px', height: '36px', borderRadius: '9999px',
                          background: '#25334A', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: '13px', fontWeight: 700, color: '#94A3B8', flexShrink: 0,
                        }}>
                          {initials(mixer.driver)}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: '14px', color: '#CBD5E1' }}>{mixer.driver}</div>
                          <div style={{ fontSize: '12px', color: '#475569', marginTop: '1px' }}>{mixer.model || '—'}</div>
                        </div>
                      </div>
                    </div>

                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '24px', fontWeight: 700, color: '#E2E8F0', lineHeight: 1 }}>
                        {mixer.volume}
                        <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 400 }}> м³</span>
                      </div>
                      {/* Кнопка звонка — stopPropagation чтобы не открывать шторку */}
                      <a
                        href={`tel:${mixer.phone}`}
                        onClick={e => e.stopPropagation()}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          marginTop: '4px',
                          padding: '4px 10px',
                          borderRadius: '9999px',
                          background: '#10B98115',
                          color: '#10B981',
                          fontSize: '12px',
                          fontWeight: 600,
                          textDecoration: 'none',
                        }}
                      >
                        <Phone size={11} /> Позвонить
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* FAB — добавить миксер (только admin, только вкладка Парк) */}
      {isAdmin && tab === 'fleet' && !sheet && (
        <button
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
          aria-label="Добавить миксер"
        >
          <Plus size={20} color="#10B981" strokeWidth={2.5} />
        </button>
      )}

      {/* ══════════════ TAB: TARIFFS ══════════════ */}
      {tab === 'tariffs' && isAdmin && (
        <div style={{ marginTop: '16px' }}>
          <TariffsTab />
        </div>
      )}

      {/* ══════════════ BOTTOM SHEET: VIEW (non-admin) ══════════════ */}
      {sheet === 'view' && selected && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000 }}
            onClick={closeSheet}
          />
          <div style={{
            position: 'fixed', bottom: '74px', left: 0, right: 0,
            zIndex: 10001,
            background: '#131C2B',
            borderRadius: '20px 20px 0 0',
            maxHeight: 'calc(80vh - 74px)',
            overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Handle */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0' }}>
              <div style={{ width: '40px', height: '4px', background: '#334155', borderRadius: '9999px' }} />
            </div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px' }}>
              <div style={{ fontSize: '18px', fontWeight: 700, color: '#E2E8F0' }}>{selected.number}</div>
              <button onClick={closeSheet} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={20} color="#64748B" />
              </button>
            </div>
            {/* Content */}
            <div style={{ padding: '0 20px 24px', overflowY: 'auto' }}>
              <InfoRow label="Модель" value={selected.model || '—'} />
              <InfoRow label="Водитель" value={selected.driver} />
              <InfoRow label="Телефон" value={selected.phone} />
              <InfoRow label="Объём" value={`${selected.volume} м³`} />
              <InfoRow label="Тип" value={selected.type === 'own' ? 'Свой' : 'Наёмный'} />
              <InfoRow label="Статус" value={selected.status} />
              <InfoRow
                label="Норма разгрузки"
                value={selected.type === 'own'
                  ? `${OWN_UNLOAD_ALLOWANCE_MIN} мин (общая)`
                  : `${selected.unload_allowance_min ?? '—'} мин`}
              />
              <a
                href={`tel:${selected.phone}`}
                style={{
                  marginTop: '16px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  padding: '14px',
                  background: '#10B981',
                  color: '#fff',
                  borderRadius: '12px',
                  fontWeight: 700,
                  fontSize: '15px',
                  textDecoration: 'none',
                }}
              >
                <Phone size={18} /> Позвонить водителю
              </a>
            </div>
          </div>
        </>
      )}

      {/* ══════════════ BOTTOM SHEET: ADD / EDIT (admin) ══════════════ */}
      {(sheet === 'add' || sheet === 'edit') && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000 }}
            onClick={closeSheet}
          />
          <div style={{
            position: 'fixed', bottom: '74px', left: 0, right: 0,
            zIndex: 10001,
            background: '#131C2B',
            borderRadius: '20px 20px 0 0',
            maxHeight: 'calc(90vh - 74px)',
            display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {/* Handle */}
            <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 0', flexShrink: 0 }}>
              <div style={{ width: '40px', height: '4px', background: '#334155', borderRadius: '9999px' }} />
            </div>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', flexShrink: 0 }}>
              <div style={{ fontSize: '17px', fontWeight: 700, color: '#E2E8F0' }}>
                {sheet === 'add' ? 'Новый миксер' : `Редактировать — ${selected?.number}`}
              </div>
              <button onClick={closeSheet} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={20} color="#64748B" />
              </button>
            </div>

            {/* Scrollable Form */}
            <div style={{ overflowY: 'auto', flex: 1, padding: '0 20px 20px' }}>
              <FieldInput label="Номер миксера *" placeholder="Например: А123БВ 32" value={form.number} onChange={v => setForm(p => ({ ...p, number: v }))} />
              <FieldInput label="Модель" placeholder="Например: КамАЗ 6520" value={form.model} onChange={v => setForm(p => ({ ...p, model: v }))} />
              <FieldInput label="ФИО водителя *" placeholder="Иванов Иван Иванович" value={form.driver} onChange={v => setForm(p => ({ ...p, driver: v }))} />
              <FieldInput label="Телефон водителя *" placeholder="+7..." value={form.phone} onChange={v => setForm(p => ({ ...p, phone: v }))} type="tel" hint="Используется для входа водителя в приложение" />
              <FieldInput label="Объём, м³" value={form.volume} onChange={v => setForm(p => ({ ...p, volume: Number(v) || 10 }))} type="number" />

              {/* Тип */}
              <div style={{ marginBottom: '16px' }}>
                <div style={{ color: '#94A3B8', fontSize: '12px', marginBottom: '8px', fontWeight: 600 }}>Тип миксера</div>
                <div style={{ display: 'flex', gap: '10px' }}>
                  {(['own', 'rented'] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setForm(p => ({ ...p, type: t }))}
                      style={{
                        flex: 1, padding: '12px',
                        background: form.type === t ? (t === 'own' ? '#10B981' : '#FACC15') : '#25334A',
                        border: 'none', borderRadius: '12px',
                        color: form.type === t && t === 'rented' ? '#000' : '#fff',
                        fontWeight: 700, fontSize: '14px', cursor: 'pointer',
                      }}
                    >
                      {t === 'own' ? 'Свой' : 'Наёмный'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Норма разгрузки */}
              {form.type === 'rented' ? (
                <FieldInput
                  label="Норма разгрузки, мин *"
                  placeholder="Например: 50"
                  value={form.unload_allowance_min}
                  onChange={v => setForm(p => ({ ...p, unload_allowance_min: v === '' ? '' : Number(v) }))}
                  type="number"
                  hint="Время сверх нормы считается простоем водителя"
                />
              ) : (
                <div style={{ padding: '12px 14px', background: '#1E2937', borderRadius: '10px', color: '#475569', fontSize: '13px', marginBottom: '16px' }}>
                  Норма разгрузки для своих — {OWN_UNLOAD_ALLOWANCE_MIN} мин (общая настройка)
                </div>
              )}

              {/* Кнопки */}
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <ModalActionButton
                  onClick={closeSheet}
                  color="#94A3B8"
                  icon={<X size={18} />}
                  label="Отмена"
                  fullWidth
                  size="lg"
                />
                <ModalActionButton
                  onClick={saveMixer}
                  disabled={saving}
                  color="#10B981"
                  icon={<Save size={18} />}
                  label={saving ? 'Сохраняем...' : (sheet === 'add' ? 'Добавить' : 'Сохранить')}
                  fullWidth
                  size="lg"
                />
              </div>

              {/* Удаление */}
              {sheet === 'edit' && selected && (
                <div style={{ marginTop: '16px' }}>
                  {confirmDelete ? (
                    <div style={{ background: '#1E2937', borderRadius: '12px', padding: '14px' }}>
                      <div style={{ color: '#EF4444', fontWeight: 600, fontSize: '14px', marginBottom: '10px', textAlign: 'center' }}>
                        Удалить миксер «{selected.number}»?
                      </div>
                      <div style={{ display: 'flex', gap: '10px' }}>
                        <button
                          onClick={() => setConfirmDelete(false)}
                          style={{ flex: 1, padding: '12px', background: '#25334A', color: '#94A3B8', border: 'none', borderRadius: '10px', fontWeight: 600, cursor: 'pointer' }}
                        >
                          Нет
                        </button>
                        <button
                          onClick={deleteMixer}
                          disabled={saving}
                          style={{ flex: 1, padding: '12px', background: '#EF4444', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: 700, cursor: 'pointer' }}
                        >
                          Да, удалить
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDelete(true)}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                        padding: '13px',
                        background: 'transparent',
                        color: '#EF4444',
                        border: '1px solid #EF444440',
                        borderRadius: '12px',
                        fontWeight: 600, fontSize: '14px', cursor: 'pointer',
                      }}
                    >
                      <Trash2 size={15} /> Удалить миксер
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Helper component ─────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '12px 0', borderBottom: '1px solid #1E2937',
    }}>
      <span style={{ color: '#475569', fontSize: '13px' }}>{label}</span>
      <span style={{ color: '#CBD5E1', fontSize: '14px', fontWeight: 600 }}>{value}</span>
    </div>
  );
}
