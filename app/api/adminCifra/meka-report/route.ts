import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  compensateMekaCementDelta,
  rollbackMekaCementCompensation,
} from '@/lib/mekaCementCompensate';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    const body = await request.json();

    const { report_date, file_name, total_volume, total_cement, total_sand, 
            total_gravel, total_water, total_additive, raw_data } = body;

    // Проверка дубликата
    const { data: existing } = await supabase
      .from('meka_reports')
      .select('id')
      .eq('report_date', report_date)
      .eq('file_name', file_name)
      .single();

    if (existing) {
      return NextResponse.json({ message: 'Отчёт за этот день уже существует' }, { status: 409 });
    }

    const { data: inserted, error } = await supabase
      .from('meka_reports')
      .insert({
        report_date,
        file_name,
        total_volume: Number(total_volume || 0),
        total_cement: Number(total_cement || 0),
        total_sand: Number(total_sand || 0),
        total_gravel: Number(total_gravel || 0),
        total_water: Number(total_water || 0),
        total_additive: Number(total_additive || 0),
        raw_data: raw_data || []
      })
      .select('id, report_date')
      .maybeSingle();

    if (error) {
      console.error('Supabase insert error:', error);
      throw error;
    }

    const reportDate = String(inserted?.report_date || report_date).substring(0, 10);
    const compensation = await compensateMekaCementDelta({
      reportDate,
      mekaReportId: inserted?.id != null ? Number(inserted.id) : null,
      rawData: raw_data || [],
      userName: 'Оператор MEKA',
    });

    return NextResponse.json({
      success: true,
      message: 'Отчёт успешно сохранён',
      compensation: {
        status: compensation.status,
        skipped: compensation.skipped,
        deltaKg: compensation.deltaKg,
        bySilo: compensation.bySilo,
        message: compensation.message || null,
      },
    });
  } catch (error: any) {
    console.error('Ошибка POST /meka-report:', error);
    return NextResponse.json({ 
      error: error.message || 'Внутренняя ошибка сервера' 
    }, { status: 500 });
  }
}

export async function GET() {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data, error } = await supabase
      .from('meka_reports')
      .select('*')
      .order('report_date', { ascending: false });

    if (error) throw error;

    return NextResponse.json(data || []);
  } catch (error: any) {
    console.error('Ошибка GET /meka-report:', error);
    return NextResponse.json([], { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) return NextResponse.json({ error: 'ID не указан' }, { status: 400 });

    const { data: report, error: fetchError } = await supabase
      .from('meka_reports')
      .select('id, report_date')
      .eq('id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!report) {
      return NextResponse.json({ error: 'Отчёт не найден' }, { status: 404 });
    }

    const reportDate = String(report.report_date || '').substring(0, 10);
    const rollback = await rollbackMekaCementCompensation({
      reportDate,
      mekaReportId: Number(report.id),
    });

    if (!rollback.ok) {
      return NextResponse.json(
        {
          error: rollback.message || 'Не удалось откатить компенсацию MEKA — отчёт не удалён',
        },
        { status: 500 },
      );
    }

    const { error } = await supabase
      .from('meka_reports')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      compensationRollback: rollback,
    });
  } catch (error: any) {
    console.error('Ошибка DELETE:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
