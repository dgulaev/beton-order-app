import { NextRequest, NextResponse } from 'next/server';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const CHAT_ID = process.env.MANAGER_CHAT_ID;

export async function POST(request: NextRequest) {
  try {
    const order = await request.json();

    const messageText = `
✅ *Новая заявка на отгрузку бетона*

📌 Марка: ${order.grade}
📦 Объём: ${order.volume} м³
📅 Дата: ${order.deliveryDate} ${order.deliveryTime}
📍 Адрес: ${order.address}

👤 Тип: ${order.customerType}
${order.customerType.includes('Юридическое') ? `🏢 ${order.organizationName || '—'}` : `🙍 ${order.fullName || '—'}`}

📞 Телефон: ${order.phone}
💰 Бетон: ${order.concreteCost?.toLocaleString('ru-RU')} ₽
🚚 Доставка: ${order.deliveryCost?.toLocaleString('ru-RU')} ₽
💵 *Итого: ${order.totalPrice?.toLocaleString('ru-RU')} ₽*

💬 Комментарий: ${order.comment || '—'}
🕒 ${new Date().toLocaleString('ru-RU')}
    `.trim();

    console.log('Отправка в MAX. Chat ID:', CHAT_ID);
    console.log('Токен присутствует:', !!BOT_TOKEN);

    if (BOT_TOKEN && CHAT_ID) {
      const url = `https://platform-api.max.ru/messages?chat_id=${CHAT_ID}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': BOT_TOKEN,        // пробуем без Bearer
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: messageText }),
      });

      const responseText = await res.text();
      console.log('MAX Response Status:', res.status);
      console.log('MAX Response Body:', responseText);

      if (!res.ok) {
        console.error('Ошибка от MAX API:', responseText);
      }
    } else {
      console.error('Отсутствует BOT_TOKEN или CHAT_ID');
    }

    return NextResponse.json({ success: true, orderId: Date.now() });

  } catch (error) {
    console.error('Ошибка в /api/order:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}