// app/api/order/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const CHAT_ID = process.env.MANAGER_CHAT_ID;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
      return NextResponse.json({ 
        success: false, 
        message: 'userId is required' 
      }, { status: 400 });
    }

    const {
      grade,
      volume,
      deliveryDate,
      deliveryTime,
      address,
      customerType,
      organizationName,
      fullName,
      phone,
      comment,
      concreteCost,
      deliveryCost,
      totalPrice
    } = payload;

    // Валидация
    if (!grade || !volume || !deliveryDate || !deliveryTime || !address || !phone) {
      return NextResponse.json({ 
        success: false, 
        message: 'Не все обязательные поля заполнены' 
      }, { status: 400 });
    }

    // === 1. Проверка конфликта по времени ===
    const startTime = new Date(`${deliveryDate}T${deliveryTime}:00`);
    const durationMinutes = Math.ceil(parseFloat(volume) * 2); // ~2 минуты на 1 м³
    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

    const { data: existingOrders } = await supabase
      .from('orders')
      .select('id, delivery_date, delivery_time, volume, status')
      .in('status', ['new', 'in_progress', 'processing']);

    let hasConflict = false;
    let conflictingOrderId = null;

    if (existingOrders && existingOrders.length > 0) {
      for (const order of existingOrders) {
        const orderStart = new Date(`${order.delivery_date}T${order.delivery_time}`);
        const orderDuration = Math.ceil(order.volume * 2);
        const orderEnd = new Date(orderStart.getTime() + orderDuration * 60000);

        if (startTime < orderEnd && endTime > orderStart) {
          hasConflict = true;
          conflictingOrderId = order.id;
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

    // === 2. Создание заявки ===
    const { data: order, error: insertError } = await supabase
      .from('orders')
      .insert([{
        user_id: userId,
        grade: grade,
        volume: parseFloat(volume),
        delivery_date: deliveryDate,
        delivery_time: deliveryTime,
        address: address,
        customer_type: customerType,
        full_name: fullName || null,
        organization_name: organizationName || null,
        phone: phone,
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
      console.error('Insert error:', insertError);
      return NextResponse.json({ 
        success: false, 
        message: 'Ошибка создания заказа в базе' 
      }, { status: 500 });
    }

    // === 3. Начисление реферальных баллов ===
    if (referredBy && parseFloat(volume) > 0) {
      const bonusPoints = Math.round(parseFloat(volume) * 100);
      const { error: rpcError } = await supabase.rpc('increment_balance', {
        user_id: referredBy,
        points: bonusPoints
      });

      if (rpcError) {
        console.error('Ошибка начисления баллов:', rpcError);
      } else {
        console.log(`✅ Начислено ${bonusPoints} баллов рефереру ${referredBy}`);
      }
    }

    // === 4. Уведомление в Max Bot ===
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

  } catch (error: any) {
    console.error('API Error in /api/order:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Внутренняя ошибка сервера' 
    }, { status: 500 });
  }
}