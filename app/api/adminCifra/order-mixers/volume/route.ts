import { NextRequest, NextResponse } from 'next/server';
import { updateOrderMixerVolume } from '@/lib/orderMixers';

export async function POST(request: NextRequest) {
  try {
    const { id, volume, userName, userRole } = await request.json();

    const result = await updateOrderMixerVolume({
      id,
      volume,
      userName,
      userRole,
    });

    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (error: any) {
    console.error('❌ Ошибка обновления объёма миксера:', error);
    return NextResponse.json(
      {
        success: false,
        message: error.message || 'Внутренняя ошибка сервера',
      },
      { status: 500 }
    );
  }
}
