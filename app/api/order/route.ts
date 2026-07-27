// app/api/order/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ORDER_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import type { AdminCifraUser } from '@/lib/adminCifraAuth';
import {
  findAnyUserByPhone,
  findClientByInn,
  findClientByOrganizationExact,
  findClientByPhone,
} from '@/lib/clientUsers';
import { canProcessTenders } from '@/lib/demandProcessAccess';
import { canActOnAssignedLeadWork } from '@/lib/leadAssigneeIds';
import { phonesMatch, toStoredPhone } from '@/lib/phone';
import { upsertLead } from '@/lib/leadService';
import { writeLeadHistory } from '@/lib/leadHistory';
import { maybeMarkClientSpamFromLead } from '@/lib/clientSpam';
import { isLikelySpam, scoreLeadText } from '@/lib/leads';

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
    console.log(
      `📍 [Order API] Источник заявки: ${isFromAdmin ? 'АДМИНКА ЦИФРА' : 'ПУБЛИЧНАЯ ФОРМА → лид'}`,
    );

    // Для админки — только авторизованный сотрудник; created_by берём с сервера,
    // не из body и не из хардкода «главного» user_id.
    let staffActorId: number | null = null;
    let staffActorName: string | null = null;
    let staffActor: AdminCifraUser | null = null;
    if (isFromAdmin) {
      const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
      if (auth.error) {
        return NextResponse.json(
          { success: false, message: 'Нет доступа. Войди в систему заново.' },
          { status: 403 },
        );
      }
      staffActor = auth.user;
      staffActorId = auth.user.user_id;
      staffActorName =
        (typeof payload.curator_name === 'string' && payload.curator_name.trim())
        || (typeof payload.userName === 'string' && payload.userName.trim())
        || auth.user.full_name
        || 'Сотрудник';
    }

    // ================================================
    // 3. НОРМАЛИЗАЦИЯ + ВАЛИДАЦИЯ (до создания клиента)
    // ================================================
    const supabase = getSupabaseClient();
    let finalUserId: number | null = null;

    const phoneRaw = String(payload.phone || payload.client_phone || payload.userPhone || '').trim();
    const clientFullName = String(payload.fullName || payload.full_name || payload.client_name || '').trim();
    const clientOrgName = String(
      payload.organizationName || payload.organization_name || payload.client_organization || '',
    ).trim();
    const clientInn = String(payload.inn || '').trim();
    const phoneWithPlus = toStoredPhone(phoneRaw);

    const {
      grade, volume, delivery_date, delivery_time, deliveryDate, deliveryTime,
      address, phone, customerType, organization_name, organizationName,
      full_name, fullName, inn, comment, concreteCost, deliveryCost, totalPrice
    } = payload;

    const finalDeliveryDate = delivery_date || deliveryDate;
    const finalDeliveryTime = delivery_time || deliveryTime;
    const finalOrganizationName = organization_name || organizationName || clientOrgName;
    const finalFullName = full_name || fullName || clientFullName;

    if (!phoneRaw || !phoneWithPlus) {
      return NextResponse.json(
        {
          success: false,
          message: isFromAdmin
            ? 'Некорректный телефон (нужен полный номер РФ)'
            : 'Укажите корректный телефон',
        },
        { status: 400 },
      );
    }

    if (!grade || !volume || !finalDeliveryDate || !finalDeliveryTime || !address || !phone) {
      return NextResponse.json(
        { success: false, message: 'Не все обязательные поля заполнены' },
        { status: 400 },
      );
    }

    const orderPhone = toStoredPhone(phone) || phoneWithPlus;

    // ================================================
    // 4. ПОИСК / СОЗДАНИЕ КЛИЕНТА
    // ================================================
    if (isFromAdmin) {
      console.log('👮 Заявка из админки — ищем/создаём клиента...');

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
      // Публичная форма: rate limit по телефону (антиспам), затем клиент → лид
      const sinceIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const { count: recentLeadCount, error: rateErr } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('source', 'public_form')
        .eq('phone', orderPhone)
        .gte('created_at', sinceIso);

      if (rateErr) {
        console.error('Rate-limit check error:', rateErr);
      } else if ((recentLeadCount ?? 0) >= 3) {
        return NextResponse.json(
          {
            success: false,
            message: 'Слишком много обращений с этого номера. Подождите 15 минут или дождитесь звонка менеджера.',
          },
          { status: 429 },
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

    const now = new Date().toISOString();
    await supabase
      .from('users')
      .update({ last_contact: now })
      .eq('user_id', finalUserId)
      .eq('role', 'client');

    // ================================================
    // 5. ПУБЛИЧНАЯ ФОРМА → ЛИД (не заказ)
    // ================================================
    if (!isFromAdmin) {
      const isLegal = typeof customerType === 'string' && /юридичес/i.test(customerType);
      const leadName = isLegal
        ? (finalOrganizationName || finalFullName || null)
        : (finalFullName || finalOrganizationName || null);
      const volumeNum = parseFloat(String(volume));
      const rawTextParts = [
        `${grade}, ${volumeNum} м³`,
        `${finalDeliveryDate} ${finalDeliveryTime}`,
        address,
        leadName,
        comment || null,
      ].filter(Boolean);
      const rawText = rawTextParts.join('\n');
      const spam = isLikelySpam(String(comment || '')) || isLikelySpam(rawText);

      const leadResult = await upsertLead({
        source: 'public_form',
        phone: orderPhone,
        name: leadName,
        grade: grade || null,
        volume_m3: Number.isFinite(volumeNum) ? volumeNum : null,
        address: address || null,
        desired_date: finalDeliveryDate || null,
        raw_text: rawText,
        score: spam ? 5 : Math.max(50, scoreLeadText(rawText)),
        status: spam ? 'spam' : 'new',
        raw_payload: {
          channel: 'public_form',
          user_id: finalUserId,
          referred_by: referredBy,
          grade,
          volume: volumeNum,
          delivery_date: finalDeliveryDate,
          delivery_time: finalDeliveryTime,
          address,
          phone: orderPhone,
          customer_type: customerType,
          full_name: finalFullName || null,
          organization_name: finalOrganizationName || null,
          inn: inn || clientInn || null,
          comment: comment || null,
          concrete_cost: concreteCost || 0,
          delivery_cost: deliveryCost || 0,
          total_price: totalPrice || 0,
          redeem_amount: payload.redeemAmount || payload.redeem_amount || 0,
        },
      });

      if (!leadResult) {
        return NextResponse.json(
          { success: false, message: 'Не удалось сохранить обращение' },
          { status: 500 },
        );
      }

      if (spam) {
        await maybeMarkClientSpamFromLead({
          phone: orderPhone,
          raw_payload: { user_id: finalUserId },
        });
      }

      console.log(
        `✅ Публичная форма → лид #${leadResult.lead.id} (user ${finalUserId})${spam ? ' [spam]' : ''}`,
      );

      return NextResponse.json({
        success: true,
        isLead: true,
        leadId: leadResult.lead.id,
        orderId: leadResult.lead.id,
        userId: finalUserId,
        message: 'Обращение принято. Менеджер свяжется с вами.',
      });
    }

    // ================================================
    // 7. СОЗДАНИЕ ЗАКАЗА (только админка)
    // ================================================
    const createdByStaff = staffActorId;
    const curatorName = staffActorName;

    const leadIdRaw = payload.lead_id ?? payload.leadId ?? null;
    let leadId = leadIdRaw != null && Number.isFinite(Number(leadIdRaw)) ? Number(leadIdRaw) : null;
    const leadSource = payload.lead_source || payload.leadSource || null;
    const externalRef = payload.external_ref || payload.externalRef || null;

    // Защита от повторной конверсии: один лид → максимум один заказ
    if (leadId) {
      const { data: existingLead, error: leadFetchError } = await supabase
        .from('leads')
        .select('id, status, order_id, assigned_to, raw_payload, source')
        .eq('id', leadId)
        .maybeSingle();

      if (leadFetchError) {
        console.error('Ошибка чтения лида перед созданием заказа:', leadFetchError);
        return NextResponse.json(
          { success: false, message: 'Не удалось проверить лид перед созданием заявки' },
          { status: 500 },
        );
      }
      if (!existingLead) {
        return NextResponse.json(
          { success: false, message: `Лид #${leadId} не найден` },
          { status: 400 },
        );
      }
      if (existingLead.status === 'converted' || existingLead.order_id) {
        return NextResponse.json(
          {
            success: false,
            message: existingLead.order_id
              ? `Лид уже конвертирован в заявку #${existingLead.order_id}`
              : 'Лид уже конвертирован в заявку',
            orderId: existingLead.order_id ?? undefined,
          },
          { status: 409 },
        );
      }

      // Заказ из лида: Авито/публичная форма — всем; иначе — назначенный или админ/торги.
      if (
        staffActor &&
        !canProcessTenders(staffActor) &&
        !canActOnAssignedLeadWork(existingLead, staffActor.user_id)
      ) {
        return NextResponse.json(
          {
            success: false,
            message: 'Создать заказ может только назначенный исполнитель или соисполнитель',
          },
          { status: 403 },
        );
      }
      if (existingLead.status === 'spam') {
        return NextResponse.json(
          { success: false, message: 'Нельзя создать заявку из лида со статусом «Спам»' },
          { status: 400 },
        );
      }
    }

    // Рефералка: из payload или из raw_payload лида (публичная форма с ?ref=)
    const referredByFromPayload = referredBy != null && Number.isFinite(Number(referredBy))
      ? Number(referredBy)
      : null;

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
        referred_by: referredByFromPayload,

        // ==================== НОВЫЕ ПОЛЯ ====================
        created_by: createdByStaff,
        curator_name: curatorName,
        lead_id: leadId,
        lead_source: leadSource,
        external_ref: externalRef,
      }])
      .select()
      .single();

    if (insertError) {
      console.error('Insert order error:', insertError);
      // Unique index orders_lead_id_unique — гонка двойной конверсии
      if (insertError.code === '23505' && leadId) {
        return NextResponse.json(
          {
            success: false,
            message: `Лид #${leadId} уже конвертирован в другую заявку`,
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ success: false, message: 'Ошибка создания заказа в базе' }, { status: 500 });
    }

    const orderId = orderData.id;
    console.log(`✅ Заказ #${orderId} успешно создан | created_by: ${createdByStaff} | curator: ${curatorName}`);

    // Конверсия лида → заказ (если заявка создана из inbox).
    // Не делаем early return: история/рефералка ниже должны выполниться всегда.
    let leadWarning: string | null = null;
    let leadConverted = false;
    if (leadId && orderId) {
      const { data: convertedLead, error: leadUpdateError } = await supabase
        .from('leads')
        .update({ status: 'converted', order_id: orderId })
        .eq('id', leadId)
        .is('order_id', null)
        .select('id')
        .maybeSingle();

      if (leadUpdateError) {
        console.error('Ошибка обновления лида после заказа:', leadUpdateError);
        leadWarning = 'Заявка создана, но лид не помечен как converted. Обнови статус лида вручную.';
        // Снимаем связь, чтобы не висел «чужой» lead_id без converted
        await supabase.from('orders').update({ lead_id: null }).eq('id', orderId);
        leadId = null;
      } else if (!convertedLead) {
        // Гонка: другой запрос уже успел привязать лид
        console.warn(`Лид #${leadId} уже был конвертирован параллельно; отвязываем от заказа #${orderId}`);
        leadWarning = 'Заявка создана, но лид уже был конвертирован в другую заявку. Связь с лидом снята.';
        await supabase.from('orders').update({ lead_id: null }).eq('id', orderId);
        leadId = null;
      } else {
        leadConverted = true;
        const convertedLeadId = leadId;
        const creatorName = payload.userName && payload.userName !== 'Сотрудник'
          ? payload.userName
          : (curatorName || (isFromAdmin ? 'Администратор' : 'Клиент'));
        const creatorRole = payload.userRole || (isFromAdmin ? 'admin' : 'client');
        const creatorUserIdRaw = payload.userId ?? payload.user_id ?? null;
        const creatorUserId =
          creatorUserIdRaw != null && Number.isFinite(Number(creatorUserIdRaw))
            ? Number(creatorUserIdRaw)
            : null;
        if (convertedLeadId) {
          await writeLeadHistory({
            lead_id: convertedLeadId,
            action: 'Конвертировал в заказ',
            user_id: creatorUserId,
            user_name: creatorName,
            user_role: creatorRole,
            field_name: 'status',
            old_value: 'in_progress',
            new_value: 'converted',
          });
        }
      }
    }

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

      const { error: historyError } = await supabase
        .from('order_history')
        .insert([historyEntry]);

      if (historyError) {
        console.error('Ошибка записи истории:', historyError);
      } else {
        console.log(`📜 ИСТОРИЯ: "${creatorName}" создал заявку #${orderId}`);
      }
    }

    // ================================================
    // 9. РЕФЕРАЛЬНЫЕ БАЛЛЫ
    // ================================================
    if (referredByFromPayload && parseFloat(volume) > 0) {
      const bonusPoints = Math.round(parseFloat(volume) * 100);

      const { error: refError } = await supabase
        .from('referral_transactions')
        .insert({
          referrer_id: referredByFromPayload,
          referred_user_id: finalUserId,
          order_id: orderId,
          volume: parseFloat(volume),
          potential_bonus: bonusPoints,
          status: 'pending'
        });

      if (refError) console.error('❌ Ошибка referral_transaction:', refError);
    }

    return NextResponse.json({ 
      success: true, 
      orderId: orderId,
      userId: finalUserId,
      message: 'Заявка успешно создана',
      ...(leadWarning ? { warning: leadWarning } : {}),
      leadConverted,
    });

  } catch (error: any) {
    console.error('API Error in /api/order:', error);
    return NextResponse.json({ 
      success: false, 
      message: error.message || 'Внутренняя ошибка сервера' 
    }, { status: 500 });
  }
}