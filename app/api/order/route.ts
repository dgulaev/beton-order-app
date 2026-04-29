import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nhudnzdgtidocwwzpqge.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const CHAT_ID = process.env.MANAGER_CHAT_ID;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function POST(request: NextRequest) {
  try {
    const order = await request.json();

    // Сохраняем заявку в базу
    const { error } = await supabase
      .from('orders')
      .insert([{
        user_id: order.userId,
        grade: order.grade,
        volume: order.volume,
        delivery_date: order.deliveryDate,
        delivery_time: order.deliveryTime,
        address: order.address,
        customer_type: order.customerType,
        full_name: order.fullName,
        organization_name: order.organizationName,
        phone: order.phone,
        comment: order.comment || null,
        concrete_cost: order.concreteCost,
        delivery_cost: order.deliveryCost,
        total_price: order.totalPrice,
      }]);

    if (error) console.error('Supabase error:', error);

    // Отправка уведомления в группу MAX
    const messageText = `
✅ *Новая заявка на отгрузку бетона*

📌 Марка: ${order.grade}
📦 Объём: ${order.volume} м³
📅 Дата: ${order.deliveryDate} ${order.deliveryTime}
📍 Адрес: ${order.address}

👤 Тип: ${order.customerType}
${order.customerType?.includes('Юридическое') ? `🏢 ${order.organizationName || '—'}` : `🙍 ${order.fullName || '—'}`}

📞 Телефон: ${order.phone}
💰 Бетон: ${order.concreteCost?.toLocaleString('ru-RU')} ₽
🚚 Доставка: ${order.deliveryCost?.toLocaleString('ru-RU')} ₽
💵 *Итого: ${order.totalPrice?.toLocaleString('ru-RU')} ₽*

💬 Комментарий: ${order.comment || '—'}
🕒 ${new Date().toLocaleString('ru-RU')}
    `.trim();

    if (BOT_TOKEN && CHAT_ID) {
      await fetch(`https://platform-api.max.ru/messages?chat_id=${CHAT_ID}`, {
        method: 'POST',
        headers: {
          'Authorization': BOT_TOKEN,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: messageText }),
      }).catch(err => console.error('MAX error:', err));
    }

    return NextResponse.json({ success: true, orderId: Date.now() });

  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}