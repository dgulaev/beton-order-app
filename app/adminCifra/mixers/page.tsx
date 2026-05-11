'use client';

import { useState } from 'react';

interface Mixer {
  id: number;
  number: string;
  model: string;
  driver: string;
  phone: string;
  volume: number;
  type: 'own' | 'rented';
  status: string;
}

export default function MixersPage() {
  const [mixers, setMixers] = useState<Mixer[]>([
    { id: 1, number: "SHACMAN A784", model: "SHACMAN", driver: "Сидоров А.В.", phone: "+7 (910) 123-45-67", volume: 12, type: 'own', status: 'В пути' },
    { id: 2, number: "KAMAZ 6744", model: "KAMAZ", driver: "Петров С.И.", phone: "+7 (920) 555-33-22", volume: 18, type: 'own', status: 'На объекте' },
    { id: 3, number: "HOWO B392", model: "HOWO", driver: "Иванов И.И.", phone: "+7 (930) 777-88-99", volume: 10, type: 'rented', status: 'Загрузка' },
    { id: 4, number: "MAN TGS 392", model: "MAN", driver: "Кузнецов Д.П.", phone: "+7 (915) 444-22-11", volume: 15, type: 'own', status: 'Возврат' },
  ]);

  const [filter, setFilter] = useState<'all' | 'own' | 'rented'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [showModal, setShowModal] = useState(false);
  const [editingMixer, setEditingMixer] = useState<Mixer | null>(null);

  const [formData, setFormData] = useState({
    number: '', model: '', driver: '', phone: '', volume: 10, type: 'own' as 'own' | 'rented', status: 'Загрузка'
  });

  const filteredMixers = mixers.filter(m => filter === 'all' || m.type === filter);

  const openAddModal = () => {
    setEditingMixer(null);
    setFormData({ number: '', model: '', driver: '', phone: '', volume: 10, type: 'own', status: 'Загрузка' });
    setShowModal(true);
  };

  const openEditModal = (mixer: Mixer) => {
    setEditingMixer(mixer);
    setFormData({ ...mixer });
    setShowModal(true);
  };

  const saveMixer = () => {
    if (!formData.number || !formData.driver) return;
    if (editingMixer) {
      setMixers(mixers.map(m => m.id === editingMixer.id ? { ...m, ...formData } : m));
    } else {
      setMixers([...mixers, { id: Date.now(), ...formData }]);
    }
    setShowModal(false);
  };

  const getStatusStyle = (status: string) => {
    if (status === 'В пути') return { color: '#3B82F6', bg: '#3B82F620' };
    if (status === 'На объекте') return { color: '#10B981', bg: '#10B98120' };
    if (status === 'Загрузка') return { color: '#FACC15', bg: '#FACC1520' };
    return { color: '#94A3B8', bg: '#334155' };
  };

  return (
    <div style={{ background: '#0F172A', minHeight: '100vh', color: '#fff', padding: '32px 40px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
        <h1 style={{ fontSize: '34px', fontWeight: '700' }}>🚛 Миксеры</h1>
        
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <div style={{ background: '#1E2937', borderRadius: '9999px', padding: '6px', display: 'flex' }}>
            <button 
              onClick={() => setViewMode('grid')} 
              style={{ padding: '8px 20px', borderRadius: '9999px', background: viewMode === 'grid' ? '#3B82F6' : 'transparent', color: 'white', fontWeight: '600' }}
            >
              Плитка
            </button>
            <button 
              onClick={() => setViewMode('list')} 
              style={{ padding: '8px 20px', borderRadius: '9999px', background: viewMode === 'list' ? '#3B82F6' : 'transparent', color: 'white', fontWeight: '600' }}
            >
              Список
            </button>
          </div>

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
      </div>

      {/* Фильтры */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '32px' }}>
        <button onClick={() => setFilter('all')} style={{ padding: '10px 24px', background: filter === 'all' ? '#3B82F6' : '#1E2937', borderRadius: '9999px', color: 'white', fontWeight: '600' }}>Все</button>
        <button onClick={() => setFilter('own')} style={{ padding: '10px 24px', background: filter === 'own' ? '#3B82F6' : '#1E2937', borderRadius: '9999px', color: 'white', fontWeight: '600' }}>Свои</button>
        <button onClick={() => setFilter('rented')} style={{ padding: '10px 24px', background: filter === 'rented' ? '#3B82F6' : '#1E2937', borderRadius: '9999px', color: 'white', fontWeight: '600' }}>Наемные</button>
      </div>

      {/* ПЛИТКА */}
      {viewMode === 'grid' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '24px' }}>
          {filteredMixers.map((mixer) => {
            const statusStyle = getStatusStyle(mixer.status);
            return (
              <div 
                key={mixer.id} 
                style={{ 
                  background: '#1E2937', 
                  borderRadius: '20px', 
                  padding: '28px',
                  transition: 'all 0.2s ease'
                }}
                onMouseEnter={(e) => { 
                  e.currentTarget.style.transform = 'translateY(-6px)'; 
                  e.currentTarget.style.boxShadow = '0 20px 25px -5px rgba(0,0,0,0.4)'; 
                }}
                onMouseLeave={(e) => { 
                  e.currentTarget.style.transform = 'translateY(0)'; 
                  e.currentTarget.style.boxShadow = 'none'; 
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                  <div style={{ fontSize: '22px', fontWeight: '700' }}>{mixer.number}</div>
                  <div style={{ 
                    padding: '6px 18px', 
                    borderRadius: '9999px', 
                    background: mixer.type === 'own' ? '#10B98120' : '#FACC1520', 
                    color: mixer.type === 'own' ? '#10B981' : '#FACC15',
                    fontSize: '14px',
                    fontWeight: '600'
                  }}>
                    {mixer.type === 'own' ? 'Свой' : 'Наемный'}
                  </div>
                </div>

                <div style={{ marginBottom: '24px' }}>
                  <div style={{ color: '#CBD5E1', fontSize: '17px' }}>{mixer.model}</div>
                  <div style={{ marginTop: '8px', fontSize: '16px' }}>
                    <strong>{mixer.driver}</strong><br />
                    <span style={{ color: '#94A3B8' }}>{mixer.phone}</span>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                  <div>
                    <div style={{ fontSize: '32px', fontWeight: '700' }}>{mixer.volume} м³</div>
                    <div style={{ color: '#94A3B8', fontSize: '14px' }}>Объём</div>
                  </div>
                  <div style={{ padding: '8px 20px', borderRadius: '9999px', background: statusStyle.bg, color: statusStyle.color, fontWeight: '600' }}>
                    {mixer.status}
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '12px' }}>
                  <button 
                    onClick={() => openEditModal(mixer)} 
                    style={{ flex: 1, padding: '14px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '9999px', fontWeight: '600' }}
                  >
                    ✏️ Редактировать
                  </button>
                  <button style={{ flex: 1, padding: '14px', background: '#334155', color: 'white', border: 'none', borderRadius: '9999px', fontWeight: '600' }}>
                    📍 На карте
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* СПИСОК */}
      {viewMode === 'list' && (
        <div style={{ background: '#1E2937', borderRadius: '20px', overflow: 'hidden' }}>
          {filteredMixers.map((mixer) => {
            const statusStyle = getStatusStyle(mixer.status);
            return (
              <div key={mixer.id} style={{ 
                display: 'flex', 
                alignItems: 'center', 
                padding: '20px 28px', 
                borderBottom: '1px solid #334155',
                transition: 'background 0.2s'
              }} onMouseEnter={(e) => e.currentTarget.style.background = '#25334A'}>
                <div style={{ width: '160px', fontWeight: '700', fontSize: '18px' }}>{mixer.number}</div>
                <div style={{ flex: 1, color: '#CBD5E1' }}>{mixer.model}</div>
                <div style={{ flex: 1 }}>
                  <strong>{mixer.driver}</strong><br />
                  <span style={{ color: '#94A3B8' }}>{mixer.phone}</span>
                </div>
                <div style={{ width: '100px', fontSize: '18px', fontWeight: '600' }}>{mixer.volume} м³</div>
                <div style={{ width: '160px' }}>
                  <span style={{ padding: '6px 18px', borderRadius: '9999px', background: statusStyle.bg, color: statusStyle.color, fontWeight: '600' }}>
                    {mixer.status}
                  </span>
                </div>
                <div style={{ padding: '6px 18px', borderRadius: '9999px', background: mixer.type === 'own' ? '#10B98120' : '#FACC1520', color: mixer.type === 'own' ? '#10B981' : '#FACC15' }}>
                  {mixer.type === 'own' ? 'Свой' : 'Наемный'}
                </div>
                <button 
                  onClick={() => openEditModal(mixer)} 
                  style={{ marginLeft: 'auto', padding: '10px 20px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '9999px', fontWeight: '600' }}
                >
                  Редактировать
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Модальное окно */}
      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowModal(false)}>
          <div style={{ background: '#1E2937', width: '520px', borderRadius: '20px', padding: '32px' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ marginBottom: '24px' }}>{editingMixer ? 'Редактировать миксер' : 'Добавить миксер'}</h2>
            
            <input type="text" placeholder="Номер миксера" value={formData.number} onChange={(e) => setFormData({...formData, number: e.target.value})} style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', marginBottom: '16px' }} />
            <input type="text" placeholder="Модель" value={formData.model} onChange={(e) => setFormData({...formData, model: e.target.value})} style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', marginBottom: '16px' }} />
            <input type="text" placeholder="ФИО водителя" value={formData.driver} onChange={(e) => setFormData({...formData, driver: e.target.value})} style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', marginBottom: '16px' }} />
            <input type="text" placeholder="Телефон" value={formData.phone} onChange={(e) => setFormData({...formData, phone: e.target.value})} style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', marginBottom: '16px' }} />

            <div style={{ marginBottom: '16px' }}>
              <label>Объём (м³)</label>
              <input type="number" value={formData.volume} onChange={(e) => setFormData({...formData, volume: Number(e.target.value)})} style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff' }} />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label>Тип миксера</label>
              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <button onClick={() => setFormData({...formData, type: 'own'})} style={{ flex: 1, padding: '12px', background: formData.type === 'own' ? '#10B981' : '#25334A', borderRadius: '12px', color: 'white' }}>Свой</button>
                <button onClick={() => setFormData({...formData, type: 'rented'})} style={{ flex: 1, padding: '12px', background: formData.type === 'rented' ? '#FACC15' : '#25334A', borderRadius: '12px', color: 'white' }}>Наемный</button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => setShowModal(false)} style={{ flex: 1, padding: '14px', background: '#334155', borderRadius: '9999px', color: 'white' }}>Отмена</button>
              <button onClick={saveMixer} style={{ flex: 1, padding: '14px', background: '#10B981', borderRadius: '9999px', fontWeight: '600', color: 'white' }}>
                {editingMixer ? 'Сохранить изменения' : 'Добавить миксер'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}