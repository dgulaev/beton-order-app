// app/api/adminCifra/orders/update/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updateData } = body;

    if (!id) {
      return NextResponse.json({ success: false, message: 'ID заявки обязателен' }, { status: 400 });
    }

    const { error } = await supabase
      .from('orders')
      .update({
        grade: updateData.grade,
        volume: updateData.volume,
        delivery_date: updateData.delivery_date,
        delivery_time: updateData.delivery_time,
        address: updateData.address,
        phone: updateData.phone,
        organization_name: updateData.organization_name,
        full_name: updateData.full_name,
        inn: updateData.inn,
        comment: updateData.comment,
        // Можно добавить обновление других полей при необходимости
      })
      .eq('id', id);

    if (error) {
      console.error('Update error:', error);
      return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Заявка успешно обновлена' });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}