import { NextRequest, NextResponse } from 'next/server';
import { updateOrderMixerStatus } from '@/lib/orderMixers';

export async function POST(request: NextRequest) {
  try {
    const { id, status, loading_started_at, podvizhnost, userName, userRole } = await request.json();

    const result = await updateOrderMixerStatus({
      id,
      status,
      loading_started_at,
      podvizhnost,
      userName,
      userRole,
    });

    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (error: any) {
    console.error('❌ Ошибка обновления статуса миксера:', error);
    return NextResponse.json(
      {
        success: false,
        message: error.message || 'Внутренняя ошибка сервера',
      },
      { status: 500 }
    );
  }
}
