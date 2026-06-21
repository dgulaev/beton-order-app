import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { orderId, status } = await request.json();

   // console.log(`📌 [STATUS API] orderId=${orderId}, status=${status}`);

    if (!orderId || !status) {
      return NextResponse.json({ success: false, message: 'orderId и status обязательны' }, { status: 400 });
    }

    return NextResponse.json({ 
      success: true, 
      message: `Статус заказа #${orderId} изменён на "${status}"` 
    });

  } catch (error: any) {
    console.error('Status API error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}