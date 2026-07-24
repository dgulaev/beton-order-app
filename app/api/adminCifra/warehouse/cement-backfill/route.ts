// Списание цемента задним числом по сегодняшним рейсам без cement_write_off.
// Только admin. Силос — operator_shift_settings.active_silo_id.
import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { calculateCementUsageKg, findRecipeByGrade } from '@/lib/recipeAdditives';
import { formatSiloCementJournalActor, siloNameById } from '@/lib/siloConfig';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

const LOADED_STATUSES = ['В пути', 'На объекте', 'Разгружен', 'Возврат'] as const;

function moscowDateStr(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

type Candidate = {
  id: number;
  orderId: number;
  mixerName: string;
  volume: number;
  status: string;
  grade: string | null;
  cementKg: number;
};

async function resolveActiveShift(): Promise<{
  siloId: number | null;
  operatorName: string | null;
}> {
  const { data: shift } = await supabase
    .from('operator_shift_settings')
    .select('active_silo_id, active_operator_name')
    .eq('id', 1)
    .maybeSingle();
  const siloId = Number(shift?.active_silo_id);
  return {
    siloId: [1, 2, 3].includes(siloId) ? siloId : null,
    operatorName:
      typeof shift?.active_operator_name === 'string' && shift.active_operator_name.trim()
        ? shift.active_operator_name.trim()
        : null,
  };
}

async function loadCandidates(dateIso: string): Promise<{
  candidates: Candidate[];
  skippedNoRecipe: number;
  skippedZeroCement: number;
}> {
  const { data: mixers, error } = await supabase
    .from('order_mixers')
    .select(`
      id,
      order_id,
      mixer_name,
      volume,
      status,
      cement_write_off_kg,
      orders!inner (
        id,
        delivery_date,
        grade
      )
    `)
    .in('status', [...LOADED_STATUSES])
    .is('cement_write_off_kg', null)
    .eq('orders.delivery_date', dateIso);

  if (error) throw error;

  const { data: recipes, error: recipesError } = await supabase
    .from('recipes')
    .select('code, name, type, cement, additive, additive2');
  if (recipesError) throw recipesError;

  const candidates: Candidate[] = [];
  let skippedNoRecipe = 0;
  let skippedZeroCement = 0;

  for (const row of mixers || []) {
    const grade = (row as any).orders?.grade ?? null;
    const volume = Number(row.volume || 0);
    const recipe = findRecipeByGrade(recipes || [], grade);
    if (!recipe) {
      skippedNoRecipe += 1;
      continue;
    }
    const cementKg = Math.round(calculateCementUsageKg(recipe, volume) * 10) / 10;
    if (cementKg <= 0) {
      skippedZeroCement += 1;
      continue;
    }
    candidates.push({
      id: Number(row.id),
      orderId: Number(row.order_id),
      mixerName: String(row.mixer_name || `Миксер #${row.id}`),
      volume,
      status: String(row.status || ''),
      grade: grade ? String(grade) : null,
      cementKg,
    });
  }

  return { candidates, skippedNoRecipe, skippedZeroCement };
}

function authHeadersOk(request: NextRequest) {
  return requireAdminCifraStaff(request, ['admin']);
}

/** Превью кандидатов на списание. */
export async function GET(request: NextRequest) {
  const auth = await authHeadersOk(request);
  if (auth.error) return auth.error;

  try {
    const dateParam = request.nextUrl.searchParams.get('date');
    const dateIso = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : moscowDateStr();

    const { siloId } = await resolveActiveShift();
    if (siloId == null) {
      return NextResponse.json(
        { error: 'Сначала выбери активный силос' },
        { status: 400 },
      );
    }

    const { candidates, skippedNoRecipe, skippedZeroCement } = await loadCandidates(dateIso);
    const totalKg = Math.round(
      candidates.reduce((sum, c) => sum + c.cementKg, 0) * 10,
    ) / 10;

    return NextResponse.json({
      date: dateIso,
      siloId,
      siloName: siloNameById(siloId),
      tripCount: candidates.length,
      totalKg,
      skippedNoRecipe,
      skippedZeroCement,
      trips: candidates.map((c) => ({
        id: c.id,
        orderId: c.orderId,
        mixerName: c.mixerName,
        volume: c.volume,
        status: c.status,
        grade: c.grade,
        cementKg: c.cementKg,
      })),
    });
  } catch (err: any) {
    console.error('cement-backfill GET:', err);
    return NextResponse.json({ error: err.message || 'Ошибка' }, { status: 500 });
  }
}

/** Выполнить списание задним числом. */
export async function POST(request: NextRequest) {
  const auth = await authHeadersOk(request);
  if (auth.error) return auth.error;

  try {
    let dateIso = moscowDateStr();
    try {
      const body = await request.json();
      if (body?.date && /^\d{4}-\d{2}-\d{2}$/.test(String(body.date))) {
        dateIso = String(body.date);
      }
    } catch {
      // тело опционально
    }

    const { siloId, operatorName } = await resolveActiveShift();
    if (siloId == null) {
      return NextResponse.json(
        { error: 'Сначала выбери активный силос' },
        { status: 400 },
      );
    }

    const { candidates } = await loadCandidates(dateIso);
    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        date: dateIso,
        siloId,
        siloName: siloNameById(siloId),
        writtenOff: 0,
        totalKg: 0,
        message: 'Нет рейсов без списания цемента за этот день',
      });
    }

    const actorName = auth.user.full_name || 'Администратор';
    const now = new Date().toISOString();
    let writtenOff = 0;
    let totalKg = 0;
    const errors: string[] = [];

    for (const trip of candidates) {
      // Идемпотентность: между GET и POST кто-то мог уже списать
      const { data: fresh } = await supabase
        .from('order_mixers')
        .select('id, cement_write_off_kg')
        .eq('id', trip.id)
        .maybeSingle();
      if (!fresh || fresh.cement_write_off_kg != null) continue;

      const tons = trip.cementKg / 1000;
      const { data: adjRows, error: rpcError } = await supabase.rpc('warehouse_silo_adjust', {
        p_silo_id: siloId,
        p_delta_tons: -tons,
      });

      if (rpcError) {
        errors.push(`#${trip.orderId} ${trip.mixerName}: ${rpcError.message}`);
        continue;
      }

      // Условный UPDATE: если списание уже успели поставить (обычная загрузка
      // или параллельный backfill) — 0 строк, откатываем остаток силоса.
      const { data: patched, error: patchError } = await supabase
        .from('order_mixers')
        .update({
          cement_write_off_silo_id: siloId,
          cement_write_off_kg: trip.cementKg,
          cement_write_off_at: now,
        })
        .eq('id', trip.id)
        .is('cement_write_off_kg', null)
        .select('id')
        .maybeSingle();

      if (patchError || !patched) {
        await supabase.rpc('warehouse_silo_adjust', {
          p_silo_id: siloId,
          p_delta_tons: tons,
        });
        if (patchError) {
          errors.push(`#${trip.orderId} ${trip.mixerName}: ${patchError.message}`);
        }
        // !patched — уже списано другим путём, просто пропускаем без ошибки
        continue;
      }

      const adj = Array.isArray(adjRows) ? adjRows[0] : adjRows;
      const oldKg = Number(adj?.old_current ?? 0) * 1000;
      const newKg = Number(adj?.new_current ?? 0) * 1000;
      await supabase.from('warehouse_operations').insert({
        operation_type: 'subtract',
        item_type: siloNameById(siloId),
        amount: trip.cementKg,
        old_value: Math.round(oldKg * 10) / 10,
        new_value: Math.round(newKg * 10) / 10,
        unit: 'кг',
        user_name: formatSiloCementJournalActor({
          kind: 'backfill',
          orderId: trip.orderId,
          operatorName,
          actorName,
        }),
      });

      writtenOff += 1;
      totalKg += trip.cementKg;
    }

    totalKg = Math.round(totalKg * 10) / 10;

    return NextResponse.json({
      success: errors.length === 0,
      date: dateIso,
      siloId,
      siloName: siloNameById(siloId),
      writtenOff,
      totalKg,
      errors,
    });
  } catch (err: any) {
    console.error('cement-backfill POST:', err);
    return NextResponse.json({ error: err.message || 'Ошибка' }, { status: 500 });
  }
}
