export interface UploadProgress {
  percent: number;
  loaded: number;
  total: number;
  phase: 'uploading' | 'processing' | 'downloading' | 'completed';
}

export interface UploadResult<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  blob?: Blob;
  error?: string;
  debugInfo?: {
    url: string;
    status: number;
    statusText: string;
    responseHeaders: Record<string, string>;
    responseBody: string;
    durationMs: number;
  };
}

export function uploadWithProgress(
  url: string,
  formData: FormData,
  options: {
    responseType?: 'json' | 'blob';
    onProgress?: (progress: UploadProgress) => void;
  } = {}
): Promise<UploadResult> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const startTime = Date.now();
    const isBlob = options.responseType === 'blob';

    if (isBlob) {
      xhr.responseType = 'blob';
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && options.onProgress) {
        const percent = Math.round((e.loaded / e.total) * 100);
        options.onProgress({
          percent,
          loaded: e.loaded,
          total: e.total,
          phase: percent >= 100 ? 'processing' : 'uploading',
        });
      }
    };

    xhr.onload = async () => {
      const durationMs = Date.now() - startTime;
      const headers: Record<string, string> = {};
      const rawHeaders = xhr.getAllResponseHeaders().trim().split(/[\r\n]+/);
      for (const line of rawHeaders) {
        const parts = line.split(': ');
        const header = parts.shift();
        const value = parts.join(': ');
        if (header) headers[header.toLowerCase()] = value;
      }

      let responseBody = '';
      let parsedData: any = null;
      let responseBlob: Blob | undefined = undefined;

      if (isBlob) {
        responseBlob = xhr.response as Blob;
        if (xhr.status >= 400) {
          try {
            responseBody = await responseBlob.text();
            parsedData = JSON.parse(responseBody);
          } catch {
            responseBody = `HTTP Error ${xhr.status}`;
          }
        }
      } else {
        responseBody = xhr.responseText || '';
        try {
          parsedData = JSON.parse(responseBody);
        } catch {
          parsedData = null;
        }
      }

      const debugInfo = {
        url,
        status: xhr.status,
        statusText: xhr.statusText,
        responseHeaders: headers,
        responseBody: responseBody.slice(0, 4000), // Cap for display
        durationMs,
      };

      if (xhr.status >= 200 && xhr.status < 300) {
        if (options.onProgress) {
          options.onProgress({ percent: 100, loaded: 1, total: 1, phase: 'completed' });
        }
        resolve({
          ok: true,
          status: xhr.status,
          data: parsedData,
          blob: responseBlob,
          debugInfo,
        });
      } else {
        const errorMsg = parsedData?.error || parsedData?.message || `請求失敗 (HTTP ${xhr.status}: ${xhr.statusText})`;
        resolve({
          ok: false,
          status: xhr.status,
          error: errorMsg,
          data: parsedData,
          debugInfo,
        });
      }
    };

    xhr.onerror = () => {
      const durationMs = Date.now() - startTime;
      resolve({
        ok: false,
        status: 0,
        error: '網路請求失敗，請確認伺服器是否連線正常。',
        debugInfo: {
          url,
          status: 0,
          statusText: 'Network Error',
          responseHeaders: {},
          responseBody: 'Network connection failed or request was aborted.',
          durationMs,
        },
      });
    };

    xhr.open('POST', url, true);
    xhr.send(formData);
  });
}
