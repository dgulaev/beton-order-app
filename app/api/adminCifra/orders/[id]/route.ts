import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET — получить данные заказа по ID
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orderId = parseInt(id);

    if (isNaN(orderId) || orderId <= 0) {
      return NextResponse.json({ error: 'Неверный ID' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .single();

    if (error) {
      console.error('Order fetch error:', error);
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    console.error('API error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

type ChildDelete = { table: string; column?: string; soft?: boolean };

/**
 * Связанные таблицы, которые блокируют DELETE orders при FK без CASCADE.
 * Порядок важен: сначала дети рейсов, потом рейсы, потом история/остальное.
 */
async function deleteOrderChildren(orderId: number): Promise<string[]> {
  const warnings: string[] = [];

  const { data: mixers } = await supabase
    .from('order_mixers')
    .select('id')
    .eq('order_id', orderId);
  const mixerIds = (mixers || []).map((m) => m.id).filter((id) => Number.isFinite(Number(id)));

  if (mixerIds.length > 0) {
    // production_logs часто ссылаются на order_mixer_id без cascade
    const { error: plMixerErr } = await supabase
      .from('production_logs')
      .delete()
      .in('order_mixer_id', mixerIds);
    if (plMixerErr && !/does not exist|Could not find/i.test(plMixerErr.message)) {
      warnings.push(`production_logs(mixer): ${plMixerErr.message}`);
    }
  }

  const steps: ChildDelete[] = [
    { table: 'production_logs', column: 'order_id' },
    { table: 'order_mixers', column: 'order_id' },
    { table: 'order_history', column: 'order_id' },
    { table: 'order_comments', column: 'order_id' },
    { table: 'bulk_shipments', column: 'order_id' },
    { table: 'referral_transactions', column: 'order_id' },
    { table: 'concrete_passports', column: 'order_id' },
  ];

  for (const step of steps) {
    const { error } = await supabase
      .from(step.table)
      .delete()
      .eq(step.column || 'order_id', orderId);
    if (error) {
      // Таблицы может не быть в окружении — не валим удаление
      if (/does not exist|Could not find|schema cache/i.test(error.message)) continue;
      warnings.push(`${step.table}: ${error.message}`);
      // Жёсткие FK — прерываем, иначе delete orders всё равно упадёт с менее понятной ошибкой
      if (/foreign key|violates|constraint/i.test(error.message)) {
        throw new Error(`Не удалось очистить ${step.table}: ${error.message}`);
      }
    }
  }

  // Лиды: обнуляем ссылку (если нет ON DELETE SET NULL)
  const { error: leadErr } = await supabase
    .from('leads')
    .update({ order_id: null })
    .eq('order_id', orderId);
  if (leadErr && !/does not exist|Could not find|schema cache|column/i.test(leadErr.message)) {
    warnings.push(`leads: ${leadErr.message}`);
  }

  return warnings;
}

// DELETE — заявка + связанные записи (история, рейсы, отгрузки…)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminCifraStaff(request, ['admin']);
  if (auth.error) {
    return NextResponse.json(
      { success: false, message: 'Удаление заявок доступно только администратору' },
      { status: 403 },
    );
  }

  try {
    const { id } = await params;
    const orderId = parseInt(id);
    if (isNaN(orderId) || orderId <= 0) {
      return NextResponse.json({ success: false, message: 'Неверный ID' }, { status: 400 });
    }

    console.log(`🗑️ Начинаем удаление заявки #${orderId} (${auth.user.full_name || auth.user.user_id})`);

    const { data: existing, error: findErr } = await supabase
      .from('orders')
      .select('id')
      .eq('id', orderId)
      .maybeSingle();
    if (findErr) {
      return NextResponse.json({ success: false, message: findErr.message }, { status: 500 });
    }
    if (!existing) {
      return NextResponse.json({ success: false, message: 'Заявка не найдена' }, { status: 404 });
    }

    const warnings = await deleteOrderChildren(orderId);

    const { error: deleteError } = await supabase
      .from('orders')
      .delete()
      .eq('id', orderId);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      const hint = /foreign key|violates/i.test(deleteError.message)
        ? ' Есть связанные записи (история, рейсы и т.п.), которые не удалось очистить.'
        : '';
      return NextResponse.json(
        {
          success: false,
          message: `${deleteError.message}${hint}`,
          warnings,
        },
        { status: 500 },
      );
    }

    console.log(`✅ Заявка #${orderId} полностью удалена`, warnings.length ? { warnings } : '');
    return NextResponse.json({
      success: true,
      message: 'Заявка успешно удалена',
      warnings: warnings.length ? warnings : undefined,
    });
  } catch (error: any) {
    console.error('Delete API error:', error);
    return NextResponse.json({
      success: false,
      message: error.message || 'Внутренняя ошибка',
    }, { status: 500 });
  }
}
