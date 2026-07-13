'use client';

import { useState, useEffect } from 'react';
import { OWN_UNLOAD_ALLOWANCE_MIN } from '@/lib/mixerConfig';

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
}

export default function MixersPage() {
  const [mixers, setMixers] = useState<Mixer[]>([]);
  const [loading, setLoading] = useState(true);

  const [filter, setFilter] = useState<'all' | 'own' | 'rented'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showModal, setShowModal] = useState(false);
  const [editingMixer, setEditingMixer] = useState<Mixer | null>(null);

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

  // ==================== ЗАГРУЗКА МИКСЕРОВ ====================
  useEffect(() => {
    fetchMixers();
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

  const filteredMixers = mixers.filter(m => 
    filter === 'all' || m.type === filter
  );

  // ==================== ФУНКЦИИ МОДАЛЬНОГО ОКНА ====================
  const openAddModal = () => {
    setEditingMixer(null);
    setFormData({ number: '', model: '', driver: '', phone: '', volume: 10, type: 'own', status: 'Доступен', unload_allowance_min: 50 });
    setShowModal(true);
  };

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

  const getStatusStyle = (status: string) => {
    if (status === 'В пути') return { color: '#3B82F6', bg: '#3B82F620' };
    if (status === 'На объекте') return { color: '#10B981', bg: '#10B98120' };
    if (status === 'Загрузка') return { color: '#FACC15', bg: '#FACC1520' };
    return { color: '#94A3B8', bg: '#334155' };
  };

  return (
    <div style={{ background: '#0F172A', minHeight: '100vh', color: '#fff', padding: '32px 40px' }}>
      
      {/* ==================== ЗАГОЛОВОК + КНОПКА ДОБАВИТЬ ==================== */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
        <h1 style={{
          fontSize: '32px',
          fontWeight: '700',
          display: 'flex',
          alignItems: 'flex-end',
          gap: '12px'
        }}>
          <img 
            src="/icons/mixer-truck.png" 
            alt="Миксер" 
            style={{ 
              width: '52px', 
              height: '52px', 
              objectFit: 'contain',
              marginBottom: '-4px'
            }} 
          />
          Миксеры
        </h1>

        <button 
          onClick={openAddModal} 
          style={{ 
            padding: '14px 28px', 
            background: '#10B981', 
            color: 'white', 
            border: 'none', 
            borderRadius: '9999px', 
            fontWeight: '600',
            fontSize: '16px'
          }}
        >
          + Добавить миксер
        </button>
      </div>

      {/* ==================== ПАНЕЛЬ УПРАВЛЕНИЯ (ФИЛЬТРЫ + ВИД) ==================== */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px',
        marginBottom: '32px'
      }}>
        
        {/* Левая группа — фильтры */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button 
            onClick={() => setFilter('all')} 
            style={{
              padding: '12px 28px',
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
              padding: '12px 28px',
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
              padding: '12px 28px',
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
              padding: '12px 24px',
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
              padding: '12px 24px',
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
      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px', color: '#94A3B8' }}>Загрузка миксеров...</div>
      ) : (
        <>
                              {/* ==================== РЕЖИМ ПЛИТКИ (компактный и гармоничный) ==================== */}
          {viewMode === 'grid' && (
            <div style={{ 
              display: 'grid', 
              gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', 
              gap: '20px' 
            }}>
              {filteredMixers.map((mixer) => {
                const statusStyle = getStatusStyle(mixer.status);
                return (
                  <div 
                    key={mixer.id} 
                    style={{ 
                      background: '#1E2937', 
                      borderRadius: '18px', 
                      padding: '20px',
                      transition: 'all 0.25s ease',
                      border: '1px solid #334155',
                      height: 'fit-content'
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                      <div style={{ fontSize: '22px', fontWeight: '700' }}>
                        {mixer.number}
                      </div>
                      <div style={{ 
                        padding: '5px 14px', 
                        borderRadius: '9999px', 
                        fontSize: '13.5px',
                        fontWeight: '600',
                        background: mixer.type === 'own' ? '#10B98120' : '#FACC1520', 
                        color: mixer.type === 'own' ? '#10B981' : '#FACC15'
                      }}>
                        {mixer.type === 'own' ? 'Свой' : 'Наемный'}
                      </div>
                    </div>

                    {/* Норма простоя */}
                    <div style={{ color: '#64748B', fontSize: '13px', marginTop: '-10px', marginBottom: '12px' }}>
                      Норма разгрузки: {mixer.type === 'own' ? OWN_UNLOAD_ALLOWANCE_MIN : (mixer.unload_allowance_min ?? '—')} мин
                    </div>

                    {/* Модель */}
                    <div style={{ color: '#CBD5E1', fontSize: '16.5px', marginBottom: '12px' }}>
                      {mixer.model}
                    </div>

                    {/* Водитель + Телефон */}
                    <div style={{ marginBottom: '20px' }}>
                      <div style={{ fontWeight: '600', fontSize: '16px' }}>{mixer.driver}</div>
                      <div style={{ color: '#94A3B8', fontSize: '14.5px' }}>{mixer.phone}</div>
                    </div>

                    {/* Объём + Статус */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
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
                        fontSize: '14px'
                      }}>
                        {mixer.status}
                      </div>
                    </div>

                    {/* Тонкие кнопки в стиле списка */}
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button 
                        onClick={() => openEditModal(mixer)} 
                        style={{ 
                          flex: 1, 
                          padding: '10px 16px',
                          background: '#334155',
                          color: '#E2E8F0',
                          border: 'none', 
                          borderRadius: '9999px', 
                          fontWeight: '500',
                          fontSize: '14.5px',
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
                      <button 
                        style={{ 
                          flex: 1, 
                          padding: '10px 16px',
                          background: '#334155',
                          color: '#E2E8F0',
                          border: 'none', 
                          borderRadius: '9999px', 
                          fontWeight: '500',
                          fontSize: '14.5px'
                        }}
                      >
                        📍 На карте
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
                const statusStyle = getStatusStyle(mixer.status);
                return (
                  <div 
                    key={mixer.id} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      padding: '18px 28px',
                      borderBottom: '1px solid #334155',
                      transition: 'background 0.2s ease',
                      minHeight: '72px'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#25334A'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                  >
                    {/* Номер миксера */}
                    <div style={{ width: '140px', fontWeight: '700', fontSize: '18px', color: '#fff' }}>
                      {mixer.number}
                    </div>

                    {/* Модель */}
                    <div style={{ flex: 1, color: '#CBD5E1', fontSize: '16px' }}>
                      {mixer.model}
                    </div>

                    {/* Водитель + телефон */}
                    <div style={{ flex: 1.4 }}>
                      <div style={{ fontWeight: '600' }}>{mixer.driver}</div>
                      <div style={{ color: '#94A3B8', fontSize: '14.5px' }}>{mixer.phone}</div>
                    </div>

                    {/* Объём */}
                    <div style={{ width: '110px', fontSize: '18px', fontWeight: '700', textAlign: 'center' }}>
                      {mixer.volume} м³
                    </div>

                    {/* Статус */}
                    <div style={{ width: '160px' }}>
                      <span style={{ 
                        padding: '6px 18px', 
                        borderRadius: '9999px', 
                        background: statusStyle.bg, 
                        color: statusStyle.color, 
                        fontWeight: '600',
                        fontSize: '14px'
                      }}>
                        {mixer.status}
                      </span>
                    </div>

                    {/* Тип */}
                    <div style={{ width: '130px' }}>
                      <span style={{ 
                        padding: '6px 18px', 
                        borderRadius: '9999px', 
                        background: mixer.type === 'own' ? '#10B98120' : '#FACC1520', 
                        color: mixer.type === 'own' ? '#10B981' : '#FACC15',
                        fontWeight: '600',
                        fontSize: '14px'
                      }}>
                        {mixer.type === 'own' ? 'Свой' : 'Наемный'}
                      </span>
                    </div>

                    {/* Кнопка Редактировать */}
                    <button 
                      onClick={() => openEditModal(mixer)} 
                      style={{ 
                        padding: '9px 20px',
                        background: '#334155',
                        color: '#E2E8F0',
                        border: 'none', 
                        borderRadius: '9999px', 
                        fontWeight: '500',
                        fontSize: '14.5px',
                        marginLeft: 'auto',
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
                );
              })}
            </div>
          )}
        </>
      )}

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
            justifyContent: 'center' 
          }} 
          onClick={() => setShowModal(false)}
        >
          <div 
            style={{ 
              background: '#1E2937', 
              width: '520px', 
              borderRadius: '20px', 
              padding: '32px' 
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
              style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', marginBottom: '16px' }} 
            />
            <input 
              type="text" 
              placeholder="Модель" 
              value={formData.model} 
              onChange={(e) => setFormData({...formData, model: e.target.value})} 
              style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', marginBottom: '16px' }} 
            />
            <input 
              type="text" 
              placeholder="ФИО водителя *" 
              value={formData.driver} 
              onChange={(e) => setFormData({...formData, driver: e.target.value})} 
              style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', marginBottom: '16px' }} 
            />
            <input 
              type="tel" 
              placeholder="Телефон водителя *" 
              value={formData.phone} 
              onChange={(e) => setFormData({...formData, phone: e.target.value})} 
              style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', marginBottom: '16px' }} 
            />

            <div style={{ marginBottom: '16px' }}>
              <label>Объём (м³)</label>
              <input 
                type="number" 
                value={formData.volume} 
                onChange={(e) => setFormData({...formData, volume: Number(e.target.value)})} 
                style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff' }} 
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label>Тип миксера</label>
              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button 
                  onClick={() => setFormData({...formData, type: 'own'})} 
                  style={{ flex: 1, padding: '12px', background: formData.type === 'own' ? '#10B981' : '#25334A', borderRadius: '12px', color: 'white' }}
                >
                  Свой
                </button>
                <button 
                  onClick={() => setFormData({...formData, type: 'rented'})} 
                  style={{ flex: 1, padding: '12px', background: formData.type === 'rented' ? '#FACC15' : '#25334A', borderRadius: '12px', color: 'white' }}
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
                  style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', marginTop: '8px' }}
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
                style={{ flex: 1, padding: '14px', background: '#334155', borderRadius: '9999px', color: 'white' }}
              >
                Отмена
              </button>
              <button 
                onClick={saveMixer} 
                style={{ flex: 1, padding: '14px', background: '#10B981', borderRadius: '9999px', fontWeight: '600', color: 'white' }}
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