'use client';

import { useEffect, useState, useMemo } from 'react';
import Image from 'next/image';
import { useSearchParams } from 'next/navigation';

declare const WebApp: any;

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

  const [orders, setOrders] = useState<any[]>([]);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingReferrals, setLoadingReferrals] = useState(false);

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

/// ==================== ЗАГРУЗКА АКТУАЛЬНОГО БАЛАНСА ====================
const loadBalance = async () => {
  if (!userId) {
    console.log('⚠️ loadBalance: userId отсутствует');
    return;
  }

  try {
    console.log(`📡 Запрашиваем баланс для userId: ${userId}`);
    
    const res = await fetch(`/api/user/balance?userId=${userId}`, {
      method: 'GET',
      cache: 'no-store',        // важно — не кэшировать
      headers: { 'Cache-Control': 'no-cache' }
    });

    if (!res.ok) {
      console.warn(`⚠️ Ответ от /api/user/balance: ${res.status}`);
      setBalance(0);
      return;
    }

    const data = await res.json();
    console.log('📦 Ответ баланса:', data);

    if (data.success && typeof data.balance === 'number') {
      setBalance(data.balance);
      console.log(`✅ Баланс успешно обновлён → ${data.balance} ₽`);
    } else {
      console.warn('⚠️ Некорректный ответ от баланса, ставим 0');
      setBalance(0);
    }
  } catch (e) {
    console.error('❌ Ошибка загрузки баланса:', e);
    setBalance(0);
  }
};

// ==================== РАСЧЁТ СТОИМОСТИ В РЕАЛЬНОМ ВРЕМЕНИ ====================
  const volume = parseFloat(form.volume) || 0;

  const pricePerCubic: Record<string, number> = {
    'М100': 6380, 'М150': 6500, 'М200': 6600, 'М250': 6950,
    'М300': 7230, 'М350': 7400, 'М400': 8050, 'М450': 8350, 'М500': 8700,
  };

  const concreteCost = useMemo(() => {
    return volume > 0 ? Math.round(volume * (pricePerCubic[form.grade] || 7230)) : 0;
  }, [volume, form.grade]);

  let deliveryCost = 0;
  let deliveryNote = '';

  if (volume > 0) {
    if (volume <= 10) { 
      deliveryCost = 6000; 
      deliveryNote = '6000 ₽ за рейс (до 10 м³)'; 
    }
    else if (volume <= 12) { 
      deliveryCost = 7500; 
      deliveryNote = '7500 ₽ за рейс (12 м³)'; 
    }
    else if (volume <= 50) { 
      deliveryCost = Math.ceil(volume / 10) * 6000; 
      deliveryNote = `${Math.ceil(volume / 10)} рейса × 6000 ₽`; 
    }
    else { 
      deliveryCost = Math.round(volume * 600); 
      deliveryNote = '600 ₽ за 1 м³'; 
    }
  }

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
    try {
      const result = await (window as any).WebApp.requestContact();
      if (result && result.phone) {
        await registerByPhone(result.phone);
      } else {
        alert('Вы не поделились номером телефона');
      }
    } catch (e) {
      alert('Не удалось запросить контакт');
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

const loadReferrals = async () => {
  if (!userId) return;
  setLoadingReferrals(true);
  await loadBalance();
  try {
    const res = await fetch(`/api/referrals/history?userId=${userId}`);   // ← исправлено
    const data = await res.json();
    if (data.success) {
      setReferralHistory(data.history || []);
    }
  } catch (e) { 
    console.error('Ошибка загрузки истории рефералов:', e); 
  } finally { 
    setLoadingReferrals(false); 
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

  // Надёжный захват реферального кода
  const refCodeFromUrl = urlSearchParams.get('ref');
  const finalReferredBy = referredBy || refCodeFromUrl;

  console.log('📤 handleSubmit → finalReferredBy:', finalReferredBy, 
    '(из состояния:', referredBy, ', из URL:', refCodeFromUrl, ')');

  // Формируем payload для отправки на сервер
  const payload = {
    ...form,
    volume: parseFloat(form.volume || '0'),
    phone: currentPhone,

    // Безопасное преобразование числовых полей
    concreteCost: Number(concreteCost) || 0,
    deliveryCost: Number(deliveryCost) || 0,
    totalPrice: Number(totalPrice) || 0,

    // ←←← ПОГАШЕНИЕ БАЛЛОВ
    redeemAmount: redeemAmount > 0 ? redeemAmount : 0,

    customerType: form.customerType === 'legal' 
      ? 'Юридическое лицо' 
      : 'Физическое лицо',

    userId: userId,
    referredBy: finalReferredBy,
  };

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
    return (
      <div style={{
        padding: '40px 20px',
        textAlign: 'center',
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center'
      }}>
        <div style={{ marginBottom: '40px' }}>
          <Image src="/logo.jpg" alt="Логотип" width={180} height={70} style={{ objectFit: 'contain' }} />
        </div>

        <h1 style={{ fontSize: '26px', fontWeight: '700', marginBottom: '12px' }}>
          Добро пожаловать!
        </h1>
        <p style={{ color: '#666', marginBottom: '30px', fontSize: '17px' }}>
          Для продолжения работы<br />подтвердите ваш номер телефона
        </p>

                {/* ==================== РЕФЕРАЛЬНЫЙ БЛОК ==================== */}
        {urlSearchParams.get('ref') && (
          <div style={{
            background: '#fefce8',
            border: '2px solid #eab308',
            borderRadius: '16px',
            padding: '20px 20px',        // уменьшил вертикальные отступы
            marginBottom: '28px',
            maxWidth: '360px',
            marginLeft: 'auto',
            marginRight: 'auto'
          }}>
            <div style={{ fontSize: '36px', marginBottom: '8px' }}>🎁</div>
            
            <div style={{ 
              fontWeight: '700', 
              color: '#ca8a04', 
              fontSize: '17px', 
              marginBottom: '12px' 
            }}>
              Вы пришли по рекомендации друга!
            </div>

            <div style={{
              background: 'white',
              padding: '12px 20px',
              borderRadius: '10px',
              fontSize: '24px',
              fontWeight: '700',
              letterSpacing: '2px',
              color: '#1e2937',
              display: 'inline-block'
            }}>
              {urlSearchParams.get('ref')}
            </div>
          </div>
        )}

        {/* Кнопка Telegram / Share Phone */}
        <button 
          onClick={requestPhone}
          style={{
            width: '100%',
            maxWidth: '420px',
            margin: '0 auto 16px',
            padding: '18px',
            backgroundColor: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '14px',
            fontSize: '18px',
            fontWeight: '600'
          }}
        >
          Поделиться моим номером
        </button>

        <p style={{ color: '#999', margin: '20px 0' }}>или введите вручную</p>

        {/* Ручной ввод телефона */}
        <input
          type="tel"
          placeholder="+7 (___) ___-__-__"
          value={phone}
          onChange={(e) => {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length > 0 && !value.startsWith('7')) value = '7' + value;
            if (value.length > 11) value = value.substring(0, 11);
            
            let formatted = '+7';
            if (value.length > 1) formatted += ' (' + value.substring(1, 4);
            if (value.length > 4) formatted += ') ' + value.substring(4, 7);
            if (value.length > 7) formatted += '-' + value.substring(7, 9);
            if (value.length > 9) formatted += '-' + value.substring(9, 11);

            setPhone(formatted);
          }}
          style={{
            width: '100%',
            maxWidth: '420px',
            margin: '0 auto 16px',
            padding: '16px',
            borderRadius: '12px',
            border: '1px solid #ddd',
            fontSize: '17px',
            textAlign: 'center'
          }}
          maxLength={18}
        />
        {/* Поле ФИО */}
          <input
            type="text"
            placeholder="Ваше ФИО"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
           style={{
             width: '100%',
             maxWidth: '420px',
             margin: '0 auto 12px',
             padding: '16px',
             borderRadius: '12px',
             border: '1px solid #ddd',
             fontSize: '17px'
         }}
         />

        <button 
          onClick={() => phone && registerByPhone(phone)}
          disabled={!phone || phone.length < 12}
          style={{
            width: '100%',
            maxWidth: '420px',
            margin: '0 auto',
            padding: '16px',
            backgroundColor: (phone && phone.length >= 12) ? '#2563eb' : '#9ca3af',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            fontSize: '17px',
            fontWeight: '600'
          }}
        >
          Продолжить
        </button>
      </div>
    );
  }

  // Экран успешной отправки заявки
  if (currentScreen === 'success') {
    return (
      <div style={{ 
        padding: '40px 20px', 
        textAlign: 'center', 
        minHeight: '100vh', 
        backgroundColor: '#f8fafc' 
      }}>
        <div style={{ fontSize: '80px', marginBottom: '24px' }}>✅</div>
        <h2 style={{ fontSize: '28px', marginBottom: '16px' }}>Заявка отправлена!</h2>
        <p style={{ fontSize: '18px', color: '#444', marginBottom: '40px' }}>
          Номер заявки: <strong>#{orderId}</strong><br />
          Менеджер свяжется с вами в ближайшее время.
        </p>
        
        <button
          onClick={() => {
            setCurrentScreen('form');
            setActiveTab('new');
          }}
          style={{
            display: 'inline-block',
            minWidth: '260px',
            padding: '16px 32px',
            backgroundColor: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            fontSize: '17px',
            fontWeight: '600',
            boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)'
          }}
        >
          Создать новую заявку
        </button>
      </div>
    );
  }

  // Основной интерфейс приложения
  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f8fafc',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      paddingTop: '16px',
      paddingRight: '12px',
      paddingBottom: '20px',
      paddingLeft: '12px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: '560px',
        backgroundColor: 'white',
        borderRadius: '24px',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.1)',
        overflow: 'hidden'
      }}>

       {/* ОСНОВНОЕ СОДЕРЖИМОЕ */}
        <div style={{ padding: '1px' }}>
        {activeTab === 'new' && (
  <div style={{ 
    width: '100%', 
    maxWidth: '100%', 
    margin: '0 auto', 
    background: 'white', 
    borderRadius: '24px', 
    overflow: 'hidden',
    boxShadow: '0 4px 20px rgba(0,0,0,0.06)' 
  }}>

    {/* ====================== ХЕДЕР С ЗАГОЛОВКОМ И МЕНЮ ====================== */}
    <div style={{ 
      display: 'flex', 
      justifyContent: 'space-between', 
      alignItems: 'center', 
      padding: '20px 24px',
      borderBottom: '1px solid #f1f5f9'
    }}>
      
      <h1 style={{ 
        fontSize: '26px', 
        fontWeight: '700', 
        margin: 0, 
        color: '#1f2937' 
      }}>
        Заказать бетон
      </h1>

      <div style={{ position: 'relative' }}>
        <div 
          onClick={() => setMenuOpen(!menuOpen)} 
          style={{ 
            padding: '10px', 
            cursor: 'pointer' 
          }}
        >
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
        </div>

        {menuOpen && (
          <div style={{
            position: 'absolute',
            top: '52px',
            right: '0',
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
            padding: '8px 0',
            zIndex: 100,
            width: '220px'
          }}>
            <div onClick={() => { setActiveTab('new'); setMenuOpen(false); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Новая заявка</div>
            <div onClick={() => { setActiveTab('history'); setMenuOpen(false); loadOrders(); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Мои заявки</div>
            <div onClick={() => { setActiveTab('referral'); setMenuOpen(false); loadReferrals(); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Мои баллы</div>
            <div onClick={() => { setActiveTab('balance'); setMenuOpen(false); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Баланс и вывод</div>
          </div>
        )}
      </div>
    </div>

    {/* ====================== САМА ФОРМА ====================== */}
 <div style={{ 
      paddingTop: '28px', 
      paddingBottom: '28px', 
      paddingLeft: '10px', 
      paddingRight: '10px' 
    }}>
      <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Марка бетона</label>
            <select
              value={form.grade}
              onChange={(e) => setForm({ ...form, grade: e.target.value })}
              style={{ 
                width: '100%', 
                padding: '14px', 
                border: '1px solid #d1d5db', 
                borderRadius: '12px', 
                fontSize: '16px' 
              }}
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
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Объём (м³)</label>
            <input
              type="number"
              value={form.volume}
              onChange={(e) => setForm({ ...form, volume: e.target.value })}
              style={{ 
                width: '80%', 
                padding: '14px', 
                border: '1px solid #d1d5db', 
                borderRadius: '12px', 
                fontSize: '16px' 
              }}
              placeholder="20"
              min="1"
              step="0.5"
            />
          </div>
        </div>

{volume > 0 && (
  <div style={{ 
    width: '90%',
    backgroundColor: '#f8fafc', 
    padding: '16px', 
    borderRadius: '16px', 
    border: '1px solid #e2e8f0',
    marginTop: '8px'
  }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
      <span style={{ color: '#475569' }}>Бетон:</span>
      <span style={{ fontWeight: '600' }}>{concreteCost.toLocaleString('ru-RU')} ₽</span>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
      <span style={{ color: '#475569' }}>Доставка:</span>
      <span style={{ fontWeight: '600' }}>{deliveryCost.toLocaleString('ru-RU')} ₽</span>
    </div>

    {deliveryNote && (
      <div style={{ marginTop: '10px', padding: '10px', backgroundColor: '#e0f2fe', borderRadius: '10px', fontSize: '14.5px', color: '#0369a1', textAlign: 'center' }}>
        🚚 {deliveryNote}
      </div>
    )}

    {/* === НОВЫЙ БЛОК ПОГАШЕНИЯ БАЛЛОВ === */}
    {balance > 0 && (
      <div style={{ 
        marginTop: '16px', 
        padding: '14px', 
        backgroundColor: '#f0fdf4', 
        borderRadius: '12px', 
        border: '1px solid #86efac' 
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span style={{ fontWeight: '600', color: '#166534' }}>Погасить баллами</span>
          <span style={{ color: '#166534' }}>Доступно: <strong>{balance} ₽</strong></span>
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
            width: '90%', 
            padding: '12px', 
            borderRadius: '10px', 
            border: '1px solid #86efac', 
            fontSize: '16px',
            textAlign: 'center'
          }}
          placeholder="0"
        />
        
        <div style={{ 
          marginTop: '10px', 
          display: 'flex', 
          justifyContent: 'space-between', 
          fontSize: '18px', 
          fontWeight: '700', 
          color: '#166534' 
        }}>
          <span>Итого к оплате:</span>
          <span>{finalPrice.toLocaleString('ru-RU')} ₽</span>
        </div>
      </div>
    )}

    {/* Старый итого (оставляем для совместимости) */}
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '18px', fontWeight: '700', color: '#1e40af', borderTop: '1px solid #cbd5e1', paddingTop: '10px', marginTop: '12px' }}>
      <span>Итого без скидки:</span>
      <span>{totalPrice.toLocaleString('ru-RU')} ₽</span>
    </div>
  </div>
)}

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Дата и время доставки</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <input
              type="date"
              value={form.deliveryDate}
              onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })}
              style={{ 
                padding: '14px', 
                border: '1px solid #d1d5db', 
                borderRadius: '12px', 
                fontSize: '16px',
                width: '80%'
              }}
            />
            <input
              type="time"
              value={form.deliveryTime}
              onChange={(e) => setForm({ ...form, deliveryTime: e.target.value })}
              style={{ 
                padding: '14px', 
                border: '1px solid #d1d5db', 
                borderRadius: '12px', 
                fontSize: '16px',
                width: '80%'
              }}
            />
          </div>
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Адрес доставки</label>
          <textarea
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            rows={3}
            style={{ 
              width: '90%', 
              padding: '14px', 
              border: '1px solid #d1d5db', 
              borderRadius: '16px', 
              resize: 'vertical', 
              minHeight: '80px',
              fontSize: '16px'
            }}
            placeholder="Укажите полный адрес"
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Тип заказчика</label>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="button"
              onClick={() => setForm({ ...form, customerType: 'physical' })}
              style={{ 
                flex: 1,
                minWidth: '150px',
                maxWidth: '170px',
                padding: '10px', 
                borderRadius: '12px', 
                fontWeight: '600', 
                fontSize: '16px',
                background: form.customerType === 'physical' ? '#2563eb' : '#f3f4f6', 
                color: form.customerType === 'physical' ? 'white' : '#374151',
                border: 'none'
              }}
            >
              Физическое лицо
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, customerType: 'legal' })}
              style={{ 
                flex: 1,
                minWidth: '150px',
                maxWidth: '170px',
                padding: '10px', 
                borderRadius: '12px', 
                fontWeight: '600', 
                fontSize: '16px',
                background: form.customerType === 'legal' ? '#2563eb' : '#f3f4f6', 
                color: form.customerType === 'legal' ? 'white' : '#374151',
                border: 'none'
              }}
            >
              Юридическое лицо
            </button>
          </div>
        </div>

        {form.customerType === 'physical' ? (
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>ФИО</label>
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              style={{ 
                width: '90%', 
                padding: '14px', 
                border: '1px solid #d1d5db', 
                borderRadius: '12px', 
                fontSize: '16px' 
              }}
              placeholder="Иванов Иван Иванович"
            />
          </div>
        ) : (
           <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Название организации</label>
            <input
              type="text"
              value={form.organizationName}
              onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
              style={{ 
                width: '90%', 
                padding: '14px', 
                border: '1px solid #d1d5db', 
                borderRadius: '12px', 
                fontSize: '16px' 
              }}
              placeholder='ООО "Ваша организация"'
            />
          </div>
        )}

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Телефон для связи</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => {
              let digits = e.target.value.replace(/\D/g, '');
              if (digits.length > 0 && !digits.startsWith('7')) {
                digits = '7' + digits;
              }
              if (digits.length > 11) {
                digits = digits.substring(0, 11);
              }
              let formatted = '+7';
              if (digits.length > 1) formatted += ' (' + digits.substring(1, 4);
              if (digits.length > 4) formatted += ') ' + digits.substring(4, 7);
              if (digits.length > 7) formatted += '-' + digits.substring(7, 9);
              if (digits.length > 9) formatted += '-' + digits.substring(9, 11);

              setForm({ ...form, phone: formatted });
            }}
            style={{ 
              width: '90%', 
              padding: '14px', 
              border: '1px solid #d1d5db', 
              borderRadius: '12px', 
              fontSize: '17px' 
            }}
            placeholder="+7 (___) ___-__-__"
            maxLength={18}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Комментарий</label>
          <textarea
            value={form.comment}
            onChange={(e) => setForm({ ...form, comment: e.target.value })}
            rows={3}
            style={{ 
              width: '90%', 
              padding: '14px', 
              border: '1px solid #d1d5db', 
              borderRadius: '16px', 
              resize: 'vertical', 
              minHeight: '90px',
              fontSize: '16px'
            }}
            placeholder="Дополнительная информация. Например труба, насос (необязательно)"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          style={{ 
            width: '97%', 
            background: isSubmitting ? '#9ca3af' : '#2563eb', 
            color: 'white', 
            padding: '16px', 
            border: 'none', 
            borderRadius: '16px', 
            fontSize: '18px', 
            fontWeight: '600',
            marginTop: '12px'
          }}
        >
          {isSubmitting ? 'Отправляем...' : 'Отправить заявку'}
        </button>
      </form>
    </div>

    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px', paddingBottom: '28px', opacity: 0.75 }}>
      <Image 
        src="/logo.jpg" 
        alt="Логотип" 
        width={160} 
        height={65} 
        style={{ objectFit: 'contain' }} 
        loading="eager"
      />
    </div>
  </div>
)}

          {activeTab === 'history' && (
  <div>
    <div style={{ 
      display: 'flex', 
      justifyContent: 'flex-end', 
      padding: '20px 24px',
      borderBottom: '1px solid #f1f5f9',
      backgroundColor: 'white'
    }}>
      <div style={{ position: 'relative' }}>
        <div 
          onClick={() => setMenuOpen(!menuOpen)} 
          style={{ padding: '10px', cursor: 'pointer' }}
        >
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
        </div>

        {menuOpen && (
          <div style={{
            position: 'absolute',
            top: '52px',
            right: '0',
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
            padding: '8px 0',
            zIndex: 100,
            width: '220px'
          }}>
            <div onClick={() => { setActiveTab('new'); setMenuOpen(false); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Новая заявка</div>
            <div onClick={() => { setActiveTab('history'); setMenuOpen(false); loadOrders(); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Мои заявки</div>
            <div onClick={() => { setActiveTab('referral'); setMenuOpen(false); loadReferrals(); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Мои баллы</div>
            <div onClick={() => { setActiveTab('balance'); setMenuOpen(false); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Баланс и вывод</div>
          </div>
        )}
      </div>
    </div>

    <div style={{ padding: '24px' }}>
      <h2 style={{ marginBottom: '20px' }}>Мои заявки</h2>
      {loadingHistory ? (
        <p style={{ textAlign: 'center', padding: '60px 0' }}>Загрузка...</p>
      ) : orders.length === 0 ? (
        <p style={{ textAlign: 'center', padding: '80px 20px', color: '#888' }}>Пока нет заявок</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {orders.map((order) => (
            <div key={order.id} style={{ background: 'white', padding: '20px', borderRadius: '16px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
              <strong>{order.grade} — {order.volume} м³</strong>
              <div style={{ color: '#555', margin: '8px 0' }}>{order.delivery_date} в {order.delivery_time}</div>
              <div style={{ color: '#666' }}>{order.address}</div>
              <div style={{ marginTop: '12px', fontSize: '19px', fontWeight: '700', color: '#2563eb' }}>
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
    {/* Хедер */}
    <div style={{ 
      display: 'flex', 
      justifyContent: 'flex-end', 
      padding: '20px 24px',
      borderBottom: '1px solid #f1f5f9',
      backgroundColor: 'white'
    }}>
      <div style={{ position: 'relative' }}>
        <div onClick={() => setMenuOpen(!menuOpen)} style={{ padding: '10px', cursor: 'pointer' }}>
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
        </div>

        {menuOpen && (
          <div style={{
            position: 'absolute', top: '52px', right: '0', background: 'white',
            borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
            padding: '8px 0', zIndex: 100, width: '220px'
          }}>
            <div onClick={() => { setActiveTab('new'); setMenuOpen(false); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Новая заявка</div>
            <div onClick={() => { setActiveTab('history'); setMenuOpen(false); loadOrders(); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Мои заявки</div>
            <div onClick={() => { setActiveTab('referral'); setMenuOpen(false); loadReferrals(); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Мои баллы</div>
            <div onClick={() => { setActiveTab('balance'); setMenuOpen(false); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Баланс и вывод</div>
          </div>
        )}
      </div>
    </div>

    <div style={{ padding: '24px' }}>
      <h2 style={{ marginBottom: '8px' }}>Мои баллы</h2>
      <div style={{ fontSize: '64px', fontWeight: '700', color: '#2563eb', marginBottom: '8px' }}>
        {balance} ₽
      </div>
      <p style={{ color: '#666', marginBottom: '30px' }}>Баллы можно использовать как скидку</p>

      {/* Реферальный код */}
      <div style={{ marginBottom: '40px' }}>
        <h3 style={{ marginBottom: '12px', textAlign: 'center' }}>Твой реферальный код</h3>
        <div style={{ 
          backgroundColor: '#f1f5f9', padding: '20px', borderRadius: '12px', 
          fontSize: '26px', fontWeight: '700', letterSpacing: '3px', 
          marginBottom: '16px', textAlign: 'center'
        }}>
          {referralCode}
        </div>
        <button 
          onClick={() => {
            const link = `https://beton-order-app-nlnv.vercel.app/?ref=${referralCode}`;
            navigator.clipboard.writeText(link);
            alert('Реферальная ссылка скопирована!');
          }} 
          style={{ 
            display: 'block', width: '80%', maxWidth: '420px', margin: '0 auto',
            padding: '16px 24px', backgroundColor: '#2563eb', color: 'white',
            border: 'none', borderRadius: '12px', fontSize: '16px', fontWeight: '600'
          }}
        >
          Скопировать реферальную ссылку
        </button>
      </div>

      <h3 style={{ marginBottom: '16px' }}>История начислений</h3>

      {loadingReferrals ? (
        <p style={{ textAlign: 'center', padding: '60px 0', color: '#888' }}>Загрузка...</p>
      ) : referralHistory.length === 0 ? (
        <p style={{ textAlign: 'center', padding: '80px 20px', color: '#888' }}>Пока нет начислений</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {referralHistory.map((item: any, index: number) => {
            const isExpanded = expandedReferrer === index;

            const earnedBonus = item.orders
              .filter((o: any) => o.status === 'completed')
              .reduce((sum: number, o: any) => sum + Number(o.bonus_amount || 0), 0);

            const hasPending = item.orders.some((o: any) => o.status !== 'completed' && o.status !== 'cancelled');

            return (
              <div key={index} style={{
                background: 'white',
                borderRadius: '16px',
                overflow: 'hidden',
                boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                border: isExpanded ? '2px solid #2563eb' : '1px solid #e2e8f0'
              }}>
                {/* Закрытая карточка */}
                <div 
                  onClick={() => setExpandedReferrer(isExpanded ? null : index)}
                  style={{
                    padding: '18px 20px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    cursor: 'pointer'
                  }}
                >
                  <div>
                    <div style={{ fontSize: '15px', color: '#64748b' }}>
                      {new Date(item.lastDate).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })}
                    </div>
                    <div style={{ fontWeight: '600', marginTop: '4px' }}>
                      От: {item.referrerName}
                    </div>
                    <div style={{ fontSize: '14px', color: '#64748b' }}>
                      {item.referrerPhone}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ 
                      fontSize: '18px', 
                      fontWeight: '700', 
                      color: earnedBonus > 0 ? '#166534' : '#94a3b8' 
                    }}>
                      {earnedBonus > 0 ? `+${earnedBonus.toLocaleString('ru-RU')} ₽` : 'В процессе начисления'}
                    </div>
                    {hasPending && earnedBonus > 0 && (
                      <div style={{ fontSize: '13px', color: '#94a3b8' }}>(есть в процессе)</div>
                    )}
                    <div style={{ fontSize: '14px', color: '#64748b' }}>
                      {item.totalVolume} м³ • {item.count} заказ{item.count > 1 ? 'а' : ''}
                    </div>
                  </div>
                </div>

                {/* Раскрытый список */}
                {isExpanded && item.orders.length > 0 && (
                  <div style={{ padding: '0 20px 18px', borderTop: '1px solid #f1f5f9' }}>
                    {item.orders.map((order: any, i: number) => {
                      let statusText = 'В процессе начисления';
                      let statusColor = '#94a3b8';

                      if (order.status === 'completed') {
                        statusText = `+${order.bonus_amount} ₽`;
                        statusColor = '#166534';
                      } else if (order.status === 'cancelled') {
                        statusText = 'Отмена';
                        statusColor = '#ef4444';
                      }

                      return (
                        <div key={i} style={{
                          padding: '12px 0',
                          borderBottom: i < item.orders.length - 1 ? '1px solid #f1f5f9' : 'none',
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: '15px'
                        }}>
                          <div>Заказ №{order.id || '—'} — {order.volume} м³</div>
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
          })}
        </div>
      )}
    </div>
  </div>
)}
{/* ====================== ВКЛАДКА «БАЛАНС» ====================== */}
{activeTab === 'balance' && (
  <div>
    <div style={{ 
      display: 'flex', 
      justifyContent: 'flex-end', 
      padding: '20px 24px',
      borderBottom: '1px solid #f1f5f9',
      backgroundColor: 'white'
    }}>
      <div style={{ position: 'relative' }}>
        <div 
          onClick={() => setMenuOpen(!menuOpen)} 
          style={{ padding: '10px', cursor: 'pointer' }}
        >
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
        </div>

        {menuOpen && (
          <div style={{
            position: 'absolute',
            top: '52px',
            right: '0',
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
            padding: '8px 0',
            zIndex: 100,
            width: '220px'
          }}>
            <div onClick={() => { setActiveTab('new'); setMenuOpen(false); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Новая заявка</div>
            <div onClick={() => { setActiveTab('history'); setMenuOpen(false); loadOrders(); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Мои заявки</div>
            <div onClick={() => { setActiveTab('referral'); setMenuOpen(false); loadReferrals(); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Мои баллы</div>
            <div onClick={() => { setActiveTab('balance'); setMenuOpen(false); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Баланс и вывод</div>
          </div>
        )}
      </div>
    </div>

    <div style={{ padding: '24px', textAlign: 'center' }}>
      <h2 style={{ marginBottom: '20px' }}>Баланс и погашение</h2>
      
      <div style={{ 
        fontSize: '72px', 
        fontWeight: '700', 
        color: '#2563eb', 
        marginBottom: '8px' 
      }}>
        {balance} ₽
      </div>
      <p style={{ color: '#666', marginBottom: '40px' }}>
        Баллы можно использовать как скидку на заказ или вывести наличными
      </p>

      <button 
        onClick={() => setActiveTab('new')}
        style={{
          width: '60%',
          maxWidth: '420px',
          margin: '0 auto 16px',
          padding: '18px',
          backgroundColor: '#2563eb',
          color: 'white',
          border: 'none',
          borderRadius: '14px',
          fontSize: '15px',
          fontWeight: '600'
        }}
      >
        Использовать на следующий заказ
      </button>

      <button 
        onClick={async () => {
          const amountStr = prompt(`Сколько баллов вывести? (максимум ${balance} ₽)`);
          if (!amountStr) return;
          
          const amount = parseInt(amountStr);
          if (isNaN(amount) || amount <= 0 || amount > balance) {
            alert('Неверная сумма!');
            return;
          }

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
                  comment: 'Вывод реферальных баллов' 
                }
              })
            });

            const data = await res.json();
            alert(data.message || 'Заявка на вывод успешно создана. Ожидайте подтверждения администратора.');
            loadBalance();
          } catch (e) {
            alert('Ошибка при создании заявки на вывод');
          }
        }}
        style={{
          width: '60%',
          maxWidth: '420px',
          margin: '0 auto',
          padding: '18px',
          backgroundColor: '#ea580c',
          color: 'white',
          border: 'none',
          borderRadius: '14px',
          fontSize: '15px',
          fontWeight: '600'
        }}
      >
        Вывести наличными / на карту
      </button>
    </div>
  </div>
)}
        </div>
      </div>
    </div>
  );
}