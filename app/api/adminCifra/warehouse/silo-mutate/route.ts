// Внести / обнулить силос с фиксацией экономии при отрицательном остатке.
import { NextRequest, NextResponse } from 'next/server';
import { WAREHOUSE_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { siloNameById, syncSiloLowRateAlert } from '@/lib/siloConfig';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

type RpcRow = {
  ok: boolean;
  error_text: string | null;
  silo_id: number | string | null;
  saving_kg: number | string | null;
  old_current: number | string | null;
  new_current: number | string | null;
};

async function writeHistory(opts: {
  operation_type: 'add' | 'reset' | 'subtract';
  siloId: number;
  amountKg: number;
  oldTons: number;
  newTons: number;
  userName: string | null;
}) {
  const { error } = await supabase.from('warehouse_operations').insert({
    operation_type: opts.operation_type,
    item_type: siloNameById(opts.siloId),
    amount: Math.round(Math.abs(opts.amountKg) * 10) / 10,
    old_value: Math.round(opts.oldTons * 1000 * 10) / 10,
    new_value: Math.round(opts.newTons * 1000 * 10) / 10,
    unit: 'кг',
    user_name: opts.userName,
  });
  if (error) console.error('silo-mutate history:', error);
}

/**
 * Страховка: если SQL-функция вернула saving_kg, но строку в таблицу
 * не записала (старая версия RPC / сбой), допишем из API.
 */
async function ensureSavingRecord(opts: {
  siloId: number;
  savingKg: number;
  reason: 'reset' | 'refill';
  balanceBeforeTons: number;
  userName: string | null;
}) {
  const savingKg = Math.round(Number(opts.savingKg || 0) * 10) / 10;
  if (!(savingKg > 0)) return;

  const since = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const { data: existing } = await supabase
    .from('warehouse_cement_savings')
    .select('id')
    .eq('silo_id', opts.siloId)
    .eq('reason', opts.reason)
    .gte('created_at', since)
    .limit(1);

  if (existing && existing.length > 0) return;

  const { error } = await supabase.from('warehouse_cement_savings').insert({
    silo_id: opts.siloId,
    amount_kg: savingKg,
    reason: opts.reason,
    balance_before_tons: opts.balanceBeforeTons,
    user_name: opts.userName,
  });
  if (error) {
    console.error('ensureSavingRecord:', error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, WAREHOUSE_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || '');
    const siloId = Number(body?.siloId);
    if (![1, 2, 3].includes(siloId)) {
      return NextResponse.json({ error: 'Укажи силос 1–3' }, { status: 400 });
    }

    const userName =
      (typeof body?.userName === 'string' && body.userName.trim()
        ? body.userName.trim().slice(0, 120)
        : null)
      || auth.user.full_name
      || null;

    if (action === 'reset') {
      const { data, error } = await supabase.rpc('warehouse_silo_book_and_reset', {
        p_silo_id: siloId,
        p_user_name: userName,
      });
      if (error) {
        console.error('warehouse_silo_book_and_reset:', error);
        return NextResponse.json(
          {
            error: error.message.includes('warehouse_silo_book_and_reset')
              ? 'Не применена SQL-функция экономии (scripts/warehouse-cement-savings.sql)'
              : error.message,
          },
          { status: 500 },
        );
      }
      const row = (Array.isArray(data) ? data[0] : data) as RpcRow | null;
      if (!row?.ok) {
        return NextResponse.json(
          { error: row?.error_text || 'Не удалось обнулить' },
          { status: 400 },
        );
      }

      const oldTons = Number(row.old_current ?? 0);
      const newTons = Number(row.new_current ?? 0);
      // Если RPC не посчитал экономию, но остаток был отрицательный — считаем сами
      let savingKg = Math.round(Number(row.saving_kg || 0) * 10) / 10;
      if (!(savingKg > 0) && oldTons < 0) {
        savingKg = Math.round(Math.abs(oldTons) * 1000 * 10) / 10;
      }
      await ensureSavingRecord({
        siloId,
        savingKg,
        reason: 'reset',
        balanceBeforeTons: oldTons,
        userName,
      });
      await writeHistory({
        operation_type: 'reset',
        siloId,
        amountKg: Math.abs(oldTons) * 1000,
        oldTons,
        newTons,
        userName,
      });
      await syncSiloLowRateAlert(supabase, siloId);

      return NextResponse.json({
        success: true,
        action: 'reset',
        siloId,
        siloName: siloNameById(siloId),
        oldCurrent: oldTons,
        newCurrent: newTons,
        savingKg,
      });
    }

    if (action === 'add') {
      const amountKg = Number(body?.amountKg);
      if (!Number.isFinite(amountKg) || amountKg === 0) {
        return NextResponse.json(
          { error: 'Укажи количество кг не равное нулю (минус — ручное списание)' },
          { status: 400 },
        );
      }

      // Минус: ручная корректировка остатка вниз — без закрытия цикла экономии
      // (как на странице склада). Плюс: поступление через RPC с экономией.
      if (amountKg < 0) {
        const { data: siloRow, error: siloErr } = await supabase
          .from('warehouse_silos')
          .select('current')
          .eq('silo_id', siloId)
          .single();
        if (siloErr || !siloRow) {
          return NextResponse.json(
            { error: siloErr?.message || 'Силос не найден' },
            { status: 404 },
          );
        }
        const oldTons = Number(siloRow.current || 0);
        const deltaTons = amountKg / 1000;
        // Как на складе: не уходим ниже −50 т
        const newTons = Math.max(-50, oldTons + deltaTons);
        const appliedKg = Math.round((newTons - oldTons) * 1000 * 10) / 10;
        if (appliedKg === 0) {
          return NextResponse.json(
            { error: 'Остаток уже на минимуме (−50 т)' },
            { status: 400 },
          );
        }
        const { error: updErr } = await supabase
          .from('warehouse_silos')
          .update({ current: newTons, updated_at: new Date().toISOString() })
          .eq('silo_id', siloId);
        if (updErr) {
          return NextResponse.json({ error: updErr.message }, { status: 500 });
        }
        await writeHistory({
          operation_type: 'subtract',
          siloId,
          amountKg: Math.abs(appliedKg),
          oldTons,
          newTons,
          userName,
        });
        const lowRate = await syncSiloLowRateAlert(supabase, siloId);
        return NextResponse.json({
          success: true,
          action: 'subtract',
          siloId,
          siloName: siloNameById(siloId),
          amountKg: appliedKg,
          oldCurrent: oldTons,
          newCurrent: newTons,
          savingKg: 0,
          lowRateAlert: lowRate?.pending ? lowRate : null,
        });
      }

      const deltaTons = amountKg / 1000;

      const { data, error } = await supabase.rpc('warehouse_silo_book_and_add', {
        p_silo_id: siloId,
        p_delta_tons: deltaTons,
        p_user_name: userName,
      });
      if (error) {
        console.error('warehouse_silo_book_and_add:', error);
        return NextResponse.json(
          {
            error: error.message.includes('warehouse_silo_book_and_add')
              ? 'Не применена SQL-функция экономии (scripts/warehouse-cement-savings.sql)'
              : error.message,
          },
          { status: 500 },
        );
      }
      const row = (Array.isArray(data) ? data[0] : data) as RpcRow | null;
      if (!row?.ok) {
        return NextResponse.json(
          { error: row?.error_text || 'Не удалось внести' },
          { status: 400 },
        );
      }

      const oldTons = Number(row.old_current ?? 0);
      const newTons = Number(row.new_current ?? 0);
      let savingKg = Math.round(Number(row.saving_kg || 0) * 10) / 10;
      if (!(savingKg > 0) && oldTons < 0) {
        savingKg = Math.round(Math.abs(oldTons) * 1000 * 10) / 10;
      }
      await ensureSavingRecord({
        siloId,
        savingKg,
        reason: 'refill',
        balanceBeforeTons: oldTons,
        userName,
      });
      await writeHistory({
        operation_type: 'add',
        siloId,
        amountKg: Math.abs(amountKg),
        oldTons,
        newTons,
        userName,
      });
      const lowRate = await syncSiloLowRateAlert(supabase, siloId);

      return NextResponse.json({
        success: true,
        action: 'add',
        siloId,
        siloName: siloNameById(siloId),
        amountKg,
        oldCurrent: oldTons,
        newCurrent: newTons,
        savingKg,
        lowRateAlert: lowRate?.pending ? lowRate : null,
      });
    }

    return NextResponse.json(
      { error: 'action должен быть reset или add' },
      { status: 400 },
    );
  } catch (err: any) {
    console.error('silo-mutate POST:', err);
    return NextResponse.json({ error: err.message || 'Ошибка' }, { status: 500 });
  }
}
