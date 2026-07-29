'use client';

import { COLORS, overlayStyle, modalStyle, ghostButton } from '../labStyles';
import { useEscapeClose } from '../labUtils';
import LabSettingsForm from './LabSettingsForm';

interface Props {
  onClose: () => void;
}

export default function LabSettingsModal({ onClose }: Props) {
  useEscapeClose(onClose);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle(720)} onClick={(e) => e.stopPropagation()} className="scroll-hidden">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: 20, color: '#fff' }}>Реквизиты лаборатории</h2>
            <p style={{ margin: '6px 0 0', color: COLORS.muted, fontSize: 13, lineHeight: 1.4 }}>
              При обновлении в Росаккредитации замени номер декларации и ссылку FSA — QR пересоберётся сам.
            </p>
          </div>
          <button type="button" onClick={onClose} style={{ ...ghostButton, padding: '8px 14px' }}>
            ✕
          </button>
        </div>
        <LabSettingsForm showCancel onCancel={onClose} onSaved={onClose} />
      </div>
    </div>
  );
}
