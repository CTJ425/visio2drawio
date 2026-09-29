'use client';

import React from 'react';
import { FileSearch, Cpu, Download } from 'lucide-react';

export interface ConversionProgress {
  phase: 'reading' | 'processing' | 'completed';
}

interface ProgressBarProps {
  progress: ConversionProgress | null;
  statusText?: string;
}

export function ProgressBar({ progress, statusText }: ProgressBarProps) {
  if (!progress) return null;

  const getPhaseIcon = () => {
    switch (progress.phase) {
      case 'reading':
        return <FileSearch size={16} style={{ flexShrink: 0 }} color="var(--primary)" />;
      case 'processing':
        return <Cpu size={16} style={{ flexShrink: 0 }} color="var(--primary)" />;
      case 'completed':
        return <Download size={16} style={{ flexShrink: 0 }} color="var(--success)" />;
      default:
        return null;
    }
  };

  const defaultText =
    progress.phase === 'reading'
      ? '正在讀取檔案...'
      : progress.phase === 'processing'
      ? '正在本機解析 Visio 向量圖形...'
      : '處理完成！';

  // The WASM converter runs as one call without progress callbacks,
  // so the working phases show an indeterminate bar.
  const isWorking = progress.phase !== 'completed';

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        marginTop: '1.5rem',
        padding: '1.25rem',
        backgroundColor: '#f8fafc',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {/* Top row: Status text */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        columnGap: '1rem',
        rowGap: '0.25rem',
        marginBottom: '0.65rem',
        fontSize: '0.875rem',
      }}>
        <span style={{ fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {getPhaseIcon()}
          {statusText || defaultText}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
          檔案不會上傳到伺服器
        </span>
      </div>

      {/* Progress Track */}
      <div
        className={isWorking ? 'progress-track progress-track-indeterminate' : 'progress-track'}
        aria-hidden="true"
      >
        <div className="progress-fill" />
      </div>
    </div>
  );
}
