// Списание mid_load-сегмента цемента при смене силоса во время загрузки.
import { NextRequest, NextResponse } from 'next/server';
import { WAREHOUSE_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  listCementSegments,
  sumSegmentVolumeM3,
  writeCementSegment,
} from '@/lib/cementSegments';
import { getFreshActiveSiloId } from '@/lib/operatorShiftSilo';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, WAREHOUSE_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json().catch(() => ({}));
    const orderMixerId = Number(body?.orderMixerId);
    const siloId = Number(body?.siloId);
    const volumeM3 = Number(String(body?.volumeM3 ?? '').replace(',', '.'));

    if (!Number.isFinite(orderMixerId) || orderMixerId <= 0) {
      return NextResponse.json({ error: 'orderMixerId обязателен' }, { status: 400 });
    }
    if (![1, 2, 3].includes(siloId)) {
      return NextResponse.json({ error: 'Укажи силос 1, 2 или 3' }, { status: 400 });
    }
    if (!(volumeM3 > 0)) {
      return NextResponse.json({ error: 'Объём должен быть больше 0' }, { status: 400 });
    }

    const { data: mixer, error: mixerError } = await supabase
      .from('order_mixers')
      .select(`
        id,
        order_id,
        volume,
        status,
        loading_started_at,
        orders!inner ( id, grade, status )
      `)
      .eq('id', orderMixerId)
      .maybeSingle();

    if (mixerError || !mixer) {
      return NextResponse.json({ error: 'Рейс не найден' }, { status: 404 });
    }

    const status = String(mixer.status || '');
    if (status !== 'Загрузка') {
      return NextResponse.json(
        { error: 'Сегмент при смене силоса можно списать только пока рейс в статусе «Загрузка»' },
        { status: 409 },
      );
    }
    // Статус «Загрузка» без loading_started_at — наследие бага short-circuit
    // (кнопка «Начать» не писала таймер). Оператор уже грузит и меняет силос:
    // дописываем таймер и продолжаем, а не блокируем mid_load.
    if (!mixer.loading_started_at) {
      const healedAt = new Date().toISOString();
      const { error: healError } = await supabase
        .from('order_mixers')
        .update({ loading_started_at: healedAt })
        .eq('id', orderMixerId)
        .eq('status', 'Загрузка')
        .is('loading_started_at', null);
      if (healError) {
        console.error('cement-segment: heal loading_started_at:', healError);
        return NextResponse.json(
          { error: 'Загрузка рейса ещё не начата — нажми «Начать» и повтори смену силоса' },
          { status: 409 },
        );
      }
      mixer.loading_started_at = healedAt;
    }

    const activeSiloId = await getFreshActiveSiloId();
    if (activeSiloId == null) {
      return NextResponse.json(
        { error: 'Сначала выбери рабочий силос на смене (на сегодня)' },
        { status: 409 },
      );
    }
    // Списываем только с текущего рабочего — клиент не должен подменить силос
    if (siloId !== activeSiloId) {
      return NextResponse.json(
        {
          error: `Сейчас активен силос №${activeSiloId}. Обнови страницу и переключи снова`,
        },
        { status: 409 },
      );
    }

    const { data: shift } = await supabase
      .from('operator_shift_settings')
      .select('active_operator_name')
      .eq('id', 1)
      .maybeSingle();

    const orderId = Number(mixer.order_id);
    const tripVolumeM3 = Number(mixer.volume || 0);
    const grade = (mixer as any).orders?.grade ?? null;

    const result = await writeCementSegment({
      orderMixerId,
      orderId,
      siloId: activeSiloId,
      volumeM3,
      tripVolumeM3,
      grade,
      kind: 'mid_load',
      operatorName:
        typeof shift?.active_operator_name === 'string' ? shift.active_operator_name : null,
      actorName: auth.user.full_name || 'Оператор',
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    const segments = await listCementSegments(orderMixerId);
    return NextResponse.json({
      success: true,
      skipped: Boolean(result.skipped),
      segmentId: result.segmentId,
      siloId: result.siloId,
      volumeM3: result.volumeM3,
      totalInMixerM3: result.totalInMixerM3 ?? volumeM3,
      cementKg: result.cementKg,
      remainingM3: result.remainingM3,
      tripVolumeM3,
      usedM3: sumSegmentVolumeM3(segments),
    });
  } catch (err: any) {
    console.error('cement-segment POST:', err);
    return NextResponse.json(
      { error: err?.message || 'Ошибка списания сегмента' },
      { status: 500 },
    );
  }
}
