import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://nhudnzdgtidocwwzpqge.supabase.co';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();

    console.log('🔍 Role check received userId:', userId);

    if (!userId || userId.toString().trim() === '') {
      return NextResponse.json({ success: false, message: 'No userId' }, { status: 400 });
    }

    const parsedUserId = parseInt(userId.toString(), 10);
    if (isNaN(parsedUserId)) {
      return NextResponse.json({ success: false, message: 'Invalid userId' }, { status: 400 });
    }

    // ←←← Важно для RLS
    await supabase.rpc('set_current_user_id', { p_user_id: parsedUserId });

    const { data, error } = await supabase
      .from('users')
      .select('role')
      .eq('user_id', parsedUserId)
      .single();

    if (error) {
      console.error('Role fetch error:', error);
    }

    console.log('Role from DB:', data?.role || 'client');

    return NextResponse.json({
      success: true,
      role: data?.role || 'client'
    });

  } catch (error: any) {
    console.error('Role check error:', error);
    return NextResponse.json({ success: false, role: 'client' }, { status: 500 });
  }
}