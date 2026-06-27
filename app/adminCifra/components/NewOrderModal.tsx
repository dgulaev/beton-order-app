'use client';

import { useState, useMemo, useEffect } from 'react';

interface NewOrderModalProps {
  isOpen: boolean;                    // ← обязательно
  onClose: () => void;
  onSuccess?: (newOrder?: any) => void; // ← если используешь onSuccess
  userId?: any;                       // ID клиента
  userName?: string;                  // Имя клиента (для отображения)
  userPhone?: string;
  currentRole?: string;               // Роль сотрудника
  currentUserName?: string;           // ← Имя сотрудника (для истории) — главное
  initialData?: any;
  defaultDeliveryDate?: string;
  orderHistory?: any[];
  callHistory?: any[];
}

export default function NewOrderModal({ 
  isOpen,
  onClose, 
  onSuccess,
  userId,
  userName = '',                      // имя клиента
  userPhone = '',
  currentRole = 'admin',
  currentUserName = 'Сотрудник',      // ← имя сотрудника, создающего заказ
  initialData = null,
  defaultDeliveryDate,
  orderHistory = [],
  callHistory = [],
}: NewOrderModalProps) {

  // ==================== 1. СОСТОЯНИЯ ====================
  const [adminUserId, setAdminUserId] = useState<number>(1);
  const [recipes, setRecipes] = useState<any[]>([]);
  
  const [orderCreated, setOrderCreated] = useState<any>(null);
  const [notificationSent, setNotificationSent] = useState(false);
  const [isSendingNotification, setIsSendingNotification] = useState(false);

  // ==================== 2. ПРЕДЗАПОЛНЕНИЕ ДАННЫМИ ====================
  useEffect(() => {
    if (initialData) {
      setForm({
        grade: initialData.grade || 'М300',
        volume: initialData.volume?.toString() || '',
        deliveryDate: initialData.deliveryDate || new Date().toISOString().split('T')[0],
        deliveryTime: initialData.deliveryTime || '09:00',
        address: initialData.address || '',
        customerType: initialData.customerType || 'physical',
        organizationName: initialData.organizationName || '',
        fullName: initialData.fullName || '',
        phone: initialData.phone || '',
        inn: initialData.inn || '',
        comment: initialData.comment || '',
      });
    } else if (defaultDeliveryDate) {
      setForm(prev => ({
        ...prev,
        deliveryDate: defaultDeliveryDate
      }));
    }
  }, [initialData, defaultDeliveryDate]);

  // ==================== 3. ЗАГРУЗКА USER_ID АДМИНА ====================
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

  // ==================== 4. ЗАГРУЗКА РЕЦЕПТОВ ====================
  useEffect(() => {
    const loadRecipes = async () => {
      try {
        const res = await fetch('/api/adminCifra/recipes');
        if (res.ok) {
          const data = await res.json();
          setRecipes(data);
        }
      } catch (e) {
        console.error('Ошибка загрузки рецептов:', e);
      }
    };
    loadRecipes();
  }, []);

    // ==================== 5. ФОРМА ====================
  const [form, setForm] = useState({
    grade: 'М300',
    volume: '',
    deliveryDate: new Date().toISOString().split('T')[0],
    deliveryTime: '10:00',
    address: '',
    customerType: 'legal' as 'physical' | 'legal',   // ← Изменено с 'physical' на 'legal'
    organizationName: '',
    fullName: '',
    phone: '',
    inn: '',
    comment: '',
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingInn, setLoadingInn] = useState(false);

  // ==================== 6. РАСЧЁТ СТОИМОСТИ ====================
  const selectedRecipe = recipes.find(r => r.code === form.grade);
  const volume = parseFloat(form.volume) || 0;

  const concreteCost = useMemo(() => {
    return volume > 0 && selectedRecipe 
      ? Math.round(volume * selectedRecipe.price) 
      : 0;
  }, [volume, selectedRecipe]);

  let deliveryCost = 0;
  let deliveryNote = '';
  if (volume > 0) {
    if (volume <= 10) { deliveryCost = 6000; deliveryNote = '6000 ₽ за рейс (до 10 м³)'; }
    else if (volume <= 12) { deliveryCost = 7500; deliveryNote = '7500 ₽ за рейс (12 м³)'; }
    else if (volume <= 50) { deliveryCost = Math.ceil(volume / 10) * 6000; deliveryNote = `${Math.ceil(volume / 10)} рейса × 6000 ₽`; }
    else { deliveryCost = Math.round(volume * 600); deliveryNote = '600 ₽ за 1 м³'; }
  }
  const totalPrice = concreteCost + deliveryCost;

  // ==================== 7. ОБРАБОТЧИКИ ====================
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  // ==================== 8. АВТОЗАПОЛНЕНИЕ ПО ИНН ====================
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
          organizationName: company.name?.short_with_opf || company.name?.short || prev.organizationName || '',
          address: company.address?.value || prev.address || '',
        }));
      }
    } catch (err) {
      console.error('Ошибка Dadata:', err);
    } finally {
      setLoadingInn(false);
    }
  };

      // ==================== 9. СОЗДАНИЕ ЗАЯВКИ ====================
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

  // Получаем ID текущего сотрудника
  const savedUserId = localStorage.getItem('userId');
  const createdByStaff = savedUserId ? parseInt(savedUserId) : 1777619517739;

  // ================================================
  // 2. ПОДГОТОВКА PAYLOAD
  // ================================================
  const payload = {
    userId: adminUserId,                    // ID клиента (если есть)
    grade: form.grade,
    volume: parseFloat(form.volume),
    delivery_date: form.deliveryDate,
    delivery_time: form.deliveryTime,
    address: form.address.trim(),
    phone: currentPhone,
    customerType: form.customerType === 'legal' ? 'Юридическое лицо' : 'Физическое лицо',
    organization_name: form.organizationName?.trim() || null,
    full_name: form.fullName?.trim() || null,
    inn: form.inn?.trim() || null,
    concreteCost: concreteCost || 0,
    deliveryCost: deliveryCost || 0,
    totalPrice: totalPrice || 0,
    comment: form.comment?.trim() || null,

    // ==================== НОВЫЕ ПОЛЯ ДЛЯ ЕДИНООБРАЗИЯ ====================
    created_by: createdByStaff,             // ← Кто создал заявку
    curator_name: currentUserName || 'Сотрудник', // ← Имя куратора

    // ==================== ДАННЫЕ ДЛЯ ИСТОРИИ ====================
    isFromAdmin: true,
    source: 'admin',
    userRole: currentRole || 'admin',
    userName: currentUserName || localStorage.getItem('userName') || 'Сотрудник',
  };

  try {
    console.log('📤 Создание заявки от:', payload.userName, 'ID:', createdByStaff);

    const response = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.success) {
      const createdOrder = {
        id: data.orderId,
        grade: form.grade,
        volume: parseFloat(form.volume),
        delivery_date: form.deliveryDate,
        delivery_time: form.deliveryTime,
        address: form.address,
        phone: currentPhone,
        status: 'new',

        customer_type: form.customerType === 'legal' ? 'Юридическое лицо' : 'Физическое лицо',
        full_name: form.fullName?.trim() || null,
        organization_name: form.organizationName?.trim() || null,
        inn: form.inn?.trim() || null,
        comment: form.comment?.trim() || null,
        created_by: createdByStaff,
      };

      setOrderCreated(createdOrder);
      setNotificationSent(false);

      alert(`✅ Заявка #${data.orderId} успешно создана!`);
      
      if (typeof onSuccess === 'function') {
        onSuccess(createdOrder);
      }

      setTimeout(() => {
        onClose();
      }, 800);

    } else {
      alert(data.message || 'Ошибка создания заявки');
    }
  } catch (error) {
    console.error('❌ Ошибка создания заявки:', error);
    alert('Ошибка соединения с сервером');
  } finally {
    setIsSubmitting(false);
  }
};

  // ==================== 10. РУЧНАЯ ОТПРАВКА УВЕДОМЛЕНИЯ ====================
  const sendNotification = async () => {
    if (!orderCreated) return alert('Сначала создайте заявку');

    setIsSendingNotification(true);

    try {
      const res = await fetch('/api/order/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: orderCreated.id }),
      });

      if (res.ok) {
        setNotificationSent(true);
        alert('✅ Уведомление успешно отправлено в Max!');
      } else {
        alert('Не удалось отправить уведомление');
      }
    } catch (e) {
      alert('Ошибка отправки уведомления');
    } finally {
      setIsSendingNotification(false);
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
                
                {/* ==================== МАРКА БЕТОНА / РАСТВОРА ==================== */}
                <select 
                  name="grade" 
                  value={form.grade} 
                  onChange={handleChange} 
                  style={{ padding: '14px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }}
                >
                  {recipes.map(r => (
                    <option key={r.code} value={r.code}>
                      {r.name}
                    </option>
                  ))}
                </select>

                <input 
                  type="number" 
                  name="volume" 
                  placeholder="Объём, м³" 
                  value={form.volume} 
                  onChange={handleChange} 
                  step="0.1" 
                  min="0.1" 
                  style={{ padding: '14px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }} 
                  required 
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <input 
                    type="date" 
                    name="deliveryDate" 
                    value={form.deliveryDate} 
                    onChange={handleChange} 
                    style={{ padding: '14px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }} 
                    required 
                  />
                  <input 
                    type="time" 
                    name="deliveryTime" 
                    value={form.deliveryTime} 
                    onChange={handleChange} 
                    style={{ padding: '14px', background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }} 
                    required 
                  />
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

          {/* Адрес доставки */}
          <div style={{ marginTop: '28px' }}>
            <label style={{ color: '#94A3B8', marginBottom: '8px', display: 'block' }}>Адрес доставки</label>
            <textarea 
              name="address" 
              value={form.address} 
              onChange={handleChange} 
              placeholder="Полный адрес объекта" 
              style={{ width: '97%', padding: '16px', background: '#25334A', border: 'none', borderRadius: '16px', color: '#fff', minHeight: '80px' }} 
              required 
            />
          </div>

          {/* Комментарий */}
          <div style={{ marginTop: '20px' }}>
            <label style={{ color: '#94A3B8', marginBottom: '8px', display: 'block' }}>Комментарий</label>
            <textarea 
              name="comment" 
              value={form.comment} 
              onChange={handleChange} 
              placeholder="Дополнительная информация..." 
              style={{ width: '97%', padding: '16px', background: '#25334A', border: 'none', borderRadius: '16px', color: '#fff', minHeight: '100px' }} 
            />
          </div>

          {/* ==================== КНОПКИ ВНИЗУ ==================== */}
          <div style={{ display: 'flex', gap: '16px', marginTop: '40px' }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '16px', background: '#334155', color: 'white', border: 'none', borderRadius: '9999px' }}>
              Отмена
            </button>

            <button 
              type="submit" 
              disabled={isSubmitting} 
              style={{ flex: 1, padding: '16px', background: '#10B981', color: 'white', border: 'none', borderRadius: '9999px', fontWeight: '600' }}
            >
              {isSubmitting ? 'Создаём...' : 'Создать заявку'}
            </button>

            {/* Кнопка отправки уведомления в Max */}
            {orderCreated && (
              <button 
                type="button"
                onClick={sendNotification}
                disabled={isSendingNotification || notificationSent}
                style={{ 
                  flex: 1, 
                  padding: '16px', 
                  background: notificationSent ? '#475569' : '#3B82F6', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '9999px', 
                  fontWeight: '600' 
                }}
              >
                {isSendingNotification ? 'Отправляем...' : notificationSent ? '✅ Отправлено в Max' : '📢 Отправить в Max'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}