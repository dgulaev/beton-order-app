import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();
    console.log('🔍 [Role API] Received userId:', userId);

    if (!userId) {
      return NextResponse.json({ success: true, role: 'client' });
    }

    const parsedUserId = parseInt(userId.toString(), 10);

    // Устанавливаем контекст
    await supabase.rpc('set_current_user_id', { p_user_id: parsedUserId });

    // Прямой запрос
    const { data, error } = await supabase
      .from('users')
      .select('role')
      .eq('user_id', parsedUserId)
      .maybeSingle();

    console.log('📊 Query data:', data);
    console.log('📊 Query error:', error);

    if (error) {
      console.error('❌ Role fetch error:', error);
    }

    const role = data?.role || 'client';
    console.log(`✅ [Role API] Final role for ${parsedUserId}: ${role}`);

    return NextResponse.json({ success: true, role });

  } catch (e: any) {
    console.error('💥 Role API crash:', e);
    return NextResponse.json({ success: true, role: 'client' });
  }
}