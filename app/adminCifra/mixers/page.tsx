'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { OWN_UNLOAD_ALLOWANCE_MIN } from '@/lib/mixerConfig';
import MixerHistoryDrawer from './MixerHistoryDrawer';
import DeliverySettingsTab from './DeliverySettingsTab';
import { useUserRole } from '../../providers/UserRoleProvider';
import { Truck } from 'lucide-react';
import { modalFieldStyle, volumeCardSoftStyle, volumeCardStyle, volumeModalStyle } from '../cardStyles';
import { appConfirm } from '../components/appDialog';
import AdminPagination from '../components/AdminPagination';
import ViewModeToggle, { LIST_GRID_OPTIONS } from '../components/ViewModeToggle';
import ModalSelect from '../components/ModalSelect';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { pluralWord } from '@/lib/ruLocale';
import {
  VEHICLE_KINDS,
  MODEL_TEMPLATES,
  applyModelTemplate,
  formatSpecsSummary,
  vehicleKindMeta,
  visibleSpecFields,
  type VehicleKind,
  type Ownership,
} from '@/lib/fleetCatalog';

function kindPlural(kind: VehicleKind, n: number): string {
  const forms: Record<VehicleKind, [string, string, string]> = {
    mixer: ['миксер', 'миксера', 'миксеров'],
    dump_truck: ['самосвал', 'самосвала', 'самосвалов'],
    tonar: ['тоннар', 'тоннара', 'тоннаров'],
    cement_truck: ['цементовоз', 'цементовоза', 'цементовозов'],
    special: ['единица', 'единицы', 'единиц'],
  };
  const [one, few, many] = forms[kind];
  return pluralWord(n, one, few, many);
}

interface MixerDriver {
  id: number;
  driver_name: string;
  phone: string;
}

interface FleetUnit {
  id: number;
  number: string;
  model: string;
  driver: string;
  phone: string;
  volume: number;
  type: Ownership;
  status: string;
  location?: string;
  created_at?: string;
  unload_allowance_min?: number | null;
  vehicle_kind?: VehicleKind;
  specs?: Record<string, any>;
  mixer_drivers?: MixerDriver[];
}

type PageTab = VehicleKind | 'delivery';

export default function MixersPage() {
  const { isAdmin } = useUserRole();

  // Вкладки видов техники + «Тарифы доставки» (admin)
  const [activeTab, setActiveTab] = useState<PageTab>('mixer');
  useEffect(() => {
    if (activeTab === 'delivery' && !isAdmin) setActiveTab('mixer');
  }, [activeTab, isAdmin]);

  const vehicleKind: VehicleKind = activeTab === 'delivery' ? 'mixer' : activeTab;
  const kindMeta = vehicleKindMeta(vehicleKind);

  const [mixers, setMixers] = useState<FleetUnit[]>([]);
  const [loading, setLoading] = useState(true);
  // Маппинг: номер миксера → актуальный статус рейса (если рейс есть)
  const [activeTripMap, setActiveTripMap] = useState<Map<string, string>>(new Map());

  const [filter, setFilter] = useState<'all' | 'own' | 'rented'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [showModal, setShowModal] = useState(false);
  const [editingMixer, setEditingMixer] = useState<FleetUnit | null>(null);
  const [historyMixer, setHistoryMixer] = useState<FleetUnit | null>(null);

  // Список: число строк под высоту экрана (как в отчётах)
  const mixerListRef = useRef<HTMLDivElement>(null);
  const [itemsPerPage, setItemsPerPage] = useState(8);
  const [currentPage, setCurrentPage] = useState(1);

  const [formData, setFormData] = useState({
    number: '',
    model: '',
    driver: '',
    phone: '',
    volume: 10,
    type: 'own' as Ownership,
    status: 'Доступен',
    unload_allowance_min: 50 as number | '',
    vehicle_kind: 'mixer' as VehicleKind,
    specs: {} as Record<string, any>,
  });

  // Дополнительные водители миксера
  const [extraDrivers, setExtraDrivers]       = useState<MixerDriver[]>([]);
  const [showAddDriver, setShowAddDriver]     = useState(false);
  const [newDriverName, setNewDriverName]     = useState('');
  const [newDriverPhone, setNewDriverPhone]   = useState('');
  const [driverSaving, setDriverSaving]       = useState(false);

  // ==================== ЗАГРУЗКА ТЕХНИКИ ====================
  useEffect(() => {
    if (activeTab === 'delivery') return;
    fetchMixers();
    if (vehicleKind === 'mixer') fetchActiveTrips();
  }, [activeTab, vehicleKind]);

  const fetchMixers = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/adminCifra/mixers?kind=${vehicleKind}`);
      if (res.ok) {
        const data = await res.json();
        setMixers(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Ошибка загрузки техники:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchActiveTrips = async () => {
    try {
      const res = await fetch('/api/adminCifra/active-mixers');
      if (res.ok) {
        const data = await res.json();
        const map = new Map<string, string>();
        for (const t of data) map.set(t.number as string, t.status as string);
        setActiveTripMap(map);
      }
    } catch (err) {
      console.error('Ошибка загрузки активных рейсов:', err);
    }
  };

  const filteredMixers = mixers.filter(m => 
    filter === 'all' || m.type === filter
  );

  const totalPages = Math.max(1, Math.ceil(filteredMixers.length / itemsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const pagedMixers = useMemo(() => {
    const start = (safeCurrentPage - 1) * itemsPerPage;
    return filteredMixers.slice(start, start + itemsPerPage);
  }, [filteredMixers, safeCurrentPage, itemsPerPage]);

  useEffect(() => {
    setCurrentPage(1);
  }, [filter, viewMode, vehicleKind]);

  // Подгонка числа строк под высоту контейнера.
  // Важно: строки — border-box (volumeCardSoftStyle). Раньше к cs.height
  // ещё раз прибавляли padding/border → высота строки завышалась, на 1920/1600
  // влезало заметно меньше строк, чем реально помещается.
  // offsetHeight = полная layout-высота в тех же единицах, что и clientHeight
  // (transform:scale layout.tsx на них не влияет — в отличие от getBoundingClientRect).
  useEffect(() => {
    if (viewMode !== 'list') return;
    const el = mixerListRef.current;
    if (!el) return;
    const GAP = 5;
    const adjust = () => {
      if (el.clientHeight <= 0) return;
      const rows = (Array.from(el.children) as HTMLElement[]).filter(
        (r) => r.dataset.mixerPlaceholder !== 'true',
      );
      let rowHeight = 0;
      if (rows.length === 0) {
        rowHeight = 56; // типовая строка, пока список пуст / грузится
      } else {
        for (const r of rows) {
          if (r.offsetHeight > rowHeight) rowHeight = r.offsetHeight;
        }
      }
      if (!rowHeight || rowHeight <= 0) return;

      // +GAP в числителе — последний gap между строками не нужен снизу
      const target = Math.max(4, Math.floor((el.clientHeight + GAP) / (rowHeight + GAP)));
      setItemsPerPage((prev) => (prev === target ? prev : target));
    };
    adjust();
    const t1 = setTimeout(adjust, 60);
    const t2 = setTimeout(adjust, 350);
    const ro = new ResizeObserver(adjust);
    ro.observe(el);
    const mo = new MutationObserver(adjust);
    mo.observe(el, { childList: true });
    window.addEventListener('resize', adjust);
    return () => {
      ro.disconnect();
      mo.disconnect();
      window.removeEventListener('resize', adjust);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [itemsPerPage, viewMode, loading, vehicleKind, filteredMixers.length]);

  // ==================== ФУНКЦИИ МОДАЛЬНОГО ОКНА ====================
  const openEditModal = (unit: FleetUnit) => {
    setEditingMixer(unit);
    setFormData({
      number: unit.number,
      model: unit.model || '',
      driver: unit.driver,
      phone: unit.phone,
      volume: unit.volume,
      type: unit.type,
      status: unit.status,
      unload_allowance_min: unit.unload_allowance_min ?? 50,
      vehicle_kind: unit.vehicle_kind || vehicleKind,
      specs: unit.specs && typeof unit.specs === 'object' ? { ...unit.specs } : {},
    });
    setExtraDrivers(unit.mixer_drivers || []);
    setShowAddDriver(false);
    setNewDriverName('');
    setNewDriverPhone('');
    setShowModal(true);
  };

  const openAddModal = () => {
    setEditingMixer(null);
    setFormData({
      number: '',
      model: '',
      driver: '',
      phone: '',
      volume: vehicleKind === 'mixer' ? 10 : 0,
      type: 'own',
      status: 'Доступен',
      unload_allowance_min: 50,
      vehicle_kind: vehicleKind,
      specs: vehicleKind === 'special' ? { subtype: 'loader' } : {},
    });
    setExtraDrivers([]);
    setShowAddDriver(false);
    setNewDriverName('');
    setNewDriverPhone('');
    setShowModal(true);
  };

  const applyModel = (modelName: string) => {
    const applied = applyModelTemplate(formData.vehicle_kind, modelName);
    setFormData((prev) => ({
      ...prev,
      model: modelName,
      volume: applied?.volume != null ? Number(applied.volume) : prev.volume,
      specs: applied?.specs ? { ...prev.specs, ...applied.specs } : prev.specs,
    }));
  };

  const saveMixer = async () => {
    if (!formData.number || !formData.driver) {
      alert('Госномер и водитель обязательны');
      return;
    }

    if (!formData.phone?.trim()) {
      alert('Телефон водителя обязателен — по нему водитель входит в мобильное приложение');
      return;
    }

    if (
      formData.vehicle_kind === 'mixer' &&
      formData.type === 'rented' &&
      (formData.unload_allowance_min === '' || formData.unload_allowance_min === null || Number(formData.unload_allowance_min) <= 0)
    ) {
      alert('Укажите норму разгрузки (мин) для наёмного миксера');
      return;
    }

    try {
      const payload = editingMixer
        ? { ...formData, id: editingMixer.id }
        : formData;

      const res = await fetch('/api/adminCifra/mixers', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({}));
      if (res.ok) {
        fetchMixers();
        setShowModal(false);
        if (json.warning) alert(json.warning);
        else alert(editingMixer ? 'Сохранено' : `${kindMeta.singular} добавлен`);
      } else {
        alert(json.error || 'Ошибка при сохранении');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка соединения');
    }
  };

  const addExtraDriver = async () => {
    if (!editingMixer) return;
    if (!newDriverName.trim() || !newDriverPhone.trim()) {
      alert('Укажите ФИО и телефон');
      return;
    }
    setDriverSaving(true);
    try {
      const res = await fetch(`/api/adminCifra/mixers/${editingMixer.id}/drivers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ driver_name: newDriverName.trim(), phone: newDriverPhone.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { alert(json.error || 'Ошибка'); return; }
      setExtraDrivers((prev) => [...prev, json.data]);
      setNewDriverName('');
      setNewDriverPhone('');
      setShowAddDriver(false);
      fetchMixers();
    } catch { alert('Ошибка соединения'); }
    finally { setDriverSaving(false); }
  };

  const removeExtraDriver = async (driverId: number) => {
    if (!editingMixer) return;
    if (!(await appConfirm('Удалить этого водителя?', { variant: 'danger', okLabel: 'Удалить', title: 'Удаление' }))) return;
    try {
      const res = await fetch(
        `/api/adminCifra/mixers/${editingMixer.id}/drivers?driverId=${driverId}`,
        { method: 'DELETE' }
      );
      if (!res.ok) { alert('Ошибка удаления'); return; }
      setExtraDrivers((prev) => prev.filter((d) => d.id !== driverId));
      fetchMixers();
    } catch { alert('Ошибка соединения'); }
  };

  const inputStyle: React.CSSProperties = modalFieldStyle({
    marginBottom: '16px',
  });

  const getStatusStyle = (status: string) => {
    if (status === 'Загрузка')   return { color: '#FACC15', bg: '#FACC1520' };
    if (status === 'В пути')     return { color: '#3B82F6', bg: '#3B82F620' };
    if (status === 'На объекте') return { color: '#10B981', bg: '#10B98120' };
    if (status === 'Проблема')   return { color: '#EF4444', bg: '#EF444420' };
    return { color: '#94A3B8', bg: '#334155' }; // Доступен / прочие
  };

  // Эффективный статус: если есть активный рейс — показываем его статус, иначе «Доступен»
  const effectiveStatus = (unit: FleetUnit) =>
    vehicleKind === 'mixer' ? (activeTripMap.get(unit.number) ?? 'Доступен') : 'Доступен';

  const pageTabs: { key: PageTab; label: string }[] = [
    ...VEHICLE_KINDS.map((k) => ({ key: k.key as PageTab, label: k.label })),
    ...(isAdmin ? [{ key: 'delivery' as const, label: 'Тарифы доставки' }] : []),
  ];

  return (
    <div style={{ 
      color: '#fff', 
      flex: 1,
      minHeight: 0,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxSizing: 'border-box'
    }}>
      
      {/* ==================== ЗАГОЛОВОК + КНОПКА ДОБАВИТЬ ==================== */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexShrink: 0, gap: '16px', flexWrap: 'wrap' }}>
        <h1 style={{
          fontSize: '26px',
          fontWeight: 700,
          color: '#fff',
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <Truck size={26} color="#94A3B8" />
          Техника
        </h1>

        {/* На «Тарифах» кнопку скрываем, но место оставляем — иначе шапка
            сжимается и вкладки прыгают вверх/вниз при переключении. */}
        {activeTab !== 'delivery' ? (
          <button 
            onClick={openAddModal} 
            style={volumeCardSoftStyle({
              padding: '10px 22px',
              background: 'linear-gradient(165deg, #10B981 0%, #059669 100%)',
              border: '1px solid rgba(110,231,183,0.35)',
              borderRadius: 12,
              color: 'white',
              fontWeight: 700,
              fontSize: '14.5px',
              cursor: 'pointer',
            })}
            onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; }}
          >
            {kindMeta.addLabel}
          </button>
        ) : (
          <div
            aria-hidden
            style={{
              padding: '10px 22px',
              borderRadius: 12,
              fontWeight: 700,
              fontSize: '14.5px',
              border: '1px solid transparent',
              visibility: 'hidden',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            {vehicleKindMeta('mixer').addLabel}
          </div>
        )}
      </div>

      {/* Виды техники + тарифы */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '28px',
          marginBottom: '14px',
          borderBottom: '1px solid #334155',
          paddingBottom: '8px',
          flexShrink: 0,
          overflowX: 'auto',
        }}
      >
        {pageTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              padding: '12px 0',
              background: 'transparent',
              border: 'none',
              fontSize: '16px',
              fontWeight: 600,
              color: activeTab === t.key ? '#10B981' : '#64748B',
              cursor: 'pointer',
              position: 'relative',
              transition: 'color 0.2s',
              whiteSpace: 'nowrap',
            }}
          >
            {t.label}
            {activeTab === t.key && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '-6px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '5px',
                  height: '5px',
                  backgroundColor: '#10B981',
                  borderRadius: '50%',
                  boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.3)',
                }}
              />
            )}
          </button>
        ))}
      </div>

      {activeTab === 'delivery' ? (
        <DeliverySettingsTab />
      ) : (
      <>
      {/* ==================== ПАНЕЛЬ УПРАВЛЕНИЯ (ВИД + ФИЛЬТРЫ) ==================== */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '10px',
        marginBottom: '14px',
        flexShrink: 0,
      }}>
        <ViewModeToggle value={viewMode} onChange={setViewMode} options={LIST_GRID_OPTIONS} />
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          <button 
            onClick={() => setFilter('all')} 
            style={{
              padding: '10px 20px',
              background: 'transparent',
              border: 'none',
              color: filter === 'all' ? '#10B981' : '#64748B',
              fontSize: '17px',
              fontWeight: '600',
              transition: 'color 0.25s ease',
              cursor: 'pointer',
            }}
          >
            Все
          </button>
          <button 
            onClick={() => setFilter('own')} 
            style={{
              padding: '10px 20px',
              background: 'transparent',
              border: 'none',
              color: filter === 'own' ? '#10B981' : '#64748B',
              fontSize: '17px',
              fontWeight: '600',
              transition: 'color 0.25s ease',
              cursor: 'pointer',
            }}
          >
            Свои
          </button>
          <button 
            onClick={() => setFilter('rented')} 
            style={{
              padding: '10px 20px',
              background: 'transparent',
              border: 'none',
              color: filter === 'rented' ? '#10B981' : '#64748B',
              fontSize: '17px',
              fontWeight: '600',
              transition: 'color 0.25s ease',
              cursor: 'pointer',
            }}
          >
            Наемные
          </button>
        </div>
      </div>

      {/* ==================== ОСНОВНОЙ КОНТЕНТ (СПИСОК / ПЛИТКА) ==================== */}
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px', color: '#94A3B8' }}>Загрузка техники...</div>
      ) : (
        <>
                              {/* ==================== РЕЖИМ ПЛИТКИ ==================== */}
          {viewMode === 'grid' && (
            <div className="scroll-hidden" style={{ 
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(280px, 100%), 1fr))', 
              gap: '16px',
              alignContent: 'start',
              paddingBottom: '4px',
            }}>
              {filteredMixers.length === 0 && (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '60px 20px', color: '#64748B', fontSize: '16px' }}>
                  {kindMeta.label} не найдены
                </div>
              )}
              {filteredMixers.map((mixer) => {
                const dispStatus = effectiveStatus(mixer);
                const statusStyle = getStatusStyle(dispStatus);
                const specsLine = formatSpecsSummary(vehicleKind, mixer.specs);
                return (
                  <div 
                    key={mixer.id} 
                    style={volumeCardStyle({ 
                      borderRadius: 18, 
                      padding: '16px',
                      transition: 'transform 0.25s ease, filter 0.25s ease',
                      display: 'flex',
                      flexDirection: 'column',
                      alignSelf: 'start',
                    })}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-3px)';
                      e.currentTarget.style.filter = 'brightness(1.06)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.filter = 'none';
                    }}
                  >
                    {/* Номер + Тип */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', marginBottom: '16px' }}>
                      <div style={{ fontSize: '22px', fontWeight: '700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        {mixer.number}
                      </div>
                      <div style={{ 
                        padding: '5px 14px', 
                        borderRadius: '9999px', 
                        fontSize: '13.5px',
                        fontWeight: '600',
                        whiteSpace: 'nowrap',
                        flexShrink: 0,
                        background: mixer.type === 'own' ? '#10B98120' : '#FACC1520', 
                        color: mixer.type === 'own' ? '#10B981' : '#FACC15'
                      }}>
                        {mixer.type === 'own' ? 'Свой' : 'Наемный'}
                      </div>
                    </div>

                    {vehicleKind === 'mixer' && (
                      <div style={{ color: '#64748B', fontSize: '13px', marginTop: '-10px', marginBottom: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        Норма разгрузки: {mixer.type === 'own' ? OWN_UNLOAD_ALLOWANCE_MIN : (mixer.unload_allowance_min ?? '—')} мин
                      </div>
                    )}

                    {/* Модель */}
                    <div style={{ color: '#CBD5E1', fontSize: '16.5px', marginBottom: specsLine ? '6px' : '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {mixer.model || '—'}
                    </div>
                    {specsLine ? (
                      <div style={{ color: '#64748B', fontSize: '12.5px', marginBottom: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {specsLine}
                      </div>
                    ) : null}

                    {/* Водитель + Телефон */}
                    <div style={{ marginBottom: '20px' }}>
                      <div style={{ 
                        fontWeight: '600', 
                        fontSize: '16px',
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical' as any,
                        overflow: 'hidden',
                        lineHeight: '19px',
                        height: '38px'
                      }}>
                        {mixer.driver}
                      </div>
                      <div style={{ color: '#94A3B8', fontSize: '14.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: '17px', height: '17px', marginTop: '3px' }}>{mixer.phone}</div>
                      {(mixer.mixer_drivers?.length ?? 0) > 0 && (
                        <div style={{ color: '#60A5FA', fontSize: '12px', marginTop: '4px' }}>
                          +{mixer.mixer_drivers!.length} вод.
                        </div>
                      )}
                    </div>

                    {/* Объём + Статус */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', marginTop: 'auto' }}>
                      <div>
                        <div style={{ fontSize: '32px', fontWeight: '700', lineHeight: 1 }}>
                          {mixer.volume} <span style={{ fontSize: '18px', color: '#94A3B8' }}>{kindMeta.volumeUnit}</span>
                        </div>
                      </div>

                      {vehicleKind === 'mixer' && (
                        <div style={{ 
                          padding: '7px 18px', 
                          borderRadius: '9999px', 
                          background: statusStyle.bg, 
                          color: statusStyle.color, 
                          fontWeight: '600',
                          fontSize: '14px',
                          whiteSpace: 'nowrap'
                        }}>
                          {dispStatus}
                        </div>
                      )}
                    </div>

                    {/* Тонкие кнопки в стиле списка */}
                    <div style={{ display: 'flex', gap: '8px' }}>
                      {vehicleKind === 'mixer' && (
                        <button
                          onClick={() => setHistoryMixer(mixer)}
                          style={{
                            flex: 1,
                            padding: '8px 12px',
                            background: 'rgba(74,222,128,0.1)',
                            color: '#4ADE80',
                            border: '1px solid rgba(74,222,128,0.3)',
                            borderRadius: '9999px',
                            fontWeight: '500',
                            fontSize: '13.5px',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            cursor: 'pointer',
                          }}
                        >
                          📋 История
                        </button>
                      )}
                      <button 
                        onClick={() => openEditModal(mixer)} 
                        style={{ 
                          flex: 1, 
                          padding: '8px 12px',
                          background: '#334155',
                          color: '#E2E8F0',
                          border: 'none', 
                          borderRadius: '9999px', 
                          fontWeight: '500',
                          fontSize: '13.5px',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          transition: 'all 0.2s ease'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#3B82F6';
                          e.currentTarget.style.color = 'white';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#334155';
                          e.currentTarget.style.color = '#E2E8F0';
                        }}
                      >
                        ✏️ Редактировать
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ==================== РЕЖИМ СПИСКА — строки вмещаются в экран ==================== */}
          {viewMode === 'list' && (
            <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <AdminPagination
                page={safeCurrentPage}
                totalPages={totalPages}
                onPage={setCurrentPage}
                suffix={`· ${kindPlural(vehicleKind, filteredMixers.length)}`}
                reserveSpace
                style={{ marginBottom: '10px' }}
              />

              {/* Список не скроллится — itemsPerPage подстраивается через ResizeObserver */}
              <div
                ref={mixerListRef}
                style={{
                  flex: 1,
                  minHeight: 0,
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '5px',
                  WebkitOverflowScrolling: 'touch',
                }}
              >
                {pagedMixers.length > 0 ? pagedMixers.map((mixer) => {
                  const dispStatus = effectiveStatus(mixer);
                  const statusStyle = getStatusStyle(dispStatus);
                  const specsLine = formatSpecsSummary(vehicleKind, mixer.specs);
                  return (
                    <div
                      key={mixer.id}
                      style={volumeCardSoftStyle({
                        display: 'flex',
                        alignItems: 'center',
                        padding: '8px 20px',
                        borderRadius: 12,
                        transition: 'filter 0.2s ease',
                        flexShrink: 0,
                        minHeight: 0,
                        gap: '12px',
                        minWidth: 720,
                      })}
                      onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.08)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.filter = 'none'; }}
                    >
                      <div style={{ width: '120px', fontWeight: 700, fontSize: '15px', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {mixer.number}
                      </div>

                      <div style={{ flex: 1.2, minWidth: 0, overflow: 'hidden' }}>
                        <div style={{ color: '#CBD5E1', fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {mixer.model || '—'}
                        </div>
                        {specsLine ? (
                          <div style={{ color: '#64748B', fontSize: '11.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {specsLine}
                          </div>
                        ) : null}
                      </div>

                      <div style={{ flex: 1.4, minWidth: 0, overflow: 'hidden' }}>
                        <div style={{ fontWeight: 600, fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mixer.driver}</div>
                        <div style={{ color: '#94A3B8', fontSize: '12.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mixer.phone}</div>
                      </div>

                      <div style={{ width: '90px', fontSize: '15px', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {mixer.volume} {kindMeta.volumeUnit}
                      </div>

                      {vehicleKind === 'mixer' && (
                        <div style={{ width: '130px', flexShrink: 0 }}>
                          <span style={{
                            padding: '4px 12px',
                            borderRadius: '9999px',
                            background: statusStyle.bg,
                            color: statusStyle.color,
                            fontWeight: 600,
                            fontSize: '12.5px',
                            whiteSpace: 'nowrap',
                          }}>
                            {dispStatus}
                          </span>
                        </div>
                      )}

                      <div style={{ width: '100px', flexShrink: 0 }}>
                        <span style={{
                          padding: '4px 12px',
                          borderRadius: '9999px',
                          background: mixer.type === 'own' ? '#10B98120' : '#FACC1520',
                          color: mixer.type === 'own' ? '#10B981' : '#FACC15',
                          fontWeight: 600,
                          fontSize: '12.5px',
                          whiteSpace: 'nowrap',
                        }}>
                          {mixer.type === 'own' ? 'Свой' : 'Наемный'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto', flexShrink: 0 }}>
                        {vehicleKind === 'mixer' && (
                          <button
                            onClick={() => setHistoryMixer(mixer)}
                            style={{
                              padding: '6px 12px',
                              background: 'rgba(74,222,128,0.1)',
                              color: '#4ADE80',
                              border: '1px solid rgba(74,222,128,0.3)',
                              borderRadius: 10,
                              fontWeight: 600,
                              fontSize: '12.5px',
                              whiteSpace: 'nowrap',
                              cursor: 'pointer',
                            }}
                          >
                            История
                          </button>
                        )}
                        <button
                          onClick={() => openEditModal(mixer)}
                          style={{
                            padding: '6px 12px',
                            background: '#334155',
                            color: '#E2E8F0',
                            border: 'none',
                            borderRadius: 10,
                            fontWeight: 600,
                            fontSize: '12.5px',
                            whiteSpace: 'nowrap',
                            cursor: 'pointer',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#3B82F6';
                            e.currentTarget.style.color = 'white';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#334155';
                            e.currentTarget.style.color = '#E2E8F0';
                          }}
                        >
                          Редактировать
                        </button>
                      </div>
                    </div>
                  );
                }) : (
                  <div
                    data-mixer-placeholder="true"
                    style={{ textAlign: 'center', padding: '60px 20px', color: '#64748B', fontSize: '16px' }}
                  >
                    {kindMeta.label} не найдены
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
      </div>
      </>
      )}

      {/* ==================== ИСТОРИЯ РЕЙСОВ МИКСЕРА ==================== */}
      <MixerHistoryDrawer
        mixer={historyMixer}
        onClose={() => setHistoryMixer(null)}
      />

      {/* ==================== МОДАЛЬНОЕ ОКНО ==================== */}
      {showModal && (
        <div 
          style={{ 
            position: 'fixed', 
            inset: 0, 
            background: 'rgba(0,0,0,0.82)', 
            zIndex: 9999, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            padding: '16px'
          }} 
          onClick={() => setShowModal(false)}
        >
          <div 
            className="scroll-hidden"
            style={volumeModalStyle({ 
              width: '100%',
              maxWidth: '520px', 
              maxHeight: '90vh',
              overflowY: 'auto',
              borderRadius: 22, 
              padding: '28px',
              margin: '0 16px',
            })} 
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: '24px' }}>
              {editingMixer ? `Редактировать: ${kindMeta.singular}` : kindMeta.addLabel.replace(/^\+\s*/, '')}
            </h2>
            
            <input 
              type="text" 
              placeholder="Госномер *" 
              value={formData.number} 
              onChange={(e) => setFormData({...formData, number: e.target.value})} 
              style={inputStyle} 
            />

            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: 8, color: '#94A3B8', fontSize: 13 }}>Модель</label>
              <ModalSelect
                value={formData.model}
                onChange={(v) => applyModel(v)}
                options={[
                  ...(MODEL_TEMPLATES[formData.vehicle_kind] || []).map((t) => ({ value: t.model, label: t.model })),
                  ...(formData.model && !(MODEL_TEMPLATES[formData.vehicle_kind] || []).some((t) => t.model === formData.model)
                    ? [{ value: formData.model, label: formData.model }]
                    : []),
                ]}
                placeholder="Выберите модель"
              />
              <input
                type="text"
                placeholder="Или введите модель вручную"
                value={formData.model}
                onChange={(e) => {
                  const model = e.target.value;
                  const applied = applyModelTemplate(formData.vehicle_kind, model);
                  setFormData((prev) => ({
                    ...prev,
                    model,
                    volume: applied?.volume != null ? Number(applied.volume) : prev.volume,
                    specs: applied?.specs ? { ...prev.specs, ...applied.specs } : prev.specs,
                  }));
                }}
                style={{ ...inputStyle, marginBottom: 0, marginTop: 8 }}
              />
            </div>

            <input 
              type="text" 
              placeholder="ФИО водителя *" 
              value={formData.driver} 
              onChange={(e) => setFormData({...formData, driver: e.target.value})} 
              style={inputStyle} 
            />
            <input 
              type="tel" 
              placeholder="Телефон водителя *" 
              value={formData.phone} 
              onChange={(e) => setFormData({...formData, phone: e.target.value})} 
              style={inputStyle} 
            />

            {/* ── Дополнительные водители (только при редактировании) ── */}
            {editingMixer && (
              <div style={volumeCardSoftStyle({ marginBottom: '20px', borderRadius: 12, padding: '14px' })}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
                  Дополнительные водители
                </div>

                {extraDrivers.length === 0 && !showAddDriver && (
                  <div style={{ color: '#475569', fontSize: '13px', marginBottom: '10px' }}>
                    Нет дополнительных водителей
                  </div>
                )}

                {extraDrivers.map((d) => (
                  <div key={d.id} style={volumeCardSoftStyle({
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    borderRadius: 10, padding: '10px 12px',
                    marginBottom: '6px',
                  })}>
                    <div>
                      <div style={{ color: '#E2E8F0', fontSize: '13px', fontWeight: 600 }}>{d.driver_name}</div>
                      <div style={{ color: '#64748B', fontSize: '12px' }}>{d.phone}</div>
                    </div>
                    <button
                      onClick={() => removeExtraDriver(d.id)}
                      style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', padding: '4px', fontSize: '16px' }}
                      title="Удалить водителя"
                    >✕</button>
                  </div>
                ))}

                {showAddDriver ? (
                  <div style={volumeCardSoftStyle({ borderRadius: 10, padding: '12px', marginTop: '4px' })}>
                    <input
                      type="text"
                      placeholder="ФИО водителя *"
                      value={newDriverName}
                      onChange={(e) => setNewDriverName(e.target.value)}
                      style={{ ...inputStyle, marginBottom: '8px' }}
                    />
                    <input
                      type="tel"
                      placeholder="Телефон *"
                      value={newDriverPhone}
                      onChange={(e) => setNewDriverPhone(e.target.value)}
                      style={{ ...inputStyle, marginBottom: '10px' }}
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => { setShowAddDriver(false); setNewDriverName(''); setNewDriverPhone(''); }}
                        style={volumeCardSoftStyle({ flex: 1, padding: '10px', borderRadius: 9999, color: '#94A3B8', cursor: 'pointer', fontSize: '13px' })}
                      >Отмена</button>
                      <button
                        onClick={addExtraDriver}
                        disabled={driverSaving}
                        style={{ flex: 1, padding: '10px', background: '#10B981', borderRadius: '9999px', color: 'white', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: '13px' }}
                      >{driverSaving ? 'Сохранение...' : 'Добавить'}</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAddDriver(true)}
                    style={{
                      width: '100%', padding: '9px', marginTop: '4px',
                      background: 'none', border: '1px dashed rgba(148,163,184,0.28)',
                      borderRadius: '10px', color: '#60A5FA', fontSize: '13px',
                      cursor: 'pointer', fontWeight: 600,
                    }}
                  >+ Добавить водителя</button>
                )}
              </div>
            )}

            <div style={{ marginBottom: '16px' }}>
              <label>{kindMeta.volumeLabel} ({kindMeta.volumeUnit})</label>
              <input 
                type="number" 
                value={formData.volume} 
                onChange={(e) => setFormData({...formData, volume: Number(e.target.value)})} 
                style={{ ...inputStyle, marginBottom: 0, marginTop: '8px' }} 
              />
            </div>

            {visibleSpecFields(formData.vehicle_kind, formData.specs).map((field) => (
              <div key={field.key} style={{ marginBottom: '16px' }}>
                <label>{field.label}{field.unit ? ` (${field.unit})` : ''}</label>
                {field.type === 'select' ? (
                  <div style={{ marginTop: 8 }}>
                    <ModalSelect
                      value={String(formData.specs[field.key] ?? '')}
                      onChange={(v) => setFormData((prev) => ({
                        ...prev,
                        specs: { ...prev.specs, [field.key]: v },
                      }))}
                      options={(field.options || []).map((o) => ({ value: o.value, label: o.label }))}
                      placeholder={field.placeholder || 'Выберите'}
                    />
                  </div>
                ) : (
                  <input
                    type={field.type === 'number' ? 'number' : 'text'}
                    placeholder={field.placeholder}
                    value={formData.specs[field.key] ?? ''}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const val = field.type === 'number' ? (raw === '' ? '' : Number(raw)) : raw;
                      setFormData((prev) => ({
                        ...prev,
                        specs: { ...prev.specs, [field.key]: val },
                      }));
                    }}
                    style={{ ...inputStyle, marginBottom: 0, marginTop: '8px' }}
                  />
                )}
              </div>
            ))}

            <div style={{ marginBottom: '24px' }}>
              <label>Принадлежность</label>
              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button 
                  onClick={() => setFormData({...formData, type: 'own'})} 
                  style={formData.type === 'own'
                    ? { flex: 1, padding: '12px', background: '#10B981', borderRadius: '12px', color: 'white', border: 'none', boxSizing: 'border-box', cursor: 'pointer' }
                    : volumeCardSoftStyle({ flex: 1, padding: '12px', borderRadius: 12, color: 'white', cursor: 'pointer' })}
                >
                  Свой
                </button>
                <button 
                  onClick={() => setFormData({...formData, type: 'rented'})} 
                  style={formData.type === 'rented'
                    ? { flex: 1, padding: '12px', background: '#FACC15', borderRadius: '12px', color: 'white', border: 'none', boxSizing: 'border-box', cursor: 'pointer' }
                    : volumeCardSoftStyle({ flex: 1, padding: '12px', borderRadius: 12, color: 'white', cursor: 'pointer' })}
                >
                  Наемный
                </button>
              </div>
            </div>

            {formData.vehicle_kind === 'mixer' && (
              formData.type === 'rented' ? (
                <div style={{ marginBottom: '24px' }}>
                  <label>Норма разгрузки, мин *</label>
                  <input
                    type="number"
                    min={1}
                    placeholder="Например, 50"
                    value={formData.unload_allowance_min}
                    onChange={(e) => setFormData({ ...formData, unload_allowance_min: e.target.value === '' ? '' : Number(e.target.value) })}
                    style={{ ...inputStyle, marginBottom: 0, marginTop: '8px' }}
                  />
                  <div style={{ color: '#64748B', fontSize: '13px', marginTop: '6px' }}>
                    Время разгрузки сверх этой нормы будет считаться простоем у водителя этого миксера
                  </div>
                </div>
              ) : (
                <div style={{ marginBottom: '24px', color: '#64748B', fontSize: '13px' }}>
                  Норма разгрузки для своих миксеров — {OWN_UNLOAD_ALLOWANCE_MIN} мин (общая для всех своих)
                </div>
              )
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => setShowModal(false)} 
                style={volumeCardSoftStyle({ flex: 1, padding: '14px', borderRadius: 9999, color: 'white', cursor: 'pointer' })}
              >
                Отмена
              </button>
              <button 
                onClick={saveMixer} 
                style={{ flex: 1, padding: '14px', background: '#10B981', borderRadius: '9999px', fontWeight: '600', color: 'white', border: 'none', boxSizing: 'border-box' }}
              >
                {editingMixer ? 'Сохранить изменения' : kindMeta.addLabel.replace(/^\+\s*/, '')}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}