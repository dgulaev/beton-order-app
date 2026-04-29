import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const order = await request.json();

    console.log('📦 Новая заявка на бетон:', {
      ...order,
      receivedAt: new Date().toISOString(),
    });

    // Здесь в будущем можно добавить:
    // - отправку в Telegram
    // - сохранение в базу данных
    // - отправку на email

    return NextResponse.json({
      success: true,
      message: 'Заявка успешно принята',
      orderId: Date.now(),
    });

  } catch (error) {
    console.error('Ошибка при обработке заявки:', error);
    return NextResponse.json({
      success: false,
      message: 'Внутренняя ошибка сервера'
    }, { status: 500 });
  }
}