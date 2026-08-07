// app/api/adminCifra/orders/update/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ORDER_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { computeRoadMinutes } from '@/lib/travelTime';
import {
  ORDER_STATUS_RU,
  applyOrderStatusSideEffects,
  assertManualCompleteAllowed,
  isFinalOrderStatus,
  isOrderStatus,
} from '@/lib/orderStatusTransition';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PUT(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
  if (auth.error) {
    return NextResponse.json(
      { success: false, message: 'Нет доступа к изменению заявки' },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const { id, userRole: _clientRole, userName, ...updateData } = body;

    if (!id) {
      return NextResponse.json({ success: false, message: 'ID заявки обязателен' }, { status: 400 });
    }

   // console.log('🔄 [Update API] Обновление заявки #', id, 'от', userName || 'Система');

    // ==================== 1. ПОЛУЧЕНИЕ ТЕКУЩЕЙ ЗАЯВКИ ====================
    const { data: currentOrder, error: fetchError } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !currentOrder) {
      return NextResponse.json({ success: false, message: 'Заявка не найдена' }, { status: 404 });
    }

    // ==================== 2. СТАТУС: whitelist + финал только админ ====================
    const isFinalOrder = isFinalOrderStatus(currentOrder.status);
    const isAdmin = auth.user.role === 'admin';
    const nextStatusRaw = updateData.status !== undefined ? String(updateData.status) : null;

    if (nextStatusRaw != null) {
      if (!isOrderStatus(nextStatusRaw)) {
        return NextResponse.json(
          { success: false, message: 'Недопустимый статус заявки' },
          { status: 400 },
        );
      }
      if (isFinalOrder && !isAdmin && nextStatusRaw !== String(currentOrder.status)) {
        return NextResponse.json(
          {
            success: false,
            message: `Заявка уже в финальном статусе "${ORDER_STATUS_RU[currentOrder.status] || currentOrder.status}" — менять может только админ`,
          },
          { status: 400 },
        );
      }
    }

    const nextStatus = nextStatusRaw;
    const leavingCompleted =
      currentOrder.status === 'completed'
      && nextStatus != null
      && nextStatus !== 'completed';

    // ==================== 2a. ЗАПРЕТ СМЕНЫ ОБЪЁМА У «ВЫПОЛНЕНА» ====================
    // Если админ в том же запросе уводит заявку из completed — объём можно менять.
    if (
      currentOrder.status === 'completed'
      && updateData.volume !== undefined
      && !leavingCompleted
    ) {
      const oldVol = Number(currentOrder.volume);
      const newVol = Number(updateData.volume);
      if (Number.isFinite(newVol) && Math.abs(oldVol - newVol) > 0.001) {
        return NextResponse.json({
          success: false,
          message: 'Нельзя менять объём заявки в статусе «Выполнена». Сначала верните заявку в работу и добавьте недостающий рейс.',
        }, { status: 400 });
      }
      delete updateData.volume;
    }

    // ==================== 2b. ЗАПРЕТ РУЧНОГО ПЕРЕВОДА В "ВЫПОЛНЕНА" БЕЗ РЕАЛЬНОЙ РАЗГРУЗКИ ====================
    // В т.ч. админский override cancelled/completed → completed.
    if (nextStatus === 'completed' && currentOrder.status !== 'completed') {
      const effectiveVolume =
        updateData.volume !== undefined
          ? Number(updateData.volume)
          : Number(currentOrder.volume || 0);
      const check = await assertManualCompleteAllowed(supabase, id, effectiveVolume);
      if (!check.ok) {
        return NextResponse.json({ success: false, message: check.message }, { status: 400 });
      }
    }

    // ==================== 3. ЗАПИСЬ ИСТОРИИ ИЗМЕНЕНИЙ ====================
    const changes: any[] = [];
    
    // Роль только с сервера — клиентский userRole не доверяем.
    const finalUserRole = auth.user.role;
    const finalUserName =
      (typeof userName === 'string' && userName.trim() ? userName.trim() : null)
      || auth.user.full_name
      || 'Сотрудник';

    const fieldsToTrack = [
      'grade', 'volume', 'delivery_date', 'delivery_time',
      'address', 'phone', 'organization_name', 'full_name',
      'inn', 'comment', 'status', 'logistics_ready', 'user_id'
    ];

    const fieldNames: Record<string, string> = {
      grade: 'марку бетона',
      volume: 'объём',
      delivery_date: 'дату доставки',
      delivery_time: 'время доставки',
      address: 'адрес доставки',
      phone: 'телефон',
      organization_name: 'название организации',
      full_name: 'ФИО',
      inn: 'ИНН',
      comment: 'комментарий',
      status: 'статус',
      is_questionable: 'метку "Под вопросом"',
      logistics_ready: 'готовность логистики',
      user_id: 'клиента'
    };

    // Метку «Под вопросом» обновляем отдельно через compare-and-swap:
    // несколько параллельных PUT (баг чекбокса / двойной клик) иначе все читают
    // старое false и пишут в историю по 3–4 одинаковые записи за одну секунду.
    // CAS одинаково защищает и постановку (false→true), и снятие (true→false).
    let hasQuestionableUpdate = updateData.is_questionable !== undefined;
    let desiredQuestionable: boolean | null = hasQuestionableUpdate
      ? (updateData.is_questionable === true || updateData.is_questionable === 'true')
      : null;
    if (hasQuestionableUpdate) {
      delete updateData.is_questionable;
    }

    // Переход в «В работе» всегда снимает метку. Явная установка true в том же
    // запросе игнорируется — побеждает бизнес-правило автоснятия.
    const transitioningToProcessing =
      updateData.status === 'processing' && currentOrder.status !== 'processing';
    if (transitioningToProcessing && desiredQuestionable === true) {
      hasQuestionableUpdate = false;
      desiredQuestionable = null;
    }

    for (const field of fieldsToTrack) {
      const oldValue = currentOrder[field];
      const newValue = updateData[field];

      if (newValue === undefined) continue;

      const oldStr = oldValue !== null && oldValue !== undefined ? String(oldValue).trim() : '';
      const newStr = newValue !== null && newValue !== undefined ? String(newValue).trim() : '';

      if (oldStr !== newStr) {
        let actionText = `Изменил ${fieldNames[field] || field}`;

        if (field === 'status') {
          const oldStatusName = ORDER_STATUS_RU[oldStr] || oldStr;
          const newStatusName = ORDER_STATUS_RU[newStr] || newStr;
          actionText = `Изменил статус заявки с "${oldStatusName}" на "${newStatusName}"`;
          if (isFinalOrder && isAdmin) {
            actionText += ' (админ: правка конечного статуса)';
          }
        } 
        else if (field === 'grade') {
          actionText = `Изменил марку бетона с ${oldStr || '—'} на ${newStr || '—'}`;
        }
        else if (field === 'volume') {
          actionText = `Изменил объём с ${oldStr} на ${newStr} м³`;
        } 
        else if (field === 'delivery_time') {
          actionText = `Изменил время доставки с ${oldStr} на ${newStr}`;
        } 
        else if (field === 'delivery_date') {
          actionText = `Изменил дату доставки`;
        }

        changes.push({
          order_id: id,
          action: actionText,
          user_name: finalUserName,
          user_role: finalUserRole,
          field_name: field,
          old_value: oldStr || null,
          new_value: newStr || null
        });
      }
    }

    // ==================== 4. ОБНОВЛЕНИЕ ЗАЯВКИ ====================
    // Сначала CAS для метки — побеждает только первый запрос, остальные
    // видят, что значение уже сменилось, и не пишут дубль в историю.
    if (hasQuestionableUpdate && desiredQuestionable !== null) {
      const oldQuestionable =
        currentOrder.is_questionable === true || currentOrder.is_questionable === 'true';

      if (oldQuestionable !== desiredQuestionable) {
        let casQuery = supabase
          .from('orders')
          .update({ is_questionable: desiredQuestionable })
          .eq('id', id);

        // Старое значение: true → фильтр eq true; false/null → or(false, null)
        if (oldQuestionable) {
          casQuery = casQuery.eq('is_questionable', true);
        } else {
          casQuery = casQuery.or('is_questionable.eq.false,is_questionable.is.null');
        }

        const { data: casRows, error: casError } = await casQuery.select('id');

        if (casError) {
          console.error('CAS is_questionable error:', casError);
          return NextResponse.json({ success: false, message: casError.message }, { status: 500 });
        }

        if (casRows && casRows.length > 0) {
          changes.push({
            order_id: id,
            action: desiredQuestionable
              ? 'Поставил метку "Под вопросом"'
              : 'Снял метку "Под вопросом"',
            user_name: finalUserName,
            user_role: finalUserRole,
            field_name: 'is_questionable',
            old_value: oldQuestionable ? 'true' : 'false',
            new_value: desiredQuestionable ? 'true' : 'false',
          });
        }
      }
    }

    // Автоснятие метки при переводе заявки в «В работе» (если менеджер
    // не снял её вручную в этом же запросе — тогда CAS выше уже отработал,
    // и повторный UPDATE затронет 0 строк → дубля в истории не будет).
    if (transitioningToProcessing) {
      const { data: autoClearRows, error: autoClearError } = await supabase
        .from('orders')
        .update({ is_questionable: false })
        .eq('id', id)
        .eq('is_questionable', true)
        .select('id');

      if (autoClearError) {
        console.error('Auto-clear is_questionable error:', autoClearError);
        return NextResponse.json({ success: false, message: autoClearError.message }, { status: 500 });
      }

      if (autoClearRows && autoClearRows.length > 0) {
        changes.push({
          order_id: id,
          action: 'Автоматически снял метку "Под вопросом" (статус «В работе»)',
          user_name: 'Система',
          user_role: 'system',
          field_name: 'is_questionable',
          old_value: 'true',
          new_value: 'false',
        });
      }
    }

    // road_time_min только с сервера (геокод), клиентский payload игнорируем.
    delete updateData.road_time_min;

    // Смена адреса → сразу пересчитать дорогу, чтобы диспетчер в планировании
    // увидел новые «объект/обр.» без ручного «Обновить дороги».
    if (Object.prototype.hasOwnProperty.call(updateData, 'address')) {
      const oldAddr = String(currentOrder.address || '').trim();
      const newAddr = String(updateData.address ?? '').trim();
      if (oldAddr !== newAddr) {
        try {
          const { road_time_min } = await computeRoadMinutes(newAddr);
          updateData.road_time_min = road_time_min;
        } catch (e) {
          console.warn('road_time_min after address change:', e);
        }
      }
    }

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await supabase
        .from('orders')
        .update(updateData)
        .eq('id', id);

      if (updateError) {
        console.error('Update error:', updateError);
        return NextResponse.json({ success: false, message: updateError.message }, { status: 500 });
      }
    }

    // История только после успешного UPDATE — иначе в журнале останутся
    // «изменения», которых в заявке нет. Тост ждёт автора с короткими ретраями.
    if (changes.length > 0) {
      const { error: historyError } = await supabase
        .from('order_history')
        .insert(changes);

      if (historyError) {
        console.error('❌ Ошибка записи истории:', historyError);
      } else {
        console.log(`📜 Записано ${changes.length} изменений в историю`);
      }
    }

   // console.log(`✅ Заявка #${id} успешно обновлена. Новый статус: ${updateData.status || currentOrder.status}`);

    const newStatus = updateData.status != null ? String(updateData.status) : null;
    if (newStatus && String(currentOrder.status) !== newStatus) {
      await applyOrderStatusSideEffects({
        supabase,
        orderId: Number(id),
        oldStatus: String(currentOrder.status),
        newStatus,
        deliveryDate: currentOrder.delivery_date,
        referredBy: currentOrder.referred_by,
        volume: updateData.volume !== undefined ? updateData.volume : currentOrder.volume,
        actorName: finalUserName,
      });
    }

    return NextResponse.json({ 
      success: true, 
      message: 'Заявка успешно обновлена',
      changesCount: changes.length 
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}