import { NextRequest, NextResponse } from 'next/server';
import { ORDER_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { normalizePlanDateKey } from '@/lib/dailyLogisticsPlan';
import { pruneGhostsForDeliveryDate } from '@/lib/pruneLogisticsPlanGhosts';
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin';

/**
 * POST { date } — вычистить «нет в заявке» у completed/cancelled заявок дня.
 * Нужен и для уже закрытых заявок (разовый проход при открытии планирования).
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json().catch(() => ({}));
    const date = normalizePlanDateKey(String(body?.date || ''));
    if (!date) {
      return NextResponse.json({ error: 'Укажи date=YYYY-MM-DD' }, { status: 400 });
    }

    const result = await pruneGhostsForDeliveryDate({
      supabase,
      deliveryDate: date,
      actorName: auth.user.full_name || 'Система',
    });

    return NextResponse.json({
      success: true,
      pruned: result.pruned,
      dates: result.dates,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Ошибка очистки плана';
    console.error('logistics-plan/prune-ghosts:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
