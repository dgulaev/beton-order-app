import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    const { userId, phone, referredBy } = await request.json();

    console.log(`📡 [Init API] Инициализация ${userId}, received referredBy:`, referredBy);

    if (!userId) {
      return NextResponse.json({ success: false, message: 'userId required' }, { status: 400 });
    }

    const parsedUserId = parseInt(userId.toString(), 10);
    let finalReferredBy: number | null = null;

    // Если передан реферальный код (строка вроде R1IF49D)
    if (referredBy && typeof referredBy === 'string' && referredBy.startsWith('R')) {
      console.log('🔍 Ищем пользователя по реферальному коду:', referredBy);
      
      const { data: referrer } = await supabase
        .from('users')
        .select('user_id')
        .eq('referral_code', referredBy)
        .maybeSingle();

      if (referrer) {
        finalReferredBy = referrer.user_id;
        console.log('✅ Реферер найден, user_id =', finalReferredBy);
      } else {
        console.log('⚠️ Реферер с кодом', referredBy, 'не найден');
      }
    } 
    // Если передан user_id (число)
    else if (referredBy && typeof referredBy === 'number') {
      finalReferredBy = referredBy;
    }

    // Получаем текущие данные
    const { data: existing } = await supabase
      .from('users')
      .select('role, referral_code, balance')
      .eq('user_id', parsedUserId)
      .maybeSingle();

    const currentRole = existing?.role || 'client';

    // Upsert
    const { data, error } = await supabase
      .from('users')
      .upsert({
        user_id: parsedUserId,
        phone: phone || null,
        role: currentRole,
        referral_code: existing?.referral_code || 'R' + Math.random().toString(36).substring(2, 8).toUpperCase(),
        balance: existing?.balance ?? 0,
        referred_by: finalReferredBy
      }, { onConflict: 'user_id' })
      .select('role, referral_code, balance, referred_by')
      .maybeSingle();

    if (error) {
      console.error('❌ Init error:', error);
      return NextResponse.json({ success: false, message: error.message });
    }

    console.log(`✅ Пользователь ${parsedUserId} сохранён. referred_by =`, data?.referred_by);

    return NextResponse.json({ 
      success: true,
      referralCode: data?.referral_code,
      balance: data?.balance || 0
    });

  } catch (error: any) {
    console.error('💥 Init API crash:', error);
    return NextResponse.json({ success: false, message: error.message });
  }
}