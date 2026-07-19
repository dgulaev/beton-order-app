'use client';

import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { formatPhoneInput } from '@/lib/phone';
import { useDeliveryCoords } from '@/lib/yandexRoute';
import { calculateDeliveryCost, fetchDeliverySettings, DEFAULT_DELIVERY_SETTINGS, type DeliverySettings } from '@/lib/deliveryPricing';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import ModalActionButton from '@/app/adminCifra/components/ModalActionButton';
import { X, Send } from 'lucide-react';


const fieldStyle: CSSProperties = {
  width: '100%',
  padding: '14px',
  background: '#25334A',
  border: 'none',
  borderRadius: '12px',
  color: '#fff',
  fontSize: '17px',
  boxSizing: 'border-box',
};

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

    // ==================== 3. УМНАЯ ОБРАБОТКА ТЕЛЕФОНА (общая логика — lib/phone.ts) ====================
  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, phone: formatPhoneInput(e.target.value) }));
  };


   // ==================== 4. ЗАПОЛНЕНИЕ ДАННЫМИ ПРИ КОПИРОВАНИИ ====================
  useEffect(() => {
    if (!initialData || Object.keys(initialData).length === 0) {
      // Свежая заявка без дублирования — просто подставляем дату по умолчанию
      // (день, открытый на странице «Заявки»), иначе поле остаётся пустым.
      if (defaultDeliveryDate) {
        setForm(prev => ({ ...prev, deliveryDate: defaultDeliveryDate }));
      }
      return;
    }

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

  // ==================== 5.1 ЗАГРУЗКА ТАРИФОВ ДОСТАВКИ ====================
  // Те же тарифы, что редактирует admin на вкладке «Тарифы доставки»
  // страницы «Миксеры» (десктоп) — см. lib/deliveryPricing.ts.
  const [deliverySettings, setDeliverySettings] = useState<DeliverySettings>(DEFAULT_DELIVERY_SETTINGS);
  useEffect(() => {
    fetchDeliverySettings().then(setDeliverySettings);
  }, []);

  // ==================== 5.2 ДЕБАУНС АДРЕСА ДЛЯ ГЕОКОДИРОВАНИЯ ====================
  // Нужны координаты адреса, чтобы посчитать км для доставки за городом —
  // не геокодируем на каждое нажатие клавиши (см. NewOrderModal.tsx, тот же приём).
  const [previewAddress, setPreviewAddress] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setPreviewAddress(form.address), 600);
    return () => clearTimeout(timer);
  }, [form.address]);
  const addressLooksUsable = previewAddress.trim().length >= 5;
  const { coords: previewCoords } = useDeliveryCoords(addressLooksUsable ? previewAddress : null);

  // ==================== 6. РАСЧЁТ СТОИМОСТИ ====================
  const selectedRecipe = recipes.find(r => r.code === form.grade);
  const volume = parseFloat(form.volume) || 0;

  const concreteCost = useMemo(() => {
    return volume > 0 && selectedRecipe ? Math.round(volume * selectedRecipe.price) : 0;
  }, [volume, selectedRecipe]);

  const { deliveryCost, deliveryNote } = useMemo(
    () => calculateDeliveryCost({
      volume,
      address: addressLooksUsable ? previewAddress : form.address,
      coords: previewCoords,
      settings: deliverySettings,
    }),
    [volume, addressLooksUsable, previewAddress, form.address, previewCoords, deliverySettings]
  );
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
      concreteCost: concreteCost || 0,
      deliveryCost: deliveryCost || 0,
      totalPrice: totalPrice || 0,
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
        // ⚠️ Отдаём наверх те же имена полей, что и в payload/ответе сервера
        // (delivery_date/delivery_time), а не form.deliveryDate/deliveryTime —
        // иначе оптимистично добавленная заявка не проходила фильтр по дню
        // (страница фильтрует именно по delivery_date) и "не показывалась".
        if (onSuccess) onSuccess({ ...payload, id: data.orderId });
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
  useBodyScrollLock(isOpen);

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
                  style={fieldStyle} 
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
                  style={fieldStyle} 
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
                style={fieldStyle}
              />
            </div>

            <div>
              <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>Марка бетона</div>
              <select 
                name="grade" 
                value={form.grade} 
                onChange={handleChange} 
                style={fieldStyle}
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
                  style={fieldStyle} 
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
                  style={fieldStyle} 
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
                style={fieldStyle} 
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
                style={{ ...fieldStyle, resize: 'vertical' }} 
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
                style={{ ...fieldStyle, resize: 'vertical' }} 
              />
            </div>

            {/* Стоимость — разбивка на бетон/доставку, как в десктопной админке (NewOrderModal.tsx) */}
            {volume > 0 && (
              <div style={{ background: '#25334A', padding: '20px', borderRadius: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', color: '#E2E8F0' }}>
                  <span>Бетон:</span><span>{concreteCost.toLocaleString()} ₽</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', color: '#E2E8F0', marginTop: '6px' }}>
                  <span>Доставка:</span><span>{deliveryCost.toLocaleString()} ₽</span>
                </div>
                {deliveryNote && <div style={{ color: '#34D399', marginTop: '8px', fontSize: '14px' }}>🚚 {deliveryNote}</div>}
                <div style={{
                  marginTop: '12px',
                  paddingTop: '12px',
                  borderTop: '1px solid #475569',
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontWeight: '700',
                  fontSize: '19px',
                  color: '#60A5FA',
                }}>
                  <span>Итого:</span><span>{totalPrice.toLocaleString()} ₽</span>
                </div>
              </div>
            )}

            {/* КНОПКИ */}
            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
              <ModalActionButton
                type="button"
                onClick={onClose}
                color="#94A3B8"
                icon={<X size={18} />}
                label="Отмена"
                fullWidth
                size="lg"
              />
              <ModalActionButton
                type="submit"
                disabled={isSubmitting}
                color="#10B981"
                icon={<Send size={18} />}
                label={isSubmitting ? 'Создаём...' : 'Создать'}
                fullWidth
                size="lg"
              />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}