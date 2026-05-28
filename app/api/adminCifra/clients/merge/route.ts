// app/api/adminCifra/clients/merge/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { sourceUserId, targetUserId } = await request.json();

    if (!sourceUserId || !targetUserId || sourceUserId === targetUserId) {
      return NextResponse.json({ error: 'Неверные ID клиентов' }, { status: 400 });
    }

    // 1. Переносим все заказы на целевого клиента
    await supabase
      .from('orders')
      .update({ user_id: targetUserId })
      .eq('user_id', sourceUserId);

    // 2. Удаляем исходного клиента
    await supabase
      .from('users')
      .delete()
      .eq('user_id', sourceUserId);

    console.log(`✅ Клиенты объединены: ${sourceUserId} → ${targetUserId}`);

    return NextResponse.json({ 
      success: true, 
      message: `Клиент ${sourceUserId} объединён с ${targetUserId}` 
    });

  } catch (error: any) {
    console.error('Merge error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}