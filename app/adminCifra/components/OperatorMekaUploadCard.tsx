'use client';

import { useRef, useState, type CSSProperties } from 'react';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { parseMekaDateToIso } from '@/lib/mekaReportDate';
import { CARD_BORDER, volumeCardSoftStyle } from '../cardStyles';
import { appAlert } from './appDialog';

type Props = {
  style?: CSSProperties;
  onUploaded?: () => void;
};

function formatVolumeM3(value: number): string {
  const n = Number(value) || 0;
  const rounded = Math.round(n * 10) / 10;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toLocaleString('ru-RU', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** Компактная загрузка отчёта MEKA — со страницы отгрузок оператора. */
export default function OperatorMekaUploadCard({ style, onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = async (file: File) => {
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];

      const jsonData = XLSX.utils.sheet_to_json(sheet, {
        range: 5,
        defval: '',
        blankrows: false,
      });

      const processed = (jsonData as any[])
        .map((row: any) => ({
          no: row['__EMPTY_3'] || row['NO'] || '-',
          date: row['__EMPTY_1'] || row['DATE'] || '',
          time: row['__EMPTY_2'] || '',
          recipe: row['__EMPTY_4'] || row['RECIPE CODE'] || 'Неизвестно',
          qty: Number(row['__EMPTY_5'] || 0),
          sand: Number(row['__EMPTY_6'] || 0),
          gravel: Number(row['__EMPTY_7'] || 0),
          cement: Number(row['__EMPTY_12'] || 0),
          water: Number(row['__EMPTY_18'] || 0),
          additive: Number(row['__EMPTY_20'] || 0),
          additive2: Number(row['__EMPTY_21'] || row['__EMPTY_22'] || 0),
        }))
        .filter(
          (r) =>
            r.qty > 0
            && r.qty < 1000
            && r.recipe !== 'Неизвестно'
            && !r.recipe.includes('ИТОГО')
            && r.no !== '-',
        );

      if (processed.length === 0) {
        await appAlert('В файле не найдено партий для загрузки', {
          title: 'Отчёт MEKA',
          variant: 'danger',
        });
        return;
      }

      const totalVolume = processed.reduce((sum, r) => sum + r.qty, 0);
      const totalCement = processed.reduce((sum, r) => sum + r.cement, 0);

      const reportDate = parseMekaDateToIso(processed[0]?.date) || '';
      if (!reportDate) {
        await appAlert(
          'Не удалось разобрать дату отчёта из Excel (ожидается ДД.ММ.ГГГГ).',
          { title: 'Отчёт MEKA', variant: 'danger' },
        );
        return;
      }

      const res = await fetch('/api/adminCifra/meka-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: file.name,
          report_date: reportDate,
          total_volume: totalVolume,
          total_cement: totalCement,
          raw_data: processed,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        await appAlert(`Не удалось сохранить отчёт:\n${errorText}`, {
          title: 'Ошибка',
          variant: 'danger',
        });
        return;
      }

      await appAlert(
        `Отчёт «${file.name}» загружен.\nПартий: ${processed.length} · Объём: ${formatVolumeM3(totalVolume)} м³`,
        { title: 'MEKA', variant: 'success', okLabel: 'Ок' },
      );
      onUploaded?.();
    } catch (err) {
      console.error(err);
      await appAlert('Ошибка обработки файла Excel', {
        title: 'Ошибка',
        variant: 'danger',
      });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div
      style={{
        ...volumeCardSoftStyle({
          borderRadius: 16,
          padding: '10px 12px',
          height: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }),
        border: CARD_BORDER,
        ...style,
      }}
    >
      <div style={{
        fontSize: '12px',
        fontWeight: 700,
        color: '#E2E8F0',
        letterSpacing: '0.02em',
        marginBottom: '8px',
      }}>
        Отчёт MEKA
      </div>

      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        textAlign: 'center',
      }}>
        <div style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(16, 185, 129, 0.12)',
          border: '1px solid rgba(16, 185, 129, 0.35)',
        }}>
          <FileSpreadsheet size={20} color="#34D399" />
        </div>

        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            width: '100%',
            padding: '9px 10px',
            borderRadius: 11,
            background: busy
              ? 'rgba(16, 185, 129, 0.35)'
              : 'linear-gradient(135deg, rgba(16, 185, 129, 0.95), rgba(5, 150, 105, 0.95))',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 700,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.85 : 1,
            boxSizing: 'border-box',
          }}
        >
          {busy ? <Loader2 size={15} className="spin" style={{ animation: 'spin 0.8s linear infinite' }} /> : <Upload size={15} />}
          {busy ? 'Загрузка…' : 'Загрузить'}
          <input
            ref={inputRef}
            type="file"
            accept=".xls,.xlsx"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
            style={{ display: 'none' }}
          />
        </label>
      </div>
    </div>
  );
}
