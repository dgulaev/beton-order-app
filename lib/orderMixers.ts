// lib/orderMixers.ts
// Общая логика смены статуса рейса миксера (order_mixers) — используется и
// диспетчерским API (/api/adminCifra/order-mixers/status), и водительским
// (/api/driver/trips/status), чтобы правила были одинаковыми независимо от
// того, кто меняет статус.
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';
import { OWN_UNLOAD_ALLOWANCE_MIN, ORDER_MIXER_STATUSES, type OrderMixerStatus } from '@/lib/mixerConfig';
import {
  findRecipeByGrade,
  calculateAdditiveUsage,
  densitiesFromLabSettings,
} from '@/lib/recipeAdditives';

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
  /**
   * ==================== ОПТИМИСТИЧНАЯ БЛОКИРОВКА ====================
   * Статус миксера, который вызывающая сторона считает текущим (тот, что она
   * видела на экране перед отправкой запроса). Если к моменту обработки в
   * БД статус уже другой — значит кто-то (оператор/диспетчер/водитель) успел
   * его сменить первым, и наше действие устарело. Раньше в этом случае
   * запрос просто тихо перезатирал чужое изменение (см. разбор гонки
   * "оператор жмёт Завершить, пока диспетчер вручную меняет статус" —
   * 18.07.2026); теперь вместо этого возвращается явный конфликт 409, и
   * вызывающая сторона должна обновить данные и решить, что делать дальше.
   * Необязателен — если не передан, всё равно действует атомарная проверка
   * на уровне самого UPDATE (см. ниже), просто без подробного сообщения.
   */
  expectedStatus?: string;
}

export interface UpdateOrderMixerStatusResult {
  httpStatus: number;
  body: {
    success: boolean;
    message: string;
    /** true — запрос отбит именно из-за гонки статусов (optimistic lock), а не из-за другой ошибки */
    conflict?: boolean;
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
  const { id, status, loading_started_at, podvizhnost, userName, userRole, timestampOverride, expectedStatus } = params;

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
  const rawStatus: string | null = mixer.status ?? null;
  const oldStatus = rawStatus || 'Загрузка';

  if (status && FINAL_ORDER_STATUSES.includes(orderStatus)) {
    return {
      httpStatus: 400,
      body: {
        success: false,
        message: `Заявка уже в финальном статусе "${STATUS_LABELS_RU[orderStatus] || orderStatus}" — изменение миксеров запрещено`,
      },
    };
  }

  // ==================== БЛОКИРОВКА НА ВРЕМЯ АКТИВНОЙ ЗАГРУЗКИ ====================
  // Пока оператор БСУ реально грузит миксер (статус "Загрузка" И запущен
  // таймер loading_started_at — то есть кнопка "Начать" уже нажата, а не
  // просто дефолтный статус свежеприкреплённого рейса), диспетчер/менеджер/
  // водитель не могут перепрыгнуть статус мимо него — например поставить
  // "Разгружен" рукой, пока оператор физически ещё сыплет цемент в барабан.
  // Разрешены только: "В пути" (естественный следующий шаг — то же самое,
  // что делает кнопка "Завершить загрузку" у оператора) и "Проблема"
  // (аварийная ситуация — авария/поломка миксера прямо во время загрузки
  // должна фиксироваться без каких-либо ограничений). Без этого правила
  // ручная смена статуса диспетчером тихо "перепрыгивала" через оператора и
  // приводила к гонке (см. разбор race condition — 18.07.2026).
  const LOADING_LOCK_EXEMPT_STATUSES = new Set(['В пути', 'Проблема']);
  const isActivelyLoading = oldStatus === 'Загрузка' && !!mixer.loading_started_at;

  if (isActivelyLoading && status && status !== 'Загрузка' && !LOADING_LOCK_EXEMPT_STATUSES.has(status)) {
    return {
      httpStatus: 400,
      body: {
        success: false,
        message: `Миксер сейчас грузится оператором БСУ (таймер запущен) — статус "${status}" поставить нельзя, пока рейс не перейдёт в "В пути". Доступно только "В пути" или "Проблема" (авария).`,
      },
    };
  }

  // ==================== ОПТИМИСТИЧНАЯ БЛОКИРОВКА: РАННЯЯ ПРОВЕРКА ====================
  // Явная проверка того, что ожидал вызывающий — даёт понятное сообщение
  // ДО каких-либо побочных эффектов (списание добавки, история). Атомарная
  // проверка при самом UPDATE (см. ниже) страхует и тех, кто expectedStatus
  // не передал, но там сообщение более общее.
  if (expectedStatus !== undefined && expectedStatus !== oldStatus) {
    return {
      httpStatus: 409,
      body: {
        success: false,
        conflict: true,
        message: `Статус миксера уже изменён кем-то другим — сейчас "${oldStatus}", а ожидался "${expectedStatus}". Обновите страницу и попробуйте снова.`,
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

  // ==================== АТОМАРНОЕ ПРИМЕНЕНИЕ ПЕРЕХОДА (OPTIMISTIC LOCK) ====================
  // UPDATE условен на статус, который мы только что прочитали (`rawStatus`).
  // Если между нашим SELECT и этим UPDATE статус успел смениться (гонка
  // оператор/диспетчер/водитель — см. разбор 18.07.2026), ни одна строка не
  // подойдёт под условие, supabase вернёт data: null, и мы отбиваем запрос
  // явным конфликтом — вместо того чтобы молча затереть чужое изменение.
  // Побочные эффекты (списание добавки, история, автозавершение заявки)
  // выполняются НИЖЕ, только после того, как переход уже гарантированно
  // применён — иначе при конфликте они бы всё равно успели сработать.
  let statusQuery = supabase.from('order_mixers').update(updateData).eq('id', id);
  statusQuery = rawStatus === null ? statusQuery.is('status', null) : statusQuery.eq('status', rawStatus);

  const { data: updatedMixer, error: updateError } = await statusQuery.select().maybeSingle();

  if (updateError) throw updateError;

  if (!updatedMixer) {
    const { data: freshMixer } = await supabase.from('order_mixers').select('status').eq('id', id).maybeSingle();
    return {
      httpStatus: 409,
      body: {
        success: false,
        conflict: true,
        message: `Не удалось обновить статус — миксер уже изменён кем-то другим (сейчас: "${
          freshMixer?.status || '—'
        }"). Обновите страницу и попробуйте снова.`,
      },
    };
  }

  // ==================== РЕАЛЬНОЕ СПИСАНИЕ ДОБАВКИ СО СКЛАДА ====================
  // Раньше добавки (ПФМ-НЛК / Линомикс ТипР) списывались пакетно раз в день
  // при загрузке отчёта MEKA — по значениям из отчёта (кг), но 1:1 из
  // литрового остатка склада, без перевода по плотности. Теперь списываем
  // сразу в момент разгрузки конкретного рейса, по реальной дозировке из
  // рецепта (recipes.additive/additive2), с переводом кг → литры по
  // плотности из lab_settings (настройки лаборатории; fallback 1.16 / 1.18).
  // Работает для ЛЮБОГО способа перевести миксер в "Разгружен" — оператор,
  // диспетчер, водитель, админ — все идут через эту функцию.
  //
  // Выполняется ПОСЛЕ атомарного UPDATE выше (переход уже подтверждён и
  // зафиксирован в БД), поэтому склад не трогаем, если статус на самом деле
  // не применился из-за гонки.
  //
  // Сумма списания сохраняется на самой строке order_mixers
  // (additive_write_off_*), чтобы при отмене/удалении рейса можно было
  // вернуть на склад ровно столько, сколько было списано, а не пересчитывать
  // по (возможно, уже изменившемуся) рецепту заново.
  const additivePatch: any = {};

  if (status === 'Разгружен' && oldStatus !== 'Разгружен' && mixer.additive_write_off_liters == null) {
    try {
      const { data: recipes } = await supabase
        .from('recipes')
        .select('code, name, type, cement, additive, additive2');

      // Плотность из настроек лаборатории; если колонок ещё нет — fallback в коде.
      let densities = densitiesFromLabSettings(null);
      try {
        const { data: labSettings, error: labError } = await supabase
          .from('lab_settings')
          .select('pfm_density_kg_per_l, linomix_density_kg_per_l')
          .eq('id', 1)
          .maybeSingle();
        if (!labError) densities = densitiesFromLabSettings(labSettings);
        else console.warn('lab_settings density columns unavailable, using defaults:', labError.message);
      } catch (labErr) {
        console.warn('Не удалось прочитать плотность добавок из lab_settings:', labErr);
      }

      const recipe = findRecipeByGrade(recipes || [], mixer.orders?.grade);
      const usage = calculateAdditiveUsage(recipe, Number(mixer.volume || 0), densities);

      if (usage) {
        const { error: rpcError } = await supabase.rpc('warehouse_additive_adjust', {
          p_additive_id: usage.additiveId,
          p_delta_liters: -usage.liters,
        });

        if (rpcError) {
          console.error('Не удалось списать добавку со склада (реальное время):', rpcError);
        } else {
          additivePatch.additive_write_off_id = usage.additiveId;
          additivePatch.additive_write_off_liters = usage.liters;
          additivePatch.additive_write_off_kg = usage.kg;
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
        additivePatch.additive_write_off_id = null;
        additivePatch.additive_write_off_liters = null;
        additivePatch.additive_write_off_kg = null;
      }
    } catch (err) {
      console.error('Ошибка возврата добавки на склад при откате статуса:', err);
    }
  }

  if (Object.keys(additivePatch).length > 0) {
    const { error: additiveUpdateError } = await supabase.from('order_mixers').update(additivePatch).eq('id', id);
    if (additiveUpdateError) console.error('Не удалось сохранить поля списания добавки:', additiveUpdateError);
  }

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
