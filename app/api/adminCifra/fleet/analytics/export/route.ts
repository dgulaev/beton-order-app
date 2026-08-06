import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { VEHICLE_KINDS } from '@/lib/fleetCatalog';
import { buildFleetAnalytics } from '@/lib/fleetAnalytics';
import { ownershipTypeLabel } from '@/lib/fleetAnalyticsShared';
import { fleetTableMissingMessage } from '@/lib/fleetDocumentsServer';
import {
  autosizeColumns,
  styleDataRow,
  styleKeyValueRow,
  styleSectionRow,
  styleTableHeaderRow,
  styleTitleRow,
} from '@/lib/excelExportStyle';

function vehicleKindLabel(kind: string | null): string {
  if (!kind) return 'Все';
  return VEHICLE_KINDS.find((k) => k.key === kind)?.label ?? kind;
}

function formatDowntime(min: number): string {
  if (!min) return '0';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h <= 0) return `${m} мин`;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

function cellValue(v: string | number | null | undefined): string | number {
  if (v == null) return '';
  return v;
}

/** GET ?from=&to=&vehicle_kind= — выгрузка таблицы (3 листа) с оформлением. */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  try {
    const from = request.nextUrl.searchParams.get('from');
    const to = request.nextUrl.searchParams.get('to');
    const vehicleKind = request.nextUrl.searchParams.get('vehicle_kind');

    const data = await buildFleetAnalytics({ from, to, vehicleKind });
    const { kpi, byUnit, ownVsRented, costsByCategory } = data;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Цифра';
    wb.created = new Date();

    // ——— Сводка ———
    const summary = wb.addWorksheet('Сводка', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    const titleRow = summary.addRow(['Аналитика автопарка — стоимость владения']);
    styleTitleRow(titleRow, 2);
    summary.mergeCells(1, 1, 1, 2);

    const meta1 = summary.addRow(['Период', `${kpi.from} — ${kpi.to}`]);
    styleKeyValueRow(meta1, false);
    const meta2 = summary.addRow(['Вид техники', vehicleKindLabel(kpi.vehicleKind)]);
    styleKeyValueRow(meta2, true);

    summary.addRow([]);

    const secKpi = summary.addRow(['Показатели']);
    styleSectionRow(secKpi, 2);
    summary.mergeCells(secKpi.number, 1, secKpi.number, 2);

    const kpiPairs: [string, string | number | null][] = [
      ['Загрузка %', kpi.utilizationPct],
      ['Дни с рейсами (свои)', kpi.tripUnitDays],
      ['Доступные машино-дни', kpi.availableUnitDays],
      ['Простой', formatDowntime(kpi.downtimeMin)],
      ['На ремонте (сейчас)', kpi.repairCount],
      ['Стоимость владения всего, ₽', kpi.totalRub],
      ['Топливо, ₽', kpi.fuelRub],
      ['ТО / сервис, ₽', kpi.serviceRub],
      ['Прочие расходы, ₽', kpi.expensesRub],
      ['Единиц в отчёте', kpi.unitCount],
    ];
    kpiPairs.forEach(([label, value], i) => {
      const row = summary.addRow([label, cellValue(value)]);
      styleKeyValueRow(row, i % 2 === 1);
    });

    summary.addRow([]);

    const secOwn = summary.addRow(['Свои и в аренде']);
    styleSectionRow(secOwn, 9);
    summary.mergeCells(secOwn.number, 1, secOwn.number, 9);

    const ownHeader = summary.addRow([
      'Тип',
      'Единиц',
      'Рейсы',
      'м³',
      'Простой',
      'Средний простой/рейс',
      'Затраты ₽',
      '₽/рейс',
      '₽/м³',
    ]);
    styleTableHeaderRow(ownHeader, 9);

    ownVsRented.forEach((r, i) => {
      const row = summary.addRow([
        r.type === 'own' ? 'Свои' : 'В аренде',
        r.units,
        r.trips,
        r.volumeM3,
        formatDowntime(r.downtimeMin),
        cellValue(r.avgDowntimeMin),
        r.totalRub,
        cellValue(r.rubPerTrip),
        cellValue(r.rubPerM3),
      ]);
      styleDataRow(row, 9, i % 2 === 1);
    });

    autosizeColumns(summary, 12, 40);

    // ——— Стоимость владения по ТС ———
    const unitsSheet = wb.addWorksheet('Стоимость владения', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const unitsHeader = unitsSheet.addRow([
      'Номер',
      'Модель',
      'Вид',
      'Тип',
      'Статус',
      'Топливо ₽',
      'Топливо л',
      'ТО ₽',
      'Расходы ₽',
      'Итого ₽',
      '₽/км',
      'Рейсы',
      'м³',
      'Простой мин',
      'Дни с рейсами',
    ]);
    styleTableHeaderRow(unitsHeader, 15);

    byUnit.forEach((u, i) => {
      const row = unitsSheet.addRow([
        u.number,
        u.model ?? '',
        vehicleKindLabel(u.vehicleKind),
        ownershipTypeLabel(u.type),
        u.lifecycleStatus || 'active',
        u.fuelRub,
        u.fuelLiters,
        u.serviceRub,
        u.expensesRub,
        u.totalRub,
        cellValue(u.costPerKm),
        u.trips,
        u.volumeM3,
        u.downtimeMin,
        u.tripDays,
      ]);
      styleDataRow(row, 15, i % 2 === 1);
    });
    autosizeColumns(unitsSheet, 10, 28);

    // ——— Категории ———
    const catSheet = wb.addWorksheet('Категории', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const catHeader = catSheet.addRow(['Категория', '₽']);
    styleTableHeaderRow(catHeader, 2);
    costsByCategory.forEach((c, i) => {
      const row = catSheet.addRow([c.label, c.rub]);
      styleDataRow(row, 2, i % 2 === 1);
    });
    autosizeColumns(catSheet, 14, 32);

    const buf = await wb.xlsx.writeBuffer();
    const filename = `stoimost-vladeniya_${kpi.from}_${kpi.to}.xlsx`;

    return new NextResponse(Buffer.from(buf), {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка экспорта';
    return NextResponse.json(
      {
        success: false,
        error: /fuel_entries|fleet_expenses|fleet_service/i.test(msg)
          ? fleetTableMissingMessage(msg, 'fuel_entries')
          : msg,
      },
      { status: 500 },
    );
  }
}
