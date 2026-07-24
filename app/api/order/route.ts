// app/api/order/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ORDER_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  findAnyUserByPhone,
  findClientByInn,
  findClientByOrganizationExact,
  findClientByPhone,
} from '@/lib/clientUsers';
import { phonesMatch, toStoredPhone } from '@/lib/phone';

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

    // Для админки — только авторизованный сотрудник; created_by берём с сервера,
    // не из body и не из хардкода «главного» user_id.
    let staffActorId: number | null = null;
    let staffActorName: string | null = null;
    if (isFromAdmin) {
      const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
      if (auth.error) {
        return NextResponse.json(
          { success: false, message: 'Нет доступа. Войди в систему заново.' },
          { status: 403 },
        );
      }
      staffActorId = auth.user.user_id;
      staffActorName =
        (typeof payload.curator_name === 'string' && payload.curator_name.trim())
        || (typeof payload.userName === 'string' && payload.userName.trim())
        || auth.user.full_name
        || 'Сотрудник';
    }

    // ================================================
    // 3. ПОИСК / СОЗДАНИЕ КЛИЕНТА
    // ================================================
    // Важно: никогда не оставляем finalUserId = id сотрудника из payload.
    const supabase = getSupabaseClient();
    let finalUserId: number | null = null;

    const phoneRaw = String(payload.phone || payload.client_phone || payload.userPhone || '').trim();
    const clientFullName = String(payload.fullName || payload.full_name || payload.client_name || '').trim();
    const clientOrgName = String(
      payload.organizationName || payload.organization_name || payload.client_organization || '',
    ).trim();
    const clientInn = String(payload.inn || '').trim();
    const phoneWithPlus = toStoredPhone(phoneRaw);

    if (isFromAdmin) {
      console.log('👮 Заявка из админки — ищем/создаём клиента...');

      if (!phoneRaw || !phoneWithPlus) {
        return NextResponse.json(
          { success: false, message: 'Некорректный телефон (нужен полный номер РФ)' },
          { status: 400 },
        );
      }

      let existingClient =
        (await findClientByPhone(supabase, phoneRaw))
        || (clientInn ? await findClientByInn(supabase, clientInn) : null)
        || (clientOrgName ? await findClientByOrganizationExact(supabase, clientOrgName) : null);

      if (existingClient) {
        finalUserId = Number(existingClient.user_id);
        console.log(`👤 Используем существующего клиента: ${finalUserId}`);
      } else {
        const newUserId = Date.now() + Math.floor(Math.random() * 1000000);
        const createdByStaff = staffActorId!;
        const curatorName = staffActorName || 'Сотрудник';

        const { data: newClient, error: createError } = await supabase
          .from('users')
          .insert({
            user_id: newUserId,
            role: 'client',
            phone: phoneWithPlus,
            full_name: clientOrgName ? null : clientFullName || null,
            organization_name: clientOrgName || clientFullName || null,
            inn: clientInn || null,
            balance: 0,
            referral_code: 'R' + Math.random().toString(36).substring(2, 10).toUpperCase(),
            created_by: createdByStaff,
            curator_id: createdByStaff,
            curator_name: curatorName,
            created_at: new Date().toISOString(),
          })
          .select('user_id')
          .single();

        if (createError || !newClient?.user_id) {
          console.error('❌ Ошибка создания клиента:', createError);
          return NextResponse.json(
            { success: false, message: 'Не удалось создать клиента. Заявка не создана.' },
            { status: 500 },
          );
        }
        finalUserId = Number(newClient.user_id);
        console.log(`✅ Создан новый клиент: ${finalUserId} | created_by: ${createdByStaff}`);
      }
    } else {
      // Публичная заявка: резолвим клиента по телефону, не доверяем Telegram/localStorage id вслепую.
      if (!phoneRaw || !phoneWithPlus) {
        return NextResponse.json(
          { success: false, message: 'Укажите корректный телефон' },
          { status: 400 },
        );
      }

      const byPhone = await findClientByPhone(supabase, phoneRaw);
      if (byPhone) {
        finalUserId = Number(byPhone.user_id);
      } else {
        const anyUser = await findAnyUserByPhone(supabase, phoneRaw);
        if (anyUser && String(anyUser.role || '').toLowerCase() !== 'client') {
          return NextResponse.json(
            { success: false, message: 'Этот номер занят учётной записью сотрудника. Используй другой телефон.' },
            { status: 409 },
          );
        }

        const payloadUserId = userId != null ? Number(userId) : NaN;
        if (Number.isFinite(payloadUserId) && payloadUserId > 0) {
          const { data: claimed } = await supabase
            .from('users')
            .select('user_id, phone, role')
            .eq('user_id', payloadUserId)
            .eq('role', 'client')
            .maybeSingle();
          // Принимаем payload.userId только если телефон совпадает
          if (claimed && phonesMatch(claimed.phone, phoneRaw)) {
            finalUserId = Number(claimed.user_id);
          }
        }

        if (finalUserId == null) {
          const newUserId = Date.now() + Math.floor(Math.random() * 1000000);
          const referredByNum = referredBy != null && Number.isFinite(Number(referredBy))
            ? Number(referredBy)
            : null;
          const { data: newClient, error: createError } = await supabase
            .from('users')
            .insert({
              user_id: newUserId,
              role: 'client',
              phone: phoneWithPlus,
              full_name: clientOrgName ? null : clientFullName || null,
              organization_name: clientOrgName || null,
              inn: clientInn || null,
              balance: 0,
              referral_code: 'R' + Math.random().toString(36).substring(2, 10).toUpperCase(),
              referred_by: referredByNum,
              created_at: new Date().toISOString(),
            })
            .select('user_id')
            .single();

          if (createError || !newClient?.user_id) {
            console.error('❌ Ошибка создания публичного клиента:', createError);
            return NextResponse.json(
              { success: false, message: 'Не удалось зарегистрировать клиента' },
              { status: 500 },
            );
          }
          finalUserId = Number(newClient.user_id);
        }
      }
    }

    if (finalUserId == null || !Number.isFinite(finalUserId) || finalUserId <= 0) {
      return NextResponse.json(
        { success: false, message: 'Не удалось определить клиента для заявки' },
        { status: 400 },
      );
    }

    console.log(`🔑 Финальный user_id заказа: ${finalUserId}`);

    // ================================================
    // 3.1 ОБНОВЛЕНИЕ last_contact
    // ================================================
    const now = new Date().toISOString();
    await supabase
      .from('users')
      .update({ last_contact: now })
      .eq('user_id', finalUserId)
      .eq('role', 'client');

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

    const orderPhone = toStoredPhone(phone) || String(phone).trim();

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
    // Админка: только auth.user_id. Публичная заявка: без куратора-сотрудника.
    const createdByStaff = isFromAdmin ? staffActorId : null;
    const curatorName = isFromAdmin
      ? staffActorName
      : (payload.curator_name || payload.userName || null);

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
        phone: orderPhone,
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