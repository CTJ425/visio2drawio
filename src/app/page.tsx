'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Uploader } from '@/components/Uploader';
import { FormatSelector, ConvertSettings } from '@/components/FormatSelector';
import { StencilGallery } from '@/components/StencilGallery';
import { ProgressBar } from '@/components/ProgressBar';
import { DebugConsole, DebugLogEntry } from '@/components/DebugConsole';
import { uploadWithProgress, UploadProgress } from '@/lib/uploadHelper';
import type { StencilItem } from '@/lib/converter';
import { Download, Sparkles, AlertCircle, RefreshCw, ExternalLink, Eye, Bug } from 'lucide-react';

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isProcessingPreview, setIsProcessingPreview] = useState(false);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [progressStatusText, setProgressStatusText] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [stencils, setStencils] = useState<StencilItem[] | null>(null);
  const [totalStencils, setTotalStencils] = useState<number>(0);

  // Debug console state
  const [debugLogs, setDebugLogs] = useState<DebugLogEntry[]>([]);
  const [isDebugOpen, setIsDebugOpen] = useState(false);

  const addDebugLog = useCallback((type: 'info' | 'warn' | 'error', title: string, details?: any) => {
    const entry: DebugLogEntry = {
      timestamp: new Date().toLocaleTimeString(),
      type,
      title,
      details,
    };
    setDebugLogs((prev) => [...prev, entry]);
  }, []);

  // Fetch /api/health on mount to verify backend engine
  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        addDebugLog('info', '後端轉換引擎狀態檢驗成功', data);
      })
      .catch((err) => {
        addDebugLog('warn', '後端轉換引擎連線警示', err.message);
      });
  }, [addDebugLog]);

  const [settings, setSettings] = useState<ConvertSettings>({
    format: 'drawio',
    cols: 3,
    scale: 120,
  });

  const loadPreview = async (file: File, limit: number = 60) => {
    if (limit === 0) {
      setIsLoadingAll(true);
      addDebugLog('info', `開始載入全部 ${totalStencils} 個形狀元件預覽...`);
    } else {
      setIsProcessingPreview(true);
      addDebugLog('info', `開始解析「${file.name}」前 ${limit} 個形狀預覽...`, {
        file: { name: file.name, size: file.size, type: file.type },
      });
    }
    setError(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('limit', limit.toString());

    const result = await uploadWithProgress('/api/preview', formData, {
      responseType: 'json',
      onProgress: (p) => {
        if (p.phase === 'uploading') {
          setProgress(p);
          setProgressStatusText(`正在傳輸檔案至伺服器預覽... (${p.percent}%)`);
        } else if (p.phase === 'processing') {
          setProgress(p);
          setProgressStatusText('上傳完成，伺服器核心正在抽取向量圖案...');
        }
      },
    });

    if (result.ok && result.data?.success) {
      setStencils(result.data.items);
      const total = result.data.total || result.data.count || result.data.items.length;
      setTotalStencils(total);
      addDebugLog('info', `成功解析 ${result.data.items.length} 個向量元件 (總計: ${total})`, result.debugInfo);
      setProgress(null);
    } else {
      const errMsg = result.error || '解析檔案預覽失敗';
      addDebugLog('warn', '預覽產生失敗', { error: errMsg, debug: result.debugInfo });
      // Non-blocking warning so conversion is still possible
      setError(`預覽提示：${errMsg}（您仍可直接點擊下方按鈕進行轉檔下載）`);
      setProgress(null);
    }

    setIsProcessingPreview(false);
    setIsLoadingAll(false);
  };

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);
    setError(null);
    setStencils(null);
    setTotalStencils(0);
    setProgress(null);

    addDebugLog('info', `使用者已選取檔案：${file.name}`, {
      name: file.name,
      sizeBytes: file.size,
      sizeFormatted: `${(file.size / (1024 * 1024)).toFixed(2)} MB`,
      type: file.type || 'unknown/binary',
      lastModified: new Date(file.lastModified).toISOString(),
    });

    // Automatically trigger fast preview with limit 60 in background
    loadPreview(file, 60);
  };

  const handleDownload = async (targetFormat?: 'drawio' | 'mxlibrary') => {
    if (!selectedFile) return;

    const formatToUse = targetFormat || settings.format;
    setIsDownloading(true);
    setError(null);

    addDebugLog('info', `發起轉檔請求 (${formatToUse})...`, {
      fileName: selectedFile.name,
      format: formatToUse,
      cols: settings.cols,
      scale: settings.scale,
    });

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('format', formatToUse);
    formData.append('cols', settings.cols.toString());
    formData.append('scale', settings.scale.toString());

    const result = await uploadWithProgress('/api/convert', formData, {
      responseType: 'blob',
      onProgress: (p) => {
        setProgress(p);
        if (p.phase === 'uploading') {
          setProgressStatusText(`正在上傳檔案進行轉檔... (${p.percent}%)`);
        } else if (p.phase === 'processing') {
          setProgressStatusText(
            formatToUse === 'mxlibrary'
              ? '正在將 Visio 元件封裝為 Draw.io 形狀庫 (.xml)...'
              : '正在將 Visio 檔案串流轉換為 Draw.io 圖表檔 (.drawio)...'
          );
        }
      },
    });

    if (result.ok && result.blob) {
      const baseName = selectedFile.name.replace(/\.[^/.]+$/, '');
      const ext = formatToUse === 'mxlibrary' ? 'xml' : 'drawio';
      const filename = `${baseName}.${ext}`;

      const url = window.URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      addDebugLog('info', `轉檔並下載成功：${filename} (${(result.blob.size / 1024).toFixed(1)} KB)`, result.debugInfo);
      setProgress(null);
    } else {
      const errMsg = result.error || '轉換檔案失敗';
      setError(`轉檔失敗：${errMsg}`);
      addDebugLog('error', '轉檔請求失敗', { error: errMsg, debug: result.debugInfo });
      setIsDebugOpen(true); // Automatically open debug console on error
      setProgress(null);
    }

    setIsDownloading(false);
  };

  const handleReset = () => {
    setSelectedFile(null);
    setStencils(null);
    setTotalStencils(0);
    setError(null);
    setProgress(null);
    addDebugLog('info', '重置上傳狀態');
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

        {/* Upload & Conversion Progress Bar */}
        <ProgressBar
          progress={progress}
          statusText={progressStatusText}
        />

        {/* Error / Warning Alert */}
        {error && (
          <div className="alert alert-danger" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setIsDebugOpen(true)}
              style={{ fontSize: '0.75rem', whiteSpace: 'nowrap' }}
            >
              <Bug size={13} /> 查看除錯訊息
            </button>
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

        {/* Diagnostic Debug Console */}
        <DebugConsole
          logs={debugLogs}
          onClear={() => setDebugLogs([])}
          isOpen={isDebugOpen}
          onToggle={() => setIsDebugOpen(!isDebugOpen)}
        />
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
