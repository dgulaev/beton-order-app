import { NextRequest, NextResponse } from 'next/server';
import { ORDER_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { updateOrderMixerStatus } from '@/lib/orderMixers';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAdminCifraStaff(request, ORDER_MUTATION_ROLES);
    if (auth.error) {
      return NextResponse.json(
        { success: false, message: 'Нет доступа к изменению статуса рейса' },
        { status: 403 },
      );
    }

    const { id, status, loading_started_at, podvizhnost, userName, expectedStatus } =
      await request.json();

    const result = await updateOrderMixerStatus({
      id,
      status,
      loading_started_at,
      podvizhnost,
      userName:
        (typeof userName === 'string' && userName.trim() ? userName.trim() : null)
        || auth.user.full_name
        || 'Сотрудник',
      userRole: auth.user.role,
      expectedStatus,
      allowAdminFinalOverride: auth.user.role === 'admin',
    });

    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (error: unknown) {
    console.error('❌ Ошибка обновления статуса миксера:', error);
    const message = error instanceof Error ? error.message : 'Внутренняя ошибка сервера';
    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status: 500 }
    );
  }
}
