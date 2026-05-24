// app/api/order/send-notification/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BOT_TOKEN = process.env.MAX_BOT_TOKEN;
const CHAT_ID = process.env.MANAGER_CHAT_ID;

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { orderId } = await request.json();

    if (!orderId) {
      return NextResponse.json({ success: false, message: 'orderId is required' }, { status: 400 });
    }

    // Получаем данные заказа
    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        id, user_id, grade, volume, delivery_date, delivery_time, address, phone,
        customer_type, organization_name, full_name, inn, comment,
        concrete_cost, delivery_cost, total_price, created_at
      `)
      .eq('id', orderId)
      .single();

    if (error || !order) {
      return NextResponse.json({ success: false, message: 'Заказ не найден' }, { status: 404 });
    }

        // ==================== КОМПАКТНОЕ УВЕДОМЛЕНИЕ В MAX ====================
    const messageText = `
✅ *Новая заявка №${order.id}*

📌 **Марка:** ${order.grade}
📦 **Объём:** ${order.volume} м³
📅 **Дата:** ${order.delivery_date} в ${order.delivery_time}

📍 **Адрес:** ${order.address}

👤 **Тип:** ${order.customer_type}
${order.customer_type?.includes('Юридическое') 
  ? `🏢 ${order.organization_name || '—'}`
  : `🙍 ${order.full_name || '—'}`}

${order.inn ? `🆔 ИНН: ${order.inn}\n` : ''}
📞 **Телефон:** ${order.phone}

💬 **Комментарий:** ${order.comment ? order.comment : '—'}

🕒 ${new Date(order.created_at).toLocaleString('ru-RU')}
👤 MAX ID: ${order.user_id || '—'}
    `.trim();

    // Отправляем уведомление
    if (BOT_TOKEN && CHAT_ID) {
      const res = await fetch(`https://platform-api.max.ru/messages?chat_id=${CHAT_ID}`, {
        method: 'POST',
        headers: { 
          'Authorization': BOT_TOKEN, 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ text: messageText }),
      });

      if (!res.ok) {
        console.error('Ошибка отправки в Max:', await res.text());
      }
    } else {
      console.warn('⚠️ MAX_BOT_TOKEN или MANAGER_CHAT_ID не настроены');
    }

    return NextResponse.json({ success: true, message: 'Уведомление отправлено' });

  } catch (error: any) {
    console.error('Send notification error:', error);
    return NextResponse.json({ 
      success: false, 
      message: error.message || 'Внутренняя ошибка' 
    }, { status: 500 });
  }
}