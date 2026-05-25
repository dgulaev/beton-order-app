// app/api/order/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const CHAT_ID = process.env.MANAGER_CHAT_ID;

// ================================================
// 1. КОНФИГУРАЦИЯ ДЛИТЕЛЬНОСТИ ОТГРУЗКИ
// ================================================
const MINUTES_PER_CUBIC_METER = 0.1;        // ←←← ИЗМЕНИТЬ ЗДЕСЬ при необходимости

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
      const phoneRaw = payload.phone?.trim();
      const phone = phoneRaw ? phoneRaw.replace(/\D/g, '') : null;
      const fullName = payload.fullName?.trim() || payload.full_name?.trim() || null;
      const organizationName = payload.organizationName?.trim() || payload.organization_name?.trim() || null;
      const inn = payload.inn?.trim() || null;
      const isLegal = !!organizationName || payload.customerType?.includes('Юридическое');

      if (!phone) {
        return NextResponse.json({ 
          success: false, 
          message: 'Телефон обязателен при создании заявки из админки' 
        }, { status: 400 });
      }

      const supabase = getSupabaseClient();

      // Ищем клиента по телефону
      const { data: existingClient } = await supabase
        .from('users')
        .select('user_id')
        .eq('phone', '+' + phone)
        .maybeSingle();

      if (existingClient) {
        finalUserId = existingClient.user_id;
        console.log(`👤 Найден существующий клиент #${finalUserId}`);
      } else {
        // Создаём нового клиента
        const newUserId = Date.now() + Math.floor(Math.random() * 10000);

        const { data: newClient, error: createError } = await supabase
          .from('users')
          .insert({
            user_id: newUserId,
            role: 'client',
            phone: '+' + phone,
            full_name: isLegal ? null : fullName,
            organization_name: isLegal ? organizationName : fullName,
            inn: inn,
            balance: 0,
            referral_code: 'R' + Math.random().toString(36).substring(2, 8).toUpperCase(),
            created_at: new Date().toISOString()
          })
          .select('user_id')
          .single();

        if (createError) {
          console.error('❌ Ошибка создания клиента:', createError);
        } else if (newClient) {
          finalUserId = newClient.user_id;
          console.log(`✅ Создан новый клиент #${finalUserId} → ${isLegal ? organizationName : fullName}`);
        }
      }
    } else {
      // Из мини-приложения используем переданный userId
      finalUserId = userId;
    }

    if (!finalUserId) {
      return NextResponse.json({ 
        success: false, 
        message: 'Не удалось определить userId клиента' 
      }, { status: 400 });
    }

    // ================================================
    // 4. НОРМАЛИЗАЦИЯ ПОЛЕЙ
    // ================================================
    const {
      grade,
      volume,
      delivery_date,
      delivery_time,
      deliveryDate,
      deliveryTime,
      address,
      phone,
      customerType,
      organization_name,
      organizationName,
      full_name,
      fullName,
      inn,
      comment,
      concreteCost,
      deliveryCost,
      totalPrice
    } = payload;

    const finalDeliveryDate = delivery_date || deliveryDate;
    const finalDeliveryTime = delivery_time || deliveryTime;
    const finalOrganizationName = organization_name || organizationName;
    const finalFullName = full_name || fullName;

    // ================================================
    // 5. ВАЛИДАЦИЯ
    // ================================================
    if (!grade || !volume || !finalDeliveryDate || !finalDeliveryTime || !address || !phone) {
      return NextResponse.json({ 
        success: false, 
        message: 'Не все обязательные поля заполнены' 
      }, { status: 400 });
    }

    const supabase = getSupabaseClient();

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

      console.log(`✅ Проверка времени прошла успешно (клиент)`);
    } else {
      console.log(`👮 Админ создаёт заявку — проверка времени ОТКЛЮЧЕНА`);
    }

    // ================================================
    // 7. СОЗДАНИЕ ЗАКАЗА (ВАЖНО: finalUserId!)
    // ================================================
    const { data: orderData, error: insertError } = await supabase
      .from('orders')
      .insert([{
        user_id: finalUserId,                    // ← КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ
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
      }])
      .select()
      .single();

    if (insertError) {
      console.error('Insert order error:', insertError);
      return NextResponse.json({ success: false, message: 'Ошибка создания заказа в базе' }, { status: 500 });
    }

    const orderId = orderData.id;
    console.log(`✅ Заказ #${orderId} успешно создан для клиента ${finalUserId}`);

    // ================================================
    // 8. РЕФЕРАЛЬНЫЕ БАЛЛЫ
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

      if (refError) {
        console.error('❌ Ошибка создания referral_transaction:', refError);
      } else {
        console.log(`✅ УСПЕШНО ЗАМОРОЖЕНО ${bonusPoints} баллов`);
      }
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