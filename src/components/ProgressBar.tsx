'use client';

import React from 'react';
import type { UploadProgress } from '@/lib/uploadHelper';
import { UploadCloud, Cpu, Download } from 'lucide-react';

interface ProgressBarProps {
  progress: UploadProgress | null;
  statusText?: string;
}

export function ProgressBar({ progress, statusText }: ProgressBarProps) {
  if (!progress) return null;

  const formatSize = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getPhaseIcon = () => {
    switch (progress.phase) {
      case 'uploading':
        return <UploadCloud size={16} className="spinner" style={{ border: 'none' }} />;
      case 'processing':
        return <Cpu size={16} color="var(--primary)" />;
      case 'downloading':
      case 'completed':
        return <Download size={16} color="var(--success)" />;
      default:
        return null;
    }
  };

  const defaultText =
    progress.phase === 'uploading'
      ? `正在上傳檔案... (${progress.percent}%)`
      : progress.phase === 'processing'
      ? '上傳完成，伺服器核心正在解析 Visio 向量圖形...'
      : '處理完成！';

  return (
    <div style={{
      marginTop: '1.5rem',
      padding: '1.25rem',
      backgroundColor: '#f8fafc',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      boxShadow: 'var(--shadow-sm)',
    }}>
      {/* Top row: Status text & size info */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '0.65rem',
        fontSize: '0.875rem',
      }}>
        <span style={{ fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {getPhaseIcon()}
          {statusText || defaultText}
        </span>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
          {progress.phase === 'uploading' && progress.total > 0
            ? `${formatSize(progress.loaded)} / ${formatSize(progress.total)}`
            : `${progress.percent}%`}
        </span>
      </div>

      {/* Progress Track */}
      <div style={{
        width: '100%',
        height: '10px',
        backgroundColor: '#e2e8f0',
        borderRadius: '9999px',
        overflow: 'hidden',
        position: 'relative',
      }}>
        <div
          style={{
            height: '100%',
            width: `${progress.percent}%`,
            background: progress.phase === 'processing'
              ? 'linear-gradient(90deg, #4f46e5 0%, #0ea5e9 100%)'
              : 'var(--primary)',
            borderRadius: '9999px',
            transition: 'width 0.2s ease-in-out',
          }}
        />
      </div>
    </div>
  );
}
