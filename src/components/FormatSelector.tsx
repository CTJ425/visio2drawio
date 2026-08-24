'use client';

import React from 'react';
import { Layers, Library, Settings2, HelpCircle } from 'lucide-react';

export interface ConvertSettings {
  format: 'drawio' | 'mxlibrary';
  cols: number;
  scale: number;
}

interface FormatSelectorProps {
  settings: ConvertSettings;
  onChange: (settings: ConvertSettings) => void;
  disabled?: boolean;
}

export function FormatSelector({ settings, onChange, disabled }: FormatSelectorProps) {
  const [showAdvanced, setShowAdvanced] = React.useState(false);

  const handleFormatChange = (format: 'drawio' | 'mxlibrary') => {
    onChange({ ...settings, format });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <label style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--text-main)' }}>
          選擇輸出格式與使用方式
        </label>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          兩種格式皆可於下方一鍵直接下載
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
        {/* Draw.io Diagram Option */}
        <div
          onClick={() => !disabled && handleFormatChange('drawio')}
          style={{
            border: `2px solid ${settings.format === 'drawio' ? 'var(--primary)' : 'var(--border)'}`,
            borderRadius: 'var(--radius-md)',
            padding: '1.25rem',
            cursor: disabled ? 'not-allowed' : 'pointer',
            backgroundColor: settings.format === 'drawio' ? 'var(--primary-light)' : '#ffffff',
            transition: 'all 0.2s ease',
            position: 'relative',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <Layers size={22} color={settings.format === 'drawio' ? 'var(--primary)' : 'var(--text-muted)'} />
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
              .drawio 繪圖畫布檔
            </div>
            <span style={{
              fontSize: '0.75rem',
              padding: '0.15rem 0.45rem',
              borderRadius: '4px',
              backgroundColor: '#e0e7ff',
              color: 'var(--primary)',
              fontWeight: 600,
            }}>
              整頁排版
            </span>
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            將所有向量形狀整齊排版在單一畫布上。
          </p>
          <div style={{
            marginTop: '0.65rem',
            padding: '0.4rem 0.6rem',
            backgroundColor: '#f1f5f9',
            borderRadius: '4px',
            fontSize: '0.75rem',
            color: '#334155',
            lineHeight: 1.4,
          }}>
            📍 <strong>Draw.io 開啟方式</strong>：使用<strong>「檔案 ➔ 開啟 (Open)」</strong>或直接拖曳至畫布中央。
          </div>
        </div>

        {/* Custom Library Option */}
        <div
          onClick={() => !disabled && handleFormatChange('mxlibrary')}
          style={{
            border: `2px solid ${settings.format === 'mxlibrary' ? 'var(--success)' : 'var(--border)'}`,
            borderRadius: 'var(--radius-md)',
            padding: '1.25rem',
            cursor: disabled ? 'not-allowed' : 'pointer',
            backgroundColor: settings.format === 'mxlibrary' ? 'var(--success-bg)' : '#ffffff',
            transition: 'all 0.2s ease',
            position: 'relative',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <Library size={22} color={settings.format === 'mxlibrary' ? 'var(--success)' : 'var(--text-muted)'} />
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
              .xml 左側自訂形狀庫
            </div>
            <span style={{
              fontSize: '0.75rem',
              padding: '0.15rem 0.45rem',
              borderRadius: '4px',
              backgroundColor: '#dcfce7',
              color: 'var(--success)',
              fontWeight: 600,
            }}>
              側邊欄專用
            </span>
          </div>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.5 }}>
            匯入為 Draw.io 左側工具箱形狀庫，便於隨時點選與重複拖拉使用。
          </p>
          <div style={{
            marginTop: '0.65rem',
            padding: '0.4rem 0.6rem',
            backgroundColor: '#f0fdf4',
            borderRadius: '4px',
            fontSize: '0.75rem',
            color: '#166534',
            lineHeight: 1.4,
          }}>
            📍 <strong>Draw.io 開啟方式</strong>：使用<strong>「檔案 ➔ 開啟形狀庫 (Open Library from) ➔ 裝置」</strong>。
          </div>
        </div>
      </div>

      {/* Advanced Settings Toggle */}
      <div style={{ marginTop: '0.25rem' }}>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--primary)',
            fontSize: '0.875rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: 0,
          }}
        >
          <Settings2 size={16} />
          <span>{showAdvanced ? '收合進階排版設定' : '展開進階排版設定 (欄數與比例)'}</span>
        </button>

        {showAdvanced && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginTop: '0.75rem',
            padding: '1rem',
            backgroundColor: '#f8fafc',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
          }}>
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.35rem', color: 'var(--text-main)' }}>
                畫布排版欄數 (Cols)
              </label>
              <input
                type="number"
                min={1}
                max={12}
                value={settings.cols}
                disabled={disabled}
                onChange={(e) => onChange({ ...settings, cols: parseInt(e.target.value, 10) || 3 })}
                style={{
                  width: '100%',
                  padding: '0.4rem 0.6rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  fontSize: '0.875rem',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '0.35rem', color: 'var(--text-main)' }}>
                縮放比例 (Scale / DPI)
              </label>
              <input
                type="number"
                min={20}
                max={600}
                step={10}
                value={settings.scale}
                disabled={disabled}
                onChange={(e) => onChange({ ...settings, scale: parseFloat(e.target.value) || 120 })}
                style={{
                  width: '100%',
                  padding: '0.4rem 0.6rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  fontSize: '0.875rem',
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
