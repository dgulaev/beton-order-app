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

    const userId = payload.userId 
      || payload.user_id 
      || payload.initDataUnsafe?.user?.id 
      || payload.initData?.user?.id 
      || null;

    const referredBy = payload.referred_by || null;

    // Сохраняем заявку
    await supabase
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
      }]);

    // Начисляем баллы рефереру (100 баллов за 1 м³)
    if (referredBy && payload.volume) {
      const bonusPoints = Math.round(payload.volume * 100);

      await supabase.rpc('increment_balance', {
        user_id: referredBy,
        points: bonusPoints
      });

      console.log(`✅ Начислено ${bonusPoints} баллов пользователю ${referredBy}`);
    }

    // Уведомление в группу
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
      }).catch(err => console.error('MAX error:', err));
    }

    return NextResponse.json({ success: true, orderId: Date.now() });

  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}