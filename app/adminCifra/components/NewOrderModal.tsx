'use client';

import { useState, useMemo, useEffect } from 'react';

interface NewOrderModalProps {
  onClose: () => void;
  onSuccess: (newOrder?: any) => void;
}

export default function NewOrderModal({ onClose, onSuccess }: NewOrderModalProps) {
  const [adminUserId, setAdminUserId] = useState<number>(1);

  // Получаем реальный userId администратора из localStorage
  useEffect(() => {
    const savedId = localStorage.getItem('userId');
    if (savedId) {
      const id = parseInt(savedId);
      if (!isNaN(id)) {
        setAdminUserId(id);
        console.log('👤 Админ userId загружен:', id);
      }
    }
  }, []);

  const [form, setForm] = useState({
    grade: 'М300',
    volume: '',
    deliveryDate: new Date().toISOString().split('T')[0],
    deliveryTime: '10:00',
    address: '',
    customerType: 'physical' as 'physical' | 'legal',
    organizationName: '',
    fullName: '',
    phone: '',
    inn: '',
    comment: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingInn, setLoadingInn] = useState(false);
  

  // ==================== РАСЧЁТ СТОИМОСТИ ====================
const volume = parseFloat(form.volume) || 0;

const pricePerCubic: Record<string, number> = {
  'М100': 6380,
  'М100и': 5050,     // на доломите
  'М150': 6500,
  'М150и': 5450,     // на доломите
  'М200': 6600,
  'М200и': 5600,     // на доломите
  'М250': 6950,
  'М250и': 5950,     // на доломите
  'М300': 7230,
  'М350': 7400,
  'М400': 8050,
  'М450': 8350,
  'М500': 8700,
  
};

  const concreteCost = useMemo(() => {
    return volume > 0 ? Math.round(volume * (pricePerCubic[form.grade] || 7230)) : 0;
  }, [volume, form.grade]);

  let deliveryCost = 0;
  let deliveryNote = '';
  if (volume > 0) {
    if (volume <= 10) { deliveryCost = 6000; deliveryNote = '6000 ₽ за рейс (до 10 м³)'; }
    else if (volume <= 12) { deliveryCost = 7500; deliveryNote = '7500 ₽ за рейс (12 м³)'; }
    else if (volume <= 50) { deliveryCost = Math.ceil(volume / 10) * 6000; deliveryNote = `${Math.ceil(volume / 10)} рейса × 6000 ₽`; }
    else { deliveryCost = Math.round(volume * 600); deliveryNote = '600 ₽ за 1 м³'; }
  }
  const totalPrice = concreteCost + deliveryCost;

  // ==================== ОБРАБОТЧИК ИЗМЕНЕНИЙ ====================
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  // ==================== АВТОЗАПОЛНЕНИЕ ПО ИНН ====================
  const fetchByInn = async (inn: string) => {
    if (inn.length < 10) return;
    setLoadingInn(true);

    try {
      const res = await fetch('/api/dadata/party', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: inn }),
      });

      const data = await res.json();
      if (data.suggestions?.[0]) {
        const company = data.suggestions[0].data;
        setForm(prev => ({
          ...prev,
          organizationName: company.name?.short_with_opf || company.name?.short || prev.organizationName,
          address: company.address?.value || prev.address,
        }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingInn(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setIsSubmitting(true);

  // ================================================
  // 1. ВАЛИДАЦИЯ ВВОДА
  // ================================================
  if (!form.volume || parseFloat(form.volume) <= 0) {
    alert('Укажите объём бетона больше 0 м³');
    setIsSubmitting(false);
    return;
  }

  if (!form.address || form.address.trim().length < 5) {
    alert('Укажите полный адрес доставки');
    setIsSubmitting(false);
    return;
  }

  const currentPhone = form.phone || '';
  if (!currentPhone || currentPhone.replace(/\D/g, '').length < 10) {
    alert('Укажите корректный номер телефона');
    setIsSubmitting(false);
    return;
  }

  if (form.customerType === 'legal' && (!form.organizationName || form.organizationName.trim().length < 3)) {
    alert('Укажите название организации');
    setIsSubmitting(false);
    return;
  }

  if (form.customerType === 'physical' && (!form.fullName || form.fullName.trim().length < 5)) {
    alert('Укажите ФИО полностью');
    setIsSubmitting(false);
    return;
  }

  // ================================================
  // 2. ПОДГОТОВКА PAYLOAD (аналогично мини-приложению)
  // ================================================
  const payload = {
  userId: adminUserId,

  grade: form.grade,
  volume: parseFloat(form.volume),
  delivery_date: form.deliveryDate,
  delivery_time: form.deliveryTime,
  address: form.address.trim(),
  phone: currentPhone,

  customerType: form.customerType === 'legal' 
    ? 'Юридическое лицо' 
    : 'Физическое лицо',

  organization_name: form.organizationName?.trim() || null,
  full_name: form.fullName?.trim() || null,
  inn: form.inn?.trim() || null,

  concreteCost: concreteCost || 0,
  deliveryCost: deliveryCost || 0,
  totalPrice: totalPrice || 0,

  comment: form.comment?.trim() || null,

  // ==================== ФЛАГ ДЛЯ АДМИНКИ ====================
  isFromAdmin: true,     // ← Это отключает проверку времени
  source: 'admin'
};
  console.log('🚀 ФИНАЛЬНЫЙ PAYLOAD из админки:', JSON.stringify(payload, null, 2));

  try {
    const response = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log('📥 Ответ от /api/order:', data);

    if (data.success) {
    const createdOrder: any = {
      id: data.orderId,
      grade: payload.grade,
      volume: payload.volume,
      delivery_date: payload.delivery_date,
      delivery_time: payload.delivery_time,
      address: payload.address,
      phone: payload.phone,
      organization_name: payload.organization_name,
      full_name: payload.full_name,
      inn: payload.inn,
      status: 'new',
      created_at: new Date().toISOString(),
    };
      alert(`✅ Заявка #${data.orderId} успешно создана!`);
      onSuccess(createdOrder);
      onClose();
    } else if (response.status === 409) {
      alert('Конфликт времени. Выберите другое время.');
    } else {
      alert(data.message || 'Ошибка создания заявки');
    }

  } catch (error) {
    console.error('Submit error:', error);
    alert('Ошибка соединения с сервером');
  } finally {
    setIsSubmitting(false);
  }
};

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.94)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#1E2937', width: '920px', borderRadius: '24px', padding: '32px', maxHeight: '92vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: 0, fontSize: '28px' }}>Новая заявка на бетон</h2>
          <button onClick={onClose} style={{ fontSize: '42px', background: 'none', border: 'none', color: '#94A3B8' }}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>

            {/* Левая колонка — Клиент */}
            <div>
              <h3 style={{ color: '#94A3B8', marginBottom: '18px' }}>Клиент</h3>
              <div style={{ background: '#25334A', padding: '24px', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                
                <div>
                  <label style={{ color: '#94A3B8', marginBottom: '8px', display: 'block' }}>Тип заказчика</label>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button type="button" onClick={() => setForm(p => ({...p, customerType: 'physical'}))}
                      style={{ flex: 1, padding: '12px', borderRadius: '12px', background: form.customerType === 'physical' ? '#3B82F6' : '#334155', color: 'white', border: 'none' }}>
                      Физ. лицо
                    </button>
                    <button type="button" onClick={() => setForm(p => ({...p, customerType: 'legal'}))}
                      style={{ flex: 1, padding: '12px', borderRadius: '12px', background: form.customerType === 'legal' ? '#3B82F6' : '#334155', color: 'white', border: 'none' }}>
                      Юр. лицо
                    </button>
                  </div>
                </div>

                {form.customerType === 'legal' && (
                  <div>
                    <label style={{ color: '#94A3B8', marginBottom: '8px', display: 'block' }}>ИНН организации</label>
                    <input
                      type="text"
                      name="inn"
                      placeholder="7707083893"
                      value={form.inn}
                      onChange={(e) => {
                        const inn = e.target.value.replace(/\D/g, '').slice(0, 12);
                        setForm(p => ({ ...p, inn }));
                        if (inn.length === 10 || inn.length === 12) fetchByInn(inn);
                      }}
                      style={{ width: '93%', padding: '14px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }}
                    />
                    {loadingInn && <small style={{ color: '#60A5FA' }}>⏳ Загрузка данных...</small>}
                  </div>
                )}

                {form.customerType === 'legal' ? (
                  <input
                    type="text"
                    name="organizationName"
                    placeholder="Название организации"
                    value={form.organizationName}
                    onChange={handleChange}
                    style={{ padding: '14px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }}
                    required
                  />
                ) : (
                  <input
                    type="text"
                    name="fullName"
                    placeholder="ФИО полностью"
                    value={form.fullName}
                    onChange={handleChange}
                    style={{ padding: '14px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }}
                    required
                  />
                )}

                <input
                  type="tel"
                  name="phone"
                  placeholder="+7 (___) ___-__-__"
                  value={form.phone}
                  onChange={handleChange}
                  style={{ padding: '14px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }}
                  required
                />
              </div>
            </div>

            {/* Правая колонка — Параметры заказа */}
            <div>
              <h3 style={{ color: '#94A3B8', marginBottom: '18px' }}>Параметры заказа</h3>
              <div style={{ background: '#25334A', padding: '24px', borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <select name="grade" value={form.grade} onChange={handleChange} style={{ padding: '14px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }}>
                  {Object.keys(pricePerCubic).map(g => <option key={g} value={g}>{g}</option>)}
                </select>

                <input type="number" name="volume" placeholder="Объём, м³" value={form.volume} onChange={handleChange} step="0.1" min="0.1" style={{ padding: '14px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }} required />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <input type="date" name="deliveryDate" value={form.deliveryDate} onChange={handleChange} style={{ padding: '14px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }} required />
                  <input type="time" name="deliveryTime" value={form.deliveryTime} onChange={handleChange} style={{ padding: '14px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }} required />
                </div>

                {volume > 0 && (
                  <div style={{ background: '#1E2937', padding: '16px', borderRadius: '12px', marginTop: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Бетон:</span><span>{concreteCost.toLocaleString()} ₽</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Доставка:</span><span>{deliveryCost.toLocaleString()} ₽</span></div>
                    {deliveryNote && <div style={{ color: '#34D399', marginTop: '8px' }}>🚚 {deliveryNote}</div>}
                    <div style={{ marginTop: '12px', fontWeight: '700', fontSize: '18px', borderTop: '1px solid #475569', paddingTop: '10px' }}>
                      Итого: {totalPrice.toLocaleString()} ₽
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Адрес */}
          <div style={{ marginTop: '28px' }}>
            <label style={{ color: '#94A3B8', marginBottom: '8px', display: 'block' }}>Адрес доставки</label>
            <textarea name="address" value={form.address} onChange={handleChange} placeholder="Полный адрес объекта" style={{ width: '97%', padding: '16px', background: '#25334A', border: 'none', borderRadius: '16px', color: '#fff', minHeight: '80px' }} required />
          </div>

          {/* Комментарий */}
          <div style={{ marginTop: '20px' }}>
            <label style={{ color: '#94A3B8', marginBottom: '8px', display: 'block' }}>Комментарий</label>
            <textarea name="comment" value={form.comment} onChange={handleChange} placeholder="Дополнительная информация..." style={{ width: '97%', padding: '16px', background: '#25334A', border: 'none', borderRadius: '16px', color: '#fff', minHeight: '100px' }} />
          </div>

          <div style={{ display: 'flex', gap: '16px', marginTop: '40px' }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '16px', background: '#334155', color: 'white', border: 'none', borderRadius: '9999px' }}>
              Отмена
            </button>
            <button type="submit" disabled={isSubmitting} style={{ flex: 1, padding: '16px', background: '#10B981', color: 'white', border: 'none', borderRadius: '9999px', fontWeight: '600' }}>
              {isSubmitting ? 'Создаём...' : 'Создать заявку'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}