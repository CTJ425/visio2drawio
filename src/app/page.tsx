'use client';

import React, { useState } from 'react';
import { Uploader } from '@/components/Uploader';
import { FormatSelector, ConvertSettings } from '@/components/FormatSelector';
import { StencilGallery } from '@/components/StencilGallery';
import type { StencilItem } from '@/lib/converter';
import { Download, Sparkles, AlertCircle, RefreshCw, ExternalLink, Eye } from 'lucide-react';

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessingPreview, setIsProcessingPreview] = useState(false);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgressText, setDownloadProgressText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [stencils, setStencils] = useState<StencilItem[] | null>(null);
  const [totalStencils, setTotalStencils] = useState<number>(0);

  const [settings, setSettings] = useState<ConvertSettings>({
    format: 'drawio',
    cols: 3,
    scale: 120,
  });

  const loadPreview = async (file: File, limit: number = 60) => {
    if (limit === 0) {
      setIsLoadingAll(true);
    } else {
      setIsProcessingPreview(true);
    }
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('limit', limit.toString());

      const res = await fetch('/api/preview', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || '解析檔案預覽失敗');
      }

      setStencils(data.items);
      setTotalStencils(data.total || data.count || data.items.length);
    } catch (err: any) {
      console.warn('Preview error:', err);
      // Non-blocking warning for preview so user can still convert
      setError(`預覽產生提示：${err.message || '無法產生即時縮圖，但仍可直接進行轉檔下載。'}`);
    } finally {
      setIsProcessingPreview(false);
      setIsLoadingAll(false);
    }
  };

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setError(null);
    setStencils(null);
    setTotalStencils(0);

    // Automatically trigger fast preview with limit 60 in background
    loadPreview(file, 60);
  };

  const handleDownload = async (targetFormat?: 'drawio' | 'mxlibrary') => {
    if (!selectedFile) return;

    const formatToUse = targetFormat || settings.format;
    setIsDownloading(true);
    setDownloadProgressText(
      formatToUse === 'mxlibrary'
        ? '正在將 Visio 元件轉換為 Draw.io 形狀庫 (.xml)...'
        : '正在將 Visio 檔案轉換為 Draw.io 圖表檔 (.drawio)...'
    );
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('format', formatToUse);
      formData.append('cols', settings.cols.toString());
      formData.append('scale', settings.scale.toString());

      const res = await fetch('/api/convert', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || '轉換檔案失敗');
      }

      const blob = await res.blob();
      const baseName = selectedFile.name.replace(/\.[^/.]+$/, '');
      const ext = formatToUse === 'mxlibrary' ? 'xml' : 'drawio';
      const filename = `${baseName}.${ext}`;

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message || '下載轉換檔案時發生錯誤');
    } finally {
      setIsDownloading(false);
      setDownloadProgressText('');
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setStencils(null);
    setTotalStencils(0);
    setError(null);
  };

  return (
    <div className="container">
      {/* Header */}
      <header className="header">
        <div className="badge">
          <Sparkles size={14} /> Next.js + LibVisio 全端轉換引擎
        </div>
        <h1 className="title">
          Visio to <span className="title-gradient">Draw.io</span>
        </h1>
        <p className="subtitle">
          快速將 Visio Stencil 與圖表（.vss, .vsd, .vssx, .vsdx）轉換為 Draw.io 向量格式與自訂形狀庫
        </p>
      </header>

      {/* Main Upload & Configuration Card */}
      <main className="card">
        <Uploader
          onFileSelect={handleFileSelect}
          selectedFile={selectedFile}
          isProcessing={isDownloading}
        />

        {/* Status / Loading Banner */}
        {isDownloading && (
          <div style={{
            marginTop: '1.5rem',
            padding: '1rem',
            borderRadius: 'var(--radius-md)',
            backgroundColor: '#eef2ff',
            border: '1px solid #c7d2fe',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
            color: 'var(--primary)',
            fontWeight: 600,
          }}>
            <div className="spinner" style={{ borderTopColor: 'var(--primary)', borderColor: 'rgba(79, 70, 229, 0.2)' }} />
            <span>{downloadProgressText || '正在處理轉檔中，請稍候...'}</span>
          </div>
        )}

        {isProcessingPreview && !isDownloading && (
          <div style={{
            marginTop: '1.5rem',
            textAlign: 'center',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.75rem',
            color: 'var(--primary)',
            fontWeight: 600,
          }}>
            <div className="spinner" style={{ borderTopColor: 'var(--primary)', borderColor: 'rgba(79, 70, 229, 0.2)' }} />
            正在解析 Visio 向量元件縮圖，您可以隨時直接點擊下方按鈕進行轉檔下載...
          </div>
        )}

        {/* Error / Warning Alert */}
        {error && (
          <div className="alert alert-danger" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        )}

        {/* Selected File Actions */}
        {selectedFile && (
          <div style={{ marginTop: '1.5rem' }}>
            {/* Format Selection */}
            <FormatSelector
              settings={settings}
              onChange={setSettings}
              disabled={isDownloading}
            />

            {/* Action Buttons */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '1rem',
              marginTop: '1.5rem',
            }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={isDownloading}
                onClick={() => handleDownload('drawio')}
                style={{ flex: '1 1 220px' }}
              >
                <Download size={18} /> 下載 .drawio 圖表檔
              </button>

              <button
                type="button"
                className="btn btn-success"
                disabled={isDownloading}
                onClick={() => handleDownload('mxlibrary')}
                style={{ flex: '1 1 220px' }}
              >
                <Download size={18} /> 下載 .xml 形狀庫
              </button>

              {!stencils && !isProcessingPreview && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => loadPreview(selectedFile, 60)}
                >
                  <Eye size={16} /> 載入向量預覽
                </button>
              )}

              <button
                type="button"
                className="btn btn-secondary"
                disabled={isDownloading}
                onClick={handleReset}
                title="重新上傳"
              >
                <RefreshCw size={16} /> 重新上傳
              </button>
            </div>

            {/* Stencil Gallery */}
            {stencils && (
              <StencilGallery
                items={stencils}
                total={totalStencils}
                fileName={selectedFile.name}
                onLoadAll={() => loadPreview(selectedFile, 0)}
                isLoadingAll={isLoadingAll}
              />
            )}
          </div>
        )}
      </main>

      {/* Usage Tips Card */}
      <footer className="card" style={{ padding: '1.5rem 2rem' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--text-main)' }}>
          💡 如何在 Draw.io 中使用產出的檔案？
        </h3>
        <ul style={{ paddingLeft: '1.25rem', fontSize: '0.875rem', color: 'var(--text-muted)', lineHeight: 1.7 }}>
          <li>
            <strong>Draw.io 圖表檔 (.drawio)</strong>：前往 <a href="https://app.diagrams.net" target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>app.diagrams.net <ExternalLink size={12} style={{ display: 'inline' }} /></a>，直接將下載的 <code>.drawio</code> 檔案拖曳至瀏覽器畫布中即可直接編輯。
          </li>
          <li>
            <strong>Draw.io 自訂形狀庫 (.xml)</strong>：在 Draw.io 左側功能表點選 <strong>「檔案 (File) → 開啟形狀庫 (Open Library from) → 裝置 (Device)」</strong> 並選取 <code>.xml</code> 檔案，即可常駐於左側工具箱隨時拖拉使用。
          </li>
        </ul>
      </footer>
    </div>
  );
}
