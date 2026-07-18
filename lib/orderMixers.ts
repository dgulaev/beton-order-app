// lib/orderMixers.ts
// Общая логика смены статуса рейса миксера (order_mixers) — используется и
// диспетчерским API (/api/adminCifra/order-mixers/status), и водительским
// (/api/driver/trips/status), чтобы правила были одинаковыми независимо от
// того, кто меняет статус.
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { OWN_UNLOAD_ALLOWANCE_MIN, ORDER_MIXER_STATUSES, type OrderMixerStatus } from '@/lib/mixerConfig';
import { findRecipeByGrade, calculateAdditiveUsage } from '@/lib/recipeAdditives';

const FINAL_ORDER_STATUSES = ['completed', 'cancelled'];
const STATUS_LABELS_RU: Record<string, string> = {
  new: 'Новая',
  processing: 'В работе',
  completed: 'Выполнена',
  cancelled: 'Отменена',
};

// Небольшой допуск на погрешность округления объёма.
const VOLUME_EPSILON = 0.01;

/** Число без лишних нулей после запятой (7 вместо 7.00, 7.5 вместо 7.50). */
function formatVolume(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, '');
}

export function calculateDowntimeMinutes(
  onSiteAt: string | null | undefined,
  unloadedAt: string | null | undefined,
  allowanceMinutes: number
): number | null {
  if (!onSiteAt || !unloadedAt) return null;
  const minutesOnSite = (new Date(unloadedAt).getTime() - new Date(onSiteAt).getTime()) / 60000;
  if (minutesOnSite < 0) return null;
  return Math.max(0, Math.round(minutesOnSite - allowanceMinutes));
}

export interface UpdateOrderMixerStatusParams {
  id: number;
  status?: string;
  loading_started_at?: string;
  podvizhnost?: string;
  userName?: string;
  userRole?: string;
  /** Ограничить набор статусов, которые разрешено ставить (например, водителю — только 2 статуса) */
  allowedStatusesOverride?: readonly string[];
  /**
   * Переопределить временную метку для on_site_at / unloaded_at.
   * Используется при offline-синхронизации: водитель мог нажать кнопку без сети,
   * timestamp зафиксирован на устройстве и передаётся при повторной отправке.
   */
  timestampOverride?: string;
}

export interface UpdateOrderMixerStatusResult {
  httpStatus: number;
  body: {
    success: boolean;
    message: string;
    data?: {
      mixerId: number;
      status?: string;
      orderId: number;
      onSiteAt?: string | null;
      unloadedAt?: string | null;
      downtimeMinutes?: number | null;
    };
  };
}

/** Возвращает норму разгрузки в минутах для данного названия миксера (ищет в реестре mixers по номеру) */
export async function resolveUnloadAllowanceMinutes(mixerName: string | null | undefined): Promise<number> {
  if (!mixerName) return OWN_UNLOAD_ALLOWANCE_MIN;

  const { data } = await supabase
    .from('mixers')
    .select('type, unload_allowance_min')
    .eq('number', mixerName)
    .maybeSingle();

  if (!data) return OWN_UNLOAD_ALLOWANCE_MIN;
  if (data.type === 'rented' && data.unload_allowance_min) {
    return Number(data.unload_allowance_min);
  }
  return OWN_UNLOAD_ALLOWANCE_MIN;
}

export async function updateOrderMixerStatus(params: UpdateOrderMixerStatusParams): Promise<UpdateOrderMixerStatusResult> {
  const { id, status, loading_started_at, podvizhnost, userName, userRole, timestampOverride } = params;

  if (!id) {
    return { httpStatus: 400, body: { success: false, message: 'id обязателен' } };
  }

  const allowedStatuses = params.allowedStatusesOverride || ORDER_MIXER_STATUSES;
  if (status && !allowedStatuses.includes(status as OrderMixerStatus)) {
    return { httpStatus: 400, body: { success: false, message: 'Недопустимый статус' } };
  }

  const { data: mixer, error: fetchError } = await supabase
    .from('order_mixers')
    .select(`*, orders!inner(id, status, volume, grade)`)
    .eq('id', id)
    .single();

  if (fetchError || !mixer) {
    return { httpStatus: 404, body: { success: false, message: `Миксер #${id} не найден` } };
  }

  const orderId = mixer.order_id;
  const orderStatus = mixer.orders?.status;
  const orderVolume = Number(mixer.orders?.volume || 0);
  const oldStatus = mixer.status || 'Загрузка';

  if (status && FINAL_ORDER_STATUSES.includes(orderStatus)) {
    return {
      httpStatus: 400,
      body: {
        success: false,
        message: `Заявка уже в финальном статусе "${STATUS_LABELS_RU[orderStatus] || orderStatus}" — изменение миксеров запрещено`,
      },
    };
  }

  const updateData: any = { updated_at: new Date().toISOString() };
  // timestampOverride — фактическое время действия водителя (из offline-очереди)
  const now = (timestampOverride && !isNaN(Date.parse(timestampOverride)))
    ? timestampOverride
    : new Date().toISOString();

  if (status) updateData.status = status;
  if (status === 'Загрузка' && loading_started_at) {
    updateData.loading_started_at = loading_started_at;
  }
  if (podvizhnost !== undefined && podvizhnost !== null) {
    updateData.podvizhnost = podvizhnost;
  }

  // ==================== ФИКСАЦИЯ ФАКТИЧЕСКОГО ВРЕМЕНИ НА ОБЪЕКТЕ ====================
  // "На объекте" — начало простоя. "Разгружен" — конец простоя, отсюда считаем downtime.
  let downtimeMinutes: number | null = mixer.downtime_minutes ?? null;

  if (status === 'На объекте' && !mixer.on_site_at) {
    updateData.on_site_at = now;
  }

  if (status === 'Разгружен') {
    if (!mixer.unloaded_at) {
      updateData.unloaded_at = now;
    }
    const onSiteAt = mixer.on_site_at || updateData.on_site_at || null;
    const unloadedAt = updateData.unloaded_at || mixer.unloaded_at || now;

    if (onSiteAt) {
      const allowance = await resolveUnloadAllowanceMinutes(mixer.mixer_name);
      downtimeMinutes = calculateDowntimeMinutes(onSiteAt, unloadedAt, allowance);
      if (downtimeMinutes !== null) {
        updateData.downtime_minutes = downtimeMinutes;
      }
    }
  }

  // ==================== РЕАЛЬНОЕ СПИСАНИЕ ДОБАВКИ СО СКЛАДА ====================
  // Раньше добавки (ПФМ-НЛК / Линомикс ТипР) списывались пакетно раз в день
  // при загрузке отчёта MEKA — по значениям из отчёта (кг), но 1:1 из
  // литрового остатка склада, без перевода по плотности. Теперь списываем
  // сразу в момент разгрузки конкретного рейса, по реальной дозировке из
  // рецепта (recipes.additive/additive2), с переводом кг → литры по
  // плотности (1.16 для ПФМ-НЛК, 1.18 для Линомикса). Работает для ЛЮБОГО
  // способа перевести миксер в "Разгружен" — оператор, диспетчер, водитель,
  // админ — все идут через эту функцию.
  //
  // Сумма списания сохраняется на самой строке order_mixers
  // (additive_write_off_*), чтобы при отмене/удалении рейса можно было
  // вернуть на склад ровно столько, сколько было списано, а не пересчитывать
  // по (возможно, уже изменившемуся) рецепту заново.
  if (status === 'Разгружен' && oldStatus !== 'Разгружен' && mixer.additive_write_off_liters == null) {
    try {
      const { data: recipes } = await supabase
        .from('recipes')
        .select('code, name, type, cement, additive, additive2');

      const recipe = findRecipeByGrade(recipes || [], mixer.orders?.grade);
      const usage = calculateAdditiveUsage(recipe, Number(mixer.volume || 0));

      if (usage) {
        const { error: rpcError } = await supabase.rpc('warehouse_additive_adjust', {
          p_additive_id: usage.additiveId,
          p_delta_liters: -usage.liters,
        });

        if (rpcError) {
          console.error('Не удалось списать добавку со склада (реальное время):', rpcError);
        } else {
          updateData.additive_write_off_id = usage.additiveId;
          updateData.additive_write_off_liters = usage.liters;
          updateData.additive_write_off_kg = usage.kg;
        }
      }
    } catch (err) {
      // Проблема со списанием добавки не должна блокировать сам факт разгрузки миксера.
      console.error('Ошибка расчёта реального списания добавки:', err);
    }
  } else if (
    status &&
    status !== 'Разгружен' &&
    oldStatus === 'Разгружен' &&
    mixer.additive_write_off_liters != null
  ) {
    // Статус рейса откатили обратно (отмена/исправление) — возвращаем на
    // склад ровно то, что было списано за этот рейс.
    try {
      const { error: rpcError } = await supabase.rpc('warehouse_additive_adjust', {
        p_additive_id: mixer.additive_write_off_id,
        p_delta_liters: Number(mixer.additive_write_off_liters),
      });

      if (rpcError) {
        console.error('Не удалось вернуть добавку на склад при откате статуса:', rpcError);
      } else {
        updateData.additive_write_off_id = null;
        updateData.additive_write_off_liters = null;
        updateData.additive_write_off_kg = null;
      }
    } catch (err) {
      console.error('Ошибка возврата добавки на склад при откате статуса:', err);
    }
  }

  const { error: updateError } = await supabase
    .from('order_mixers')
    .update(updateData)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (updateError) throw updateError;

  // ==================== ИСТОРИЯ: СМЕНА СТАТУСА МИКСЕРА ====================
  const historyEntries: any[] = [];

  if (status && status !== oldStatus) {
    const mixerName = mixer.mixer_name || `Миксер #${id}`;
    historyEntries.push({
      order_id: orderId,
      action: `Изменил статус миксера ${mixerName} с "${oldStatus}" на "${status}"${
        status === 'Разгружен' && downtimeMinutes !== null ? ` — простой на объекте: ${downtimeMinutes} мин` : ''
      }`,
      user_name: userName || (userRole === 'driver' ? 'Водитель' : 'Диспетчер'),
      user_role: userRole || null,
    });
  }

  // ==================== ПРАВИЛО: авто-завершение заявки при полной разгрузке ====================
  if (status === 'Разгружен' && !FINAL_ORDER_STATUSES.includes(orderStatus)) {
    const { data: allMixersData } = await supabase.from('order_mixers').select('volume, status').eq('order_id', orderId);
    const allMixers = allMixersData || [];

    const totalDelivered = allMixers.reduce((sum: number, m: any) => sum + Number(m?.volume || 0), 0);
    const allUnloaded = allMixers.length > 0 && allMixers.every((m: any) => m?.status === 'Разгружен');

    if (allUnloaded && totalDelivered >= orderVolume - VOLUME_EPSILON) {
      const { error: completeError } = await supabase
        .from('orders')
        .update({ status: 'completed', logistics_ready: true, updated_at: new Date().toISOString() })
        .eq('id', orderId);

      if (!completeError) {
        historyEntries.push({
          order_id: orderId,
          action: `Автоматически изменил статус заявки с "В работе" на "Выполнена" (разгружено ${formatVolume(
            totalDelivered
          )} м³ из ${formatVolume(orderVolume)} м³)`,
          user_name: 'Система',
          user_role: 'system',
        });
      } else {
        console.error('Не удалось автоматически завершить заявку:', completeError);
      }
    }
  }

  if (historyEntries.length > 0) {
    const { error: historyError } = await supabase.from('order_history').insert(historyEntries);
    if (historyError) console.error('Ошибка записи истории при смене статуса миксера:', historyError);
  }

  return {
    httpStatus: 200,
    body: {
      success: true,
      message: `Статус миксера обновлён на "${status || '—'}"`,
      data: {
        mixerId: id,
        status,
        orderId,
        onSiteAt: updateData.on_site_at ?? mixer.on_site_at ?? null,
        unloadedAt: updateData.unloaded_at ?? mixer.unloaded_at ?? null,
        downtimeMinutes,
      },
    },
  };
}

export interface UpdateOrderMixerVolumeParams {
  id: number;
  volume: number;
  userName?: string;
  userRole?: string;
}

export interface UpdateOrderMixerVolumeResult {
  httpStatus: number;
  body: {
    success: boolean;
    message: string;
    data?: { mixerId: number; volume: number; orderId: number; orderCompleted?: boolean };
  };
}

/**
 * Правка объёма УЖЕ НАЗНАЧЕННОГО миксера — инструмент админа/диспетчера для
 * исправления ситуаций постфактум (см. заявку #589, 18.07.2026: заявку
 * закрыли по факту разгрузки 7 м³ = 7 м³, а через час диспетчер поправила
 * реальный объём заявки на 8 м³ — миксер физически привёз именно 8 м³,
 * просто изначально ошиблись при записи). В отличие от смены статуса или
 * добавления/удаления миксера, эта правка СПЕЦИАЛЬНО разрешена и на уже
 * "Выполненной"/"Отменённой" заявке — иначе такую задокументированную
 * задним числом неточность нечем было бы исправить.
 *
 * Если после правки сумма объёмов миксеров дотягивает до объёма ещё не
 * завершённой заявки (и все миксеры разгружены) — заявка автозавершается
 * тем же правилом, что и при смене статуса на "Разгружен" (см. выше).
 */
export async function updateOrderMixerVolume(params: UpdateOrderMixerVolumeParams): Promise<UpdateOrderMixerVolumeResult> {
  const { id, userName, userRole } = params;
  const volume = Number(params.volume);

  if (!id) {
    return { httpStatus: 400, body: { success: false, message: 'id обязателен' } };
  }
  if (!Number.isFinite(volume) || volume <= 0) {
    return { httpStatus: 400, body: { success: false, message: 'Некорректный объём' } };
  }

  const { data: mixer, error: fetchError } = await supabase
    .from('order_mixers')
    .select(`*, orders!inner(id, status, volume)`)
    .eq('id', id)
    .single();

  if (fetchError || !mixer) {
    return { httpStatus: 404, body: { success: false, message: `Миксер #${id} не найден` } };
  }

  const orderId = mixer.order_id;
  const orderStatus = mixer.orders?.status;
  const orderVolume = Number(mixer.orders?.volume || 0);
  const oldVolume = Number(mixer.volume || 0);

  if (Math.abs(volume - oldVolume) < VOLUME_EPSILON) {
    return {
      httpStatus: 200,
      body: { success: true, message: 'Объём не изменился', data: { mixerId: id, volume: oldVolume, orderId } },
    };
  }

  const { error: updateError } = await supabase
    .from('order_mixers')
    .update({ volume, updated_at: new Date().toISOString() })
    .eq('id', id);

  if (updateError) throw updateError;

  // ==================== СИНХРОНИЗАЦИЯ СО СНИМКОМ В production_logs ====================
  // Лента "Отгружено сегодня" у оператора БСУ и складские отчёты берут объём
  // рейса из production_logs.volume — это отдельная копия, записанная в
  // момент нажатия кнопки "Загружен" (см. /api/adminCifra/production-log),
  // а НЕ живая ссылка на order_mixers.volume. Без этой синхронизации правка
  // объёма диспетчером была бы не видна в ленте оператора и в отчётах.
  const { error: logSyncError } = await supabase
    .from('production_logs')
    .update({ volume })
    .eq('order_mixer_id', id);

  if (logSyncError) {
    console.error('Не удалось синхронизировать объём в production_logs:', logSyncError);
  }

  const mixerName = mixer.mixer_name || `Миксер #${id}`;
  const historyEntries: any[] = [
    {
      order_id: orderId,
      action: `Изменил объём миксера ${mixerName} с ${formatVolume(oldVolume)} на ${formatVolume(volume)} м³`,
      user_name: userName || 'Диспетчер',
      user_role: userRole || null,
    },
  ];

  let orderCompleted = false;

  // ==================== ТО ЖЕ ПРАВИЛО АВТОЗАВЕРШЕНИЯ, НО ОТ ПРАВКИ ОБЪЁМА ====================
  if (!FINAL_ORDER_STATUSES.includes(orderStatus)) {
    const { data: allMixersData } = await supabase.from('order_mixers').select('volume, status').eq('order_id', orderId);
    const allMixers = allMixersData || [];

    const totalDelivered = allMixers.reduce((sum: number, m: any) => sum + Number(m?.volume || 0), 0);
    const allUnloaded = allMixers.length > 0 && allMixers.every((m: any) => m?.status === 'Разгружен');

    if (allUnloaded && totalDelivered >= orderVolume - VOLUME_EPSILON) {
      const { error: completeError } = await supabase
        .from('orders')
        .update({ status: 'completed', logistics_ready: true, updated_at: new Date().toISOString() })
        .eq('id', orderId);

      if (!completeError) {
        orderCompleted = true;
        historyEntries.push({
          order_id: orderId,
          action: `Автоматически изменил статус заявки с "В работе" на "Выполнена" (разгружено ${formatVolume(
            totalDelivered
          )} м³ из ${formatVolume(orderVolume)} м³)`,
          user_name: 'Система',
          user_role: 'system',
        });
      } else {
        console.error('Не удалось автоматически завершить заявку после правки объёма миксера:', completeError);
      }
    }
  }

  const { error: historyError } = await supabase.from('order_history').insert(historyEntries);
  if (historyError) console.error('Ошибка записи истории при правке объёма миксера:', historyError);

  return {
    httpStatus: 200,
    body: {
      success: true,
      message: `Объём миксера обновлён на ${formatVolume(volume)} м³`,
      data: { mixerId: id, volume, orderId, orderCompleted },
    },
  };
}
