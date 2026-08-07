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
  calculateCementUsageKg,
  densitiesFromLabSettings,
} from '@/lib/recipeAdditives';
import {
  formatSiloCementJournalActor,
  siloNameById,
  syncSiloLowRateAlert,
} from '@/lib/siloConfig';
import {
  hasFinalCementSegment,
  listCementSegments,
  refundAllCementWriteoffs,
  sumSegmentVolumeM3,
  writeCementSegment,
} from '@/lib/cementSegments';
import { maybeRetrySkippedMekaCompensation } from '@/lib/mekaCementCompensate';
import { getFreshActiveSiloId } from '@/lib/operatorShiftSilo';
import { isPickupOrder } from '@/lib/logisticsPlanner';
import { applyFleetTariffOnUnload } from '@/lib/fleetTripTariff';

const FINAL_ORDER_STATUSES = ['completed', 'cancelled'];
const STATUS_LABELS_RU: Record<string, string> = {
  new: 'Новая',
  processing: 'В работе',
  completed: 'Выполнена',
  cancelled: 'Отменена',
};

// Небольшой допуск на погрешность округления объёма.
const VOLUME_EPSILON = 0.01;

/**
 * Самовывоз: после выдачи бетона сразу «Разгружен» (не цикл «В пути» → объект).
 * В факт простоя пишем фиксированные 5 мин (выдача / отъезд клиента).
 */
export const PICKUP_STATUS_DELAY_MIN = 5;

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
  /** Админ может менять рейсы даже на финальной заявке. */
  allowAdminFinalOverride?: boolean;
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

async function ownUnloadAllowanceFromSettings(): Promise<number> {
  try {
    const { loadSystemSettingsServer } = await import('@/lib/systemSettingsServer');
    const s = await loadSystemSettingsServer();
    const n = Number(s.logistics?.ownUnloadAllowanceMin);
    return Number.isFinite(n) && n > 0 ? n : OWN_UNLOAD_ALLOWANCE_MIN;
  } catch {
    return OWN_UNLOAD_ALLOWANCE_MIN;
  }
}

/** Возвращает норму разгрузки в минутах для данного названия миксера (ищет в реестре mixers по номеру) */
export async function resolveUnloadAllowanceMinutes(mixerName: string | null | undefined): Promise<number> {
  const ownDefault = await ownUnloadAllowanceFromSettings();
  if (!mixerName) return ownDefault;

  const { data } = await supabase
    .from('mixers')
    .select('type, unload_allowance_min')
    .eq('number', mixerName)
    .maybeSingle();

  if (!data) return ownDefault;
  if (data.type === 'rented' && data.unload_allowance_min) {
    return Number(data.unload_allowance_min);
  }
  return ownDefault;
}

export async function updateOrderMixerStatus(params: UpdateOrderMixerStatusParams): Promise<UpdateOrderMixerStatusResult> {
  const {
    id,
    status,
    loading_started_at,
    podvizhnost,
    userName,
    userRole,
    timestampOverride,
    expectedStatus,
    allowAdminFinalOverride,
  } = params;

  if (!id) {
    return { httpStatus: 400, body: { success: false, message: 'id обязателен' } };
  }

  const allowedStatuses = params.allowedStatusesOverride || ORDER_MIXER_STATUSES;
  if (status && !allowedStatuses.includes(status as OrderMixerStatus)) {
    return { httpStatus: 400, body: { success: false, message: 'Недопустимый статус' } };
  }

  const { data: mixer, error: fetchError } = await supabase
    .from('order_mixers')
    .select(`*, orders!inner(id, status, volume, grade, address, delivery_date)`)
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
  const isPickup = isPickupOrder((mixer.orders as { address?: string | null } | null)?.address);

  // Самовывоз: «В пути» не используем — бетон отдан клиенту → сразу «Разгружен».
  let effectiveStatus = status;
  if (isPickup && effectiveStatus === 'В пути') {
    effectiveStatus = 'Разгружен';
  }

  // Старт таймера оператора: статус уже «Загрузка» (дефолт очереди), но
  // loading_started_at ещё null. Нельзя short-circuit'ить — иначе таймер
  // живёт только в React-state и пропадает после reload страницы.
  const startingLoadTimer =
    status === 'Загрузка'
    && !!loading_started_at
    && !mixer.loading_started_at;

  // Идемпотентность: повтор «В пути»/тот же статус (двойной клик, auto-heal,
  // retry после таймаута) — успех, не 409 «конфликт с диспетчером».
  // Исключение: startingLoadTimer — идём дальше и пишем loading_started_at.
  if (effectiveStatus && oldStatus === effectiveStatus && !startingLoadTimer) {
    return {
      httpStatus: 200,
      body: {
        success: true,
        message: `Статус уже «${effectiveStatus}»`,
        data: {
          mixerId: id,
          status: effectiveStatus,
          orderId,
          onSiteAt: mixer.on_site_at ?? null,
          unloadedAt: mixer.unloaded_at ?? null,
          downtimeMinutes: mixer.downtime_minutes ?? null,
        },
      },
    };
  }

  // Админ может править рейсы и на финальной заявке (после ошибочного статуса).
  if (
    effectiveStatus
    && FINAL_ORDER_STATUSES.includes(orderStatus)
    && !allowAdminFinalOverride
  ) {
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
  // Самовывоз: после «Загружен» сразу «Разгружен» — тоже exempt.
  const LOADING_LOCK_EXEMPT_STATUSES = new Set(
    isPickup ? ['В пути', 'Разгружен', 'Проблема'] : ['В пути', 'Проблема'],
  );
  const isActivelyLoading = oldStatus === 'Загрузка' && !!mixer.loading_started_at;

  if (
    isActivelyLoading
    && effectiveStatus
    && effectiveStatus !== 'Загрузка'
    && !LOADING_LOCK_EXEMPT_STATUSES.has(effectiveStatus)
  ) {
    return {
      httpStatus: 400,
      body: {
        success: false,
        message: `Миксер сейчас грузится оператором БСУ (таймер запущен) — статус "${effectiveStatus}" поставить нельзя, пока рейс не перейдёт в "В пути". Доступно только "В пути" или "Проблема" (авария).`,
      },
    };
  }

  // ==================== РАБОЧИЙ СИЛОС: СТАРТ ЗАГРУЗКИ И «В ПУТИ» ====================
  // Берём только «свежий» силос за сегодня МСК — иначе UI мог показывать вчерашний,
  // а в БД id ещё лежал до ближайшего GET (ложный блок «силос выбран, а Начать нет»).
  if (startingLoadTimer) {
    const siloForLoad = await getFreshActiveSiloId();
    if (siloForLoad == null) {
      return {
        httpStatus: 409,
        body: {
          success: false,
          message:
            'Сначала выбери рабочий силос на смене (на сегодня) — без него нельзя начинать загрузку. '
            + 'Нажми силос 1/2/3 сверху и повтори «Начать».',
        },
      };
    }
  }

  const CEMENT_LOADED_STATUSES_GUARD = new Set(['В пути', 'На объекте', 'Разгружен', 'Возврат']);
  if (
    effectiveStatus
    && CEMENT_LOADED_STATUSES_GUARD.has(effectiveStatus)
    && oldStatus === 'Загрузка'
  ) {
    const segsBeforeLeave = await listCementSegments(id);
    const alreadyFinal = hasFinalCementSegment(segsBeforeLeave);
    if (!alreadyFinal) {
      const siloGuard = await getFreshActiveSiloId();
      if (siloGuard == null) {
        const usedM3 = sumSegmentVolumeM3(segsBeforeLeave);
        const tripVol = Number(mixer.volume || 0);
        const remainingM3 = Math.round((tripVol - usedM3) * 1000) / 1000;
        if (segsBeforeLeave.length > 0 && remainingM3 > VOLUME_EPSILON) {
          return {
            httpStatus: 409,
            body: {
              success: false,
              message:
                `Уже списано ${usedM3} м³ с предыдущего силоса (смена силоса), `
                + `остаток ${remainingM3} м³ некуда списать — рабочий силос не выбран на сегодня. `
                + 'Выбери силос 1/2/3 сверху, затем снова «В пути».',
            },
          };
        }
        if (segsBeforeLeave.length === 0 && mixer.cement_write_off_kg == null) {
          return {
            httpStatus: 409,
            body: {
              success: false,
              message:
                'Рабочий силос не выбран на сегодня — цемент при «В пути» не спишется. '
                + 'Выбери силос 1/2/3 сверху и повтори.',
            },
          };
        }
      }
    }
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

  if (effectiveStatus) updateData.status = effectiveStatus;
  if (effectiveStatus === 'Загрузка' && loading_started_at) {
    updateData.loading_started_at = loading_started_at;
  }
  if (podvizhnost !== undefined && podvizhnost !== null) {
    updateData.podvizhnost = podvizhnost;
  }

  // ==================== ФИКСАЦИЯ ФАКТИЧЕСКОГО ВРЕМЕНИ НА ОБЪЕКТЕ ====================
  // "На объекте" — начало простоя. "Разгружен" — конец простоя, отсюда считаем downtime.
  let downtimeMinutes: number | null = mixer.downtime_minutes ?? null;

  if (effectiveStatus === 'На объекте' && !mixer.on_site_at) {
    updateData.on_site_at = now;
  }

  if (effectiveStatus === 'Разгружен') {
    if (isPickup && !mixer.on_site_at && !mixer.unloaded_at) {
      // Самовывоз: фиксируем выдачу с задержкой статуса 5 мин (on_site → unloaded).
      const unloadedMs = Date.parse(now);
      const onSiteMs = unloadedMs - PICKUP_STATUS_DELAY_MIN * 60 * 1000;
      updateData.on_site_at = new Date(onSiteMs).toISOString();
      updateData.unloaded_at = new Date(unloadedMs).toISOString();
      downtimeMinutes = 0;
      updateData.downtime_minutes = 0;
    } else {
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
    const { data: freshMixer } = await supabase
      .from('order_mixers')
      .select('status, on_site_at, unloaded_at, downtime_minutes')
      .eq('id', id)
      .maybeSingle();
    const freshStatus = freshMixer?.status || '—';
    // Параллельный запрос (оператор + auto-heal / retry) уже поставил нужный
    // статус — для вызывающего это успех, не конфликт с диспетчером.
    if (effectiveStatus && freshStatus === effectiveStatus) {
      return {
        httpStatus: 200,
        body: {
          success: true,
          message: `Статус уже «${effectiveStatus}»`,
          data: {
            mixerId: id,
            status: effectiveStatus,
            orderId,
            onSiteAt: freshMixer?.on_site_at ?? null,
            unloadedAt: freshMixer?.unloaded_at ?? null,
            downtimeMinutes: freshMixer?.downtime_minutes ?? null,
          },
        },
      };
    }
    return {
      httpStatus: 409,
      body: {
        success: false,
        conflict: true,
        message: `Не удалось обновить статус — миксер уже изменён кем-то другим (сейчас: "${freshStatus}"). Обновите страницу и попробуйте снова.`,
      },
    };
  }

  // Фаза 3: тариф non-mixer (самосвал/тонара/…) в order_mixers при закрытии рейса
  if (effectiveStatus === 'Разгружен' && oldStatus !== 'Разгружен') {
    void applyFleetTariffOnUnload({
      orderMixerId: id,
      mixerName: mixer.mixer_name,
      previousStatus: oldStatus,
      newStatus: effectiveStatus,
    });
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

  if (effectiveStatus === 'Разгружен' && oldStatus !== 'Разгружен' && mixer.additive_write_off_liters == null) {
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
    effectiveStatus &&
    effectiveStatus !== 'Разгружен' &&
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

  // ==================== РЕАЛЬНОЕ СПИСАНИЕ ЦЕМЕНТА С СИЛОСА ====================
  // Цемент списываем в момент «загружен» (= бетон уже в миксере), а не на
  // «Разгружен». При смене силоса mid-load-сегменты уже могли списаться раньше —
  // здесь пишем только остаток (final) или весь объём, если сегментов не было.
  //
  // Силос — operator_shift_settings.active_silo_id. Не выбран — пропускаем.
  const CEMENT_LOADED_STATUSES = new Set(['В пути', 'На объекте', 'Разгружен', 'Возврат']);
  let cementSegmentsForTrip = await listCementSegments(id);
  const cementAlreadyFinal = hasFinalCementSegment(cementSegmentsForTrip);
  const tripVolumeM3 = Number(mixer.volume || 0);
  const cementUsedM3 = sumSegmentVolumeM3(cementSegmentsForTrip);
  const cementRemainingM3 = Math.round((tripVolumeM3 - cementUsedM3) * 1000) / 1000;
  // Идемпотентность:
  // — mid_load уже есть → списываем только остаток (если > 0);
  // — сегментов нет → как раньше: только если cement_write_off_kg ещё null.
  const enteringLoadedForCement =
    !!effectiveStatus
    && CEMENT_LOADED_STATUSES.has(effectiveStatus)
    && !cementAlreadyFinal
    && (
      (cementSegmentsForTrip.length > 0 && cementRemainingM3 > VOLUME_EPSILON)
      || (cementSegmentsForTrip.length === 0 && mixer.cement_write_off_kg == null)
    );
  const rollingBackToLoading =
    !!effectiveStatus && effectiveStatus === 'Загрузка' && oldStatus !== 'Загрузка'
    && (
      cementSegmentsForTrip.length > 0
      || (mixer.cement_write_off_kg != null && mixer.cement_write_off_silo_id != null)
    );

  if (enteringLoadedForCement) {
    try {
      const { data: shift } = await supabase
        .from('operator_shift_settings')
        .select('active_operator_name')
        .eq('id', 1)
        .maybeSingle();

      const siloId = await getFreshActiveSiloId();
      const shiftOperatorName =
        typeof shift?.active_operator_name === 'string' ? shift.active_operator_name : null;
      if (siloId == null) {
        // Опасно при mid_load: часть уже списана, остаток «зависнет»
        // (в норме сюда не доходим — guard выше блокирует «В пути»)
        console.warn(
          `Рейс #${id}: силос не выбран — финальное списание цемента пропущено`
          + (cementSegmentsForTrip.length > 0
            ? ` (уже учтено mid_load ${cementUsedM3} м³, остаток ${cementRemainingM3} м³ не списан)`
            : ''),
        );
      } else {
        // Перечитываем сегменты — mid_load мог появиться параллельно
        cementSegmentsForTrip = await listCementSegments(id);
        if (hasFinalCementSegment(cementSegmentsForTrip)) {
          // уже закрыто
        } else {
          const usedM3 = sumSegmentVolumeM3(cementSegmentsForTrip);
          const remainingM3 = Math.round((tripVolumeM3 - usedM3) * 1000) / 1000;
          if (remainingM3 > VOLUME_EPSILON) {
            const result = await writeCementSegment({
              orderMixerId: id,
              orderId: Number(orderId),
              siloId,
              volumeM3: remainingM3,
              tripVolumeM3,
              grade: mixer.orders?.grade,
              kind: 'final',
              operatorName: shiftOperatorName,
              actorName: userName || (userRole === 'driver' ? 'Водитель' : 'Диспетчер'),
            });
            if (!result.ok) {
              // Fallback: таблица сегментов ещё не применена — legacy одним куском
              if (
                cementSegmentsForTrip.length === 0
                && mixer.cement_write_off_kg == null
                && String(result.error || '').includes('сегментов ещё не применена')
              ) {
                const { data: recipes } = await supabase
                  .from('recipes')
                  .select('code, name, type, cement, additive, additive2');
                const recipe = findRecipeByGrade(recipes || [], mixer.orders?.grade);
                const kg = calculateCementUsageKg(recipe, tripVolumeM3);
                if (kg > 0) {
                  const tons = kg / 1000;
                  const { data: adjRows, error: rpcError } = await supabase.rpc('warehouse_silo_adjust', {
                    p_silo_id: siloId,
                    p_delta_tons: -tons,
                  });
                  if (!rpcError) {
                    const writtenKg = Math.round(kg * 10) / 10;
                    const { data: patched, error: patchError } = await supabase
                      .from('order_mixers')
                      .update({
                        cement_write_off_silo_id: siloId,
                        cement_write_off_kg: writtenKg,
                        cement_write_off_at: now,
                      })
                      .eq('id', id)
                      .is('cement_write_off_kg', null)
                      .select('id')
                      .maybeSingle();
                    if (patchError || !patched) {
                      await supabase.rpc('warehouse_silo_adjust', {
                        p_silo_id: siloId,
                        p_delta_tons: tons,
                      });
                    } else {
                      const adj = Array.isArray(adjRows) ? adjRows[0] : adjRows;
                      const oldKg = Number(adj?.old_current ?? 0) * 1000;
                      const newKg = Number(adj?.new_current ?? 0) * 1000;
                      await supabase.from('warehouse_operations').insert({
                        operation_type: 'subtract',
                        item_type: siloNameById(siloId),
                        amount: writtenKg,
                        old_value: Math.round(oldKg * 10) / 10,
                        new_value: Math.round(newKg * 10) / 10,
                        unit: 'кг',
                        user_name: formatSiloCementJournalActor({
                          kind: 'auto_writeoff',
                          orderId: Number(orderId),
                          operatorName: shiftOperatorName,
                          actorName: userName || (userRole === 'driver' ? 'Водитель' : 'Диспетчер'),
                        }),
                      });
                      await syncSiloLowRateAlert(supabase, siloId);
                      void maybeRetrySkippedMekaCompensation({ atIso: now }).catch((err) => {
                        console.error('maybeRetrySkippedMekaCompensation after legacy writeoff:', err);
                      });
                    }
                  }
                }
              } else {
                console.error(`Рейс #${id}: финальное списание цемента:`, result.error);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error('Ошибка списания цемента со склада:', err);
    }
  } else if (rollingBackToLoading) {
    // Откат только в «Загрузка» — цемент ещё не должен был уйти с завода.
    try {
      let rollbackOperatorName: string | null = null;
      try {
        const { data: shiftRow } = await supabase
          .from('operator_shift_settings')
          .select('active_operator_name')
          .eq('id', 1)
          .maybeSingle();
        rollbackOperatorName =
          typeof shiftRow?.active_operator_name === 'string'
            ? shiftRow.active_operator_name
            : null;
      } catch {
        // имя смены необязательно
      }

      const refund = await refundAllCementWriteoffs({
        orderMixerId: id,
        orderId: Number(orderId),
        legacyKg: mixer.cement_write_off_kg,
        legacySiloId: mixer.cement_write_off_silo_id,
        operatorName: rollbackOperatorName,
        actorName: userName || (userRole === 'driver' ? 'Водитель' : 'Диспетчер'),
        journalKind: 'rollback',
      });
      if (!refund.ok) {
        console.error('Не удалось вернуть цемент при откате статуса:', refund.error);
      }
    } catch (err) {
      console.error('Ошибка возврата цемента на склад при откате статуса:', err);
    }
  }

  // ==================== ИСТОРИЯ: СМЕНА СТАТУСА МИКСЕРА ====================
  const historyEntries: any[] = [];

  if (effectiveStatus && effectiveStatus !== oldStatus) {
    const mixerName = mixer.mixer_name || `Миксер #${id}`;
    const pickupNote =
      isPickup && effectiveStatus === 'Разгружен'
        ? ` — самовывоз, сразу Разгружен (задержка ${PICKUP_STATUS_DELAY_MIN} мин)`
        : '';
    historyEntries.push({
      order_id: orderId,
      action: `Изменил статус миксера ${mixerName} с "${oldStatus}" на "${effectiveStatus}"${
        effectiveStatus === 'Разгружен' && downtimeMinutes !== null && !isPickup
          ? ` — простой на объекте: ${downtimeMinutes} мин`
          : ''
      }${pickupNote}`,
      user_name: userName || (userRole === 'driver' ? 'Водитель' : 'Диспетчер'),
      user_role: userRole || null,
    });
  }

  // ==================== ПРАВИЛО: авто-завершение заявки при полной разгрузке ====================
  if (effectiveStatus === 'Разгружен' && !FINAL_ORDER_STATUSES.includes(orderStatus)) {
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
        try {
          const { pruneGhostTripsFromLogisticsPlan } = await import(
            '@/lib/pruneLogisticsPlanGhosts'
          );
          await pruneGhostTripsFromLogisticsPlan({
            supabase,
            orderIds: [orderId],
            deliveryDate: (mixer.orders as { delivery_date?: string } | null)?.delivery_date,
            actorName: 'Система',
          });
        } catch (e) {
          console.warn('pruneGhostTrips after auto-complete:', e);
        }
      } else {
        console.error('Не удалось автоматически завершить заявку:', completeError);
      }
    }
  }

  // Лид: авто «Исполнен», если суммарная отгрузка по всем заявкам ≥ плана лида
  if (effectiveStatus && effectiveStatus !== oldStatus && orderId) {
    try {
      const { maybeAutoFulfillLeadByOrderId } = await import('@/lib/leadShipments');
      await maybeAutoFulfillLeadByOrderId(Number(orderId));
    } catch (e) {
      console.error('maybeAutoFulfillLeadByOrderId:', e);
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
      message: `Статус миксера обновлён на "${effectiveStatus || '—'}"`,
      data: {
        mixerId: id,
        status: effectiveStatus,
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
    .select(`*, orders!inner(id, status, volume, delivery_date)`)
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

  // Нельзя уменьшить объём ниже уже списанных mid_load-сегментов
  const cementSegs = await listCementSegments(id);
  const cementUsedM3 = sumSegmentVolumeM3(cementSegs);
  if (cementSegs.length > 0 && volume + VOLUME_EPSILON < cementUsedM3) {
    return {
      httpStatus: 409,
      body: {
        success: false,
        message: `Уже списано ${formatVolume(cementUsedM3)} м³ по силосам (смена силоса). `
          + `Новый объём рейса не может быть меньше`,
      },
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
        try {
          const { pruneGhostTripsFromLogisticsPlan } = await import(
            '@/lib/pruneLogisticsPlanGhosts'
          );
          await pruneGhostTripsFromLogisticsPlan({
            supabase,
            orderIds: [orderId],
            deliveryDate: (mixer.orders as { delivery_date?: string } | null)?.delivery_date,
            actorName: 'Система',
          });
        } catch (e) {
          console.warn('pruneGhostTrips after volume auto-complete:', e);
        }
      } else {
        console.error('Не удалось автоматически завершить заявку после правки объёма миксера:', completeError);
      }
    }
  }

  const { error: historyError } = await supabase.from('order_history').insert(historyEntries);
  if (historyError) console.error('Ошибка записи истории при правке объёма миксера:', historyError);

  // Правка объёма тоже может дотянуть план лида до закрытия
  if (orderId) {
    try {
      const { maybeAutoFulfillLeadByOrderId } = await import('@/lib/leadShipments');
      await maybeAutoFulfillLeadByOrderId(Number(orderId));
    } catch (e) {
      console.error('maybeAutoFulfillLeadByOrderId after volume edit:', e);
    }
  }

  return {
    httpStatus: 200,
    body: {
      success: true,
      message: `Объём миксера обновлён на ${formatVolume(volume)} м³`,
      data: { mixerId: id, volume, orderId, orderCompleted },
    },
  };
}
