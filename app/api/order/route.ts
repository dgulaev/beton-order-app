// app/api/order/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const CHAT_ID = process.env.MANAGER_CHAT_ID;

// ================================================
// 1. КОНФИГУРАЦИЯ ДЛИТЕЛЬНОСТИ ОТГРУЗКИ
// ================================================
const MINUTES_PER_CUBIC_METER = 0.1;

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('❌ SUPABASE_URL или SUPABASE_SERVICE_ROLE_KEY не настроены');
  }

  return createClient(supabaseUrl, supabaseServiceKey);
}

export async function POST(request: NextRequest) {
  try {
    const payload: any = await request.json();

    console.log('📥 [Order API] Получен payload:', payload);

    let userId = payload.userId || payload.user_id || null;
    let referredBy = payload.referredBy || payload.referred_by || null;

    // ================================================
    // 2. ОПРЕДЕЛЕНИЕ ИСТОЧНИКА ЗАЯВКИ
    // ================================================
    const isFromAdmin = !!(payload.isFromAdmin === true || payload.source === 'admin');
    console.log(`📍 [Order API] Источник заявки: ${isFromAdmin ? 'АДМИНКА ЦИФРА' : 'МИНИ-ПРИЛОЖЕНИЕ МАКС'}`);

// ================================================
// 3. ЛОГИКА СОЗДАНИЯ/ПОИСКА КЛИЕНТА ИЗ АДМИНКИ
// ================================================
let finalUserId = userId;

if (isFromAdmin) {
  console.log('👮 Заявка из админки — ищем/создаём клиента...');

  let phoneRaw = (payload.phone || payload.client_phone || payload.userPhone || '').trim();
  const fullName = (payload.fullName || payload.full_name || payload.client_name || '').trim();
  const organizationName = (payload.organizationName || payload.organization_name || payload.client_organization || '').trim();
  const inn = (payload.inn || '').trim();

  if (!phoneRaw) {
    return NextResponse.json({ success: false, message: 'Телефон обязателен при создании заявки из админки' }, { status: 400 });
  }

  // Нормализация телефона
  const phoneNormalized = phoneRaw.replace(/\D/g, '');
  let phoneWithPlus = '';
  
  if (phoneNormalized.length === 11 && phoneNormalized.startsWith('7')) {
    phoneWithPlus = '+' + phoneNormalized;
  } else if (phoneNormalized.length === 10) {
    phoneWithPlus = '+7' + phoneNormalized;
  } else if (phoneNormalized.length === 11) {
    phoneWithPlus = '+' + phoneNormalized;
  } else {
    phoneWithPlus = phoneRaw;
  }

  const supabase = getSupabaseClient();

  let existingClient = null;

  // 1. Поиск по телефону (самый надёжный)
  const { data: phoneClient } = await supabase
    .from('users')
    .select('user_id, phone, organization_name, full_name, role')
    .or(`phone.eq.${phoneWithPlus},phone.eq.${phoneRaw},phone.ilike.%${phoneNormalized}%`)
    .maybeSingle();

  if (phoneClient && phoneClient.role === 'client') {
    existingClient = phoneClient;
    console.log(`✅ Найден клиент по телефону: ${phoneClient.user_id}`);
  }

  // 2. Поиск по ИНН
  if (!existingClient && inn) {
    const { data: innClient } = await supabase
      .from('users')
      .select('user_id, phone, organization_name, full_name')
      .eq('inn', inn)
      .maybeSingle();

    if (innClient) existingClient = innClient;
  }

  // 3. Поиск по названию организации
  if (!existingClient && organizationName) {
    const { data: orgClient } = await supabase
      .from('users')
      .select('user_id, phone, organization_name, full_name')
      .ilike('organization_name', `%${organizationName}%`)
      .limit(1)
      .maybeSingle();

    if (orgClient) existingClient = orgClient;
  }

  if (existingClient) {
    finalUserId = existingClient.user_id;
    console.log(`👤 Используем существующего клиента: ${finalUserId}`);
  } else {
    // ================================================
    // СОЗДАНИЕ НОВОГО КЛИЕНТА С КУРАТОРОМ
    // ================================================
    const newUserId = Date.now() + Math.floor(Math.random() * 1000000);

    // Получаем данные текущего сотрудника из payload (из фронта)
    const createdByStaff = payload.created_by || 1777619517739; // fallback на тебя
    const curatorName = payload.curator_name || payload.userName || 'Сотрудник';

    const { data: newClient, error: createError } = await supabase
      .from('users')
      .insert({
        user_id: newUserId,
        role: 'client',
        phone: phoneWithPlus,
        full_name: organizationName ? null : fullName,
        organization_name: organizationName || fullName || null,
        inn: inn || null,
        balance: 0,
        referral_code: 'R' + Math.random().toString(36).substring(2, 10).toUpperCase(),
        
        // ==================== НОВЫЕ ПОЛЯ (по твоей просьбе) ====================
        created_by: createdByStaff,      // Кто создал клиента
        curator_id: createdByStaff,      // Назначаем создателя куратором
        curator_name: curatorName,       // Имя куратора

        created_at: new Date().toISOString()
      })
      .select('user_id')
      .single();

    if (createError) {
      console.error('❌ Ошибка создания клиента:', createError);
    } else if (newClient) {
      finalUserId = newClient.user_id;
      console.log(`✅ Создан новый клиент: ${finalUserId} | created_by: ${createdByStaff} | curator: ${curatorName}`);
    }
  }
}

console.log(`🔑 Финальный user_id заказа: ${finalUserId} (изначально было ${userId})`);

// ================================================
// 3.1 АВТОМАТИЧЕСКОЕ ОБНОВЛЕНИЕ КОНТАКТОВ КЛИЕНТА (УЛУЧШЕННЫЙ)
// ================================================
const supabase = getSupabaseClient();
const now = new Date().toISOString();

console.log(`🔄 [3.1] Обновление контактов для userId: ${finalUserId}`);

// Обновляем last_contact
await supabase
  .from('users')
  .update({ last_contact: now })
  .eq('user_id', finalUserId);

// ==================== УЛУЧШЕННЫЙ РАСЧЁТ next_contact ====================
const { data: orders } = await supabase
  .from('orders')
  .select('delivery_date, created_at')
  .eq('user_id', finalUserId)
  .order('delivery_date', { ascending: true });

let nextContact = null;

if (orders && orders.length >= 2) {
  const dates = orders
    .map((o: any) => new Date(o.delivery_date || o.created_at))
    .filter(d => d && !isNaN(d.getTime()))
    .sort((a: Date, b: Date) => a.getTime() - b.getTime());

  if (dates.length >= 2) {
    let totalDays = 0;
    for (let i = 1; i < dates.length; i++) {
      totalDays += (dates[i].getTime() - dates[i-1].getTime()) / (1000 * 3600 * 24);
    }
    const avgInterval = totalDays / (dates.length - 1);
    
    // Улучшенная логика:
    // Минимум 14 дней, максимум 60 дней, +20% буфер
    let daysToAdd = Math.ceil(avgInterval * 1.2);
    daysToAdd = Math.max(14, Math.min(60, daysToAdd));

    const lastOrder = dates[dates.length - 1];
    const nextDate = new Date(lastOrder.getTime() + daysToAdd * 86400000);
    
    nextContact = nextDate.toISOString();
    
    console.log(`📅 Рассчитан next_contact: ${nextDate.toLocaleDateString('ru-RU')} (+${daysToAdd} дней)`);
  }
}

// Fallback — минимум через 25 дней
if (!nextContact) {
  const defaultNext = new Date();
  defaultNext.setDate(defaultNext.getDate() + 25);
  nextContact = defaultNext.toISOString();
  console.log(`📅 Fallback next_contact (+25 дней)`);
}

await supabase
  .from('users')
  .update({ next_contact: nextContact })
  .eq('user_id', finalUserId);

console.log(`✅ next_contact сохранён: ${nextContact}`);

    // ================================================
    // 4. НОРМАЛИЗАЦИЯ ПОЛЕЙ
    // ================================================
    const {
      grade, volume, delivery_date, delivery_time, deliveryDate, deliveryTime,
      address, phone, customerType, organization_name, organizationName,
      full_name, fullName, inn, comment, concreteCost, deliveryCost, totalPrice
    } = payload;

    const finalDeliveryDate = delivery_date || deliveryDate;
    const finalDeliveryTime = delivery_time || deliveryTime;
    const finalOrganizationName = organization_name || organizationName;
    const finalFullName = full_name || fullName;

    // ================================================
    // 5. ВАЛИДАЦИЯ
    // ================================================
    if (!grade || !volume || !finalDeliveryDate || !finalDeliveryTime || !address || !phone) {
      return NextResponse.json({ success: false, message: 'Не все обязательные поля заполнены' }, { status: 400 });
    }

    // ================================================
    // 6. ПРОВЕРКА КОНФЛИКТОВ ПО ВРЕМЕНИ
    // ================================================
    let hasConflict = false;
    let conflictingOrderId = null;
    let suggestions: any[] = [];

    if (!isFromAdmin) {
      const requestedStart = new Date(`${finalDeliveryDate}T${finalDeliveryTime}:00`);
      const newDurationMin = Math.ceil(parseFloat(volume) * MINUTES_PER_CUBIC_METER);
      const requestedEnd = new Date(requestedStart.getTime() + newDurationMin * 60000);

      const { data: activeOrders } = await supabase
        .from('orders')
        .select('id, delivery_date, delivery_time, volume, status')
        .eq('delivery_date', finalDeliveryDate)
        .in('status', ['new', 'processing', 'in_progress']);

      if (activeOrders && activeOrders.length > 0) {
        for (const ord of activeOrders) {
          const ordStart = new Date(`${ord.delivery_date}T${ord.delivery_time}`);
          const ordDuration = Math.ceil(ord.volume * MINUTES_PER_CUBIC_METER);
          const ordEnd = new Date(ordStart.getTime() + ordDuration * 60000);

          if (requestedStart < ordEnd && requestedEnd > ordStart) {
            hasConflict = true;
            conflictingOrderId = ord.id;
            break;
          }
        }
      }

      if (hasConflict) {
        suggestions = await getFreeTimeSuggestions(supabase, finalDeliveryDate, requestedStart, newDurationMin);
        return NextResponse.json({
          success: false,
          message: `Время ${finalDeliveryTime} занято (заявка #${conflictingOrderId}).`,
          suggestions,
          conflict: true
        }, { status: 409 });
      }
    }

    // ================================================
    // 7. СОЗДАНИЕ ЗАКАЗА
    // ================================================
    const createdByStaff = payload.created_by || null;
    const curatorName = payload.curator_name || payload.userName || null;

    const { data: orderData, error: insertError } = await supabase
      .from('orders')
      .insert([{
        user_id: finalUserId,
        grade,
        volume: parseFloat(volume),
        delivery_date: finalDeliveryDate,
        delivery_time: finalDeliveryTime,
        address,
        customer_type: customerType,
        full_name: finalFullName || null,
        organization_name: finalOrganizationName || null,
        inn: inn || null,
        phone,
        comment: comment || null,
        concrete_cost: concreteCost || 0,
        delivery_cost: deliveryCost || 0,
        total_price: totalPrice || 0,
        status: 'new',
        referred_by: referredBy,

        // ==================== НОВЫЕ ПОЛЯ ====================
        created_by: createdByStaff,
        curator_name: curatorName,
      }])
      .select()
      .single();

    if (insertError) {
      console.error('Insert order error:', insertError);
      return NextResponse.json({ success: false, message: 'Ошибка создания заказа в базе' }, { status: 500 });
    }

    const orderId = orderData.id;
    console.log(`✅ Заказ #${orderId} успешно создан | created_by: ${createdByStaff} | curator: ${curatorName}`);

    // ================================================
    // 8. ЗАПИСЬ В ИСТОРИЮ СОЗДАНИЯ ЗАЯВКИ
    // ================================================
    if (orderId) {
      const creatorName = payload.userName && payload.userName !== 'Сотрудник' 
        ? payload.userName 
        : (curatorName || (isFromAdmin ? 'Администратор' : 'Клиент'));

      const creatorRole = payload.userRole || (isFromAdmin ? 'admin' : 'client');

      const historyEntry = {
        order_id: orderId,
        action: 'Создал заявку',
        user_name: creatorName,
        user_role: creatorRole,
        field_name: null,
        old_value: null,
        new_value: null,
        created_at: new Date().toISOString()
      };

      try {
        await supabase
          .from('order_history')
          .insert([historyEntry]);

        console.log(`📜 ИСТОРИЯ: "${creatorName}" создал заявку #${orderId}`);
      } catch (err: any) {
        console.error('Ошибка записи истории:', err);
      }
    }

    // ================================================
    // 9. РЕФЕРАЛЬНЫЕ БАЛЛЫ
    // ================================================
    if (referredBy && parseFloat(volume) > 0) {
      const bonusPoints = Math.round(parseFloat(volume) * 100);

      const { error: refError } = await supabase
        .from('referral_transactions')
        .insert({
          referrer_id: referredBy,
          referred_user_id: finalUserId,
          order_id: orderId,
          volume: parseFloat(volume),
          potential_bonus: bonusPoints,
          status: 'pending'
        });

      if (refError) console.error('❌ Ошибка referral_transaction:', refError);
    }

    // ================================================
    // 9. ОТПРАВКА УВЕДОМЛЕНИЯ В MAX
    // ================================================
    if (BOT_TOKEN && CHAT_ID && !isFromAdmin) {
      const messageText = `
✅ *Новая заявка на отгрузку бетона*

📌 Марка: ${grade}
📦 Объём: ${volume} м³
📅 Дата: ${finalDeliveryDate} ${finalDeliveryTime}
📍 Адрес: ${address}

👤 Тип: ${customerType}
${customerType?.includes('Юридическое') 
  ? `🏢 ${finalOrganizationName || '—'}`
  : `🙍 ${finalFullName || '—'}`}

📞 Телефон: ${phone}
💰 Бетон: ${concreteCost?.toLocaleString('ru-RU')} ₽
🚚 Доставка: ${deliveryCost?.toLocaleString('ru-RU')} ₽
💵 *Итого: ${totalPrice?.toLocaleString('ru-RU')} ₽*

💬 Комментарий: ${comment || '—'}
🕒 ${new Date().toLocaleString('ru-RU')}
👤 Источник: Мини-приложение Макс
      `.trim();

      try {
        await fetch(`https://platform-api.max.ru/messages?chat_id=${CHAT_ID}`, {
          method: 'POST',
          headers: { 
            'Authorization': BOT_TOKEN, 
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify({ text: messageText }),
        });
        console.log(`✅ Уведомление отправлено в Max`);
      } catch (err) {
        console.error('❌ Не удалось отправить уведомление:', err);
      }
    } else if (isFromAdmin) {
      console.log(`👮 Заявка из админки — уведомление отключено`);
    }

    return NextResponse.json({ 
      success: true, 
      orderId: orderId,
      userId: finalUserId,
      message: 'Заявка успешно создана' 
    });

  } catch (error: any) {
    console.error('API Error in /api/order:', error);
    return NextResponse.json({ 
      success: false, 
      message: error.message || 'Внутренняя ошибка сервера' 
    }, { status: 500 });
  }
}

// ================================================
// 10. ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ================================================
async function getFreeTimeSuggestions(supabase: any, date: string, requestedTime: Date, newDurationMin: number) {
  const suggestions: Array<{ time: string; reason: string }> = [];
  const baseHour = requestedTime.getHours();

  for (let h = Math.max(6, baseHour - 3); h <= Math.min(22, baseHour + 3); h++) {
    for (let m = 0; m < 60; m += 15) {
      const testTimeStr = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      const testStart = new Date(`${date}T${testTimeStr}:00`);
      const testEnd = new Date(testStart.getTime() + newDurationMin * 60000);

      const isFree = await isTimeSlotFree(supabase, date, testTimeStr, testStart, testEnd);

      if (isFree) {
        suggestions.push({
          time: testTimeStr,
          reason: testStart < requestedTime ? 'Раньше' : 'После'
        });
      }
    }
  }

  suggestions.sort((a, b) => {
    const ta = parseInt(a.time.replace(':', ''));
    const tb = parseInt(b.time.replace(':', ''));
    const req = parseInt(`${requestedTime.getHours()}${requestedTime.getMinutes().toString().padStart(2, '0')}`);
    return Math.abs(ta - req) - Math.abs(tb - req);
  });

  return suggestions.slice(0, 6);
}

async function isTimeSlotFree(supabase: any, date: string, time: string, testStart: Date, testEnd: Date) {
  const { data } = await supabase
    .from('orders')
    .select('id, delivery_date, delivery_time, volume')
    .eq('delivery_date', date)
    .in('status', ['new', 'processing', 'in_progress']);

  if (!data) return true;

  for (const ord of data) {
    const ordStart = new Date(`${ord.delivery_date}T${ord.delivery_time}`);
    const ordDuration = Math.ceil(ord.volume * MINUTES_PER_CUBIC_METER);
    const ordEnd = new Date(ordStart.getTime() + ordDuration * 60000);

    if (testStart < ordEnd && testEnd > ordStart) {
      return false;
    }
  }
  return true;
}