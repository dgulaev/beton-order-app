// app/api/order/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const CHAT_ID = process.env.MANAGER_CHAT_ID;

// ================================================
// КОНФИГУРАЦИЯ ДЛИТЕЛЬНОСТИ ОТГРУЗКИ (легко менять)
// ================================================
const MINUTES_PER_CUBIC_METER = 2;        // ←←← ИЗМЕНИТЬ ЗДЕСЬ при необходимости

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
    const payload = await request.json();

    const userId = payload.userId || payload.user_id || null;
    let referredBy = payload.referredBy || payload.referred_by || null;

    console.log('📥 [Order API] Получен referredBy:', referredBy);

    if (!userId) {
      return NextResponse.json({ success: false, message: 'userId is required' }, { status: 400 });
    }

    // === ПРЕОБРАЗОВАНИЕ РЕФЕРАЛЬНОГО КОДА В user_id ===
    if (referredBy && typeof referredBy === 'string' && referredBy.startsWith('R')) {
      const supabase = getSupabaseClient();
      const { data: referrer } = await supabase
        .from('users')
        .select('user_id')
        .eq('referral_code', referredBy)
        .maybeSingle();

      if (referrer) {
        referredBy = referrer.user_id;
        console.log(`🔍 Реферальный код ${payload.referredBy} преобразован в user_id ${referredBy}`);
      } else {
        console.log(`⚠️ Реферер с кодом ${referredBy} не найден`);
        referredBy = null;
      }
    }

    const {
      grade, volume, deliveryDate, deliveryTime, address,
      customerType, organizationName, fullName, phone, comment,
      concreteCost, deliveryCost, totalPrice
    } = payload;

    if (!grade || !volume || !deliveryDate || !deliveryTime || !address || !phone) {
      return NextResponse.json({ success: false, message: 'Не все обязательные поля заполнены' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // ================================================
    // === УМНАЯ ПРОВЕРКА КОНФЛИКТОВ ПО ВРЕМЕНИ ===
    // ================================================
    const requestedStart = new Date(`${deliveryDate}T${deliveryTime}:00`);
    const newDurationMin = Math.ceil(parseFloat(volume) * MINUTES_PER_CUBIC_METER);
    const requestedEnd = new Date(requestedStart.getTime() + newDurationMin * 60000);

    const { data: activeOrders } = await supabase
      .from('orders')
      .select('id, delivery_date, delivery_time, volume, status')
      .eq('delivery_date', deliveryDate)
      .in('status', ['new', 'processing', 'in_progress']);

    let hasConflict = false;
    let conflictingOrderId = null;

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
      const suggestions = await getFreeTimeSuggestions(supabase, deliveryDate, requestedStart, newDurationMin);

      return NextResponse.json({
        success: false,
        message: `Время ${deliveryTime} занято (заявка #${conflictingOrderId}).`,
        suggestions: suggestions,
        conflict: true
      }, { status: 409 });
    }

    console.log(`✅ Проверка времени прошла успешно. Нет конфликтов.`);

    // Создание заявки
    const { data: orderData, error: insertError } = await supabase
      .from('orders')
      .insert([{
        user_id: userId,
        grade,
        volume: parseFloat(volume),
        delivery_date: deliveryDate,
        delivery_time: deliveryTime,
        address,
        customer_type: customerType,
        full_name: fullName || null,
        organization_name: organizationName || null,
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
    console.log(`✅ Заказ #${orderId} успешно создан. referred_by = ${referredBy || 'null'}`);

    // === ПОГАШЕНИЕ БАЛЛОВ (СКИДКА) ===
    const redeemAmount = Number(payload.redeemAmount) || 0;

    if (redeemAmount > 0) {
      const { error: redeemError } = await supabase
        .from('balance_redemptions')
        .insert({
          user_id: userId,
          order_id: orderId,
          amount: redeemAmount,
          type: 'discount',
          status: 'completed',
          processed_at: new Date().toISOString()
        });

      if (redeemError) {
        console.error('Ошибка записи погашения баллов:', redeemError);
      } else {
        console.log(`✅ Погашено ${redeemAmount} баллов при создании заказа #${orderId}`);
      }
    }

    // === ЗАМОРОЗКА РЕФЕРАЛЬНЫХ БАЛЛОВ ===
    if (referredBy && parseFloat(volume) > 0) {
      const bonusPoints = Math.round(parseFloat(volume) * 100);

      const { error: refError } = await supabase
        .from('referral_transactions')
        .insert({
          referrer_id: referredBy,
          referred_user_id: userId,
          order_id: orderId,
          volume: parseFloat(volume),
          potential_bonus: bonusPoints,
          status: 'pending'
        });

      if (refError) {
        console.error('❌ Ошибка создания referral_transaction:', refError);
      } else {
        console.log(`✅ УСПЕШНО ЗАМОРОЖЕНО ${bonusPoints} баллов для реферера ${referredBy} (заказ #${orderId})`);
      }
    }
    // Уведомление в Max (оставлено без изменений)
    const messageText = `
✅ *Новая заявка на отгрузку бетона*

📌 Марка: ${grade}
📦 Объём: ${volume} м³
📅 Дата: ${deliveryDate} ${deliveryTime}
📍 Адрес: ${address}

👤 Тип: ${customerType}
${customerType?.includes('Юридическое') ? `🏢 ${organizationName || '—'}` : `🙍 ${fullName || '—'}`}

📞 Телефон: ${phone}
💰 Бетон: ${concreteCost?.toLocaleString('ru-RU')} ₽
🚚 Доставка: ${deliveryCost?.toLocaleString('ru-RU')} ₽
💵 *Итого: ${totalPrice?.toLocaleString('ru-RU')} ₽*

💬 Комментарий: ${comment || '—'}
🕒 ${new Date().toLocaleString('ru-RU')}
👤 MAX ID: ${userId}
    `.trim();

    if (BOT_TOKEN && CHAT_ID) {
      await fetch(`https://platform-api.max.ru/messages?chat_id=${CHAT_ID}`, {
        method: 'POST',
        headers: { 'Authorization': BOT_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: messageText }),
      }).catch(() => {});
    }

    return NextResponse.json({ 
      success: true, 
      orderId: orderId,
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
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ДЛЯ ПРЕДЛОЖЕНИЯ ВРЕМЕНИ
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

  // Сортировка по близости
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