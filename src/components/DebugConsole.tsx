'use client';

import React, { useState } from 'react';
import { Copy, Check, Trash2, ChevronDown, ChevronUp, Bug } from 'lucide-react';

export interface DebugLogEntry {
  timestamp: string;
  type: 'info' | 'warn' | 'error';
  title: string;
  details?: any;
}

interface DebugConsoleProps {
  logs: DebugLogEntry[];
  onClear: () => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function DebugConsole({ logs, onClear, isOpen, onToggle }: DebugConsoleProps) {
  const [copied, setCopied] = useState(false);

  const getFullLogText = () => {
    const header = `=== Visio2Drawio Debug Report ===\nTime: ${new Date().toISOString()}\nUser-Agent: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'N/A'}\nURL: ${typeof window !== 'undefined' ? window.location.href : 'N/A'}\n\n`;
    const body = logs.map((log) => {
      let detailStr = '';
      if (log.details) {
        try {
          detailStr = typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2);
        } catch {
          detailStr = String(log.details);
        }
      }
      return `[${log.timestamp}] [${log.type.toUpperCase()}] ${log.title}\n${detailStr ? detailStr + '\n' : ''}`;
    }).join('\n----------------------------------------\n');

    return header + body;
  };

  const handleCopy = () => {
    const text = getFullLogText();
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div style={{ marginTop: '2rem', borderTop: '1px solid var(--border)', paddingTop: '1.25rem' }}>
      {/* Debug Header Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '0.75rem',
      }}>
        <button
          type="button"
          onClick={onToggle}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-main)',
            fontSize: '0.9rem',
            fontWeight: 600,
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <Bug size={16} color={logs.some(l => l.type === 'error') ? 'var(--danger)' : 'var(--primary)'} />
          <span>除錯診斷模式 (Debug Console)</span>
          <span style={{
            fontSize: '0.75rem',
            padding: '0.15rem 0.5rem',
            borderRadius: '9999px',
            backgroundColor: logs.some(l => l.type === 'error') ? 'var(--danger-bg)' : '#f1f5f9',
            color: logs.some(l => l.type === 'error') ? 'var(--danger)' : 'var(--text-muted)',
            fontWeight: 600,
          }}>
            {logs.length} 則日誌
          </span>
          {isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {isOpen && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleCopy}
              title="複製完整除錯訊息以回報問題"
              style={{ fontSize: '0.75rem' }}
            >
              {copied ? <Check size={13} color="var(--success)" /> : <Copy size={13} />}
              {copied ? '已複製診斷日誌！' : '一鍵複製診斷訊息'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onClear}
              title="清空日誌"
              style={{ fontSize: '0.75rem' }}
            >
              <Trash2 size={13} /> 清空
            </button>
          </div>
        )}
      </div>

      {/* Expanded Console Box */}
      {isOpen && (
        <div style={{
          marginTop: '0.75rem',
          backgroundColor: '#0f172a',
          color: '#e2e8f0',
          borderRadius: 'var(--radius-md)',
          padding: '1rem',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: '0.8125rem',
          maxHeight: '320px',
          overflowY: 'auto',
          lineHeight: 1.5,
        }}>
          {logs.length === 0 ? (
            <div style={{ color: '#64748b', textAlign: 'center', padding: '1rem' }}>
              目前暫無除錯日誌。進行檔案上傳或轉檔時，詳細網路請求與核心訊息將記錄於此。
            </div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} style={{
                marginBottom: '0.75rem',
                paddingBottom: '0.75rem',
                borderBottom: idx === logs.length - 1 ? 'none' : '1px solid #1e293b',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                  <span style={{ color: '#64748b', fontSize: '0.75rem' }}>[{log.timestamp}]</span>
                  <span style={{
                    fontWeight: 700,
                    color: log.type === 'error' ? '#f87171' : log.type === 'warn' ? '#fbbf24' : '#38bdf8',
                  }}>
                    [{log.type.toUpperCase()}]
                  </span>
                  <span style={{ color: '#f8fafc', fontWeight: 600 }}>{log.title}</span>
                </div>
                {log.details && (
                  <pre style={{
                    margin: 0,
                    padding: '0.5rem',
                    backgroundColor: '#1e293b',
                    borderRadius: '4px',
                    color: '#94a3b8',
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>
                    {typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
