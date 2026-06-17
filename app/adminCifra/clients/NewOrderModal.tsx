'use client';

import { useState, useMemo, useEffect } from 'react';

// ==================== ГЛОБАЛЬНАЯ ФУНКЦИЯ ДЛЯ ИСТОРИИ ====================
declare global {
  interface Window {
    addToHistoryGlobal?: (action: string) => void;
  }
}

interface NewOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  userId?: any;
  userName?: string;
  currentUserName?: string;
  userPhone?: string;
  currentRole?: string;
  onOrderCreated?: () => void;
  initialData?: any;
  orderHistory?: any[];      // ← Добавь
  callHistory?: any[];       // ← Добавь         // ← Добавь эту строку
}

export default function NewOrderModal({ 
  isOpen, 
  onClose, 
  userId, 
  userName, 
  currentUserName = 'Сотрудник',
  userPhone, 
  currentRole = 'admin',
  onOrderCreated,
  initialData,
  orderHistory = [],     // ← Добавь
  callHistory = []       // ← Добавь
}: NewOrderModalProps) {

  const [recipes, setRecipes] = useState<any[]>([]);   // ← Добавлено

  const [form, setForm] = useState({
  grade: 'М300',
  volume: '',
  deliveryDate: new Date().toISOString().split('T')[0],
  deliveryTime: '10:00',
  address: '',
  customerType: 'legal' as 'physical' | 'legal',   // ← По умолчанию Юрлицо
  organizationName: '',
  fullName: '',
  phone: '',
  inn: '',                                         // ← Новое поле
  comment: '',
});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  // ==================== ЗАГРУЗКА РЕЦЕПТОВ ИЗ БАЗЫ ====================
useEffect(() => {
  const loadRecipes = async () => {
    try {
      const res = await fetch('/api/adminCifra/recipes');
      if (res.ok) {
        const data = await res.json();
        setRecipes(data);
        // ← УБРАЛИ автоматическую установку первой марки
      }
    } catch (e) {
      console.error('Ошибка загрузки рецептов:', e);
    }
  };

  if (isOpen) loadRecipes();
}, [isOpen]);

// ==================== АВТОЗАПОЛНЕНИЕ ====================
useEffect(() => {
  if (!isOpen) return;

  if (initialData) {
    const isLegal = !!( 
      initialData.customerType === 'legal' || 
      initialData.customer_type === 'Юридическое лицо' ||
      initialData.organizationName || 
      initialData.organization_name ||
      initialData.inn 
    );

    setForm({
      grade: initialData.grade || initialData.grade_code || 'М300',   // ← усиленная приоритетность
      volume: initialData.volume || '',
      deliveryDate: initialData.delivery_date || initialData.deliveryDate || new Date().toISOString().split('T')[0],
      deliveryTime: initialData.delivery_time || initialData.deliveryTime || '10:00',
      address: initialData.address || '',
      customerType: isLegal ? 'legal' : 'physical',
      organizationName: initialData.organizationName || initialData.organization_name || '',
      fullName: initialData.fullName || initialData.full_name || '',
      phone: initialData.phone || '',
      inn: initialData.inn || '',
      comment: initialData.comment || '',
    });
  } else if (isOpen) {
    setForm(prev => ({
      ...prev,
      fullName: userName || prev.fullName || '',
      phone: userPhone || prev.phone || '',
      customerType: 'legal',
    }));
  }
}, [isOpen, initialData, userName, userPhone]);

  // ==================== РАСЧЁТ СТОИМОСТИ ====================
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

    // ==================== ОБРАБОТКА ОТПРАВКИ ЗАКАЗА ====================
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!userId) return alert('Клиент не выбран');

  setIsSubmitting(true);

  // ==================== ОПРЕДЕЛЕНИЕ ИМЕНИ СОЗДАТЕЛЯ ====================
  const creatorName = currentUserName || 'Сотрудник';

  const payload = {
    userId,
    grade: form.grade,
    volume: Number(form.volume),
    deliveryDate: form.deliveryDate,
    deliveryTime: form.deliveryTime,
    address: form.address,
    customerType: form.customerType === 'legal' ? 'Юридическое лицо' : 'Физическое лицо',
    fullName: form.fullName,
    phone: form.phone,
    organizationName: form.organizationName,
    inn: form.inn,
    totalPrice,
    concreteCost,
    deliveryCost,
    comment: form.comment,

    // ==================== КРИТИЧНЫЕ ДАННЫЕ ДЛЯ ИСТОРИИ ====================
    isFromAdmin: true,
    source: 'admin',
    userRole: currentRole || 'admin',
    createdByName: creatorName,      // ← Имя того, кто создал заявку
    userName: creatorName,           // ← для совместимости с бэкендом
  };

  try {
    console.log('📤 Создание заказа от имени:', creatorName);

    const res = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (data.success) {
      const orderId = data.order?.id || data.id || '???';

      // ==================== ЗАПИСЬ В ИСТОРИЮ ====================
      const historyText = `Создал новую заявку #${orderId}`;
      console.log('📝 Записываем в историю:', historyText);

      if (typeof (window as any).addToHistoryGlobal === 'function') {
        (window as any).addToHistoryGlobal(historyText);
      }

      setShowSuccess(true);
      onOrderCreated?.();

      setTimeout(() => {
        setShowSuccess(false);
        onClose();
      }, 1400);
    } else {
      alert('Ошибка: ' + (data.message || 'Неизвестная ошибка'));
    }
  } catch (err) {
    console.error('❌ Ошибка при создании заказа:', err);
    alert('Ошибка соединения с сервером');
  } finally {
    setIsSubmitting(false);
  }
};

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.85)', zIndex: 1100,
      display: 'flex', alignItems: 'center', justifyContent: 'center'
    }}>
      {/* ==================== ОСНОВНОЙ КОНТЕЙНЕР МОДАЛКИ ==================== */}
      <div style={{
        background: '#1E2937',
        width: '560px',
        borderRadius: '20px',
        padding: '32px',
        color: '#fff',
        maxHeight: '92vh',
        overflow: 'auto',
        position: 'relative'
      }}>
        {/* ==================== УВЕДОМЛЕНИЕ ОБ УСПЕХЕ ==================== */}
        {showSuccess && (
          <div style={{
            position: 'absolute', top: 20, left: 20, right: 20,
            background: '#10B981', color: 'white', padding: '16px 20px',
            borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '10px',
            zIndex: 10, boxShadow: '0 10px 15px -3px rgb(16 185 129)'
          }}>
            <span style={{ fontSize: '24px' }}>✅</span>
            <span style={{ fontWeight: '600' }}>Заказ успешно создан!</span>
          </div>
        )}

        <h2 style={{ marginBottom: '8px', textAlign: 'center', fontSize: '24px' }}>Новый заказ</h2>
        <p style={{ textAlign: 'center', color: '#94A3B8', marginBottom: '28px' }}>
          Для: <strong>{userName || 'Клиент'}</strong><br />{userPhone}
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* ==================== ПОЛЕ МАРКА БЕТОНА (ДИНАМИЧЕСКАЯ ИЗ БАЗЫ) ==================== */}
          <div>
            <label style={{ display: 'block', marginBottom: '8px', color: '#94A3B8', fontSize: '14px' }}>Марка бетона / раствора</label>
            <select 
              value={form.grade} 
              onChange={e => setForm({...form, grade: e.target.value})} 
              style={{ 
                width: '100%', 
                padding: '16px', 
                background: '#25334A', 
                border: 'none', 
                borderRadius: '12px', 
                color: '#fff', 
                fontSize: '16px' 
              }}
            >
              {recipes.map(r => (
                <option key={r.code} value={r.code}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          {/* ==================== БЛОК ОБЪЁМ + ДАТА (в две колонки) ==================== */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#94A3B8', fontSize: '14px' }}>Объём (м³)</label>
              <input type="number" value={form.volume} onChange={e => setForm({...form, volume: e.target.value})} style={{ 
                width: '80%', padding: '16px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '16px' 
              }} placeholder="20" required />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#94A3B8', fontSize: '14px' }}>Дата доставки</label>
              <input type="date" value={form.deliveryDate} onChange={e => setForm({...form, deliveryDate: e.target.value})} style={{ 
                width: '87%', padding: '16px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '16px' 
              }} required />
            </div>
          </div>

          {/* ==================== ВРЕМЯ ДОСТАВКИ ==================== */}
          <div>
            <label style={{ display: 'block', marginBottom: '8px', color: '#94A3B8', fontSize: '14px' }}>Время доставки</label>
            <input type="time" value={form.deliveryTime} onChange={e => setForm({...form, deliveryTime: e.target.value})} style={{ 
              width: '95%', padding: '16px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '16px' 
            }} />
          </div>

          {/* ==================== АДРЕС ДОСТАВКИ ==================== */}
          <div>
            <label style={{ display: 'block', marginBottom: '8px', color: '#94A3B8', fontSize: '14px' }}>Адрес доставки</label>
            <input type="text" placeholder="г. Брянск, ул. Советская 52" value={form.address} onChange={e => setForm({...form, address: e.target.value})} style={{ 
              width: '95%', padding: '16px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '16px' 
            }} />
          </div>

          {/* ==================== КНОПКИ ВЫБОРА ТИПА КЛИЕНТА ==================== */}
<div>
  <label style={{ display: 'block', marginBottom: '8px', color: '#94A3B8', fontSize: '14px' }}>Тип заказчика</label>
  <div style={{ display: 'flex', gap: '12px' }}>
    <button 
      type="button" 
      onClick={() => setForm({...form, customerType: 'physical'})} 
      style={{ 
        flex: 1, 
        padding: '14px', 
        borderRadius: '12px',
        background: form.customerType === 'physical' ? '#3B82F6' : '#25334A',
        color: 'white', 
        border: 'none', 
        fontSize: '15px', 
        fontWeight: '600'
      }}
    >
      Физическое лицо
    </button>
    <button 
      type="button" 
      onClick={() => setForm({...form, customerType: 'legal'})} 
      style={{ 
        flex: 1, 
        padding: '14px', 
        borderRadius: '12px',
        background: form.customerType === 'legal' ? '#3B82F6' : '#25334A',
        color: 'white', 
        border: 'none', 
        fontSize: '15px', 
        fontWeight: '600'
      }}
    >
      Юридическое лицо
    </button>
  </div>
</div>

{/* ==================== ИНН (только для юрлиц) ==================== */}
{form.customerType === 'legal' && (
  <div>
    <label style={{ display: 'block', marginBottom: '8px', color: '#94A3B8', fontSize: '14px' }}>
      ИНН организации
    </label>
    <input 
      type="text" 
      value={form.inn} 
      onChange={e => setForm({...form, inn: e.target.value})} 
      placeholder="123456789012" 
      style={{ 
        width: '95%', 
        padding: '16px', 
        background: '#25334A', 
        border: 'none', 
        borderRadius: '12px', 
        color: '#fff', 
        fontSize: '16px' 
      }} 
    />
  </div>
)}

          {/* ==================== ФИО ИЛИ ОРГАНИЗАЦИЯ ==================== */}
          {form.customerType === 'physical' ? (
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#94A3B8', fontSize: '14px' }}>ФИО клиента</label>
              <input type="text" value={form.fullName} onChange={e => setForm({...form, fullName: e.target.value})} style={{ 
                width: '95%', padding: '16px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '16px' 
              }} />
            </div>
          ) : (
            <div>
              <label style={{ display: 'block', marginBottom: '8px', color: '#94A3B8', fontSize: '14px' }}>Название организации</label>
              <input type="text" value={form.organizationName} onChange={e => setForm({...form, organizationName: e.target.value})} style={{ 
                width: '95%', padding: '16px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '16px' 
              }} />
            </div>
          )}

          {/* ==================== ТЕЛЕФОН ==================== */}
          <div>
            <label style={{ display: 'block', marginBottom: '8px', color: '#94A3B8', fontSize: '14px' }}>Телефон</label>
            <input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} style={{ 
              width: '95%', padding: '16px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '16px' 
            }} />
          </div>

          {/* ==================== ИНН ==================== */}
<div>
  <label style={{ display: 'block', marginBottom: '8px', color: '#94A3B8', fontSize: '14px' }}>ИНН (для юрлиц)</label>
  <input 
    type="text" 
    value={form.inn} 
    onChange={e => setForm({...form, inn: e.target.value})} 
    placeholder="123456789012" 
    style={{ 
      width: '95%', 
      padding: '16px', 
      background: '#25334A', 
      border: 'none', 
      borderRadius: '12px', 
      color: '#fff', 
      fontSize: '16px' 
    }} 
  />
</div>

          {/* ==================== КОММЕНТАРИЙ ==================== */}
          <div>
            <label style={{ display: 'block', marginBottom: '8px', color: '#94A3B8', fontSize: '14px' }}>Комментарий</label>
            <textarea value={form.comment} onChange={e => setForm({...form, comment: e.target.value})} placeholder="Проверка отправки заказа из админки" style={{ 
              width: '95%', padding: '16px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '16px', minHeight: '110px', resize: 'vertical' 
            }} />
          </div>

          {/* ==================== БЛОК РАСЧЁТА СТОИМОСТИ ==================== */}
          {volume > 0 && (
            <div style={{ background: '#25334A', padding: '20px', borderRadius: '16px', marginTop: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span>Бетон</span>
                <span style={{ fontWeight: '700' }}>{concreteCost.toLocaleString()} ₽</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                <span>Доставка</span>
                <span style={{ fontWeight: '700' }}>{deliveryCost.toLocaleString()} ₽</span>
              </div>
              <div style={{ borderTop: '1px solid #334155', paddingTop: '16px', fontSize: '19px', fontWeight: '700', color: '#60A5FA' }}>
                Итого: {totalPrice.toLocaleString()} ₽
              </div>
            </div>
          )}

          {/* ==================== КНОПКИ ДЕЙСТВИЙ ==================== */}
          <div style={{ display: 'flex', gap: '16px', marginTop: '12px' }}>
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '18px', background: '#334155', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600' }}>Отмена</button>
            <button type="submit" disabled={isSubmitting} style={{ flex: 1, padding: '18px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600' }}>
              {isSubmitting ? 'Создаём...' : 'Создать заказ'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}