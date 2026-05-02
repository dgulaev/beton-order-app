import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nhudnzdgtidocwwzpqge.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const CHAT_ID = process.env.MANAGER_CHAT_ID;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json();

    // Надёжное извлечение userId
    const userId = payload.userId 
      || payload.user_id 
      || payload.initDataUnsafe?.user?.id 
      || payload.initData?.user?.id 
      || null;

    const referredBy = payload.referred_by || null;

    if (!userId) {
      return NextResponse.json({ success: false, message: 'userId is required' }, { status: 400 });
    }

    // ←←← Важно для RLS
    await supabase.rpc('set_current_user_id', { p_user_id: userId });

    // === 1. Расчёт интервала новой заявки ===
    const deliveryDate = payload.deliveryDate;   // например "2026-05-02"
    const deliveryTime = payload.deliveryTime;   // например "10:00"
    const volume = parseFloat(payload.volume);

    if (!deliveryDate || !deliveryTime || isNaN(volume) || volume <= 0) {
      return NextResponse.json({ success: false, message: 'Некорректные данные даты, времени или объёма' }, { status: 400 });
    }

    // Создаём точное время начала
    const startTime = new Date(`${deliveryDate}T${deliveryTime}:00`);
    const durationMinutes = Math.ceil(volume * 2); // 2 минуты на 1 м³
    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

    console.log(`🔍 Новая заявка: ${deliveryDate} ${deliveryTime} на ${volume} м³`);
    console.log(`   Занимает: ${startTime.toISOString()} — ${endTime.toISOString()}`);

    // === 2. Проверка пересечения с существующими заявками ===
    const { data: existingOrders, error: checkError } = await supabase
      .from('orders')
      .select('id, delivery_date, delivery_time, volume, status')
      .in('status', ['new', 'processing']);

    if (checkError) {
      console.error('Ошибка проверки конфликтов:', checkError);
    }

    let hasConflict = false;
    let conflictingOrderId = null;

    if (existingOrders && existingOrders.length > 0) {
      for (const order of existingOrders) {
        const orderStart = new Date(`${order.delivery_date}T${order.delivery_time}`);
        const orderDuration = Math.ceil(order.volume * 2);
        const orderEnd = new Date(orderStart.getTime() + orderDuration * 60000);

        console.log(`   Проверяем заявку #${order.id}: ${order.delivery_date} ${order.delivery_time} (${order.volume} м³)`);

        // Пересечение интервалов
        if (startTime < orderEnd && endTime > orderStart) {
          hasConflict = true;
          conflictingOrderId = order.id;
          console.log(`   ⚠️ КОНФЛИКТ с заявкой #${order.id}`);
          break;
        }
      }
    }

    if (hasConflict) {
      return NextResponse.json({
        success: false,
        message: `На выбранное время уже запланирована отгрузка (заявка #${conflictingOrderId}). Пожалуйста, выберите другое время.`
      }, { status: 409 });
    }

    console.log('✅ Конфликтов не найдено. Создаём заявку.');

    // === 3. Сохраняем заявку в базу ===
    const { data: order, error: insertError } = await supabase
      .from('orders')
      .insert([{
        user_id: userId,
        grade: payload.grade,
        volume: payload.volume,
        delivery_date: payload.deliveryDate,
        delivery_time: payload.deliveryTime,
        address: payload.address,
        customer_type: payload.customerType,
        full_name: payload.fullName,
        organization_name: payload.organizationName,
        phone: payload.phone,
        comment: payload.comment || null,
        concrete_cost: payload.concreteCost,
        delivery_cost: payload.deliveryCost,
        total_price: payload.totalPrice,
        referred_by: referredBy,
        status: 'new',
      }])
      .select()
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      return NextResponse.json({ success: false, message: 'Ошибка создания заказа в базе' }, { status: 500 });
    }

    // === 4. Начисление баллов рефереру ===
    if (referredBy && payload.volume && payload.volume > 0) {
      const bonusPoints = Math.round(payload.volume * 100);

      const { error: rpcError } = await supabase.rpc('increment_balance', {
        user_id: referredBy,
        points: bonusPoints
      });

      if (rpcError) {
        console.error('Ошибка начисления баллов:', rpcError);
      } else {
        console.log(`✅ Начислено ${bonusPoints} баллов пользователю ${referredBy} (реферер)`);
      }
    }

    // === 5. Уведомление в группу MAX ===
    const messageText = `
✅ *Новая заявка на отгрузку бетона*

📌 Марка: ${payload.grade}
📦 Объём: ${payload.volume} м³
📅 Дата: ${payload.deliveryDate} ${payload.deliveryTime}
📍 Адрес: ${payload.address}

👤 Тип: ${payload.customerType}
${payload.customerType?.includes('Юридическое') ? `🏢 ${payload.organizationName || '—'}` : `🙍 ${payload.fullName || '—'}`}

📞 Телефон: ${payload.phone}
💰 Бетон: ${payload.concreteCost?.toLocaleString('ru-RU')} ₽
🚚 Доставка: ${payload.deliveryCost?.toLocaleString('ru-RU')} ₽
💵 *Итого: ${payload.totalPrice?.toLocaleString('ru-RU')} ₽*

💬 Комментарий: ${payload.comment || '—'}
🕒 ${new Date().toLocaleString('ru-RU')}
👤 MAX ID: ${userId || '—'}
    `.trim();

    if (BOT_TOKEN && CHAT_ID) {
      await fetch(`https://platform-api.max.ru/messages?chat_id=${CHAT_ID}`, {
        method: 'POST',
        headers: {
          'Authorization': BOT_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: messageText }),
      }).catch(err => console.error('MAX notification error:', err));
    }

    return NextResponse.json({ 
      success: true, 
      orderId: order.id,
      message: 'Заявка успешно создана' 
    });

  } catch (error) {
    console.error('API Error in /api/order:', error);
    return NextResponse.json({ success: false, message: 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}