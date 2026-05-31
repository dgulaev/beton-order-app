import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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

// DELETE — существующий метод (оставляем)
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