import { NextRequest, NextResponse } from 'next/server';
import { ORDER_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { pruneGhostTripsFromLogisticsPlan } from '@/lib/pruneLogisticsPlanGhosts';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

const FINAL_STATUSES = ['completed', 'cancelled'];
const LOADED_STATUSES = ['В пути', 'На объекте', 'Разгружен', 'Возврат', 'Проблема'];
const STATUS_LABELS_RU: Record<string, string> = {
  new: 'Новая',
  processing: 'В работе',
  completed: 'Выполнена',
  cancelled: 'Отменена',
};

type ApplyTripIn = {
  orderId?: number | string;
  mixerName?: string;
  volume?: number | string;
  time?: string;
  sortOrder?: number;
  /** Id рейса плана интеллекта — для жёсткой 1:1 связки */
  planTripId?: string;
};

function toDbTime(raw: string): string | null {
  const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function volLabel(volume: number): string {
  return volume.toFixed(2).replace(/\.?0+$/, '');
}

function isProtectedMixer(row: {
  status?: string | null;
  loading_started_at?: string | null;
  cement_write_off_kg?: number | null;
  additive_write_off_liters?: number | null;
}): boolean {
  const status = String(row.status || 'Загрузка');
  if (LOADED_STATUSES.includes(status)) return true;
  if (status === 'Загрузка' && row.loading_started_at) return true;
  if (row.cement_write_off_kg != null) return true;
  if (row.additive_write_off_liters != null) return true;
  return false;
}

/**
 * POST — применить плановые рейсы интеллекта в order_mixers.
 * По умолчанию (overwriteManual ≠ true): заявки с ручными «Загрузка»
 * (ещё не на пульте) пропускаем — не конфликтуем с работой диспетчера.
 * При overwriteManual: удаляем незащищённые «Загрузка», вставляем план;
 * выехавшие / начатые на пульте не трогаем в любом режиме.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const rawTrips: ApplyTripIn[] = Array.isArray(body?.trips) ? body.trips : [];
    /** false по умолчанию: не затираем ручные назначения диспетчера. */
    const overwriteManual = body?.overwriteManual === true;
    const actorName =
      typeof body?.userName === 'string' && body.userName.trim()
        ? body.userName.trim()
        : auth.user.full_name || 'Диспетчер';
    const actorRole = auth.user.role;

    if (rawTrips.length === 0) {
      return NextResponse.json({ error: 'Нет рейсов для применения' }, { status: 400 });
    }

    type NormTrip = {
      orderId: number;
      mixerName: string;
      volume: number;
      time: string;
      sortOrder: number;
      planTripId: string | null;
    };

    const byOrder = new Map<number, NormTrip[]>();
    for (let i = 0; i < rawTrips.length; i++) {
      const t = rawTrips[i];
      const orderId = Number(t.orderId);
      const mixerName = String(t.mixerName || '').trim();
      const volume = Number(t.volume);
      const time = toDbTime(String(t.time || ''));
      if (!Number.isFinite(orderId) || orderId <= 0) continue;
      if (!mixerName || mixerName === 'самовывоз' || /^pickup$/i.test(mixerName)) continue;
      if (!Number.isFinite(volume) || volume <= 0) continue;
      if (!time) continue;
      const list = byOrder.get(orderId) || [];
      list.push({
        orderId,
        mixerName,
        volume,
        time,
        sortOrder: Number.isFinite(Number(t.sortOrder)) ? Number(t.sortOrder) : i,
        planTripId: t.planTripId ? String(t.planTripId) : null,
      });
      byOrder.set(orderId, list);
    }

    if (byOrder.size === 0) {
      return NextResponse.json(
        { error: 'Нет валидных рейсов (самовывоз и пустые строки отброшены)' },
        { status: 400 },
      );
    }

    const results: Array<{
      orderId: number;
      deleted: number;
      inserted: number;
      kept: number;
      skipped?: string;
      newOrderStatus?: string | null;
      /** delete прошёл, insert нет — заявка могла остаться без рейсов */
      insertFailedAfterDelete?: boolean;
    }> = [];
    /** Жёсткая 1:1: planTripId → order_mixers.id */
    const links: Array<{ planTripId: string; orderMixerId: number }> = [];

    for (const [orderId, planTrips] of byOrder) {
      const { data: order, error: orderErr } = await supabase
        .from('orders')
        .select('id, status, is_questionable')
        .eq('id', orderId)
        .maybeSingle();

      if (orderErr || !order) {
        results.push({
          orderId,
          deleted: 0,
          inserted: 0,
          kept: 0,
          skipped: 'Заявка не найдена',
        });
        continue;
      }

      if (FINAL_STATUSES.includes(String(order.status))) {
        results.push({
          orderId,
          deleted: 0,
          inserted: 0,
          kept: 0,
          skipped: `Финальный статус «${STATUS_LABELS_RU[order.status] || order.status}»`,
        });
        continue;
      }

      const { data: existing, error: existErr } = await supabase
        .from('order_mixers')
        .select(
          'id, mixer_name, status, loading_started_at, cement_write_off_kg, additive_write_off_liters, sort_order, time, volume',
        )
        .eq('order_id', orderId);

      if (existErr) {
        results.push({
          orderId,
          deleted: 0,
          inserted: 0,
          kept: 0,
          skipped: existErr.message,
        });
        continue;
      }

      const rows = existing || [];
      const protectedRows = rows.filter((r) => isProtectedMixer(r));
      const manualEditable = rows.filter((r) => !isProtectedMixer(r));
      const editableIds = manualEditable.map((r) => r.id);

      // Ручные «Загрузка» диспетчера: по умолчанию заявку не трогаем.
      if (!overwriteManual && manualEditable.length > 0) {
        // 1:1 всё равно проставим по совпадению номера (без записи в БД).
        const usedIds = new Set<number>();
        for (const t of [...planTrips].sort((a, b) => a.sortOrder - b.sortOrder)) {
          if (!t.planTripId) continue;
          const match = rows.find(
            (r) =>
              !usedIds.has(Number(r.id)) &&
              String(r.mixer_name || '').trim() === t.mixerName,
          );
          if (match?.id != null) {
            usedIds.add(Number(match.id));
            links.push({ planTripId: t.planTripId, orderMixerId: Number(match.id) });
          }
        }
        results.push({
          orderId,
          deleted: 0,
          inserted: 0,
          kept: rows.length,
          skipped: `Уже есть ручные назначения (${manualEditable.length}) — не трогаем`,
        });
        continue;
      }

      // Сначала 1:1 связываем с защищёнными (не трогаем их), остальное — insert.
      const sorted = [...planTrips].sort((a, b) => a.sortOrder - b.sortOrder);
      const usedProtected = new Set<number>();
      const toInsertMeta: NormTrip[] = [];

      const takeProtected = (t: NormTrip) => {
        const same = protectedRows.filter(
          (r) =>
            !usedProtected.has(Number(r.id)) &&
            String(r.mixer_name || '').trim() === t.mixerName,
        );
        if (same.length === 0) return null;
        if (same.length === 1) return same[0];
        const planMin = (() => {
          const m = String(t.time || '').match(/^(\d{1,2}):(\d{2})/);
          return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
        })();
        return [...same].sort((a, b) => {
          const aMin = (() => {
            const m = String(a.time || '').match(/^(\d{1,2}):(\d{2})/);
            return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
          })();
          const bMin = (() => {
            const m = String(b.time || '').match(/^(\d{1,2}):(\d{2})/);
            return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 0;
          })();
          const aVol = Math.abs((Number(a.volume) || 0) - t.volume);
          const bVol = Math.abs((Number(b.volume) || 0) - t.volume);
          if (planMin == null) return aVol - bVol;
          return (
            Math.abs(aMin - planMin) - Math.abs(bMin - planMin) || aVol - bVol
          );
        })[0];
      };

      for (const t of sorted) {
        const match = takeProtected(t);
        if (match?.id != null) {
          usedProtected.add(Number(match.id));
          if (t.planTripId) {
            links.push({
              planTripId: t.planTripId,
              orderMixerId: Number(match.id),
            });
          }
          continue;
        }
        toInsertMeta.push(t);
      }

      const deleteIds =
        overwriteManual && editableIds.length > 0
          ? editableIds.map((id) => Number(id)).filter((n) => Number.isFinite(n))
          : [];
      const insertPayload = toInsertMeta.map((t, idx) => ({
        mixer_name: t.mixerName,
        time: t.time,
        volume: t.volume,
        sort_order: idx + 1,
        plan_trip_id: t.planTripId,
      }));

      const willInsert = insertPayload.length;
      const wasQuestionable =
        order.is_questionable === true ||
        (order.is_questionable as unknown) === 'true';
      const setProcessing = order.status === 'new' && willInsert > 0;
      const historyAction =
        `Применил план логистики: ${willInsert} рейс.` +
        (deleteIds.length ? `, заменено ручных ${deleteIds.length}` : '') +
        (protectedRows.length
          ? `, сохранено выехавших ${protectedRows.length}`
          : '') +
        (willInsert
          ? ` (${insertPayload
              .map(
                (t) =>
                  `${t.mixer_name} ${volLabel(Number(t.volume))}м³ ${t.time}`,
              )
              .join('; ')})`
          : '');

      const extraHistory: Array<Record<string, string>> = [];
      if (setProcessing) {
        extraHistory.push({
          action:
            'Автоматически изменил статус заявки с "Новая" на "В работе" (применён план логистики)',
          user_name: 'Система',
          user_role: 'system',
        });
        if (wasQuestionable) {
          extraHistory.push({
            action: 'Автоматически снял метку "Под вопросом" (статус «В работе»)',
            user_name: 'Система',
            user_role: 'system',
            field_name: 'is_questionable',
            old_value: 'true',
            new_value: 'false',
          });
        }
      }

      let deletedCount = 0;
      let inserted = 0;
      let newOrderStatus: string | null = setProcessing ? 'processing' : null;
      let usedRpc = false;

      // Атомарный путь: RPC delete+insert+status+history в одной транзакции.
      // Важно: не передавать null в optional text/jsonb — PostgREST тогда
      // не матчит сигнатуру (PGRST202), хотя функция в схеме есть.
      if (deleteIds.length > 0 || insertPayload.length > 0 || setProcessing) {
        const rpcArgs: Record<string, unknown> = {
          p_order_id: orderId,
          p_delete_ids: deleteIds,
          p_insert: insertPayload,
          p_set_processing: setProcessing,
          p_clear_questionable: Boolean(wasQuestionable && setProcessing),
          p_actor_name: actorName,
          p_actor_role: actorRole,
        };
        if (historyAction && historyAction.trim()) {
          rpcArgs.p_history_action = historyAction;
        }
        if (extraHistory.length > 0) {
          rpcArgs.p_extra_history = extraHistory;
        }

        const { data: rpcData, error: rpcErr } = await supabase.rpc(
          'apply_logistics_plan_trips',
          rpcArgs,
        );

        if (!rpcErr && rpcData && typeof rpcData === 'object') {
          usedRpc = true;
          const payload = rpcData as {
            deleted?: number;
            inserted?: Array<{
              id?: number;
              plan_trip_id?: string | null;
            }>;
          };
          deletedCount = Number(payload.deleted) || 0;
          const insertedRows = Array.isArray(payload.inserted)
            ? payload.inserted
            : [];
          inserted = insertedRows.length;
          for (const row of insertedRows) {
            if (row?.plan_trip_id && row?.id != null) {
              links.push({
                planTripId: String(row.plan_trip_id),
                orderMixerId: Number(row.id),
              });
            }
          }
        } else if (
          rpcErr &&
          !/could not find the function|schema cache|does not exist|PGRST202/i.test(
            `${rpcErr.code || ''} ${rpcErr.message || ''}`,
          )
        ) {
          results.push({
            orderId,
            deleted: 0,
            inserted: 0,
            kept: protectedRows.length,
            skipped: `Не удалось применить план: ${rpcErr.message}`,
          });
          continue;
        }
        // иначе — fallback на пошаговые запросы (RPC ещё не накатили / кэш)
      }

      if (!usedRpc) {
        if (deleteIds.length > 0) {
          const { error: delErr } = await supabase
            .from('order_mixers')
            .delete()
            .in('id', deleteIds);
          if (delErr) {
            results.push({
              orderId,
              deleted: 0,
              inserted: 0,
              kept: protectedRows.length,
              skipped: `Не удалось удалить старые рейсы: ${delErr.message}`,
            });
            continue;
          }
          deletedCount = deleteIds.length;
        }

        if (insertPayload.length > 0) {
          const toInsert = insertPayload.map((t) => ({
            order_id: orderId,
            mixer_name: t.mixer_name,
            time: t.time,
            volume: t.volume,
            sort_order: t.sort_order,
            status: 'Загрузка',
          }));
          const { data: insertedRows, error: insErr } = await supabase
            .from('order_mixers')
            .insert(toInsert)
            .select('id, mixer_name, time, volume');
          if (insErr) {
            results.push({
              orderId,
              deleted: deletedCount,
              inserted: 0,
              kept: protectedRows.length,
              skipped: `Не удалось вставить рейсы: ${insErr.message}`,
              insertFailedAfterDelete: deletedCount > 0,
            });
            continue;
          }
          inserted = insertedRows?.length || 0;
          for (let i = 0; i < (insertedRows || []).length; i++) {
            const row = insertedRows![i];
            const meta = toInsertMeta[i];
            if (meta?.planTripId && row?.id != null) {
              links.push({
                planTripId: meta.planTripId,
                orderMixerId: Number(row.id),
              });
            }
          }
        }

        const historyEntries: Array<Record<string, unknown>> = [
          {
            order_id: orderId,
            action: historyAction,
            user_name: actorName,
            user_role: actorRole,
          },
        ];

        if (setProcessing) {
          const { error: statusErr } = await supabase
            .from('orders')
            .update({
              status: 'processing',
              ...(wasQuestionable ? { is_questionable: false } : {}),
            })
            .eq('id', orderId);
          if (!statusErr) {
            for (const h of extraHistory) {
              historyEntries.push({ order_id: orderId, ...h });
            }
          } else {
            newOrderStatus = null;
          }
        }

        const { error: histErr } = await supabase
          .from('order_history')
          .insert(historyEntries);
        if (histErr) {
          console.error('logistics-plan/apply history:', histErr);
        }
      }

      results.push({
        orderId,
        deleted: deletedCount,
        inserted,
        kept: protectedRows.length,
        newOrderStatus,
      });
    }

    const applied = results.filter((r) => !r.skipped && r.inserted + r.deleted > 0);
    const skipped = results.filter((r) => r.skipped);
    const broken = results.filter((r) => r.insertFailedAfterDelete);
    const insertedTotal = results.reduce((s, r) => s + r.inserted, 0);
    const deletedTotal = results.reduce((s, r) => s + r.deleted, 0);
    const success = broken.length === 0;

    // Один RELOAD вместо N per-row broadcast (RPC подавляет их через
    // app.suppress_om_broadcast). Если RPC ещё не накатили — функция может
    // отсутствовать; тогда клиенты живут на обычных INSERT/DELETE.
    if (insertedTotal + deletedTotal > 0) {
      const { error: reloadErr } = await supabase.rpc('notify_order_mixers_reload');
      if (
        reloadErr &&
        !/could not find the function|schema cache|does not exist|PGRST202/i.test(
          `${reloadErr.code || ''} ${reloadErr.message || ''}`,
        )
      ) {
        console.warn('notify_order_mixers_reload:', reloadErr.message);
      }
    }

    // Убрать из плана слоты «нет в заявке» по заявкам из этого apply
    // (в т.ч. пропущенные с ручными назначениями — призраки плана).
    let prunedGhosts = 0;
    try {
      const prune = await pruneGhostTripsFromLogisticsPlan({
        supabase,
        orderIds: [...byOrder.keys()],
        actorName,
      });
      prunedGhosts = prune.pruned;
    } catch (e) {
      console.warn('pruneGhostTrips after apply:', e);
    }

    return NextResponse.json(
      {
        success,
        orders: results.length,
        appliedOrders: applied.length,
        skippedOrders: skipped.length,
        brokenOrders: broken.length,
        insertedTotal,
        deletedTotal,
        prunedGhosts,
        results,
        links,
        ...(broken.length
          ? {
              error:
                'Часть заявок: старые рейсы удалены, новые не записались. Проверь назначения вручную.',
            }
          : {}),
      },
      { status: success ? 200 : 207 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Ошибка применения плана';
    console.error('logistics-plan/apply:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
