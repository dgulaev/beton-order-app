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

  const row = data || { id: 1, active_operator_name: null, available_names: DEFAULT_NAMES, active_operator_set_at: null };

  // ==================== АВТОСБРОС В НАЧАЛЕ НОВОГО ДНЯ ====================
  // Выбор "кто на смене" сделан вчера (или раньше) — считаем его неактуальным
  // и сбрасываем прямо здесь, при первом обращении в новый день (без
  // отдельного cron/задачи). Это "ленивый" сброс: до первого GET в новый день
  // строка в базе формально хранит вчерашнее имя, но как только кто-то
  // откроет страницу оператора — вернём и сохраним null, чтобы обе стороны
  // (страница оператора и карточка в Стаффе) увидели одинаковую картину.
  const setAt = row.active_operator_set_at ? new Date(row.active_operator_set_at) : null;
  const isStale = row.active_operator_name && setAt && !isSameLocalDay(setAt, new Date());

  if (isStale) {
    const { data: cleared, error: clearError } = await supabase
      .from('operator_shift_settings')
      .update({ active_operator_name: null, active_operator_set_at: null })
      .eq('id', 1)
      .select()
      .maybeSingle();

    if (!clearError && cleared) return NextResponse.json(cleared);
    return NextResponse.json({ ...row, active_operator_name: null, active_operator_set_at: null });
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
