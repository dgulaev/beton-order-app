/** Общие стили выгрузки отчётов в Excel (exceljs). */

import type ExcelJS from 'exceljs';

export const EXCEL_BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF94A3B8' } },
  left: { style: 'thin', color: { argb: 'FF94A3B8' } },
  bottom: { style: 'thin', color: { argb: 'FF94A3B8' } },
  right: { style: 'thin', color: { argb: 'FF94A3B8' } },
};

export const EXCEL_HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1E2937' },
};

export const EXCEL_SECTION_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFE2E8F0' },
};

export const EXCEL_ALT_ROW_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF8FAFC' },
};

export function styleTitleRow(row: ExcelJS.Row, colCount: number) {
  row.font = { bold: true, size: 14, color: { argb: 'FF0F172A' } };
  row.height = 22;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.border = EXCEL_BORDER_THIN;
  }
}

export function styleSectionRow(row: ExcelJS.Row, colCount: number) {
  row.font = { bold: true, size: 11, color: { argb: 'FF0F172A' } };
  row.fill = EXCEL_SECTION_FILL;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = EXCEL_SECTION_FILL;
    cell.border = EXCEL_BORDER_THIN;
    cell.font = { bold: true, size: 11, color: { argb: 'FF0F172A' } };
  }
}

/** Заголовок таблицы: тёмный фон, белый текст, границы. */
export function styleTableHeaderRow(row: ExcelJS.Row, colCount: number) {
  row.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  row.height = 18;
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.fill = EXCEL_HEADER_FILL;
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.border = EXCEL_BORDER_THIN;
    cell.alignment = { vertical: 'middle', wrapText: true };
  }
}

/** Обычная строка данных с границами; чётные — слегка серые. */
export function styleDataRow(row: ExcelJS.Row, colCount: number, alt: boolean) {
  for (let c = 1; c <= colCount; c++) {
    const cell = row.getCell(c);
    cell.border = EXCEL_BORDER_THIN;
    cell.alignment = { vertical: 'middle' };
    if (alt) cell.fill = EXCEL_ALT_ROW_FILL;
  }
}

/** KV-строка (показатель | значение) с границами. */
export function styleKeyValueRow(row: ExcelJS.Row, alt: boolean) {
  styleDataRow(row, 2, alt);
  row.getCell(1).font = { size: 10, color: { argb: 'FF334155' } };
  row.getCell(2).font = { size: 10, bold: true, color: { argb: 'FF0F172A' } };
}

export function autosizeColumns(sheet: ExcelJS.Worksheet, min = 10, max = 36) {
  sheet.columns.forEach((col) => {
    let width = min;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      const text =
        v == null
          ? ''
          : typeof v === 'object' && v && 'text' in v
            ? String((v as { text: string }).text)
            : String(v);
      width = Math.min(max, Math.max(width, text.length + 2));
    });
    col.width = width;
  });
}
