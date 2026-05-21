// app/api/adminCifra/orders/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const orderId = parseInt(id);

    if (isNaN(orderId) || orderId <= 0) {
      return NextResponse.json({ success: false, message: 'Неверный ID' }, { status: 400 });
    }

    console.log(`🗑️ Начинаем удаление заявки #${orderId}`);

    // 1. Удаляем связанные referral_transactions
    const { error: refError } = await supabase
      .from('referral_transactions')
      .delete()
      .eq('order_id', orderId);

    if (refError) {
      console.warn('Предупреждение при удалении referral_transactions:', refError);
    } else {
      console.log('✅ Связанные referral_transactions удалены');
    }

    // 2. Удаляем саму заявку
    const { error: deleteError } = await supabase
      .from('orders')
      .delete()
      .eq('id', orderId);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      return NextResponse.json({ 
        success: false, 
        message: deleteError.message 
      }, { status: 500 });
    }

    console.log(`✅ Заявка #${orderId} полностью удалена`);

    return NextResponse.json({ 
      success: true, 
      message: 'Заявка успешно удалена' 
    });

  } catch (error: any) {
    console.error('Delete API error:', error);
    return NextResponse.json({ 
      success: false, 
      message: error.message || 'Внутренняя ошибка' 
    }, { status: 500 });
  }
}