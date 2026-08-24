'use client';

import React, { useCallback, useState, useEffect } from 'react';
import { UploadCloud, CheckCircle2 } from 'lucide-react';

interface UploaderProps {
  onFileSelect: (file: File) => void;
  selectedFile: File | null;
  isProcessing: boolean;
}

export function Uploader({ onFileSelect, selectedFile, isProcessing }: UploaderProps) {
  const [isDragOver, setIsDragOver] = useState(false);

  // Prevent browser from opening dropped files outside dropzone
  useEffect(() => {
    const preventDefault = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);
    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set false if leaving the main container
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      onFileSelect(file);
    }
  }, [onFileSelect]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      onFileSelect(file);
      // Reset input value so selecting the same file again still triggers onChange
      e.target.value = '';
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <label
      htmlFor="visio-file-input"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        display: 'block',
        position: 'relative',
        border: `2px dashed ${isDragOver ? 'var(--primary)' : '#cbd5e1'}`,
        borderRadius: 'var(--radius-lg)',
        padding: '2.5rem 1.5rem',
        textAlign: 'center',
        cursor: isProcessing ? 'not-allowed' : 'pointer',
        backgroundColor: isDragOver ? 'var(--primary-light)' : '#f8fafc',
        transition: 'all 0.2s ease',
        opacity: isProcessing ? 0.7 : 1,
        pointerEvents: isProcessing ? 'none' : 'auto',
      }}
    >
      <input
        type="file"
        id="visio-file-input"
        data-testid="visio-file-input"
        className="sr-only"
        accept=".vss,.vsd,.vssx,.vsdx,application/vnd.visio,application/x-visio,*"
        disabled={isProcessing}
        onChange={handleChange}
      />
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        {selectedFile ? (
          <>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: '#dcfce7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1rem'
            }}>
              <CheckCircle2 size={36} color="var(--success)" />
            </div>
            <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)' }}>
              {selectedFile.name}
            </span>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
              大小：{formatFileSize(selectedFile.size)}・點擊或拖曳可更換檔案
            </span>
          </>
        ) : (
          <>
            <div style={{
              width: '64px',
              height: '64px',
              borderRadius: '50%',
              backgroundColor: isDragOver ? '#c7d2fe' : '#e0e7ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1rem',
              transition: 'all 0.2s ease',
            }}>
              <UploadCloud size={36} color="var(--primary)" />
            </div>
            <span style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)' }}>
              {isDragOver ? '放開滑鼠即可上傳' : '點擊或拖曳 Visio 檔案至此'}
            </span>
            <span style={{ fontSize: '0.875rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              支援格式：<strong style={{ color: 'var(--primary)' }}>.vss</strong> (二進位圖形庫)、<strong>.vsd</strong>、<strong>.vssx</strong>、<strong>.vsdx</strong>
            </span>
          </>
        )}
      </div>
    </label>
  );
}
