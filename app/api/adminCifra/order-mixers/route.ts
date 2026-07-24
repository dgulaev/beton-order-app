// app/api/adminCifra/order-mixers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ORDER_MIXER_DELETE_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { listCementSegments, refundAllCementWriteoffs } from '@/lib/cementSegments';
import { siloNameById } from '@/lib/siloConfig';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const FINAL_STATUSES = ['completed', 'cancelled'];
const LOADED_STATUSES = ['В пути', 'На объекте', 'Разгружен', 'Возврат', 'Проблема'];
const STATUS_LABELS_RU: Record<string, string> = {
  new: 'Новая',
  processing: 'В работе',
  completed: 'Выполнена',
  cancelled: 'Отменена'
};

// GET — все назначенные миксеры (для дашборда), по одному orderId, или по
// списку orderIds (через запятую) — это сильно урезает выборку там, где
// нужны назначения только для заявок за конкретный день/месяц, а не за всё
// время (см. app/mobile/page.tsx).
export async function GET(request: NextRequest) {
  const orderId = request.nextUrl.searchParams.get('orderId');
  const orderIdsParam = request.nextUrl.searchParams.get('orderIds');

  try {
    let query = supabase
      .from('order_mixers')
      .select(`
        id,
        order_id,
        mixer_name,
        time,
        volume,
        status,
        created_at,
        on_site_at,
        unloaded_at,
        downtime_minutes,
        orders (
          id,
          organization_name,
          full_name
        )
      `)
      .order('created_at', { ascending: false });

    // Если передан orderId — фильтруем по заказу
    if (orderId) {
      query = query.eq('order_id', parseInt(orderId));
    } else if (orderIdsParam) {
      const ids = orderIdsParam
        .split(',')
        .map((id) => parseInt(id.trim()))
        .filter((id) => Number.isFinite(id));
      if (ids.length > 0) {
        query = query.in('order_id', ids);
      } else {
        return NextResponse.json([]);
      }
    }

    const { data, error } = await query;

    if (error) throw error;

    const formatted = (data || []).map((item: any) => ({
      id: item.id,
      orderId: item.order_id,
      number: item.mixer_name,
      mixerName: item.mixer_name,
      time: item.time,
      volume: Number(item.volume || 0),
      status: item.status || 'Загрузка',
      client: item.orders?.organization_name || item.orders?.full_name || '—',
      onSiteAt: item.on_site_at || null,
      unloadedAt: item.unloaded_at || null,
      downtimeMinutes: item.downtime_minutes ?? null
    }));

   // console.log(`✅ Загружено ${formatted.length} записей order_mixers`);
    return NextResponse.json(formatted);

  } catch (error: any) {
    console.error('Order-mixers GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST — добавить миксер к заказу
export async function POST(request: NextRequest) {
  try {
    const { orderId, mixerName, time, volume, sortOrder, status, userName, userRole } = await request.json();

    if (!orderId || !mixerName || !time || volume === undefined) {
      return NextResponse.json({ error: 'Не все обязательные поля заполнены' }, { status: 400 });
    }

    // ==================== ПРОВЕРКА ФИНАЛЬНОГО СТАТУСА ЗАЯВКИ ====================
    const { data: currentOrder, error: orderFetchError } = await supabase
      .from('orders')
      .select('id, status, volume, is_questionable')
      .eq('id', orderId)
      .single();

    if (orderFetchError || !currentOrder) {
      return NextResponse.json({ error: 'Заявка не найдена' }, { status: 404 });
    }

    if (FINAL_STATUSES.includes(currentOrder.status)) {
      return NextResponse.json({
        error: `Заявка уже в финальном статусе "${STATUS_LABELS_RU[currentOrder.status] || currentOrder.status}" — добавление миксеров запрещено`
      }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('order_mixers')
      .insert([{
        order_id: orderId,
        mixer_name: mixerName,
        time: time,
        volume: volume,
        sort_order: sortOrder || 0,
        status: status || 'Загрузка'        // ← Теперь используем переданное значение
      }])
      .select()
      .single();

    if (error) throw error;

    // ==================== ИСТОРИЯ: ДОБАВЛЕНИЕ МИКСЕРА ====================
    const historyEntries: any[] = [{
      order_id: orderId,
      action: `Добавил миксер ${mixerName} (${Number(volume).toFixed(2).replace(/\.?0+$/, '')} м³, время ${time})`,
      user_name: userName || 'Диспетчер',
      user_role: userRole || null
    }];

    // ==================== ПРАВИЛО 1: Новая → В работе при добавлении ЛЮБОГО миксера ====================
    let newOrderStatus: string | null = null;

    if (currentOrder.status === 'new') {
      newOrderStatus = 'processing';
      const wasQuestionable =
        currentOrder.is_questionable === true || currentOrder.is_questionable === 'true';

      // Вместе со статусом снимаем метку «Под вопросом» (если ещё стоит)
      const { error: statusUpdateError } = await supabase
        .from('orders')
        .update({
          status: newOrderStatus,
          ...(wasQuestionable ? { is_questionable: false } : {}),
        })
        .eq('id', orderId);

      if (statusUpdateError) {
        console.error('Не удалось автоматически перевести заявку в "В работе":', statusUpdateError);
      } else {
        historyEntries.push({
          order_id: orderId,
          action: `Автоматически изменил статус заявки с "Новая" на "В работе" (добавлен миксер ${mixerName})`,
          user_name: 'Система',
          user_role: 'system'
        });
        if (wasQuestionable) {
          historyEntries.push({
            order_id: orderId,
            action: 'Автоматически снял метку "Под вопросом" (статус «В работе»)',
            user_name: 'Система',
            user_role: 'system',
            field_name: 'is_questionable',
            old_value: 'true',
            new_value: 'false',
          });
        }
      }
    }

    const { error: historyError } = await supabase.from('order_history').insert(historyEntries);
    if (historyError) {
      console.error('Ошибка записи истории при добавлении миксера:', historyError);
    }

   // console.log(`✅ Добавлен миксер ${mixerName} со статусом ${status || 'Загрузка'}`);

    return NextResponse.json({ success: true, data, newOrderStatus });

  } catch (error: any) {
    console.error('Add mixer error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE — удалить миксер/рейс (+ возврат списаний на склад, чистка production_logs).
// Рейсы уже уехавшие («В пути» и дальше) может удалять только admin.
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const id = Number(body?.id);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'id обязателен' }, { status: 400 });
    }

    const { data: mixer, error: mixerFetchError } = await supabase
      .from('order_mixers')
      .select(`
        id,
        order_id,
        mixer_name,
        volume,
        status,
        time,
        additive_write_off_id,
        additive_write_off_liters,
        cement_write_off_silo_id,
        cement_write_off_kg,
        cement_write_off_at,
        orders!inner(status)
      `)
      .eq('id', id)
      .single();

    if (mixerFetchError || !mixer) {
      return NextResponse.json({ error: 'Рейс не найден' }, { status: 404 });
    }

    const orderStatus = (mixer as any).orders?.status as string | undefined;
    const orderIsFinal = !!(orderStatus && FINAL_STATUSES.includes(orderStatus));

    const cementSegments = await listCementSegments(id);
    const mixerStatus = String(mixer.status || 'Загрузка');
    const needsAdmin = orderIsFinal
      || LOADED_STATUSES.includes(mixerStatus)
      || mixer.cement_write_off_kg != null
      || cementSegments.length > 0
      || mixer.additive_write_off_liters != null
      || Boolean(body?.force);

    // Auth всегда: «лёгкий» рейс — staff, уже отгруженный/force — только admin.
    const auth = await requireAdminCifraStaff(
      request,
      needsAdmin ? ['admin'] : ORDER_MIXER_DELETE_ROLES,
    );
    if (auth.error) {
      return NextResponse.json(
        {
          error: needsAdmin
            ? (orderIsFinal
              ? `Заявка в статусе "${STATUS_LABELS_RU[orderStatus!] || orderStatus}" — удаление рейсов только для администратора`
              : 'Удаление уже отгруженного рейса доступно только администратору')
            : 'Нет доступа к удалению рейса',
        },
        { status: 403 },
      );
    }

    let actorName = typeof body?.userName === 'string' && body.userName.trim()
      ? body.userName.trim()
      : (auth.user.full_name || 'Сотрудник');
    let actorRole: string | null = auth.user.role;

    // ==================== ВОЗВРАТ ЦЕМЕНТА НА СИЛОС(Ы) ====================
    let cementReturnedKg: number | null = null;
    let cementReturnNote = '';
    if (
      cementSegments.length > 0
      || (mixer.cement_write_off_kg != null && mixer.cement_write_off_silo_id != null)
    ) {
      const refund = await refundAllCementWriteoffs({
        orderMixerId: id,
        orderId: Number(mixer.order_id),
        legacyKg: mixer.cement_write_off_kg,
        legacySiloId: mixer.cement_write_off_silo_id,
        actorName,
        journalKind: 'delete_return',
      });
      if (!refund.ok) {
        console.error('Не удалось вернуть цемент при удалении миксера:', refund.error);
        return NextResponse.json(
          { error: `Не удалось вернуть цемент на склад: ${refund.error}` },
          { status: 500 },
        );
      }
      if (refund.returnedKg > 0) {
        cementReturnedKg = refund.returnedKg;
        cementReturnNote = refund.bySilo.length === 1
          ? `; цемент ${refund.returnedKg} кг возвращён на ${siloNameById(refund.bySilo[0].siloId)}`
          : `; цемент ${refund.returnedKg} кг возвращён по силосам: ${
            refund.bySilo.map((s) => `${siloNameById(s.siloId)} ${s.kg} кг`).join(', ')
          }`;
      }
    }

    // ==================== ВОЗВРАТ ДОБАВКИ НА СКЛАД ====================
    // Тот же CAS-claim, чтобы повторный DELETE не начислил литры дважды.
    if (mixer.additive_write_off_liters != null && mixer.additive_write_off_id != null) {
      const additiveId = Number(mixer.additive_write_off_id);
      const liters = Number(mixer.additive_write_off_liters);

      const { data: claimedAdd, error: claimAddError } = await supabase
        .from('order_mixers')
        .update({
          additive_write_off_id: null,
          additive_write_off_liters: null,
        })
        .eq('id', id)
        .not('additive_write_off_liters', 'is', null)
        .select('id')
        .maybeSingle();

      if (claimAddError) {
        console.error('Не удалось снять метку списания добавки при удалении рейса:', claimAddError);
        return NextResponse.json(
          { error: `Не удалось подготовить возврат добавки: ${claimAddError.message}` },
          { status: 500 },
        );
      }

      if (claimedAdd) {
        const { error: rpcError } = await supabase.rpc('warehouse_additive_adjust', {
          p_additive_id: additiveId,
          p_delta_liters: liters,
        });
        if (rpcError) {
          await supabase
            .from('order_mixers')
            .update({
              additive_write_off_id: additiveId,
              additive_write_off_liters: liters,
            })
            .eq('id', id);
          console.error('Не удалось вернуть добавку на склад при удалении миксера:', rpcError);
          return NextResponse.json(
            { error: `Не удалось вернуть добавку на склад: ${rpcError.message}` },
            { status: 500 },
          );
        }
      }
    }

    // Лог «Отгружено сегодня» — иначе строка останется сиротой у оператора
    const { error: logDeleteError } = await supabase
      .from('production_logs')
      .delete()
      .eq('order_mixer_id', id);
    if (logDeleteError) {
      console.error('Не удалось удалить production_logs при удалении рейса:', logDeleteError);
    }

    const { error } = await supabase
      .from('order_mixers')
      .delete()
      .eq('id', id);

    if (error) throw error;

    const vol = Number(mixer.volume || 0);
    const volLabel = Number.isFinite(vol)
      ? vol.toFixed(2).replace(/\.?0+$/, '')
      : String(mixer.volume ?? '');
    const { error: historyError } = await supabase.from('order_history').insert({
      order_id: mixer.order_id,
      action: `Удалил рейс ${mixer.mixer_name || 'миксер'} (${volLabel} м³, статус «${mixerStatus}»)${cementReturnNote}`,
      user_name: actorName,
      user_role: actorRole,
    });
    if (historyError) console.error('Не удалось записать историю удаления рейса:', historyError);

    return NextResponse.json({
      success: true,
      cementReturnedKg,
    });
  } catch (error: any) {
    console.error('Delete mixer error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
