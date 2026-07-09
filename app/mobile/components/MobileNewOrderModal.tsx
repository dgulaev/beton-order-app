'use client';

import { useState, useEffect, useMemo } from 'react';


interface MobileNewOrderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (newOrder?: any) => void;
  defaultDeliveryDate?: string;
  currentRole?: string;
  currentUserName?: string;
  initialData?: any;
}

export default function MobileNewOrderModal({
  isOpen,
  onClose,
  onSuccess,
  defaultDeliveryDate,
  currentRole = 'admin',
  currentUserName = 'Сотрудник',
  initialData = null,
}: MobileNewOrderModalProps) {

  // ==================== 1. ОСНОВНЫЕ СОСТОЯНИЯ ====================
  const [recipes, setRecipes] = useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loadingInn, setLoadingInn] = useState(false);

  // ==================== 2. ФОРМА ====================
  const [form, setForm] = useState({
    grade: 'М300',
    volume: '',
    deliveryDate: '',
    deliveryTime: '10:00',
    address: '',
    customerType: 'legal' as 'physical' | 'legal',
    organizationName: '',
    fullName: '',
    phone: '+7',
    inn: '',
    comment: '',
  });

    // ==================== 3. УМНАЯ ОБРАБОТКА ТЕЛЕФОНА (ПРОСТОЙ ВАРИАНТ) ====================
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let value = e.target.value;

    // Разрешаем полное удаление
    if (value.length === 0) {
      setForm(prev => ({ ...prev, phone: '+7' }));
      return;
    }

    // Оставляем только цифры
    let digits = value.replace(/\D/g, '');

    // Защита от 8 и 9 в начале
    if (digits.startsWith('8')) {
      digits = '7' + digits.slice(1);
    } else if (digits.startsWith('9')) {
      digits = '7' + digits;
    }

    // Максимум 11 цифр
    if (digits.length > 11) {
      digits = digits.slice(0, 11);
    }

    // Простое форматирование
    let formatted = '+7';
    const rest = digits.slice(1); // цифры после 7

    if (rest.length > 0) {
      formatted += ' ' + rest.slice(0, 3);
      if (rest.length > 3) formatted += ' ' + rest.slice(3, 6);
      if (rest.length > 6) formatted += '-' + rest.slice(6, 8);
      if (rest.length > 8) formatted += '-' + rest.slice(8, 10);
    }

    setForm(prev => ({ ...prev, phone: formatted }));
  };


   // ==================== 4. ЗАПОЛНЕНИЕ ДАННЫМИ ПРИ КОПИРОВАНИИ ====================
  useEffect(() => {
    if (!initialData || Object.keys(initialData).length === 0) return;

    let phone = initialData.phone || '+7';
    if (!phone.startsWith('+7')) {
      if (phone.startsWith('8')) phone = '+7' + phone.slice(1);
      else if (phone.startsWith('9')) phone = '+7' + phone;
      else phone = '+7' + phone.replace(/\D/g, '');
    }

    const newFormData = {
      grade: initialData.grade || 'М300',
      volume: initialData.volume?.toString() || '',
      deliveryDate: initialData.deliveryDate || defaultDeliveryDate || new Date().toISOString().split('T')[0],
      deliveryTime: initialData.deliveryTime || '10:00',
      address: initialData.address || '',
      customerType: initialData.customerType || 'legal',
      organizationName: initialData.organizationName || '',
      fullName: initialData.fullName || '',
      phone: phone,
      inn: initialData.inn || '',
      comment: initialData.comment || '',
    };

    setForm(newFormData);
  }, [initialData, defaultDeliveryDate]);

  // ==================== 5. ЗАГРУЗКА РЕЦЕПТОВ ====================
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

  // ==================== 6. РАСЧЁТ СТОИМОСТИ ====================
  const selectedRecipe = recipes.find(r => r.code === form.grade);
  const volume = parseFloat(form.volume) || 0;

  const concreteCost = useMemo(() => {
    return volume > 0 && selectedRecipe ? Math.round(volume * selectedRecipe.price) : 0;
  }, [volume, selectedRecipe]);

  let deliveryCost = 0;
  let deliveryNote = '';
  if (volume > 0) {
    if (volume <= 10) { deliveryCost = 6000; deliveryNote = '6000 ₽'; }
    else if (volume <= 12) { deliveryCost = 7500; deliveryNote = '7500 ₽'; }
    else if (volume <= 50) { deliveryCost = Math.ceil(volume / 10) * 6000; deliveryNote = `${Math.ceil(volume / 10)} рейса`; }
    else { deliveryCost = Math.round(volume * 600); deliveryNote = '600 ₽/м³'; }
  }
  const totalPrice = concreteCost + deliveryCost;

  // ==================== 7. ОБРАБОТЧИКИ ИЗМЕНЕНИЙ ====================
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'phone') return; // телефон обрабатывается в handlePhoneChange
    setForm(prev => ({ ...prev, [name]: value }));
  };

  // ==================== 8. СОЗДАНИЕ ЗАЯВКИ ====================
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Валидация телефона
    const cleanPhone = form.phone.replace(/\D/g, '');
    if (cleanPhone.length !== 11 || !cleanPhone.startsWith('7')) {
      alert('Укажите корректный номер телефона (начинается с +7, 11 цифр)');
      setIsSubmitting(false);
      return;
    }

    const payload = {
      grade: form.grade,
      volume: parseFloat(form.volume),
      delivery_date: form.deliveryDate,
      delivery_time: form.deliveryTime,
      address: form.address.trim(),
      phone: form.phone,
      customerType: form.customerType === 'legal' ? 'Юридическое лицо' : 'Физическое лицо',
      organization_name: form.organizationName?.trim() || null,
      full_name: form.fullName?.trim() || null,
      inn: form.inn?.trim() || null,
      comment: form.comment?.trim() || null,
      created_by: localStorage.getItem('userId') ? parseInt(localStorage.getItem('userId')!) : 1777619517739,
      curator_name: currentUserName,
      userRole: currentRole,
      userName: currentUserName,
    };

    try {
      const response = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (data.success) {
        alert(`✅ Заявка #${data.orderId} успешно создана!`);
        if (onSuccess) onSuccess({ id: data.orderId, ...form });
        onClose();
      } else {
        alert(data.message || 'Ошибка создания заявки');
      }
    } catch (error) {
      console.error(error);
      alert('Ошибка соединения с сервером');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ==================== 9. РЕНДЕР ====================
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.95)',
      zIndex: 10000,
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch'
    }} onClick={onClose}>
      
      <div 
        style={{
          backgroundColor: '#1E2937',
          minHeight: '100vh',
          maxWidth: '560px',
          margin: '0 auto',
          paddingBottom: '100px'
        }}
        onClick={e => e.stopPropagation()}
      >
        
        {/* ШАПКА */}
        <div style={{ 
          padding: '18px 20px', 
          borderBottom: '1px solid #334155',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          backgroundColor: '#1E2937',
          zIndex: 10
        }}>
          <h2 style={{ margin: 0, fontSize: '23px', fontWeight: '700', color: '#ffffff' }}>
            Новая заявка
          </h2>
          <button 
            onClick={onClose} 
            style={{ 
              fontSize: '34px', 
              background: 'none', 
              border: 'none', 
              color: '#94A3B8',
              padding: 0,
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '20px' }}>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

            {/* Тип заказчика */}
            <div>
              <label style={{ color: '#94A3B8', marginBottom: '8px', display: 'block', fontSize: '14px' }}>
                Тип заказчика
              </label>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button 
                  type="button" 
                  onClick={() => setForm(p => ({...p, customerType: 'physical'}))}
                  style={{ 
                    flex: 1, 
                    padding: '16px', 
                    borderRadius: '16px', 
                    background: form.customerType === 'physical' ? '#3B82F6' : '#334155', 
                    color: 'white', 
                    border: 'none', 
                    fontSize: '16px' 
                  }}
                >
                  Физ. лицо
                </button>
                <button 
                  type="button" 
                  onClick={() => setForm(p => ({...p, customerType: 'legal'}))}
                  style={{ 
                    flex: 1, 
                    padding: '16px', 
                    borderRadius: '16px', 
                    background: form.customerType === 'legal' ? '#3B82F6' : '#334155', 
                    color: 'white', 
                    border: 'none', 
                    fontSize: '16px' 
                  }}
                >
                  Юр. лицо
                </button>
              </div>
            </div>

            {/* Название / ФИО */}
            {form.customerType === 'legal' && (
              <div>
                <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>Название организации</div>
                <input 
                  name="organizationName" 
                  placeholder="Название организации" 
                  value={form.organizationName} 
                  onChange={handleChange} 
                  required 
                  style={{ width: '93%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '16px' }} 
                />
              </div>
            )}

            {form.customerType === 'physical' && (
              <div>
                <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>ФИО полностью</div>
                <input 
                  name="fullName" 
                  placeholder="ФИО полностью" 
                  value={form.fullName} 
                  onChange={handleChange} 
                  required 
                  style={{ width: '93%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '16px' }} 
                />
              </div>
            )}

            {/* Остальные поля */}
            <div>
              <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>Телефон</div>
              <input
                name="phone"
                type="tel"
                value={form.phone}
                onChange={handlePhoneChange}
                placeholder="+7 (___) ___-__-__"
                required
                style={{ width: '93%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '17px' }}
              />
            </div>

            <div>
              <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>Марка бетона</div>
              <select 
                name="grade" 
                value={form.grade} 
                onChange={handleChange} 
                style={{ width: '80%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '17px' }}
              >
                {recipes.map(r => (
                  <option key={r.code} value={r.code}>{r.name}</option>
                ))}
              </select>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              <div>
                <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>Объём, м³</div>
                <input 
                  name="volume" 
                  type="number" 
                  step="0.01" 
                  value={form.volume} 
                  onChange={handleChange} 
                  required 
                  style={{ width: '80%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '17px' }} 
                />
              </div>
              <div>
                <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>Время</div>
                <input 
                  name="deliveryTime" 
                  type="time" 
                  value={form.deliveryTime} 
                  onChange={handleChange} 
                  required 
                  style={{ width: '85%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff' }} 
                />
              </div>
            </div>

            <div>
              <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>Дата доставки</div>
              <input 
                name="deliveryDate" 
                type="date" 
                value={form.deliveryDate} 
                onChange={handleChange} 
                required 
                style={{ width: '93%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff' }} 
              />
            </div>

            <div>
              <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>Адрес доставки</div>
              <textarea 
                name="address" 
                placeholder="Полный адрес доставки" 
                value={form.address} 
                onChange={handleChange} 
                required 
                rows={3}
                style={{ width: '93%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', resize: 'vertical' }} 
              />
            </div>

            <div>
              <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>Комментарий</div>
              <textarea 
                name="comment" 
                placeholder="Комментарий (необязательно)" 
                value={form.comment} 
                onChange={handleChange} 
                rows={4}
                style={{ width: '93%', padding: '14px', background: '#25334A', border: 'none', borderRadius: '12px', color: '#fff', resize: 'vertical' }} 
              />
            </div>

            {/* Стоимость */}
            {volume > 0 && (
              <div style={{ background: '#25334A', padding: '20px', borderRadius: '16px', textAlign: 'center' }}>
                <div style={{ fontSize: '18px', color: '#94A3B8' }}>Итого к оплате:</div>
                <div style={{ fontSize: '28px', fontWeight: '700', color: '#60A5FA' }}>
                  {totalPrice.toLocaleString()} ₽
                </div>
                {deliveryNote && <div style={{ color: '#34D399', marginTop: '6px' }}>🚚 {deliveryNote}</div>}
              </div>
            )}

            {/* КНОПКИ */}
            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
              <button 
                type="button" 
                onClick={onClose} 
                style={{ 
                  flex: 1, 
                  padding: '18px', 
                  background: '#334155', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '16px', 
                  fontSize: '17px' 
                }}
              >
                Отмена
              </button>
              <button 
                type="submit" 
                disabled={isSubmitting} 
                style={{ 
                  flex: 1, 
                  padding: '18px', 
                  background: '#10B981', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '16px', 
                  fontSize: '17px', 
                  fontWeight: '600' 
                }}
              >
                {isSubmitting ? 'Создаём...' : 'Создать заявку'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}