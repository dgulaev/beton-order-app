// app/api/adminCifra/operator-shift/route.ts
// Кто сейчас на смене за пультом оператора БСУ (общая учётка на двоих —
// Семён/Максим, без отдельных логинов). Одна строка настроек (id=1),
// переключение — это UPDATE существующей строки, а не создание новой записи.
// available_names — редактируемый список имён (см. карточку "Оператор" на
// странице Клиенты → Стафф), чтобы состав операторов можно было поменять
// без правки кода.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DEFAULT_NAMES = ['Семён', 'Максим'];

function isSameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export async function GET() {
  const { data, error } = await supabase
    .from('operator_shift_settings')
    .select('*')
    .eq('id', 1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const row = data || {
    id: 1,
    active_operator_name: null,
    available_names: DEFAULT_NAMES,
    active_operator_set_at: null,
    active_silo_id: null,
    active_silo_set_at: null,
  };

  // ==================== АВТОСБРОС В НАЧАЛЕ НОВОГО ДНЯ ====================
  // Выбор "кто на смене" и рабочего силоса сделан вчера (или раньше) —
  // сбрасываем при первом GET в новый день (ленивый сброс без cron).
  const now = new Date();
  const shiftSetAt = row.active_operator_set_at ? new Date(row.active_operator_set_at) : null;
  const siloSetAt = row.active_silo_set_at ? new Date(row.active_silo_set_at) : null;
  const shiftStale = !!(row.active_operator_name && shiftSetAt && !isSameLocalDay(shiftSetAt, now));
  // Силос без метки времени (старые данные) при выбранном id тоже сбрасываем утром —
  // иначе подсветка «выбери силос» не появится.
  const siloStale = !!(
    row.active_silo_id
    && (!siloSetAt || !isSameLocalDay(siloSetAt, now))
  );

  if (shiftStale || siloStale) {
    const clearUpdate: Record<string, any> = {};
    if (shiftStale) {
      clearUpdate.active_operator_name = null;
      clearUpdate.active_operator_set_at = null;
    }
    if (siloStale) {
      clearUpdate.active_silo_id = null;
      clearUpdate.active_silo_set_at = null;
    }

    const { data: cleared, error: clearError } = await supabase
      .from('operator_shift_settings')
      .update(clearUpdate)
      .eq('id', 1)
      .select()
      .maybeSingle();

    if (!clearError && cleared) return NextResponse.json(cleared);
    return NextResponse.json({
      ...row,
      ...(shiftStale ? { active_operator_name: null, active_operator_set_at: null } : {}),
      ...(siloStale ? { active_silo_id: null, active_silo_set_at: null } : {}),
    });
  }

  return NextResponse.json(row);
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const update: Record<string, any> = { updated_at: new Date().toISOString() };

    // Оба поля опциональны — переключатель смены шлёт только
    // active_operator_name, а карточка "Оператор" в Стаффе — только
    // available_names, не трогая при этом текущую выбранную смену.
    if ('active_operator_name' in body) {
      update.active_operator_name = body.active_operator_name || null;
      // Отдельная метка именно момента выбора смены (не путать с updated_at,
      // который также меняется при редактировании available_names) — на неё
      // опирается автосброс в GET выше.
      update.active_operator_set_at = body.active_operator_name ? new Date().toISOString() : null;
    }
    if ('available_names' in body) {
      const names = Array.isArray(body.available_names)
        ? body.available_names.map((n: any) => String(n).trim()).filter(Boolean)
        : [];
      update.available_names = names;
    }
    if ('active_silo_id' in body) {
      const raw = body.active_silo_id;
      if (raw === null || raw === '' || raw === undefined) {
        update.active_silo_id = null;
        update.active_silo_set_at = null;
      } else {
        const id = Number(raw);
        if (![1, 2, 3].includes(id)) {
          return NextResponse.json({ error: 'active_silo_id должен быть 1, 2 или 3' }, { status: 400 });
        }
        update.active_silo_id = id;
        update.active_silo_set_at = new Date().toISOString();
      }
    }

    const { data, error } = await supabase
      .from('operator_shift_settings')
      .update(update)
      .eq('id', 1)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Operator shift update error:', error);
    return NextResponse.json({ error: error.message || 'Не удалось сохранить смену' }, { status: 500 });
  }
}
