import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nhudnzdgtidocwwzpqge.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const CHAT_ID = process.env.MANAGER_CHAT_ID;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function POST(request: NextRequest) {
  try {
    const rawOrder = await request.json();

    // Более надёжное извлечение user_id из MAX
    const userId = rawOrder.userId 
      || rawOrder.user_id 
      || rawOrder.initDataUnsafe?.user?.id 
      || null;

    console.log('Received userId:', userId);
    console.log('Full payload:', rawOrder);

    if (!userId) {
      console.warn('Warning: userId is null. Saving without user_id.');
    }

    const { error } = await supabase
      .from('orders')
      .insert([{
        user_id: userId,                    // может быть null
        grade: rawOrder.grade,
        volume: rawOrder.volume,
        delivery_date: rawOrder.deliveryDate,
        delivery_time: rawOrder.deliveryTime,
        address: rawOrder.address,
        customer_type: rawOrder.customerType,
        full_name: rawOrder.fullName,
        organization_name: rawOrder.organizationName,
        phone: rawOrder.phone,
        comment: rawOrder.comment || null,
        concrete_cost: rawOrder.concreteCost,
        delivery_cost: rawOrder.deliveryCost,
        total_price: rawOrder.totalPrice,
      }]);

    if (error) {
      console.error('Supabase insert error:', error);
    } else {
      console.log('✅ Заявка успешно сохранена в Supabase');
    }

    // Отправка в группу MAX
    const messageText = `
✅ *Новая заявка на отгрузку бетона*

📌 Марка: ${rawOrder.grade}
📦 Объём: ${rawOrder.volume} м³
📅 Дата: ${rawOrder.deliveryDate} ${rawOrder.deliveryTime}
📍 Адрес: ${rawOrder.address}

👤 Тип: ${rawOrder.customerType}
${rawOrder.customerType?.includes('Юридическое') ? `🏢 ${rawOrder.organizationName || '—'}` : `🙍 ${rawOrder.fullName || '—'}`}

📞 Телефон: ${rawOrder.phone}
💰 Бетон: ${rawOrder.concreteCost?.toLocaleString('ru-RU')} ₽
🚚 Доставка: ${rawOrder.deliveryCost?.toLocaleString('ru-RU')} ₽
💵 *Итого: ${rawOrder.totalPrice?.toLocaleString('ru-RU')} ₽*

💬 Комментарий: ${rawOrder.comment || '—'}
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
      }).catch(err => console.error('MAX send error:', err));
    }

    return NextResponse.json({ success: true, orderId: Date.now() });

  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
}