'use client';

import { useState, useMemo, useEffect } from 'react';
import { MapPin, X, PlusCircle, Send, CheckCircle2 } from 'lucide-react';
import OrderRouteMap from './OrderRouteMap';
import ModalActionButton from './ModalActionButton';
import { useMapRouteLinks, useDeliveryCoords } from '@/lib/yandexRoute';
import { calculateDeliveryCost, fetchDeliverySettings, DEFAULT_DELIVERY_SETTINGS, type DeliverySettings } from '@/lib/deliveryPricing';

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

  // ==================== 1.1 КОМПАКТНАЯ РАСКЛАДКА НА НЕВЫСОКИХ ЭКРАНАХ ====================
  // На Full HD (1920×1080 — с учётом хрома браузера реально остаётся
  // ~900–950px высоты) форма с картой не влезала без внутреннего скролла.
  // На 4K (высота ~2160+) места достаточно — там раскладка должна остаться
  // прежней, просторной, без изменений. Поэтому переключаем плотность полей
  // по фактической высоте окна, а не жёстко ужимаем везде.
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-height: 1200px)');
    const update = () => setCompact(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  // s(компактное, просторное) — просторное значение = как было раньше (4K), компактное — под 1920×1080.
  const s = <T,>(compactValue: T, spaciousValue: T): T => (compact ? compactValue : spaciousValue);

  // ==================== 2. ПРЕДЗАПОЛНЕНИЕ ДАННЫМИ ====================
  useEffect(() => {
    if (initialData) {
      // Разные вызывающие страницы кладут поля то в camelCase, то в snake_case
      // (например, duplicateOrder на Клиентах отдаёт delivery_date/delivery_time) —
      // подстраховываемся и читаем оба варианта.
      const deliveryDateRaw = initialData.deliveryDate || initialData.delivery_date;
      setForm({
        grade: initialData.grade || 'М300',
        volume: initialData.volume?.toString() || '',
        deliveryDate: deliveryDateRaw ? String(deliveryDateRaw).split('T')[0] : new Date().toISOString().split('T')[0],
        deliveryTime: initialData.deliveryTime || initialData.delivery_time || '09:00',
        address: initialData.address || '',
        customerType: initialData.customerType || 'physical',
        organizationName: initialData.organizationName || initialData.organization_name || '',
        fullName: initialData.fullName || initialData.full_name || '',
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

  // ==================== 4.1 ЗАГРУЗКА ТАРИФОВ ДОСТАВКИ ====================
  // Тарифы (цены за рейс, ставка за км за городом и т.п.) редактирует admin
  // на вкладке «Тарифы доставки» страницы «Миксеры» — см. lib/deliveryPricing.ts.
  // Пока не загрузились — считаем по тем же значениям, что были захардкожены
  // раньше (DEFAULT_DELIVERY_SETTINGS), чтобы форма не "прыгала" в цене.
  const [deliverySettings, setDeliverySettings] = useState<DeliverySettings>(DEFAULT_DELIVERY_SETTINGS);
  useEffect(() => {
    fetchDeliverySettings().then(setDeliverySettings);
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

  // ==================== 5.1 ЖИВОЙ ПРЕВЬЮ АДРЕСА НА КАРТЕ ====================
  // Геокодируем не при каждом нажатии клавиши (это била бы DaData на каждую
  // букву), а через небольшую паузу после того, как диспетчер перестал
  // печатать — см. `lib/yandexRoute.ts` про лимиты геокодера.
  const [previewAddress, setPreviewAddress] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setPreviewAddress(form.address), 600);
    return () => clearTimeout(timer);
  }, [form.address]);

  const addressLooksUsable = previewAddress.trim().length >= 5;
  const { yandexHref: previewRouteHref } = useMapRouteLinks(addressLooksUsable ? previewAddress : null);
  // Координаты того же (дебаунснутого) адреса — нужны только для расчёта
  // километража при доставке за городом (см. calculateDeliveryCost).
  // Использует тот же кэш геокодирования, что и карта/ссылки выше — не
  // дублирует запросы к DaData.
  const { coords: previewCoords } = useDeliveryCoords(addressLooksUsable ? previewAddress : null);

  // ==================== 6. РАСЧЁТ СТОИМОСТИ ====================
  const selectedRecipe = recipes.find(r => r.code === form.grade);
  const volume = parseFloat(form.volume) || 0;

  const concreteCost = useMemo(() => {
    return volume > 0 && selectedRecipe 
      ? Math.round(volume * selectedRecipe.price) 
      : 0;
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
      <div className="w-full max-w-[920px] lg:max-w-[1080px] max-h-[90vh] overflow-auto mx-auto scroll-hidden" style={{ background: '#1E2937', borderRadius: '24px', padding: s('20px 32px 24px', '32px') }} onClick={e => e.stopPropagation()}>
        
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: s('14px', '24px') }}>
          <h2 style={{ margin: 0, fontSize: s('22px', '28px') }}>Новая заявка на бетон</h2>
          <button onClick={onClose} style={{ fontSize: s('32px', '42px'), lineHeight: 1, background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer' }}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* ==================== ДВЕ КОЛОНКИ: слева Клиент + Адрес, справа Параметры + Карта ====================
              Адрес доставки и карта — теперь не отдельная секция на всю ширину, а
              продолжение тех же двух колонок: поле адреса ровно по ширине колонки
              «Клиент», карта — ровно по ширине колонки «Параметры заказа», начинается
              сразу под карточкой параметров и растягивается (flex:1) так, чтобы низ
              карты всегда совпадал с низом поля адреса, даже если высота карточек
              справа/слева отличается (например, при появлении блока стоимости). */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>

            {/* Левая колонка — Клиент + Адрес доставки */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: s('16px', '28px') }}>
            <div>
              <h3 style={{ color: '#94A3B8', marginBottom: s('10px', '18px') }}>Клиент</h3>
              <div style={{ background: '#25334A', padding: s('16px', '24px'), borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: s('12px', '16px') }}>
                
                <div>
                  <label style={{ color: '#94A3B8', marginBottom: s('6px', '8px'), display: 'block' }}>Тип заказчика</label>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    <button type="button" onClick={() => setForm(p => ({...p, customerType: 'physical'}))}
                      style={{ flex: 1, padding: s('10px', '12px'), borderRadius: '12px', background: form.customerType === 'physical' ? '#3B82F6' : '#334155', color: 'white', border: 'none' }}>
                      Физ. лицо
                    </button>
                    <button type="button" onClick={() => setForm(p => ({...p, customerType: 'legal'}))}
                      style={{ flex: 1, padding: s('10px', '12px'), borderRadius: '12px', background: form.customerType === 'legal' ? '#3B82F6' : '#334155', color: 'white', border: 'none' }}>
                      Юр. лицо
                    </button>
                  </div>
                </div>

                {form.customerType === 'legal' && (
                  <div>
                    <label style={{ color: '#94A3B8', marginBottom: s('6px', '8px'), display: 'block' }}>ИНН организации</label>
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
                      style={{ width: '93%', padding: s('12px', '14px'), background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }}
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
                    style={{ padding: s('12px', '14px'), background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }}
                    required
                  />
                ) : (
                  <input
                    type="text"
                    name="fullName"
                    placeholder="ФИО полностью"
                    value={form.fullName}
                    onChange={handleChange}
                    style={{ padding: s('12px', '14px'), background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }}
                    required
                  />
                )}

                <input
                  type="tel"
                  name="phone"
                  placeholder="+7 (___) ___-__-__"
                  value={form.phone}
                  onChange={handleChange}
                  style={{ padding: s('12px', '14px'), background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }}
                  required
                />
              </div>
            </div>

            {/* Адрес доставки — по ширине ровно как колонка «Клиент» выше.
                Подсказка — НАД полем (а не под ним), чтобы само поле ввода
                было единственным flex:1 элементом и его нижний край точно
                совпадал с нижним краем карты справа. */}
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <label style={{ color: '#94A3B8', marginBottom: s('6px', '8px'), display: 'block' }}>Адрес доставки</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: s('8px', '10px'), color: '#64748B', fontSize: '12px', lineHeight: '1.4' }}>
                <MapPin size={14} style={{ flexShrink: 0, marginTop: '2px' }} />
                <span>
                  Можно писать словами («г. Брянск, ул. Ленина, 5») или вставить координаты через запятую
                  («53.253470, 34.416444») — карта справа сразу покажет точку доставки.
                </span>
              </div>
              <textarea
                name="address"
                value={form.address}
                onChange={handleChange}
                placeholder="Полный адрес объекта"
                style={{ flex: 1, width: '100%', boxSizing: 'border-box', padding: s('14px', '16px'), background: '#25334A', border: 'none', borderRadius: '16px', color: '#fff', minHeight: s('64px', '80px'), resize: 'vertical' }}
                required
              />
            </div>
            </div>

            {/* Правая колонка — Параметры заказа + Карта */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: s('16px', '28px') }}>
            <div>
              <h3 style={{ color: '#94A3B8', marginBottom: s('10px', '18px') }}>Параметры заказа</h3>
              <div style={{ background: '#25334A', padding: s('16px', '24px'), borderRadius: '16px', display: 'flex', flexDirection: 'column', gap: s('12px', '16px') }}>
                
                {/* ==================== МАРКА БЕТОНА / РАСТВОРА ==================== */}
                <select 
                  name="grade" 
                  value={form.grade} 
                  onChange={handleChange} 
                  style={{ padding: s('12px', '14px'), background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }}
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
                  step="0.01" 
                  min="0.01" 
                  style={{ padding: s('12px', '14px'), background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }} 
                  required 
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <input 
                    type="date" 
                    name="deliveryDate" 
                    value={form.deliveryDate} 
                    onChange={handleChange} 
                    style={{ padding: s('12px', '14px'), background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }} 
                    required 
                  />
                  <input 
                    type="time" 
                    name="deliveryTime" 
                    value={form.deliveryTime} 
                    onChange={handleChange} 
                    style={{ padding: s('12px', '14px'), background: '#334155', border: 'none', borderRadius: '12px', color: '#fff' }} 
                    required 
                  />
                </div>

                {volume > 0 && (
                  <div style={{ background: '#1E2937', padding: s('12px 16px', '16px'), borderRadius: '12px', marginTop: s('4px', '8px') }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Бетон:</span><span>{concreteCost.toLocaleString()} ₽</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Доставка:</span><span>{deliveryCost.toLocaleString()} ₽</span></div>
                    {deliveryNote && <div style={{ color: '#34D399', marginTop: s('6px', '8px') }}>🚚 {deliveryNote}</div>}
                    <div style={{ marginTop: s('8px', '12px'), fontWeight: '700', fontSize: s('17px', '18px'), borderTop: '1px solid #475569', paddingTop: s('8px', '10px') }}>
                      Итого: {totalPrice.toLocaleString()} ₽
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Карта — по ширине ровно как колонка «Параметры заказа» выше, начинается
                сразу под карточкой параметров, растягивается до низа поля адреса слева */}
            <div style={{ flex: 1, minHeight: s('120px', '160px'), borderRadius: '16px', overflow: 'hidden' }}>
              {addressLooksUsable ? (
                <OrderRouteMap address={previewAddress} routeHref={previewRouteHref} />
              ) : (
                <div style={{
                  width: '100%',
                  height: '100%',
                  minHeight: s('120px', '160px'),
                  background: '#25334A',
                  borderRadius: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  color: '#64748B',
                  fontSize: '13px',
                  textAlign: 'center',
                  padding: '16px',
                }}>
                  <MapPin size={22} strokeWidth={1.5} />
                  <span>Карта появится, когда вы укажете адрес</span>
                </div>
              )}
            </div>
            </div>
          </div>

          {/* Комментарий */}
          <div style={{ marginTop: s('14px', '20px') }}>
            <label style={{ color: '#94A3B8', marginBottom: s('6px', '8px'), display: 'block' }}>Комментарий</label>
            <textarea 
              name="comment" 
              value={form.comment} 
              onChange={handleChange} 
              placeholder="Дополнительная информация..." 
              style={{ width: '97%', padding: s('12px 16px', '16px'), background: '#25334A', border: 'none', borderRadius: '16px', color: '#fff', minHeight: s('56px', '100px') }} 
            />
          </div>

          {/* ==================== КНОПКИ ВНИЗУ (единый стиль — как в редакторе заявки на "Заявках") ==================== */}
          <div style={{ display: 'flex', gap: '10px', marginTop: s('20px', '40px'), justifyContent: 'center', flexWrap: 'wrap' }}>
            <ModalActionButton
              type="button"
              color="#94A3B8"
              icon={<X size={15} />}
              label="Отмена"
              onClick={onClose}
            />

            <ModalActionButton
              type="submit"
              color="#10B981"
              icon={<PlusCircle size={15} />}
              label={isSubmitting ? 'Создаём...' : 'Создать заявку'}
              disabled={isSubmitting}
            />

            {/* Кнопка отправки уведомления в Max */}
            {orderCreated && (
              <ModalActionButton
                type="button"
                color={notificationSent ? '#94A3B8' : '#3B82F6'}
                icon={notificationSent ? <CheckCircle2 size={15} /> : <Send size={15} />}
                label={isSendingNotification ? 'Отправляем...' : notificationSent ? 'Отправлено в Max' : 'Отправить в Max'}
                disabled={isSendingNotification || notificationSent}
                onClick={sendNotification}
              />
            )}
          </div>
        </form>
      </div>
    </div>
  );
}