// app/api/adminCifra/clients/delete/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function DELETE(request: NextRequest) {
  try {
    const userId = request.nextUrl.searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    const parsedId = parseInt(userId);

    console.log(`🗑 Попытка удаления клиента ID: ${parsedId}`);

    // Проверяем, есть ли у клиента заказы
    const { count } = await supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', parsedId);

    if (count && count > 0) {
      return NextResponse.json({ 
        error: 'Нельзя удалить клиента, у которого есть заказы' 
      }, { status: 400 });
    }

    // Удаляем клиента
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('user_id', parsedId);

    if (error) {
      console.error('Ошибка удаления:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`✅ Клиент ${parsedId} успешно удалён`);
    return NextResponse.json({ success: true, message: 'Клиент удалён' });

  } catch (error: any) {
    console.error('Delete client error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}