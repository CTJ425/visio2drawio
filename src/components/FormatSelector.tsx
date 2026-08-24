'use client';

import React, { useState } from 'react';
import { Sliders, Layers, FileCode } from 'lucide-react';

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
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Format Selection Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
        <div
          onClick={() => !disabled && onChange({ ...settings, format: 'drawio' })}
          style={{
            border: `2px solid ${settings.format === 'drawio' ? 'var(--primary)' : 'var(--border)'}`,
            backgroundColor: settings.format === 'drawio' ? 'var(--primary-light)' : '#ffffff',
            borderRadius: 'var(--radius-md)',
            padding: '1.25rem',
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s ease',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '1rem',
          }}
        >
          <div style={{
            backgroundColor: settings.format === 'drawio' ? 'var(--primary)' : '#f1f5f9',
            color: settings.format === 'drawio' ? '#ffffff' : 'var(--text-muted)',
            padding: '0.65rem',
            borderRadius: 'var(--radius-sm)',
            display: 'flex'
          }}>
            <FileCode size={24} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
              Draw.io 圖表檔 (.drawio)
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              將所有形狀依網格排版在單一頁面上，下載後可直接開啟編輯。
            </div>
          </div>
        </div>

        <div
          onClick={() => !disabled && onChange({ ...settings, format: 'mxlibrary' })}
          style={{
            border: `2px solid ${settings.format === 'mxlibrary' ? 'var(--primary)' : 'var(--border)'}`,
            backgroundColor: settings.format === 'mxlibrary' ? 'var(--primary-light)' : '#ffffff',
            borderRadius: 'var(--radius-md)',
            padding: '1.25rem',
            cursor: disabled ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s ease',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '1rem',
          }}
        >
          <div style={{
            backgroundColor: settings.format === 'mxlibrary' ? 'var(--primary)' : '#f1f5f9',
            color: settings.format === 'mxlibrary' ? '#ffffff' : 'var(--text-muted)',
            padding: '0.65rem',
            borderRadius: 'var(--radius-sm)',
            display: 'flex'
          }}>
            <Layers size={24} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-main)' }}>
              Draw.io 自訂形狀庫 (.xml)
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              匯入為 Draw.io 側邊欄形狀庫（File → Open Library from Device），便於重複拖拉使用。
            </div>
          </div>
        </div>
      </div>

      {/* Advanced Settings Toggle */}
      <div style={{ marginTop: '0.5rem' }}>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: '0.875rem',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            fontWeight: 500,
          }}
        >
          <Sliders size={16} />
          {showAdvanced ? '隱藏進階排版設定' : '展開進階排版設定 (欄數與比例)'}
        </button>

        {showAdvanced && (
          <div style={{
            marginTop: '0.75rem',
            padding: '1rem 1.25rem',
            backgroundColor: '#f8fafc',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1.5rem',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)' }}>
                圖表排版欄數 (Columns)
              </label>
              <input
                type="number"
                min="1"
                max="10"
                value={settings.cols}
                disabled={disabled}
                onChange={(e) => onChange({ ...settings, cols: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                style={{
                  padding: '0.4rem 0.65rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  width: '100px',
                  fontSize: '0.875rem',
                }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>預設為 3 欄</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <label style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)' }}>
                圖形縮放比例 (Scale / DPI)
              </label>
              <input
                type="number"
                min="50"
                max="300"
                step="10"
                value={settings.scale}
                disabled={disabled}
                onChange={(e) => onChange({ ...settings, scale: Math.max(10, parseFloat(e.target.value) || 120) })}
                style={{
                  padding: '0.4rem 0.65rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--border)',
                  width: '100px',
                  fontSize: '0.875rem',
                }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>預設 120 (點/英吋)</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
