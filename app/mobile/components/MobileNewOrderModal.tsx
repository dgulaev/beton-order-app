'use client';

import { useState, useEffect, useMemo } from 'react';
import { formatPhoneInput } from '@/lib/phone';
import { useDeliveryCoords } from '@/lib/yandexRoute';
import { calculateDeliveryCost, fetchDeliverySettings, DEFAULT_DELIVERY_SETTINGS, type DeliverySettings } from '@/lib/deliveryPricing';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { X, Send, User, Phone, Building2, Layers, Clock, Calendar, MapPin, MessageSquare, Wallet } from 'lucide-react';
import ModalActionButton from '@/app/adminCifra/components/ModalActionButton';

const INPUT: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  background: '#25334A',
  border: '1px solid #334155',
  borderRadius: '10px',
  color: '#E2E8F0',
  fontSize: '15px',
  boxSizing: 'border-box',
};

function Label({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#475569', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
      {icon}{text}
    </div>
  );
}

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

  const isCopy = !!(initialData && Object.keys(initialData).length > 0);

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 20000, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as any }}
      onClick={onClose}
    >
      <div
        style={{ background: '#0D1520', minHeight: '100vh', maxWidth: '560px', margin: '0 auto', paddingBottom: '40px' }}
        onClick={e => e.stopPropagation()}
      >

        {/* ── ШАПКА ──────────────────────────────── */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: '#25334A', borderBottom: '1px solid #334155',
          padding: '14px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: '18px', fontWeight: 700, color: '#E2E8F0' }}>
            {isCopy ? 'Копия заявки' : 'Новая заявка'}
          </span>
          <button onClick={onClose} style={{ background: '#334155', border: 'none', borderRadius: '9999px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
            <X size={16} color="#64748B" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

            {/* ── КЛИЕНТ ─────────────────────────── */}
            <div style={{ background: '#25334A', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

              {/* Тип */}
              <div>
                <Label icon={<User size={11} />} text="Тип заказчика" />
                <div style={{ display: 'flex', gap: '8px' }}>
                  {(['physical', 'legal'] as const).map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm(p => ({ ...p, customerType: t }))}
                      style={{
                        flex: 1, padding: '10px 8px',
                        borderRadius: '10px',
                        border: `1px solid ${form.customerType === t ? '#3B82F6' : '#334155'}`,
                        background: form.customerType === t ? '#3B82F620' : 'transparent',
                        color: form.customerType === t ? '#3B82F6' : '#475569',
                        fontSize: '14px', fontWeight: 600, cursor: 'pointer',
                      }}
                    >
                      {t === 'physical' ? 'Физ. лицо' : 'Юр. лицо'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Название / ФИО */}
              {form.customerType === 'legal' ? (
                <div>
                  <Label icon={<Building2 size={11} />} text="Название организации" />
                  <input name="organizationName" placeholder="ООО «Название»" value={form.organizationName} onChange={handleChange} required style={INPUT} />
                </div>
              ) : (
                <div>
                  <Label icon={<User size={11} />} text="ФИО" />
                  <input name="fullName" placeholder="Иванов Иван Иванович" value={form.fullName} onChange={handleChange} required style={INPUT} />
                </div>
              )}

              {/* Телефон */}
              <div>
                <Label icon={<Phone size={11} />} text="Телефон" />
                <input name="phone" type="tel" value={form.phone} onChange={handlePhoneChange} placeholder="+7 (___) ___-__-__" required style={INPUT} />
              </div>
            </div>

            {/* ── ПАРАМЕТРЫ ЗАКАЗА ────────────────── */}
            <div style={{ background: '#25334A', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>

              <div>
                <Label icon={<Layers size={11} />} text="Марка бетона" />
                <select name="grade" value={form.grade} onChange={handleChange} style={INPUT}>
                  {recipes.map(r => <option key={r.code} value={r.code}>{r.name}</option>)}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div>
                  <Label icon={<span style={{ fontSize: '11px' }}>м³</span>} text="Объём" />
                  <input name="volume" type="number" step="0.01" placeholder="0" value={form.volume} onChange={handleChange} required style={INPUT} />
                </div>
                <div>
                  <Label icon={<Clock size={11} />} text="Время" />
                  <input name="deliveryTime" type="time" value={form.deliveryTime} onChange={handleChange} required style={INPUT} />
                </div>
              </div>

              <div>
                <Label icon={<Calendar size={11} />} text="Дата доставки" />
                <input name="deliveryDate" type="date" value={form.deliveryDate} onChange={handleChange} required style={INPUT} />
              </div>
            </div>

            {/* ── АДРЕС И КОММЕНТАРИЙ ─────────────── */}
            <div style={{ background: '#25334A', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <Label icon={<MapPin size={11} />} text="Адрес доставки" />
                <textarea name="address" placeholder="г. Брянск, ул. ..." value={form.address} onChange={handleChange} required rows={2} style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5 }} />
              </div>
              <div>
                <Label icon={<MessageSquare size={11} />} text="Комментарий" />
                <textarea name="comment" placeholder="Необязательно" value={form.comment} onChange={handleChange} rows={3} style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5 }} />
              </div>
            </div>

            {/* ── СТОИМОСТЬ ───────────────────────── */}
            {volume > 0 && (
              <div style={{ background: '#25334A', borderRadius: '16px', padding: '16px' }}>
                <Label icon={<Wallet size={11} />} text="Расчёт стоимости" />
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8', fontSize: '14px', padding: '6px 0' }}>
                  <span>Бетон</span><span>{concreteCost.toLocaleString()} ₽</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94A3B8', fontSize: '14px', padding: '6px 0', borderBottom: '1px solid #334155' }}>
                  <span>Доставка</span><span>{deliveryCost.toLocaleString()} ₽</span>
                </div>
                {deliveryNote && (
                  <div style={{ color: '#34D399', fontSize: '12px', padding: '6px 0' }}>🚚 {deliveryNote}</div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#60A5FA', fontSize: '17px', fontWeight: 700, paddingTop: '10px' }}>
                  <span>Итого</span><span>{totalPrice.toLocaleString()} ₽</span>
                </div>
              </div>
            )}

            {/* ── КНОПКИ ──────────────────────────── */}
            <div style={{ display: 'flex', gap: '10px' }}>
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

          </div>
        </form>
      </div>
    </div>
  );
}