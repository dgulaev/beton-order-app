// app/api/adminCifra/clients/update/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, full_name, organization_name, phone, inn, ...other } = body;

    console.log('📥 [Update Client] Получен payload:', body);

    if (!userId) {
      return NextResponse.json({ 
        error: 'userId обязателен' 
      }, { status: 400 });
    }

    const updatePayload: any = {};

    if (full_name !== undefined) updatePayload.full_name = full_name || null;
    if (organization_name !== undefined) updatePayload.organization_name = organization_name || null;
    if (phone !== undefined) updatePayload.phone = phone || null;
    if (inn !== undefined) updatePayload.inn = inn || null;

    // Добавляем другие возможные поля
    Object.keys(other).forEach(key => {
      if (other[key] !== undefined) {
        updatePayload[key] = other[key] || null;
      }
    });

    if (Object.keys(updatePayload).length === 0) {
      return NextResponse.json({ error: 'Нет данных для обновления' }, { status: 400 });
    }

    const { error } = await supabase
      .from('users')
      .update(updatePayload)
      .eq('user_id', userId);

    if (error) {
      console.error('❌ Supabase Error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`✅ Клиент ${userId} успешно обновлён`, updatePayload);
    return NextResponse.json({ 
      success: true, 
      message: 'Клиент успешно обновлён' 
    });

  } catch (error: any) {
    console.error('❌ Update client error:', error);
    return NextResponse.json({ error: error.message || 'Внутренняя ошибка' }, { status: 500 });
  }
}