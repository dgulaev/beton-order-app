'use client';

import { useState, useEffect } from 'react';
import { OWN_UNLOAD_ALLOWANCE_MIN } from '@/lib/mixerConfig';
import MixerHistoryDrawer from './MixerHistoryDrawer';
import DeliverySettingsTab from './DeliverySettingsTab';
import { useUserRole } from '../../providers/UserRoleProvider';
import { Truck, DollarSign } from 'lucide-react';

interface MixerDriver {
  id: number;
  driver_name: string;
  phone: string;
}

interface Mixer {
  id: number;
  number: string;
  model: string;
  driver: string;
  phone: string;
  volume: number;
  type: 'own' | 'rented';
  status: string;
  location?: string;
  created_at?: string;
  unload_allowance_min?: number | null;
  mixer_drivers?: MixerDriver[];
}

export default function MixersPage() {
  const { isAdmin } = useUserRole();

  // ==================== ВКЛАДКИ: «Миксеры» / «Тарифы доставки» (только admin) ====================
  const [activeTab, setActiveTab] = useState<'mixers' | 'delivery'>('mixers');
  useEffect(() => {
    if (activeTab === 'delivery' && !isAdmin) setActiveTab('mixers');
  }, [activeTab, isAdmin]);

  const [mixers, setMixers] = useState<Mixer[]>([]);
  const [loading, setLoading] = useState(true);
  // Маппинг: номер миксера → актуальный статус рейса (если рейс есть)
  const [activeTripMap, setActiveTripMap] = useState<Map<string, string>>(new Map());

  const [filter, setFilter] = useState<'all' | 'own' | 'rented'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showModal, setShowModal] = useState(false);
  const [editingMixer, setEditingMixer] = useState<Mixer | null>(null);
  const [historyMixer, setHistoryMixer] = useState<Mixer | null>(null);

  const [formData, setFormData] = useState({
    number: '',
    model: '',
    driver: '',
    phone: '',
    volume: 10,
    type: 'own' as 'own' | 'rented',
    status: 'Доступен',
    unload_allowance_min: 50 as number | ''
  });

  // Дополнительные водители миксера
  const [extraDrivers, setExtraDrivers]       = useState<MixerDriver[]>([]);
  const [showAddDriver, setShowAddDriver]     = useState(false);
  const [newDriverName, setNewDriverName]     = useState('');
  const [newDriverPhone, setNewDriverPhone]   = useState('');
  const [driverSaving, setDriverSaving]       = useState(false);

  // ==================== ЗАГРУЗКА МИКСЕРОВ ====================
  useEffect(() => {
    fetchMixers();
    fetchActiveTrips();
  }, []);

  const fetchMixers = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/adminCifra/mixers');
      if (res.ok) {
        const data = await res.json();
        setMixers(data);
      }
    } catch (err) {
      console.error('Ошибка загрузки миксеров:', err);
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

  // ==================== ФУНКЦИИ МОДАЛЬНОГО ОКНА ====================
  const openEditModal = (mixer: Mixer) => {
    setEditingMixer(mixer);
    setFormData({
      number: mixer.number,
      model: mixer.model,
      driver: mixer.driver,
      phone: mixer.phone,
      volume: mixer.volume,
      type: mixer.type,
      status: mixer.status,
      unload_allowance_min: mixer.unload_allowance_min ?? 50
    });
    // Подгружаем доп. водителей из ответа API (уже приходят в mixer_drivers)
    setExtraDrivers(mixer.mixer_drivers || []);
    setShowAddDriver(false);
    setNewDriverName('');
    setNewDriverPhone('');
    setShowModal(true);
  };

  const openAddModal = () => {
    setEditingMixer(null);
    setFormData({ number: '', model: '', driver: '', phone: '', volume: 10, type: 'own', status: 'Доступен', unload_allowance_min: 50 });
    setExtraDrivers([]);
    setShowAddDriver(false);
    setNewDriverName('');
    setNewDriverPhone('');
    setShowModal(true);
  };

  const saveMixer = async () => {
    if (!formData.number || !formData.driver) {
      alert('Номер миксера и водитель обязательны');
      return;
    }

    if (!formData.phone?.trim()) {
      alert('Телефон водителя обязателен — по нему водитель входит в мобильное приложение');
      return;
    }

    if (formData.type === 'rented' && (formData.unload_allowance_min === '' || formData.unload_allowance_min === null || Number(formData.unload_allowance_min) <= 0)) {
      alert('Укажите норму разгрузки (мин) для наёмного миксера');
      return;
    }

    try {
      const payload = editingMixer 
        ? { ...formData, id: editingMixer.id } 
        : formData;

      const res = await fetch('/api/adminCifra/mixers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        fetchMixers();           // обновляем список
        setShowModal(false);
        alert(editingMixer ? 'Миксер обновлён' : 'Миксер успешно добавлен');
      } else {
        alert('Ошибка при сохранении');
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
    if (!confirm('Удалить этого водителя?')) return;
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

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '14px',
    background: '#25334A',
    border: 'none',
    borderRadius: '12px',
    color: '#fff',
    marginBottom: '16px',
    boxSizing: 'border-box'
  };

  const getStatusStyle = (status: string) => {
    if (status === 'Загрузка')   return { color: '#FACC15', bg: '#FACC1520' };
    if (status === 'В пути')     return { color: '#3B82F6', bg: '#3B82F620' };
    if (status === 'На объекте') return { color: '#10B981', bg: '#10B98120' };
    if (status === 'Проблема')   return { color: '#EF4444', bg: '#EF444420' };
    return { color: '#94A3B8', bg: '#334155' }; // Доступен / прочие
  };

  // Эффективный статус: если есть активный рейс — показываем его статус, иначе «Доступен»
  const effectiveStatus = (mixer: Mixer) =>
    activeTripMap.get(mixer.number) ?? 'Доступен';

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
      
      {/* ==================== ЗАГОЛОВОК + ВКЛАДКИ + КНОПКА ДОБАВИТЬ ==================== */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexShrink: 0, gap: '16px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
          <h1 style={{
            fontSize: '26px',
            fontWeight: 700,
            color: '#fff',
            marginTop: 0,
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <Truck size={26} color="#94A3B8" />
            Миксеры
          </h1>

          {/* Вкладка «Тарифы доставки» — видна только admin (см. AGENTS.md о доступе), больше никому. */}
          {isAdmin && (
            <div style={{ display: 'flex', gap: '6px', background: '#1E2937', borderRadius: '9999px', padding: '4px' }}>
              <button
                onClick={() => setActiveTab('mixers')}
                style={{
                  padding: '8px 18px', borderRadius: '9999px', border: 'none', cursor: 'pointer',
                  background: activeTab === 'mixers' ? '#334155' : 'transparent',
                  color: activeTab === 'mixers' ? '#fff' : '#94A3B8',
                  fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '7px',
                }}
              >
                <Truck size={15} />
                Миксеры
              </button>
              <button
                onClick={() => setActiveTab('delivery')}
                style={{
                  padding: '8px 18px', borderRadius: '9999px', border: 'none', cursor: 'pointer',
                  background: activeTab === 'delivery' ? '#334155' : 'transparent',
                  color: activeTab === 'delivery' ? '#fff' : '#94A3B8',
                  fontWeight: 600, fontSize: '14px', display: 'flex', alignItems: 'center', gap: '7px',
                }}
              >
                <DollarSign size={15} />
                Тарифы доставки
              </button>
            </div>
          )}
        </div>

        {activeTab === 'mixers' && (
          <button 
            onClick={openAddModal} 
            style={{ 
              padding: '10px 22px', 
              background: '#10B981', 
              color: 'white', 
              border: 'none', 
              borderRadius: '9999px', 
              fontWeight: '600',
              fontSize: '14.5px'
            }}
          >
            + Добавить миксер
          </button>
        )}
      </div>

      {activeTab === 'delivery' ? (
        <DeliverySettingsTab />
      ) : (
      <>
      {/* ==================== ПАНЕЛЬ УПРАВЛЕНИЯ (ФИЛЬТРЫ + ВИД) ==================== */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px',
        marginBottom: '14px',
        flexShrink: 0
      }}>
        
        {/* Левая группа — фильтры */}
        <div style={{ display: 'flex', gap: '8px' }}>
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

        {/* Правая группа — Плитка / Список */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            onClick={() => setViewMode('grid')} 
            style={{
              padding: '10px 20px',
              background: 'transparent',
              border: 'none',
              color: viewMode === 'grid' ? '#10B981' : '#64748B',
              fontSize: '17px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              position: 'relative',
              transition: 'color 0.25s ease',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: '22px', opacity: viewMode === 'grid' ? 0.9 : 0.45 }}>▦</span>
            Плитка
            {viewMode === 'grid' && (
              <div style={{
                position: 'absolute',
                bottom: '3px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '5px',
                height: '5px',
                backgroundColor: '#10B981',
                borderRadius: '50%',
                boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.25)'
              }} />
            )}
          </button>

          <button 
            onClick={() => setViewMode('list')} 
            style={{
              padding: '10px 20px',
              background: 'transparent',
              border: 'none',
              color: viewMode === 'list' ? '#10B981' : '#64748B',
              fontSize: '17px',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              position: 'relative',
              transition: 'color 0.25s ease',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: '24px', opacity: viewMode === 'list' ? 0.9 : 0.45, lineHeight: 1 }}>≡</span>
            Список
            {viewMode === 'list' && (
              <div style={{
                position: 'absolute',
                bottom: '3px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '5px',
                height: '5px',
                backgroundColor: '#10B981',
                borderRadius: '50%',
                boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.25)'
              }} />
            )}
          </button>
        </div>
      </div>

      {/* ==================== ОСНОВНОЙ КОНТЕНТ (СПИСОК / ПЛИТКА) ==================== */}
      <div className="scroll-hidden" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px', color: '#94A3B8' }}>Загрузка миксеров...</div>
      ) : (
        <>
                              {/* ==================== РЕЖИМ ПЛИТКИ (компактный и гармоничный) ==================== */}
          {viewMode === 'grid' && (
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', 
              gap: '16px',
              paddingBottom: '4px'
            }}>
              {filteredMixers.map((mixer) => {
                const dispStatus = effectiveStatus(mixer);
                const statusStyle = getStatusStyle(dispStatus);
                return (
                  <div 
                    key={mixer.id} 
                    style={{ 
                      background: '#1E2937', 
                      borderRadius: '16px', 
                      padding: '16px',
                      transition: 'all 0.25s ease',
                      border: '1px solid #334155',
                      display: 'flex',
                      flexDirection: 'column',
                      alignSelf: 'start'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.transform = 'translateY(-3px)';
                      e.currentTarget.style.boxShadow = '0 15px 35px rgba(0,0,0,0.35)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'none';
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

                    {/* Норма простоя */}
                    <div style={{ color: '#64748B', fontSize: '13px', marginTop: '-10px', marginBottom: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      Норма разгрузки: {mixer.type === 'own' ? OWN_UNLOAD_ALLOWANCE_MIN : (mixer.unload_allowance_min ?? '—')} мин
                    </div>

                    {/* Модель */}
                    <div style={{ color: '#CBD5E1', fontSize: '16.5px', marginBottom: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {mixer.model}
                    </div>

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
                          {mixer.volume} <span style={{ fontSize: '18px', color: '#94A3B8' }}>м³</span>
                        </div>
                      </div>

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
                    </div>

                    {/* Тонкие кнопки в стиле списка */}
                    <div style={{ display: 'flex', gap: '8px' }}>
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

          {/* ==================== РЕЖИМ СПИСКА (компактный) ==================== */}
          {viewMode === 'list' && (
            <div style={{ 
              background: '#1E2937', 
              borderRadius: '20px', 
              overflow: 'hidden',
              boxShadow: '0 10px 30px rgba(0,0,0,0.3)'
            }}>
              {filteredMixers.map((mixer) => {
                const dispStatus = effectiveStatus(mixer);
                const statusStyle = getStatusStyle(dispStatus);
                return (
                  <div 
                    key={mixer.id} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      padding: '8px 28px',
                      borderBottom: '1px solid #334155',
                      transition: 'background 0.2s ease',
                      minHeight: '46px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#25334A'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Номер миксера */}
                    <div style={{ width: '140px', fontWeight: '700', fontSize: '15.5px', color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {mixer.number}
                    </div>

                    {/* Модель */}
                    <div style={{ flex: 1, color: '#CBD5E1', fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {mixer.model}
                    </div>

                    {/* Водитель + телефон */}
                    <div style={{ flex: 1.4, minWidth: 0, overflow: 'hidden' }}>
                      <div style={{ fontWeight: '600', fontSize: '14px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mixer.driver}</div>
                      <div style={{ color: '#94A3B8', fontSize: '12.5px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mixer.phone}</div>
                    </div>

                    {/* Объём */}
                    <div style={{ width: '90px', fontSize: '15px', fontWeight: '700', textAlign: 'center', whiteSpace: 'nowrap' }}>
                      {mixer.volume} м³
                    </div>

                    {/* Статус */}
                    <div style={{ width: '150px' }}>
                      <span style={{ 
                        padding: '4px 14px', 
                        borderRadius: '9999px', 
                        background: statusStyle.bg, 
                        color: statusStyle.color, 
                        fontWeight: '600',
                        fontSize: '13px',
                        whiteSpace: 'nowrap'
                      }}>
                        {dispStatus}
                      </span>
                    </div>

                    {/* Тип */}
                    <div style={{ width: '120px' }}>
                      <span style={{ 
                        padding: '4px 14px', 
                        borderRadius: '9999px', 
                        background: mixer.type === 'own' ? '#10B98120' : '#FACC1520', 
                        color: mixer.type === 'own' ? '#10B981' : '#FACC15',
                        fontWeight: '600',
                        fontSize: '13px',
                        whiteSpace: 'nowrap'
                      }}>
                        {mixer.type === 'own' ? 'Свой' : 'Наемный'}
                      </span>
                    </div>

                    {/* Кнопки действий */}
                    <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
                      <button
                        onClick={() => setHistoryMixer(mixer)}
                        style={{
                          padding: '6px 14px',
                          background: 'rgba(74,222,128,0.1)',
                          color: '#4ADE80',
                          border: '1px solid rgba(74,222,128,0.3)',
                          borderRadius: '9999px',
                          fontWeight: '500',
                          fontSize: '13px',
                          whiteSpace: 'nowrap',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = 'rgba(74,222,128,0.2)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'rgba(74,222,128,0.1)';
                        }}
                      >
                        📋 История
                      </button>
                      <button 
                        onClick={() => openEditModal(mixer)} 
                        style={{ 
                          padding: '6px 16px',
                          background: '#334155',
                          color: '#E2E8F0',
                          border: 'none', 
                          borderRadius: '9999px', 
                          fontWeight: '500',
                          fontSize: '13.5px',
                          whiteSpace: 'nowrap',
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
                        Редактировать
                      </button>
                    </div>
                  </div>
                );
              })}
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
            background: 'rgba(0,0,0,0.9)', 
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
            style={{ 
              background: '#1E2937', 
              width: '100%',
              maxWidth: '520px', 
              maxHeight: '90vh',
              overflowY: 'auto',
              borderRadius: '20px', 
              padding: '28px',
              boxSizing: 'border-box',
              margin: '0 16px'
            }} 
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: '24px' }}>
              {editingMixer ? 'Редактировать миксер' : 'Добавить миксер'}
            </h2>
            
            <input 
              type="text" 
              placeholder="Номер миксера *" 
              value={formData.number} 
              onChange={(e) => setFormData({...formData, number: e.target.value})} 
              style={inputStyle} 
            />
            <input 
              type="text" 
              placeholder="Модель" 
              value={formData.model} 
              onChange={(e) => setFormData({...formData, model: e.target.value})} 
              style={inputStyle} 
            />
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
              <div style={{ marginBottom: '20px', background: '#162032', borderRadius: '12px', padding: '14px' }}>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
                  Дополнительные водители
                </div>

                {extraDrivers.length === 0 && !showAddDriver && (
                  <div style={{ color: '#475569', fontSize: '13px', marginBottom: '10px' }}>
                    Нет дополнительных водителей
                  </div>
                )}

                {/* Список */}
                {extraDrivers.map((d) => (
                  <div key={d.id} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: '#25334A', borderRadius: '10px', padding: '10px 12px',
                    marginBottom: '6px',
                  }}>
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

                {/* Форма добавления */}
                {showAddDriver ? (
                  <div style={{ background: '#25334A', borderRadius: '10px', padding: '12px', marginTop: '4px' }}>
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
                        style={{ flex: 1, padding: '10px', background: '#334155', borderRadius: '9999px', color: '#94A3B8', border: 'none', cursor: 'pointer', fontSize: '13px' }}
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
                      background: 'none', border: '1px dashed #334155',
                      borderRadius: '10px', color: '#60A5FA', fontSize: '13px',
                      cursor: 'pointer', fontWeight: 600,
                    }}
                  >+ Добавить водителя</button>
                )}
              </div>
            )}

            <div style={{ marginBottom: '16px' }}>
              <label>Объём (м³)</label>
              <input 
                type="number" 
                value={formData.volume} 
                onChange={(e) => setFormData({...formData, volume: Number(e.target.value)})} 
                style={{ ...inputStyle, marginBottom: 0, marginTop: '8px' }} 
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label>Тип миксера</label>
              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button 
                  onClick={() => setFormData({...formData, type: 'own'})} 
                  style={{ flex: 1, padding: '12px', background: formData.type === 'own' ? '#10B981' : '#25334A', borderRadius: '12px', color: 'white', border: 'none', boxSizing: 'border-box' }}
                >
                  Свой
                </button>
                <button 
                  onClick={() => setFormData({...formData, type: 'rented'})} 
                  style={{ flex: 1, padding: '12px', background: formData.type === 'rented' ? '#FACC15' : '#25334A', borderRadius: '12px', color: 'white', border: 'none', boxSizing: 'border-box' }}
                >
                  Наемный
                </button>
              </div>
            </div>

            {formData.type === 'rented' ? (
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
            )}

            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => setShowModal(false)} 
                style={{ flex: 1, padding: '14px', background: '#334155', borderRadius: '9999px', color: 'white', border: 'none', boxSizing: 'border-box' }}
              >
                Отмена
              </button>
              <button 
                onClick={saveMixer} 
                style={{ flex: 1, padding: '14px', background: '#10B981', borderRadius: '9999px', fontWeight: '600', color: 'white', border: 'none', boxSizing: 'border-box' }}
              >
                {editingMixer ? 'Сохранить изменения' : 'Добавить миксер'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}