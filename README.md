# Visio to Draw.io (visio2drawio)

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![libvisio](https://img.shields.io/badge/Engine-libvisio--0.1-green)](https://wiki.documentfoundation.org/DLP/Libraries/libvisio)
[![Playwright](https://img.shields.io/badge/E2E-Playwright-orange)](https://playwright.dev/)
[![Vitest](https://img.shields.io/badge/Tests-Vitest-yellow)](https://vitest.dev/)

一套全端 Web 應用程式，專為將 Microsoft Visio 的各種圖表與形狀庫檔案（包含舊版二進位 **`.vss`**、**`.vsd`** 以及現代 XML 格式 **`.vssx`**、**`.vsdx`**）精準轉換為 Draw.io (diagrams.net) 格式而設計。

---

## ✨ 核心特色

1. **支援全格式 Visio**：
   - 舊版二進位：**`.vss`** (圖形庫/Stencil)、**`.vsd`** (繪圖圖表)
   - 現代 XML 封裝：**`.vssx`** (圖形庫)、**`.vsdx`** (繪圖圖表)
2. **多種輸出格式**：
   - **Draw.io 圖表檔 (`.drawio`)**：將所有形狀按網格整齊排版在畫布上，下載後直接拖入 Draw.io 編輯。
   - **Draw.io 自訂形狀庫 (`.xml`)**：可直接匯入 Draw.io 側邊欄（`檔案 -> 開啟形狀庫 -> 裝置`），常駐使用。
   - **向量 SVG 圖案預覽 (Stencil Gallery)**：上傳後即時展示高解析向量縮圖、搜尋元件、個別下載 SVG。
3. **高效能 C++ 核心引擎 & 串流傳輸**：
   - 底層採用 `libvisio` 與 `librevenge`，完整保留原始向量形狀、文字與尺寸比例。
   - 伺服器端採串流傳輸（O(1) 記憶體佔用），完美處理 50MB+ 及 280+ 個大型圖形庫。
4. **Next.js 全端架構**：
   - 單一進程提供 React UI 與 Route Handlers API，無需分開管理前後端服務與 Port。

---

## 🚀 快速開始

### 1. 系統環境需求
- **Node.js** >= 18.0.0
- **C++ 編譯器** (支援 C++17) 與 `libvisio-0.1` 開發庫 (若需自行重新編譯底層引擎):
  ```bash
  # Ubuntu / Debian
  sudo apt-get install build-essential pkg-config libvisio-dev librevenge-dev
  ```

### 2. 安裝與執行

```bash
# 安裝 Node.js 依賴
npm install

# 啟動開發伺服器 (預設在 http://localhost:3000)
npm run dev

# 建置生產版本
npm run build

# 啟動生產伺服器
npm start
```

### 3. (選用) 重新編譯 Native 轉換引擎
若修改了 `src-native/vss2drawio.cpp`，可執行：
```bash
npm run build:native
```

---

## 🧪 自動化測試 (Unit, Smoke & E2E Tests)

專案內建完整的自動化測試套件（涵蓋單元測試、API 冒煙測試、瀏覽器 E2E 流程與大檔壓測）：

```bash
# 執行全部測試套件 (Vitest + Playwright)
npm test

# 僅執行單元測試 (Unit Tests)
npm run test:unit

# 僅執行 API 冒煙測試 (API Smoke Tests)
npm run test:smoke

# 僅執行瀏覽器端對端測試 (Playwright E2E Tests)
npm run test:e2e
```

---

## 📡 API 端點

| 方法 | 路徑 | 描述 |
| :--- | :--- | :--- |
| `GET` | `/api/health` | 檢查底層 `libvisio` 轉換引擎運作狀態 |
| `POST` | `/api/preview` | 上傳 Visio 檔案，回傳 Stencil 元件列表與 Base64 向量 SVG 預覽（支援 `limit` 參數） |
| `POST` | `/api/convert` | 接收 Visio 檔案與參數（`format`: `drawio` \| `mxlibrary`, `cols`, `scale`），串流下載檔案 |

---

## 📁 專案目錄結構

```
visio2drawio/
├── bin/
│   └── vss2drawio          # 預編譯之 C++ 轉換執行檔
├── samples/                # 範例 Visio 檔案 (.vss)
├── src-native/
│   └── vss2drawio.cpp      # 基於 libvisio/librevenge 的轉換核心源碼
├── src/
│   ├── app/
│   │   ├── api/            # Next.js App Router API Route Handlers
│   │   │   ├── convert/    # /api/convert (串流轉換下載)
│   │   │   ├── health/     # /api/health
│   │   │   └── preview/    # /api/preview (分頁與預覽抽取)
│   │   ├── globals.css     # 全域樣式
│   │   ├── layout.tsx      # 根版面
│   │   └── page.tsx        # 前端主頁面與狀態管理
│   ├── components/         # React UI 元件
│   │   ├── FormatSelector.tsx # 格式選擇與進階排版設定
│   │   ├── StencilGallery.tsx # 形狀庫向量預覽與搜尋畫廊
│   │   └── Uploader.tsx       # 全格式檔案拖曳上傳區
│   └── lib/
│       └── converter.ts    # 封裝 CLI 呼叫、串流與臨時檔案生命週期管理
└── tests/
    ├── unit/               # 單元測試 (Converter Lib)
    ├── smoke/              # API 冒煙測試 (Route Handlers)
    └── e2e/                # Playwright 瀏覽器端對端測試
```

---

## 💡 如何在 Draw.io 中使用產出的檔案？

- **開啟 `.drawio` 圖表**：至 [app.diagrams.net](https://app.diagrams.net)，直接將下載的 `.drawio` 檔案拖入瀏覽器視窗中。
- **載入 `.xml` 形狀庫**：在 Draw.io 介面中點選 **「檔案 (File) → 開啟形狀庫 (Open Library from) → 裝置 (Device)」**，選取下載的 `.xml` 檔案，即可在左側工具列看到所有專屬形狀元件。
