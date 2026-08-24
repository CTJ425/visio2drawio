'use client';

import React, { useState, useMemo } from 'react';
import { Search, Download, Copy, Check, Eye } from 'lucide-react';
import type { StencilItem } from '@/lib/converter';

interface StencilGalleryProps {
  items: StencilItem[];
  total: number;
  fileName: string;
  onLoadAll?: () => void;
  isLoadingAll?: boolean;
}

export function StencilGallery({ items, total, fileName: _fileName, onLoadAll, isLoadingAll }: StencilGalleryProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const filteredItems = useMemo(() => {
    if (!searchTerm.trim()) return items;
    const term = searchTerm.toLowerCase();
    return items.filter(
      item => item.title.toLowerCase().includes(term) || item.id.toString().includes(term)
    );
  }, [items, searchTerm]);

  const handleDownloadSvg = (item: StencilItem) => {
    const link = document.createElement('a');
    link.href = item.svgBase64;
    const safeTitle = item.title.replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]/g, '_') || `shape_${item.id}`;
    link.download = `${safeTitle}.svg`;
    link.click();
  };

  const handleCopyTitle = (item: StencilItem) => {
    navigator.clipboard.writeText(item.title);
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div style={{ marginTop: '2rem', borderTop: '1px solid var(--border)', paddingTop: '1.5rem' }}>
      {/* Header and Search Bar */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        marginBottom: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-main)' }}>
            形狀庫預覽 (Stencil Gallery)
          </h3>
          <span className="badge" style={{ margin: 0 }}>
            共 {total} 個元件 {total > items.length ? `(已載入前 ${items.length} 個)` : ''}
          </span>
          {total > items.length && onLoadAll && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={isLoadingAll}
              onClick={onLoadAll}
              style={{ fontSize: '0.75rem' }}
            >
              <Eye size={13} /> {isLoadingAll ? '正在載入全部...' : `載入全部 ${total} 個元件`}
            </button>
          )}
        </div>

        {/* Search Input */}
        <div style={{ position: 'relative', width: '100%', maxWidth: '280px' }}>
          <Search
            size={16}
            color="var(--text-light)"
            style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)' }}
          />
          <input
            type="text"
            placeholder="搜尋元件名稱..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem 0.5rem 2.25rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border)',
              fontSize: '0.875rem',
              outline: 'none',
            }}
          />
        </div>
      </div>

      {/* Grid of items */}
      {filteredItems.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '3rem 1rem',
          color: 'var(--text-muted)',
          backgroundColor: '#f8fafc',
          borderRadius: 'var(--radius-md)',
        }}>
          查無符合「{searchTerm}」的形狀元件
        </div>
      ) : (
        <div className="stencil-grid">
          {filteredItems.map((item) => (
            <div key={item.id} className="stencil-item">
              <div className="stencil-img-wrapper">
                <img
                  src={item.svgBase64}
                  alt={item.title}
                  loading="lazy"
                />
              </div>
              <div className="stencil-title" title={item.title}>
                {item.title || `Shape ${item.id}`}
              </div>
              <div className="stencil-dim">
                {item.widthInches.toFixed(2)}" × {item.heightInches.toFixed(2)}"
              </div>
              <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  title="下載 SVG 圖檔"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleDownloadSvg(item)}
                >
                  <Download size={14} />
                </button>
                <button
                  type="button"
                  title="複製元件名稱"
                  className="btn btn-secondary btn-sm"
                  onClick={() => handleCopyTitle(item)}
                >
                  {copiedId === item.id ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
