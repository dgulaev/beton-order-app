'use client';

import { useState } from 'react';

interface NewOrderModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function NewOrderModal({ onClose, onSuccess }: NewOrderModalProps) {
  const [formData, setFormData] = useState({
    organization_name: '',
    full_name: '',
    phone: '',
    grade: 'М300',
    volume: '',
    delivery_date: '',
    delivery_time: '',
    address: '',
    comment: '',
  });

  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const res = await fetch('/api/adminCifra/all-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          volume: Number(formData.volume),
          status: 'new',
        }),
      });

      if (res.ok) {
        alert('✅ Новая заявка успешно создана!');
        onSuccess();
        onClose();
      } else {
        alert('Ошибка при создании заявки');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка соединения с сервером');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      style={{ 
        position: 'fixed', 
        inset: 0, 
        background: 'rgba(0,0,0,0.94)', 
        zIndex: 10000, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center' 
      }} 
      onClick={onClose}
    >
      <div 
        style={{ 
          background: '#1E2937', 
          width: '920px', 
          borderRadius: '24px', 
          padding: '32px', 
          maxHeight: '92vh', 
          overflow: 'auto',
          boxShadow: '0 30px 80px rgba(0,0,0,0.8)'
        }} 
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: 0, fontSize: '28px' }}>Новая заявка</h2>
          <button 
            onClick={onClose}
            style={{ fontSize: '42px', background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer' }}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '28px' }}>
            
            {/* Левая колонка */}
            <div>
              <h3 style={{ color: '#94A3B8', marginBottom: '16px' }}>Клиент</h3>
              <input 
                type="text" 
                placeholder="Название организации" 
                value={formData.organization_name}
                onChange={(e) => setFormData({...formData, organization_name: e.target.value})}
                style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', marginBottom: '12px' }}
              />
              <input 
                type="text" 
                placeholder="ФИО (если физлицо)" 
                value={formData.full_name}
                onChange={(e) => setFormData({...formData, full_name: e.target.value})}
                style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', marginBottom: '12px' }}
              />
              <input 
                type="tel" 
                placeholder="Телефон" 
                value={formData.phone}
                onChange={(e) => setFormData({...formData, phone: e.target.value})}
                style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff' }}
              />
            </div>

            {/* Правая колонка */}
            <div>
              <h3 style={{ color: '#94A3B8', marginBottom: '16px' }}>Параметры бетона</h3>
              <select 
                value={formData.grade}
                onChange={(e) => setFormData({...formData, grade: e.target.value})}
                style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', marginBottom: '12px' }}
              >
                <option value="М200">М200</option>
                <option value="М250">М250</option>
                <option value="М300">М300</option>
                <option value="М350">М350</option>
                <option value="М400">М400</option>
              </select>

              <input 
                type="number" 
                placeholder="Объём, м³" 
                value={formData.volume}
                onChange={(e) => setFormData({...formData, volume: e.target.value})}
                style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', marginBottom: '12px' }}
                required
              />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <input 
                  type="date" 
                  value={formData.delivery_date}
                  onChange={(e) => setFormData({...formData, delivery_date: e.target.value})}
                  style={{ padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff' }}
                  required
                />
                <input 
                  type="time" 
                  value={formData.delivery_time}
                  onChange={(e) => setFormData({...formData, delivery_time: e.target.value})}
                  style={{ padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff' }}
                  required
                />
              </div>
            </div>
          </div>

          <div style={{ marginTop: '24px' }}>
            <label style={{ display: 'block', color: '#94A3B8', marginBottom: '8px' }}>Адрес доставки</label>
            <input 
              type="text" 
              placeholder="Полный адрес объекта" 
              value={formData.address}
              onChange={(e) => setFormData({...formData, address: e.target.value})}
              style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff' }}
              required
            />
          </div>

          <div style={{ marginTop: '24px' }}>
            <label style={{ display: 'block', color: '#94A3B8', marginBottom: '8px' }}>Комментарий</label>
            <textarea 
              placeholder="Дополнительная информация..." 
              value={formData.comment}
              onChange={(e) => setFormData({...formData, comment: e.target.value})}
              style={{ width: '100%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', minHeight: '80px', resize: 'vertical' }}
            />
          </div>

          <div style={{ display: 'flex', gap: '16px', marginTop: '32px' }}>
            <button 
              type="button"
              onClick={onClose}
              style={{ flex: 1, padding: '16px', background: '#334155', color: 'white', border: 'none', borderRadius: '16px', fontSize: '17px' }}
            >
              Отмена
            </button>
            <button 
              type="submit"
              disabled={loading}
              style={{ 
                flex: 1, 
                padding: '16px', 
                background: '#10B981', 
                color: 'white', 
                border: 'none', 
                borderRadius: '16px', 
                fontSize: '17px',
                fontWeight: '600'
              }}
            >
              {loading ? 'Создание...' : 'Создать заявку'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}