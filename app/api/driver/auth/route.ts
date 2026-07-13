// app/api/driver/auth/route.ts
// Вход водителя: номер миксера + телефон. Также используется для повторной
// проверки сессии при каждом открытии приложения (телефон мог быть изменён
// диспетчером в админке — тогда старая пара сразу перестаёт проходить).
import { NextRequest, NextResponse } from 'next/server';
import { verifyDriver } from '@/lib/driverAuth';

export async function POST(request: NextRequest) {
  try {
    const { number, phone } = await request.json();

    if (!number || !phone) {
      return NextResponse.json({ success: false, message: 'Укажите номер миксера и телефон' }, { status: 400 });
    }

    const mixer = await verifyDriver(number, phone);

    if (!mixer) {
      return NextResponse.json(
        { success: false, message: 'Миксер с таким номером и телефоном не найден. Проверьте данные или обратитесь к диспетчеру.' },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      mixer: {
        id: mixer.id,
        number: mixer.number,
        model: mixer.model,
        driver: mixer.driver,
        phone: mixer.phone,
        volume: mixer.volume,
        type: mixer.type,
      },
    });
  } catch (error: any) {
    console.error('Driver auth error:', error);
    return NextResponse.json({ success: false, message: 'Ошибка сервера' }, { status: 500 });
  }
}
