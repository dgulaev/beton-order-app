import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

export async function POST(request: NextRequest) {
  try {
    const { userId, encrypted_password: newPasswordHash } = await request.json();

    if (!userId || !newPasswordHash) {
      return NextResponse.json({ 
        error: 'Не переданы userId или пароль' 
      }, { status: 400 });
    }

    const { error } = await supabaseAdmin
      .from('users')
      .update({ 
        password_hash: newPasswordHash,        // ← Исправлено
        updated_at: new Date().toISOString()
      })
      .eq('user_id', userId);

    if (error) {
      console.error('Ошибка обновления пароля:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    console.log(`✅ Пароль успешно обновлён для пользователя ${userId}`);

    return NextResponse.json({ 
      success: true, 
      message: 'Пароль успешно обновлён' 
    });

  } catch (err: any) {
    console.error('Ошибка в change-password:', err);
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}