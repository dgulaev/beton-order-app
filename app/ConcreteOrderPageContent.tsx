'use client';

import { useEffect, useState, useMemo, useRef, type CSSProperties } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { PlusCircle, ClipboardList, Gift, Wallet } from 'lucide-react';
import { formatPhoneInput, normalizePhone } from '@/lib/phone';
import { useDeliveryCoords } from '@/lib/yandexRoute';
import { calculateDeliveryCost, fetchDeliverySettings, DEFAULT_DELIVERY_SETTINGS, type DeliverySettings } from '@/lib/deliveryPricing';

declare const WebApp: any;

const lightFieldStyle: CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: '10px',
  fontSize: '15px',
  boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.07)',
  color: '#F8FAFC',
};

// Стиль кнопок как в adminCifra ModalActionButton — outlined/ghost
const outlinedBtn = (color: string): CSSProperties => ({
  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
  padding: '11px 16px',
  borderRadius: '12px',
  border: `1px solid ${color}40`,
  background: 'transparent',
  color,
  fontWeight: 600,
  fontSize: '15px',
  cursor: 'pointer',
  transition: 'border-color 0.15s, background 0.15s',
});

const LABEL: CSSProperties = {
  display: 'block', marginBottom: '4px',
  fontWeight: 500, color: 'rgba(255,255,255,0.5)',
  fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.06em',
};

export default function ConcreteOrderPage() {
  const [isVerified, setIsVerified] = useState(false);
  const [phone, setPhone] = useState('');

  const [activeTab, setActiveTab] = useState<'new' | 'history' | 'referral' | 'balance'>('new');
  const [referralHistory, setReferralHistory] = useState<any[]>([]);
  const [expandedReferrer, setExpandedReferrer] = useState<number | null>(null);
  const [currentScreen, setCurrentScreen] = useState<'form' | 'success'>('form');
  const [orderId, setOrderId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fullName, setFullName] = useState('');
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [selectedReferrerForWithdraw, setSelectedReferrerForWithdraw] = useState<any>(null);
  const [showReferrerList, setShowReferrerList] = useState(false);

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
    comment: '',
  });

  const [userId, setUserId] = useState<number | null>(null);
  const [referralCode, setReferralCode] = useState<string>('Загрузка...');
  const [balance, setBalance] = useState(0);
  const [referredBy, setReferredBy] = useState<number | null>(null);

  // Проверка — открыта ли форма внутри Telegram Mini App
  const isTelegram = typeof window !== 'undefined'
    && !!((window as any).Telegram?.WebApp?.initData || (window as any).WebApp?.initData);

  // Флаг предпросмотра от мобильной админки — показываем кнопку «Назад в админку»
  const [isAdminPreview, setIsAdminPreview] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('admin_preview') === '1') {
      setIsAdminPreview(true);
    }
  }, []);

  // Навбар: скрывается при скролле вниз, выезжает при скролле вверх
  const [navVisible, setNavVisible] = useState(true);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 10) {
        setNavVisible(true);
      } else if (y > lastScrollY.current + 6) {
        setNavVisible(false);
      } else if (y < lastScrollY.current - 6) {
        setNavVisible(true);
      }
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const [orders, setOrders] = useState<any[]>([]);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingReferrals, setLoadingReferrals] = useState(false);

    // Автозагрузка истории при переключении на вкладку "Баланс"
  useEffect(() => {
    if (activeTab === 'balance' && userId) {
      loadReferrals();
    }
  }, [activeTab, userId]);

  // ==================== useSearchParams ====================
  const urlSearchParams = useSearchParams();

  // ==================== ЗАХВАТ РЕФЕРАЛЬНОЙ ССЫЛКИ ====================
  useEffect(() => {
    const refCode = urlSearchParams.get('ref');
    console.log('🔍 Проверка ref из URL:', refCode);

    if (refCode) {
      console.log('🔥 Найден реферальный код:', refCode);
      // Временно сохраняем как строку, но не ломаем тип
      setReferredBy(null); // оставляем null, чтобы не было конфликта
      // Будем передавать код напрямую в registerByPhone
    }
  }, [urlSearchParams]);

  // ==================== ЗАПУСК ИНИЦИАЛИЗАЦИИ ПОСЛЕ РЕГИСТРАЦИИ ====================
  useEffect(() => {
    if (userId && isVerified) {
      console.log('🔄 Запускаем initializeUser после верификации | referredBy =', referredBy);
      initializeUser(userId);
    }
  }, [userId, isVerified, referredBy]);

// ==================== ИНИЦИАЛИЗАЦИЯ РЕФЕРАЛЬНОЙ СИСТЕМЫ ====================
const initializeUser = async (uid: number) => {
  const refCode = urlSearchParams.get('ref') || referredBy;

  console.log(`📡 [Init API] Запуск для uid=${uid}, refCode:`, refCode);

  try {
    const payload = { 
      userId: uid,
      phone: phone || null,
      referredBy: refCode
    };

    const res = await fetch('/api/user/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    console.log('📦 Ответ от /api/user/init:', data);

    if (data.success) {
      if (data.referralCode) {
        setReferralCode(data.referralCode);
        console.log('🔑 Код успешно установлен:', data.referralCode);
      }
      if (data.balance !== undefined) {
        setBalance(data.balance);
        console.log('💰 Баланс обновлён из init:', data.balance);
      }
    }
  } catch (e) {
    console.error('💥 Ошибка initializeUser:', e);
  }
};

// ==================== ЗАГРУЗКА АКТУАЛЬНОГО БАЛАНСА ====================
const loadBalance = async () => {
  if (!userId) {
    console.log('⚠️ loadBalance: userId отсутствует');
    return;
  }

  try {
    console.log(`📡 Запрашиваем баланс для userId: ${userId} (с кэш-байпасом)`);
    
    const res = await fetch(`/api/user/balance?userId=${userId}&t=${Date.now()}`, {
      method: 'GET',
      cache: 'no-store',
      headers: { 
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });

    if (!res.ok) {
      console.warn(`⚠️ Ответ от /api/user/balance: ${res.status}`);
      return;
    }

    const data = await res.json();
    console.log('📦 Ответ баланса:', data);

    if (data.success && typeof data.balance === 'number') {
      setBalance(data.balance);
      console.log(`✅ Баланс обновлён → ${data.balance} ₽`);
    } else {
      console.warn('⚠️ Некорректный ответ от баланса');
    }
  } catch (e) {
    console.error('❌ Ошибка загрузки баланса:', e);
  }
};

// ==================== ТАРИФЫ ДОСТАВКИ ====================
  // Редактируются admin на вкладке «Тарифы доставки» страницы «Миксеры»
  // (десктоп-админка) — см. lib/deliveryPricing.ts. Пока не загрузились,
  // считаем по тем же значениям, что были захардкожены раньше.
  const [deliverySettings, setDeliverySettings] = useState<DeliverySettings>(DEFAULT_DELIVERY_SETTINGS);
  useEffect(() => {
    fetchDeliverySettings().then(setDeliverySettings);
  }, []);

  // Дебаунс адреса перед геокодированием (нужны координаты только для
  // расчёта км доставки за городом) — не дёргаем DaData на каждую букву.
  const [previewAddress, setPreviewAddress] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setPreviewAddress(form.address), 600);
    return () => clearTimeout(timer);
  }, [form.address]);
  const addressLooksUsable = previewAddress.trim().length >= 5;
  const { coords: previewCoords } = useDeliveryCoords(addressLooksUsable ? previewAddress : null);

  // ==================== РАСЧЁТ СТОИМОСТИ В РЕАЛЬНОМ ВРЕМЕНИ ====================
  const volume = parseFloat(form.volume) || 0;

  const pricePerCubic: Record<string, number> = {
    'М100': 6380, 'М150': 6500, 'М200': 6600, 'М250': 6950,
    'М300': 7230, 'М350': 7400, 'М400': 8050, 'М450': 8350, 'М500': 8700,
  };

  const concreteCost = useMemo(() => {
    return volume > 0 ? Math.round(volume * (pricePerCubic[form.grade] || 7230)) : 0;
  }, [volume, form.grade]);

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

  // === ПОГАШЕНИЕ БАЛЛОВ ===
  const [redeemAmount, setRedeemAmount] = useState<number>(0);

  const finalPrice = Math.max(0, totalPrice - redeemAmount);

  const handleChange = (e: React.ChangeEvent<any>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleCustomerTypeChange = (type: 'physical' | 'legal') => {
    setForm(prev => ({ ...prev, customerType: type }));
  };

  const requestPhone = async () => {
    const wa = (window as any).Telegram?.WebApp ?? (window as any).WebApp;
    if (!wa?.requestContact) {
      alert('Эта кнопка работает только в Telegram. Введите номер вручную.');
      return;
    }
    try {
      const result = await wa.requestContact();
      // Telegram Bot API 6.9+: { status: 'sent', response: { responseUnsafe: { contact: { phone_number } } } }
      const raw = result?.response?.responseUnsafe?.contact?.phone_number
        ?? result?.responseUnsafe?.contact?.phone_number
        ?? result?.phone_number
        ?? result?.phone;
      if (raw) {
        await registerByPhone(raw);
      } else {
        alert('Вы не поделились номером телефона');
      }
    } catch (e) {
      console.error('requestContact error:', e);
      alert('Не удалось запросить контакт. Введите номер вручную.');
    }
  };

const registerByPhone = async (phoneNumber: string) => {
  if (!phoneNumber) return;

  setIsSubmitting(true);

  try {
    const refCode = urlSearchParams.get('ref') || referredBy;
    const normalizedPhone = phoneNumber.replace(/\D/g, '');

    console.log('🚀 registerByPhone → phone:', normalizedPhone, 'refCode:', refCode);

    const res = await fetch('/api/user/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        phone: normalizedPhone,     // ← только цифры
        fullName: fullName || null,
        referredBy: refCode
      }),
    });

    const data = await res.json();
    console.log('📦 Ответ от /api/user/register:', data);

    if (data.success && data.userId) {
      setUserId(data.userId);
      setPhone(phoneNumber);           // красивый формат для отображения
      setIsVerified(true);

      localStorage.setItem('userPhone', phoneNumber);
      localStorage.setItem('userId', data.userId.toString());

      console.log('✅ Регистрация/логин успешна, userId:', data.userId);

      initializeUser(data.userId);
    } 
    else if (data.message?.includes('duplicate') || data.message?.includes('phone')) {
      // Пользователь уже существует — логиним
      console.log('👤 Пользователь уже существует, выполняем вход');

      const savedUserId = localStorage.getItem('userId');
      if (savedUserId) {
        setUserId(parseInt(savedUserId));
        setPhone(phoneNumber);
        setIsVerified(true);
        initializeUser(parseInt(savedUserId));
      } else {
        alert('Этот номер уже зарегистрирован.');
      }
    } 
    else {
      alert('Ошибка: ' + (data.message || 'Неизвестная ошибка'));
    }
  } catch (e: any) {
    console.error('💥 Ошибка регистрации:', e);
    alert('Ошибка соединения с сервером');
  } finally {
    setIsSubmitting(false);
  }
};

  // Проверка при загрузке (localStorage)
  useEffect(() => {
    const savedPhone = localStorage.getItem('userPhone');
    const savedUserId = localStorage.getItem('userId');

    if (savedPhone && savedUserId) {
      setPhone(savedPhone);
      setUserId(parseInt(savedUserId));
      setIsVerified(true);
      console.log('✅ Загружено из localStorage, userId =', savedUserId);
    }
  }, []);

  // Основной useEffect — Telegram WebApp
  useEffect(() => {
    const wa = (window as any).WebApp;
    if (!wa) return;

    wa.ready();
    wa.expand();
    wa.enableClosingConfirmation();

    const uid = wa.initDataUnsafe?.user?.id || wa.initData?.user?.id;
    if (uid) {
      setUserId(uid);
      console.log('✅ Telegram userId:', uid);
    }

    wa.MainButton.setText('Отправить заявку');
    wa.MainButton.show();
    wa.MainButton.onClick(handleSubmit);
  }, []);

  // Ловим ref из URL
useEffect(() => {
  const ref = urlSearchParams.get('ref');
  if (ref) {
    const refId = parseInt(ref, 10);
    if (!isNaN(refId)) {
      setReferredBy(refId);
      console.log('🔗 🔥 РЕФЕРАЛЬНАЯ ССЫЛКА ПОЙМАНА!', refId);
    }
  }
}, [urlSearchParams]);

// Запускаем initializeUser когда есть userId
useEffect(() => {
  if (userId) {
    console.log(`🔄 Запускаем initializeUser | userId=${userId}, referredBy=${referredBy || 'null'}`);
    initializeUser(userId);
  }
}, [userId, referredBy]);

  const loadOrders = async () => {
    if (!userId) {
      console.log('❌ loadOrders: userId отсутствует');
      setLoadingHistory(false);
      return;
    }

    setLoadingHistory(true);
    try {
      console.log('📡 Загрузка истории для userId:', userId);
      const res = await fetch(`/api/orders?userId=${userId}`);
      console.log('📨 Статус ответа /api/orders:', res.status);
      const data = await res.json();
      console.log('📦 Получено заявок из базы:', data.orders?.length || 0);
      console.log('📋 Данные заявок:', data.orders);
      setOrders(data.orders || []);
    } catch (e) {
      console.error('loadOrders error:', e);
    } finally {
      setLoadingHistory(false);
    }
  };

// Загрузка истории операций (начисления + погашения + выводы)
const loadReferrals = async () => {
  if (!userId) {
    console.warn('loadReferrals: userId отсутствует');
    return;
  }

  setLoadingReferrals(true);

  try {
    const res = await fetch(`/api/referrals/history?userId=${userId}`);

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const result = await res.json();

    if (result.success) {
      setReferralHistory(result.history || []);
      console.log(`✅ Загружено ${result.history?.length || 0} операций`);
    } else {
      console.error('❌ Ошибка от API:', result.message);
      setReferralHistory([]);
    }
  } catch (err) {
    console.error('❌ Ошибка при загрузке истории операций:', err);
    setReferralHistory([]);
  } finally {
    setLoadingReferrals(false);
  }
};

   // Функция вывода баллов
  const handleWithdraw = async () => {
  const amount = parseInt(withdrawAmount);
  
  if (!amount || amount <= 0 || amount > balance) {
    alert('Неверная сумма!');
    return;
  }

  const selected = selectedReferrerForWithdraw;

  try {
    const res = await fetch('/api/balance/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: userId,
        amount: amount,
        type: 'cash',
        payoutDetails: { 
          method: 'card', 
          comment: 'Вывод реферальных баллов',
          source_referrer_id: selected ? (selected.referrerPhone || null) : null,
          source_referrer_name: selected ? selected.referrerName : null
        }
      })
    });

    const data = await res.json();

    if (data.success) {
      alert(data.message || 'Заявка на вывод успешно создана. Ожидайте подтверждения администратора.');
    } else {
      alert(data.message || 'Ошибка при создании заявки');
    }

    // Закрываем модальное окно и сбрасываем все состояния
    setShowWithdrawModal(false);
    setWithdrawAmount('');
    setSelectedReferrerForWithdraw(null);
    setShowReferrerList(false);        // ← Добавлено

    // Обновляем данные
    loadBalance();
    loadReferrals();

  } catch (e) {
    console.error(e);
    alert('Ошибка соединения с сервером');
  }
};

  const handleSubmit = async () => {
  const wa = (window as any).WebApp;
  const showAlert = wa?.showAlert || alert;

  // ================================================
  // 1. ВАЛИДАЦИЯ ВВОДА
  // ================================================
  if (!form.volume || parseFloat(form.volume) <= 0) {
    showAlert('Укажите объём бетона больше 0 м³');
    return;
  }

  if (!form.address || form.address.trim().length < 5) {
    showAlert('Укажите полный адрес доставки');
    return;
  }

  const currentPhone = form.phone || phone || '';
  if (!currentPhone || currentPhone.replace(/\D/g, '').length < 10) {
    showAlert('Укажите корректный номер телефона');
    return;
  }

  if (form.customerType === 'legal' && (!form.organizationName || form.organizationName.trim().length < 3)) {
    showAlert('Укажите название организации');
    return;
  }

  if (form.customerType === 'physical' && (!form.fullName || form.fullName.trim().length < 5)) {
    showAlert('Укажите ФИО полностью');
    return;
  }

  // ================================================
  // 2. ПОДГОТОВКА К ОТПРАВКЕ
  // ================================================
  setIsSubmitting(true);
  if (wa?.MainButton) wa.MainButton.showProgress();

  // ====================== НАДЁЖНЫЙ ЗАХВАТ РЕФЕРАЛА ======================
  const refCodeFromUrl = urlSearchParams.get('ref');
  const finalReferredBy = referredBy || refCodeFromUrl || null;

  console.log('📤 handleSubmit → finalReferredBy:', finalReferredBy);
  console.log('   → из состояния referredBy:', referredBy);
  console.log('   → из URL ref:', refCodeFromUrl);

  // Формируем payload для отправки на сервер
  const payload = {
    ...form,
    volume: parseFloat(form.volume || '0'),
    phone: currentPhone,

    // Безопасное преобразование числовых полей
    concreteCost: Number(concreteCost) || 0,
    deliveryCost: Number(deliveryCost) || 0,
    totalPrice: Number(totalPrice) || 0,

    // Погашение баллов
    redeemAmount: redeemAmount > 0 ? redeemAmount : 0,

    customerType: form.customerType === 'legal' 
      ? 'Юридическое лицо' 
      : 'Физическое лицо',

    userId: userId,
    referredBy: finalReferredBy,           // ← КРИТИЧЕСКИ ВАЖНО
  };

  console.log('📦 Полный payload перед отправкой:', {
    userId: payload.userId,
    referredBy: payload.referredBy,
    volume: payload.volume,
    redeemAmount: payload.redeemAmount
  });

  try {
    // ================================================
    // 3. ОТПРАВКА ЗАКАЗА НА СЕРВЕР
    // ================================================
    const response = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log('📦 Ответ от /api/order:', data);

    if (data.success) {
      // ================================================
      // 4. УСПЕШНОЕ СОЗДАНИЕ ЗАКАЗА
      // ================================================
      setOrderId(data.orderId);
      setCurrentScreen('success');
      if (wa?.MainButton) wa.MainButton.hide();

      console.log(`✅ Заказ #${data.orderId} успешно создан! Погашено баллов: ${redeemAmount}`);

      // Очистка формы + сброс суммы погашения
      setForm({
        grade: 'М300',
        volume: '',
        deliveryDate: new Date().toISOString().split('T')[0],
        deliveryTime: '10:00',
        address: '',
        customerType: 'physical',
        organizationName: '',
        fullName: '',
        phone: currentPhone,
        comment: '',
      });

      setRedeemAmount(0);        // ← Важно! Сбрасываем сумму погашения

      // Обновляем баланс пользователя
      if (userId) loadBalance();

    } 
    else if (response.status === 409 && data.suggestions) {
      let message = `${data.message}\n\nБлижайшие свободные времена:\n\n`;
      data.suggestions.forEach((slot: any, index: number) => {
        message += `${index + 1}. ${slot.time} — ${slot.reason}\n`;
      });
      message += `\nВыберите одно из предложенных времён или измените дату.`;
      showAlert(message);
    } 
    else {
      showAlert('Ошибка создания заявки:\n' + (data.message || 'Неизвестная ошибка'));
    }

  } catch (error) {
    console.error('Submit error:', error);
    showAlert('Ошибка соединения с сервером. Попробуйте ещё раз.');
  } finally {
    setIsSubmitting(false);
    if (wa?.MainButton) wa.MainButton.hideProgress();
  }
};

  // ====================== ЭКРАН ВЕРИФИКАЦИИ ======================
  if (!isVerified) {
    const phoneReady = normalizePhone(phone).length === 11;
    return (
      <div className="order-page-root" style={{
        backgroundColor: '#1C2B3D',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
        {/* ── Карточка по центру ── */}
        <div style={{
          width: '100%',
          maxWidth: '400px',
          margin: '0 auto',
          padding: '32px 24px 36px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}>
          {/* Логотип */}
          <div style={{ marginBottom: '8px' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-tradecom-white.png" alt="TradeCom" style={{ height: '92px', objectFit: 'contain' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '28px' }}>
            <div style={{ width: '24px', height: '1px', background: 'rgba(255,255,255,0.2)' }} />
            <span style={{ fontSize: '11px', fontWeight: 500, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Заказать бетон
            </span>
            <div style={{ width: '24px', height: '1px', background: 'rgba(255,255,255,0.2)' }} />
          </div>

        {/* ── Контент ── */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0' }}>

          {/* Подзаголовок */}
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: '14px', margin: '0 0 24px', textAlign: 'center', lineHeight: 1.5 }}>
            Подтвердите номер телефона<br />для продолжения работы
          </p>

          {/* Реферальный блок */}
          {urlSearchParams.get('ref') && (
            <div style={{
              width: '100%',
              background: 'rgba(234,179,8,0.08)',
              border: '1px solid rgba(234,179,8,0.3)',
              borderRadius: '14px',
              padding: '16px 20px',
              marginBottom: '24px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '28px', marginBottom: '6px' }}>🎁</div>
              <div style={{ fontWeight: 700, color: '#FCD34D', fontSize: '15px', marginBottom: '10px' }}>
                Вы пришли по рекомендации друга!
              </div>
              <div style={{
                background: 'rgba(255,255,255,0.08)',
                padding: '8px 18px',
                borderRadius: '8px',
                fontSize: '22px',
                fontWeight: 700,
                letterSpacing: '3px',
                color: '#F8FAFC',
                display: 'inline-block',
              }}>
                {urlSearchParams.get('ref')}
              </div>
            </div>
          )}

          {/* Кнопка быстрого ввода номера */}
          {isTelegram ? (
            /* Внутри Telegram — берём номер из профиля */
            <button
              onClick={requestPhone}
              style={{
                ...outlinedBtn('#10B981'),
                width: '100%',
                padding: '13px',
                fontSize: '16px',
                fontWeight: 700,
                marginBottom: '20px',
              }}
            >
              📱 Использовать мой номер из Telegram
            </button>
          ) : (
            /* Вне Telegram — вставить из буфера обмена */
            <button
              onClick={async () => {
                try {
                  const text = await navigator.clipboard.readText();
                  const digits = text.replace(/\D/g, '');
                  if (digits.length >= 10) {
                    setPhone(formatPhoneInput('+' + digits));
                  } else {
                    alert('В буфере обмена не найден номер телефона. Скопируйте его и попробуйте снова.');
                  }
                } catch {
                  alert('Нет доступа к буферу обмена. Введите номер вручную.');
                }
              }}
              style={{
                ...outlinedBtn('#60A5FA'),
                width: '100%',
                padding: '13px',
                fontSize: '16px',
                fontWeight: 700,
                marginBottom: '20px',
              }}
            >
              📋 Вставить номер из буфера
            </button>
          )}

          {/* Разделитель */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', marginBottom: '20px' }}>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
            <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap' }}>или введите вручную</span>
            <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
          </div>

          {/* Поля */}
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
            <div>
              <label style={LABEL}>Телефон</label>
              <input
                type="tel"
                placeholder="+7 (___) ___-__-__"
                value={phone}
                onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
                style={{ ...lightFieldStyle, textAlign: 'center', fontSize: '17px' }}
                maxLength={18}
              />
            </div>
            <div>
              <label style={LABEL}>ФИО</label>
              <input
                type="text"
                placeholder="Иванов Иван Иванович"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                style={lightFieldStyle}
              />
            </div>
          </div>

          {/* Кнопка продолжить */}
          <button
            onClick={() => phone && registerByPhone(phone)}
            disabled={!phoneReady}
            style={{
              ...outlinedBtn(phoneReady ? '#10B981' : 'rgba(255,255,255,0.2)'),
              width: '100%',
              padding: '13px',
              fontSize: '16px',
              fontWeight: 700,
              opacity: phoneReady ? 1 : 0.5,
              cursor: phoneReady ? 'pointer' : 'not-allowed',
            }}
          >
            Продолжить →
          </button>
        </div>{/* конец внутреннего flex */}
        </div>{/* конец карточки */}
      </div>
    );
  }

  // Экран успешной отправки заявки
  if (currentScreen === 'success') {
    return (
      <div className="order-page-root" style={{ 
        padding: '40px 20px', 
        textAlign: 'center', 
        backgroundColor: '#1C2B3D',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
      }}>
        <div style={{ fontSize: '80px', marginBottom: '24px' }}>✅</div>
        <h2 style={{ fontSize: '28px', marginBottom: '16px', color: '#F8FAFC' }}>Заявка отправлена!</h2>
        <p style={{ fontSize: '18px', color: 'rgba(255,255,255,0.5)', marginBottom: '40px' }}>
          Номер заявки: <strong style={{ color: '#10B981' }}>#{orderId}</strong><br />
          Менеджер свяжется с вами в ближайшее время.
        </p>
        
        <button
          onClick={() => {
            setCurrentScreen('form');
            setActiveTab('new');
          }}
          style={{ ...outlinedBtn('#10B981'), minWidth: '240px', padding: '14px 28px', fontSize: '16px', fontWeight: 700 }}
        >
          + Создать новую заявку
        </button>
      </div>
    );
  }

  // Основной интерфейс приложения

  // ── Нижний навбар (компонент внутри рендера) ──────────────────────────────
  const NAV_ITEMS = [
    { tab: 'new' as const,      icon: <PlusCircle size={22} />,    label: 'Заявка',    action: () => setActiveTab('new') },
    { tab: 'history' as const,  icon: <ClipboardList size={22} />, label: 'Мои заявки', action: () => { setActiveTab('history'); loadOrders(); } },
    { tab: 'referral' as const, icon: <Gift size={22} />,          label: 'Баллы',     action: () => { setActiveTab('referral'); loadReferrals(); } },
    { tab: 'balance' as const,  icon: <Wallet size={22} />,        label: 'Баланс',    action: () => setActiveTab('balance') },
  ];

  return (
    <div className="order-page-root" style={{ backgroundColor: '#1C2B3D', display: 'flex', flexDirection: 'column' }}>

      {/* ── HERO ШАПКА ──────────────────────────────────────────────────────── */}
      <div style={{ width: '100%', backgroundColor: '#1C2B3D', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{
          maxWidth: '480px', margin: '0 auto',
          padding: '14px 20px 12px',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px',
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-tradecom-white.png" alt="TradeCom" style={{ height: '46px', width: 'auto', objectFit: 'contain' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ width: '24px', height: '1px', background: 'rgba(255,255,255,0.2)' }} />
            <span style={{ fontSize: '11px', fontWeight: 500, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Заказать бетон
            </span>
            <div style={{ width: '24px', height: '1px', background: 'rgba(255,255,255,0.2)' }} />
          </div>
        </div>
      </div>

      {/* ── ОСНОВНОЕ СОДЕРЖИМОЕ ─────────────────────────────────────────────── */}
      <div className="order-page-content" style={{ width: '100%', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {/* Центрирующая обёртка для десктопа, на мобильном — 100% */}
        <div style={{ width: '100%', maxWidth: '480px' }}>

        {activeTab === 'new' && (
  <div style={{ width: '100%', background: 'transparent' }}>

    {/* ====================== САМА ФОРМА ====================== */}
 <div style={{ padding: '12px 16px' }}>
      <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={LABEL}>Марка бетона</label>
            <select
              value={form.grade}
              onChange={(e) => setForm({ ...form, grade: e.target.value })}
              style={lightFieldStyle}
            >
              <option value="М100">М100</option>
              <option value="М150">М150</option>
              <option value="М200">М200</option>
              <option value="М250">М250</option>
              <option value="М300">М300</option>
              <option value="М350">М350</option>
              <option value="М400">М400</option>
              <option value="М450">М450</option>
              <option value="М500">М500</option>         
            </select>
          </div>

           <div>
            <label style={LABEL}>Объём (м³)</label>
            <input
              type="number"
              value={form.volume}
              onChange={(e) => setForm({ ...form, volume: e.target.value })}
              style={lightFieldStyle}
              placeholder="20"
              min="1"
              step="0.5"
            />
          </div>
        </div>

{volume > 0 && (
  <div style={{ 
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)', 
    padding: '16px', 
    borderRadius: '16px', 
    border: '1px solid rgba(255,255,255,0.1)',
    marginTop: '8px',
    boxSizing: 'border-box'
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
      <span style={{ color: 'rgba(255,255,255,0.5)' }}>Бетон:</span>
      <span style={{ fontWeight: '600', color: '#F8FAFC' }}>{concreteCost.toLocaleString('ru-RU')} ₽</span>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
      <span style={{ color: 'rgba(255,255,255,0.5)' }}>Доставка:</span>
      <span style={{ fontWeight: '600', color: '#F8FAFC' }}>{deliveryCost.toLocaleString('ru-RU')} ₽</span>
    </div>

    {deliveryNote && (
      <div style={{ marginTop: '10px', padding: '10px', backgroundColor: 'rgba(14,165,233,0.15)', borderRadius: '10px', fontSize: '14.5px', color: '#38BDF8', textAlign: 'center' }}>
        🚚 {deliveryNote}
      </div>
    )}

    {/* === НОВЫЙ БЛОК ПОГАШЕНИЯ БАЛЛОВ === */}
    {balance > 0 && (
      <div style={{ 
        marginTop: '16px', 
        padding: '14px', 
        backgroundColor: 'rgba(16,185,129,0.1)', 
        borderRadius: '12px', 
        border: '1px solid rgba(16,185,129,0.3)' 
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontWeight: '600', color: '#10B981' }}>Погасить баллами</span>
          <span style={{ color: '#10B981' }}>Доступно: <strong>{balance} ₽</strong></span>
        </div>
        
        <input
      type="number"
      value={redeemAmount || ''}           // ← важно для исчезновения нуля
      min="0"
      max={Math.min(balance, totalPrice)}
      onChange={(e) => {
        const inputValue = e.target.value;
        
        if (inputValue === '') {
          setRedeemAmount(0);
          return;
        }

        let val = Number(inputValue);
        if (isNaN(val) || val < 0) val = 0;
        
        // Ограничиваем максимумом
        val = Math.min(val, balance, totalPrice);
        
        setRedeemAmount(val);
      }}
          style={{ 
            width: '100%', 
            padding: '12px', 
            borderRadius: '10px', 
            border: '1px solid rgba(16,185,129,0.4)', 
            fontSize: '16px',
            textAlign: 'center',
            boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.05)',
            color: '#F8FAFC',
          }}
          placeholder="0"
        />
        
        <div style={{ 
          marginTop: '10px', 
          display: 'flex', 
          justifyContent: 'space-between', 
          fontSize: '18px', 
          fontWeight: '700', 
          color: '#10B981' 
        }}>
          <span>Итого к оплате:</span>
          <span>{finalPrice.toLocaleString('ru-RU')} ₽</span>
        </div>
      </div>
    )}

    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '18px', fontWeight: '700', color: '#60A5FA', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '10px', marginTop: '12px' }}>
      <span>Итого без скидки:</span>
      <span>{totalPrice.toLocaleString('ru-RU')} ₽</span>
    </div>
  </div>
)}

        <div>
          <label style={LABEL}>Дата и время доставки</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <input
              type="date"
              value={form.deliveryDate}
              onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })}
              style={lightFieldStyle}
            />
            <input
              type="time"
              value={form.deliveryTime}
              onChange={(e) => setForm({ ...form, deliveryTime: e.target.value })}
              style={lightFieldStyle}
            />
          </div>
        </div>
        <div>
          <label style={LABEL}>Адрес доставки</label>
          <textarea
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            rows={2}
            style={{ 
              ...lightFieldStyle,
              borderRadius: '10px', 
              resize: 'none', 
              minHeight: '52px',
            }}
            placeholder="Укажите полный адрес"
          />
        </div>

        <div>
          <label style={LABEL}>Тип заказчика</label>
          <div style={{ display: 'flex', gap: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '10px', padding: '3px' }}>
            {(['physical', 'legal'] as const).map(t => (
              <button key={t} type="button" onClick={() => setForm({ ...form, customerType: t })}
                style={{ flex: 1, padding: '7px 4px', borderRadius: '8px', fontWeight: 600, fontSize: '13px',
                  whiteSpace: 'nowrap', border: 'none', transition: 'all 0.15s',
                  background: form.customerType === t ? '#10B981' : 'transparent',
                  color: form.customerType === t ? 'white' : 'rgba(255,255,255,0.45)',
                }}>
                {t === 'physical' ? 'Физическое лицо' : 'Юридическое лицо'}
              </button>
            ))}
          </div>
        </div>

        {form.customerType === 'physical' ? (
          <div>
            <label style={LABEL}>ФИО</label>
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              style={lightFieldStyle}
              placeholder="Иванов Иван Иванович"
            />
          </div>
        ) : (
           <div>
            <label style={LABEL}>Название организации</label>
            <input
              type="text"
              value={form.organizationName}
              onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
              style={lightFieldStyle}
              placeholder='ООО "Ваша организация"'
            />
          </div>
        )}

        <div>
          <label style={LABEL}>Телефон для связи</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: formatPhoneInput(e.target.value) })}
            style={{ ...lightFieldStyle, fontSize: '17px' }}
            placeholder="+7 (___) ___-__-__"
            maxLength={18}
          />
        </div>

        <div>
          <label style={LABEL}>Комментарий</label>
          <textarea
            value={form.comment}
            onChange={(e) => setForm({ ...form, comment: e.target.value })}
            rows={2}
            style={{ 
              ...lightFieldStyle,
              borderRadius: '10px', 
              resize: 'none', 
              minHeight: '52px',
            }}
            placeholder="Насос, лоток, тип подачи, въезд для миксера, особенности объекта…"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          style={{ 
            width: '100%',
            ...outlinedBtn('#10B981'),
            padding: '12px',
            borderRadius: '12px',
            fontSize: '16px',
            fontWeight: 700,
            marginTop: '4px',
            boxSizing: 'border-box',
            opacity: isSubmitting ? 0.5 : 1,
          }}
        >
          {isSubmitting ? 'Отправляем...' : '✓ Отправить заявку'}
        </button>
      </form>
    </div>

  </div>
)}

          {activeTab === 'history' && (
  <div>
    <div style={{ padding: '20px 16px' }}>
      <h2 style={{ marginBottom: '20px', color: '#F8FAFC', fontSize: '20px' }}>Мои заявки</h2>
      {loadingHistory ? (
        <p style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.4)' }}>Загрузка...</p>
      ) : orders.length === 0 ? (
        <p style={{ textAlign: 'center', padding: '80px 20px', color: 'rgba(255,255,255,0.3)' }}>Пока нет заявок</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {orders.map((order) => (
            <div key={order.id} style={{ background: 'rgba(255,255,255,0.06)', padding: '18px', borderRadius: '16px', border: '1px solid rgba(255,255,255,0.08)' }}>
              <strong style={{ color: '#F8FAFC' }}>{order.grade} — {order.volume} м³</strong>
              <div style={{ color: 'rgba(255,255,255,0.5)', margin: '6px 0', fontSize: '14px' }}>{order.delivery_date} в {order.delivery_time}</div>
              <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '14px' }}>{order.address}</div>
              <div style={{ marginTop: '12px', fontSize: '19px', fontWeight: '700', color: '#10B981' }}>
                {order.total_price?.toLocaleString('ru-RU')} ₽
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
)}

{activeTab === 'referral' && (
  <div>
          <div style={{ padding: '20px 16px', textAlign: 'center' }}>
           <h2 style={{ marginBottom: '8px', color: '#F8FAFC' }}>Мои баллы</h2>
  
           <div style={{ 
           fontSize: '64px', 
           fontWeight: '700', 
           color: '#10B981', 
           marginBottom: '8px',
           textAlign: 'center'
        }}>
         {balance} ₽
     </div>
  
        <p style={{ 
          color: 'rgba(255,255,255,0.4)', 
          marginBottom: '30px',
          textAlign: 'center'
       }}>
             Баллы можно использовать как скидку
     </p>

       {/* Реферальный код */}
      <div style={{ marginBottom: '32px' }}>
        <h3 style={{ marginBottom: '12px', textAlign: 'center', color: 'rgba(255,255,255,0.7)', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Твой реферальный код</h3>
        <div style={{ 
          backgroundColor: 'rgba(255,255,255,0.07)', padding: '18px', borderRadius: '12px', 
          fontSize: '26px', fontWeight: '700', letterSpacing: '3px', 
          marginBottom: '14px', textAlign: 'center', color: '#F8FAFC',
          border: '1px solid rgba(255,255,255,0.1)',
        }}>
          {referralCode}
        </div>
        <button 
          onClick={() => {
            const link = `https://beton-order-app-nlnv.vercel.app/?ref=${referralCode}`;
            navigator.clipboard.writeText(link);
            alert('Реферальная ссылка скопирована!');
          }} 
          style={{ ...outlinedBtn('#10B981'), width: '80%', maxWidth: '320px', margin: '0 auto', padding: '11px 20px' }}
        >
          Скопировать ссылку
        </button>
      </div>

      <h3 style={{ marginBottom: '16px', color: 'rgba(255,255,255,0.7)', fontSize: '14px', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'left' }}>История операций</h3>

      {loadingReferrals ? (
        <p style={{ textAlign: 'center', padding: '60px 0', color: 'rgba(255,255,255,0.3)' }}>Загрузка операций...</p>
      ) : referralHistory.length === 0 ? (
        <p style={{ textAlign: 'center', padding: '80px 20px', color: 'rgba(255,255,255,0.3)' }}>Пока нет операций</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', textAlign: 'left' }}>
          {referralHistory.map((op: any, index: number) => {
            const isExpanded = expandedReferrer === index;

            // === ГРУППА НАЧИСЛЕНИЙ ОТ РЕФЕРАЛА ===
            if (op.type === 'referral_group') {
              const earned = op.earnedBonus || 0;
              return (
                <div key={index} style={{
                  background: isExpanded ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.05)',
                  borderRadius: '14px',
                  overflow: 'hidden',
                  border: isExpanded ? '1px solid rgba(16,185,129,0.3)' : '1px solid rgba(255,255,255,0.08)'
                }}>
                  <div 
                    onClick={() => setExpandedReferrer(isExpanded ? null : index)}
                    style={{
                      padding: '16px 18px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
                        {new Date(op.lastDate).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })}
                      </div>
                      <div style={{ fontWeight: '600', marginTop: '4px', color: '#F8FAFC' }}>
                        От: {op.referrerName}
                      </div>
                      <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
                        {op.referrerPhone}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '18px', fontWeight: '700', color: '#10B981' }}>
                        +{earned.toLocaleString('ru-RU')} ₽
                      </div>
                      <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
                        {op.totalVolume} м³ • {op.count} заказ{op.count > 1 ? 'а' : ''}
                      </div>
                    </div>
                  </div>

                  {isExpanded && op.orders && op.orders.length > 0 && (
                    <div style={{ padding: '0 18px 16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                      {op.orders.map((order: any, i: number) => {
                        let statusText = 'В процессе начисления';
                        let statusColor = 'rgba(255,255,255,0.3)';

                        if (order.status === 'completed') {
                          statusText = `+${order.bonus_amount} ₽`;
                          statusColor = '#10B981';
                        } else if (order.status === 'cancelled') {
                          statusText = 'Отмена';
                          statusColor = '#F87171';
                        }

                        return (
                          <div key={i} style={{
                            padding: '10px 0',
                            borderBottom: i < op.orders.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: '14px'
                          }}>
                            <div style={{ color: 'rgba(255,255,255,0.7)' }}>Заказ №{order.id || '—'} — {order.volume} м³</div>
                            <div style={{ color: statusColor, fontWeight: '600' }}>
                              {statusText}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            // === ОДИНОЧНЫЕ ОПЕРАЦИИ (погашение, вывод) ===
            const isNegative = op.type === 'discount' || op.type === 'cash_withdrawal';
            const amountColor = isNegative ? '#F87171' : '#10B981';
            const amountText = isNegative ? `-${op.amount} ₽` : `+${op.amount} ₽`;

            return (
              <div key={index} style={{
                background: 'rgba(255,255,255,0.05)',
                borderRadius: '14px',
                overflow: 'hidden',
                border: '1px solid rgba(255,255,255,0.08)'
              }}>
                <div style={{
                  padding: '16px 18px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <div>
                    <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>
                      {op.date ? new Date(op.date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' }) : '—'}
                    </div>
                    <div style={{ fontWeight: '600', marginTop: '4px', color: '#F8FAFC' }}>
                      {op.title}
                    </div>
                    {op.subtitle && <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>{op.subtitle}</div>}
                  </div>
                  <div style={{ fontSize: '18px', fontWeight: '700', color: amountColor }}>
                    {amountText}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  </div>
)}
{/* ====================== ВКЛАДКА «БАЛАНС» ====================== */}
{activeTab === 'balance' && (
  <div>
    <div style={{ padding: '20px 16px', textAlign: 'center' }}>
      <h2 style={{ marginBottom: '20px', color: '#F8FAFC' }}>Баланс и погашение</h2>
      
        <div style={{ 
           fontSize: '72px', 
           fontWeight: '700', 
           color: '#10B981', 
           marginBottom: '8px',
           textAlign: 'center',
           width: '100%'
       }}>
          {balance} ₽
      </div>
      <p style={{ color: 'rgba(255,255,255,0.4)', marginBottom: '36px' }}>
        Баллы можно использовать как скидку на заказ или вывести наличными
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxWidth: '320px', margin: '0 auto' }}>
        <button 
          onClick={() => setActiveTab('new')}
          style={{ ...outlinedBtn('#10B981'), width: '100%', padding: '12px 16px' }}
        >
          ✓ Использовать на следующий заказ
        </button>

        <button 
          onClick={() => setShowWithdrawModal(true)}
          style={{ ...outlinedBtn('#FB923C'), width: '100%', padding: '12px 16px' }}
        >
          ↑ Вывести наличными / на карту
        </button>
      </div>
    </div>

{/* ==================== МОДАЛЬНОЕ ОКНО ВЫВОДА ==================== */}
{showWithdrawModal && (
  <div style={{
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.8)', zIndex: 3000,
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  }}>
    <div style={{
      background: '#1E293B', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: '560px',
      maxHeight: '85vh', overflow: 'auto', boxShadow: '0 -20px 60px rgba(0,0,0,0.5)',
    }}>
      <div style={{ padding: '28px 20px' }}>
        <h3 style={{ textAlign: 'center', marginBottom: '8px', fontSize: '20px', color: '#F8FAFC' }}>Вывод баллов</h3>
        <p style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)', marginBottom: '20px' }}>
          Максимум: <strong style={{ color: '#10B981' }}>{balance} ₽</strong>
        </p>

        <input
          type="number"
          placeholder="Сумма вывода"
          value={withdrawAmount}
          onChange={(e) => setWithdrawAmount(e.target.value)}
          style={{ 
            width: '100%', 
            padding: '16px', 
            fontSize: '20px', 
            textAlign: 'center', 
            border: '1px solid rgba(255,255,255,0.15)', 
            borderRadius: '14px', 
            marginBottom: '20px',
            boxSizing: 'border-box',
            background: 'rgba(255,255,255,0.07)',
            color: '#F8FAFC',
          }}
        />

        <div style={{ marginBottom: '24px' }}>
          <p style={{ fontWeight: '600', marginBottom: '10px', color: 'rgba(255,255,255,0.6)', fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            От какого реферала списать?
          </p>

          <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', overflow: 'hidden' }}>
            <div 
              onClick={() => setSelectedReferrerForWithdraw(null)}
              style={{ 
                padding: '14px 16px', 
                background: selectedReferrerForWithdraw === null ? 'rgba(16,185,129,0.1)' : 'transparent', 
                borderBottom: '1px solid rgba(255,255,255,0.07)', 
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: '#F8FAFC',
              }}
            >
              <div>Общий баланс (без привязки)</div>
              {selectedReferrerForWithdraw === null && <span style={{ color: '#10B981', fontSize: '18px' }}>✓</span>}
            </div>

            {referralHistory && referralHistory.filter(op => 
              op.type === 'referral_group' && 
              (op.referrerName || op.referrerPhone)
            ).length > 0 ? (
              referralHistory
                .filter(op => op.type === 'referral_group' && (op.referrerName || op.referrerPhone))
                .map((op, i) => {
                  const isSelected = selectedReferrerForWithdraw?.referrerPhone === op.referrerPhone;
                  return (
                    <div 
                      key={i}
                      onClick={() => setSelectedReferrerForWithdraw(op)}
                      style={{
                        padding: '14px 16px',
                        borderBottom: i < referralHistory.length - 1 ? '1px solid rgba(255,255,255,0.07)' : 'none',
                        background: isSelected ? 'rgba(16,185,129,0.1)' : 'transparent',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: '600', color: '#F8FAFC' }}>{op.referrerName}</div>
                        <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.4)' }}>{op.referrerPhone}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: '700', color: '#10B981' }}>
                          {op.earnedBonus || 0} ₽
                        </div>
                        {isSelected && <span style={{ color: '#10B981', fontSize: '18px' }}>✓</span>}
                      </div>
                    </div>
                  );
                })
            ) : (
              <div style={{ padding: '24px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.3)' }}>
                Пока нет рефералов
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            onClick={() => { 
              setShowWithdrawModal(false); 
              setWithdrawAmount(''); 
              setSelectedReferrerForWithdraw(null); 
            }} 
            style={{ ...outlinedBtn('rgba(255,255,255,0.5)'), flex: 1, padding: '12px' }}
          >
            Отмена
          </button>

          <button 
            onClick={handleWithdraw} 
            disabled={!withdrawAmount || parseInt(withdrawAmount) <= 0} 
            style={{ 
              ...outlinedBtn('#FB923C'), 
              flex: 1, padding: '12px',
              opacity: (!withdrawAmount || parseInt(withdrawAmount) <= 0) ? 0.4 : 1,
            }}
          >
            ↑ Вывести
          </button>
        </div>
      </div>
    </div>
  </div>
)}
  </div>
)}
        </div>{/* /centering wrapper */}
      </div>

      {/* ── НИЖНИЙ НАВБАР ───────────────────────────────────────────────────── */}
      <div className="order-page-navbar" style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        backgroundColor: '#131E2C',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transform: navVisible ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      }}>
        {/* Центрирующая обёртка навбара — 480px, как форма */}
        <div style={{ width: '100%', maxWidth: '480px', display: 'flex', alignItems: 'center', justifyContent: 'space-around', paddingTop: '8px', paddingBottom: '8px' }}>
          {NAV_ITEMS.map(item => {
            const active = activeTab === item.tab;
            return (
              <button
                key={item.tab}
                onClick={item.action}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: active ? '#10B981' : 'rgba(255,255,255,0.4)',
                  padding: '6px 14px',
                  borderRadius: '12px',
                  transition: 'color 0.15s',
                }}
              >
                {item.icon}
                <span style={{ fontSize: '10px', fontWeight: active ? 700 : 500, letterSpacing: '0.02em' }}>
                  {item.label}
                </span>
                {active && (
                  <div style={{ width: '4px', height: '4px', borderRadius: '50%', background: '#10B981', marginTop: '1px' }} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── КНОПКА ВОЗВРАТА В АДМИНКУ (только для сотрудников, через localStorage-флаг) ── */}
      {isAdminPreview && (
        <button
          onClick={() => {
            localStorage.removeItem('admin_preview');
            window.close();
          }}
          title="Вернуться в мобильную админку"
          style={{
            position: 'fixed',
            top: '12px',
            right: '12px',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '8px 14px',
            borderRadius: '9999px',
            background: 'rgba(30, 41, 59, 0.92)',
            border: '1px solid rgba(96, 165, 250, 0.4)',
            backdropFilter: 'blur(8px)',
            color: '#60A5FA',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Закрыть просмотр
        </button>
      )}
    </div>
  );
}