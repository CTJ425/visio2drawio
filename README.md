# Visio to Draw.io (visio2drawio)

[![Next.js](https://img.shields.io/badge/Next.js-16-black?style=flat&logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-blue?style=flat&logo=typescript)](https://www.typescriptlang.org/)
[![libvisio](https://img.shields.io/badge/Engine-libvisio_WASM-green)](https://wiki.documentfoundation.org/DLP/Libraries/libvisio)
[![Playwright](https://img.shields.io/badge/E2E-Playwright-orange)](https://playwright.dev/)
[![Vitest](https://img.shields.io/badge/Tests-Vitest-yellow)](https://vitest.dev/)

一套純前端的 Web 應用程式，將 Microsoft Visio 的圖表與形狀庫檔案（舊版二進位 **`.vss`**、**`.vsd`**，以及 XML 格式 **`.vssx`**、**`.vsdx`**）轉換為 Draw.io (diagrams.net) 格式。

轉換引擎是用 Emscripten 編譯成 WebAssembly 的 `libvisio`，在瀏覽器的 Web Worker 裡執行：**檔案不會上傳到任何伺服器**，整個網站是靜態檔案，可以直接部署在 Cloudflare Pages。

---

## ✨ 核心特色

1. **支援全格式 Visio**：
   - 舊版二進位：**`.vss`** (圖形庫/Stencil)、**`.vsd`** (繪圖圖表)
   - 現代 XML 封裝：**`.vssx`** (圖形庫)、**`.vsdx`** (繪圖圖表)
2. **多種輸出格式**：
   - **Draw.io 圖表檔 (`.drawio`)**：`.vsdx` 圖表會逐頁還原（見下方第 5 點）；形狀庫（`.vss`、`.vssx`）與舊版 `.vsd` 圖表則把所有形狀按網格排版在單一畫布上。下載後直接拖入 Draw.io 編輯。
   - **Draw.io 自訂形狀庫 (`.xml`)**：可直接匯入 Draw.io 側邊欄（`檔案 -> 開啟形狀庫 -> 裝置`），常駐使用。每個形狀採用 Draw.io 原生的圖片項目格式（`data` + `style`），圖片只存一份，連接點寫在 `style` 裡。
     - **圖片格式可選**：預設為**點陣 PNG**（以形狀尺寸 4 倍解析度保存完整圖案，最長邊上限 2048 px，Draw.io 放大到 400% 仍清晰），匯入與捲動形狀庫都很流暢；也可選**向量 SVG**，但 Visio 廠商圖形每個有上千條路徑，大型形狀庫在 Draw.io 中會明顯卡頓。實測 Dell RackServers（281 個形狀）：SVG 81.6 MB、匯入時主執行緒卡住約 3–4.5 秒；PNG 16 MB、約 0.6 秒。轉 PNG 在網頁主執行緒進行（`src/lib/rasterize.ts`），因為 Web Worker 無法解碼 SVG。
   - **向量 SVG 圖案預覽 (Stencil Gallery)**：即時展示向量縮圖、搜尋元件、個別下載 SVG。
3. **瀏覽器端 WebAssembly 引擎**：
   - 底層採用 `libvisio 0.1.11`、`librevenge 0.0.5`、`libxml2`，完整保留原始向量形狀、文字與尺寸比例。
   - 轉換在 Web Worker 中執行，不會卡住頁面；已實測 55 MB、281 個形狀的圖形庫。
   - Visio 內嵌的 EMF/WMF 圖片轉成 SVG 後直接寫進形狀的 SVG（不再包一層 base64），路徑資料以無損方式縮短（`public/wasm/svg-minify.mjs`），畫面與原本一致；Dell XR 形狀庫的 `.xml` 從 34.7 MB 降到 12.2 MB。
   - ICU 只打包 libvisio 用到的 Windows code page（1250–1258、874、932、936、949、950），WASM 約 1.7 MB。
4. **保留 Visio 連接點**：形狀的連接點 (connection points) 會轉成 Draw.io 的 `points` 樣式，連線會接在與 Visio 相同的位置（例如網卡的每個埠）；沒有連接點的形狀維持 Draw.io 預設。
5. **`.vsdx` 圖表逐頁還原成可編輯的 Draw.io 頁面**：每個 Visio 頁面對應一個 Draw.io 頁面，每個圖形是一個可編輯的 cell，連接器是接在原本圖形上的連線（保留折點、顏色、虛線與箭頭）。
   - 伺服器、交換器等 master 圖形沿用 libvisio 畫好的向量圖，依實例自己的位置、縮放、旋轉與翻轉放置。
   - 矩形與文字方塊轉成原生 Draw.io 圖形（填色、框線、文字樣式都保留）；其他自訂圖形轉成 SVG 圖片。
   - 舊版 `.vsd`（二進位）沒有可讀的頁面 XML，仍走形狀庫排版。
6. **零後端**：Next.js `output: 'export'` 靜態輸出，沒有 API、沒有伺服器成本，也沒有上傳大小限制。

---

## 🏗️ 架構

```
瀏覽器
 ├─ src/app/page.tsx                 React UI
 ├─ src/lib/converter.ts             Worker client（型別、請求配對）
 └─ Web Worker
     └─ public/wasm/converter.worker.mjs
         └─ public/wasm/converter-core.mjs   轉換入口與 JS ⇄ WASM 資料搬移（Worker 與單元測試共用）
             ├─ public/wasm/vss2drawio.{mjs,wasm}  由 src-native/vss2drawio.cpp 編譯：形狀庫、master 圖形的向量圖
             └─ public/wasm/vsdx-diagram.mjs       .vsdx 頁面 → Draw.io 頁面（vsdx-zip.mjs 讀封裝、vsdx-xml.mjs 解析 XML）
```

`.vsdx` 圖表走第二條路：libvisio 只會回報「要畫什麼」，沒有圖形、群組與連接器的結構，所以頁面結構（`visio/pages/page*.xml` 的 Shape 與 Connect）由 `vsdx-diagram.mjs` 直接從封裝讀取，只有 master 的圖案向 libvisio 要。純 JS，不需要重新編譯 WASM；`vsdx-*.mjs` 都有 `// @ts-check` 與 JSDoc 型別，`next build` 會一併做型別檢查。其他檔案（`.vss`、`.vssx`、`.vsd`，或沒有圖面頁的 `.vsdx`）維持由 libvisio 排成網格；`.vsdx` 頁面解析失敗時也會退回這個輸出，並在主控台留下警告。

`public/wasm/vss2drawio.mjs` 與 `vss2drawio.wasm` 是**預先建置並提交進 git 的產物**。一般開發與 Cloudflare Pages 建置都不需要 Emscripten；只有修改 `src-native/vss2drawio.cpp` 或升級 libvisio 時才要重建（見下方）。

---

## 🚀 快速開始

### 1. 系統環境需求
- **Node.js** >= 20.9（Next.js 16 的最低需求；專案以 `.node-version` 指定 22）

### 2. 安裝與執行

```bash
# 安裝 Node.js 依賴
npm install

# 啟動開發伺服器 (預設在 http://localhost:3000)
npm run dev

# 建置靜態網站，輸出到 out/
npm run build

# 在本機以靜態檔案伺服器預覽 out/（與 Cloudflare Pages 行為相同）
npm run preview
```

### 3. (選用) 重新編譯 WebAssembly 轉換引擎

修改 `src-native/vss2drawio.cpp` 或升級函式庫版本後執行。需要 Linux 或 WSL：

```bash
# 1. 安裝 Emscripten SDK（一次性）
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
~/emsdk/emsdk install latest && ~/emsdk/emsdk activate latest
source ~/emsdk/emsdk_env.sh

# 2. 建置工具（Ubuntu / Debian）
sudo apt-get install build-essential gperf icu-devtools curl patch

# 3. 建置，輸出到 public/wasm/
npm run build:wasm
```

腳本 `scripts/build-wasm.sh` 會下載並交叉編譯 libxml2、librevenge、libvisio（先套用 `scripts/libvisio-connection-points.patch`，讓 libvisio 讀出連接點），暫存目錄為 `.wasm-build/`（已 gitignore，第二次執行會跳過已建好的函式庫）。完成後請把 `public/wasm/vss2drawio.mjs` 與 `public/wasm/vss2drawio.wasm` 一起提交。

原生 CLI 版本仍可用 `npm run build:native` 編譯到 `bin/`（需要系統安裝 `libvisio-dev`、`librevenge-dev`、`pkg-config`），僅供本機除錯使用，網站不會用到。

---

## ☁️ 部署到 Cloudflare Pages

### 方式 A：連結 Git 儲存庫（推薦）

Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**，選擇此 repo 後依下表設定：

| 設定項目 | 值 | 說明 |
| :--- | :--- | :--- |
| Framework preset | `Next.js (Static HTML Export)` | 選 `None` 也可以，只要下面三項正確 |
| Build command | `npm run build` | 等同 `next build`；WASM 已預先建置，不需要 Emscripten |
| Build output directory | `out` | `next.config.ts` 的 `output: 'export'` 輸出位置 |
| Root directory | （留空） | repo 根目錄即是專案根目錄 |
| Production branch | `main` | |
| 環境變數 | 不需要 | Node 版本由 repo 內的 `.node-version`（22）決定；如需覆寫可設 `NODE_VERSION` |

不要選 `Next.js` preset（那是給 SSR 用的 `@cloudflare/next-on-pages`）；本專案沒有伺服器端程式碼。

### 方式 B：用 Wrangler 直接上傳

```bash
npm run build
npx wrangler pages deploy out --project-name visio2drawio
```

### 部署相關檔案

| 檔案 | 用途 |
| :--- | :--- |
| `next.config.ts` | `output: 'export'`，產生純靜態檔案 |
| `public/_headers` | Cloudflare Pages 回應標頭：`/_next/static/*` 長期快取；`/wasm/*` 檔名沒有 hash，設為每次重新驗證 |
| `.node-version` | 指定 Cloudflare Pages build image 使用的 Node 版本 |

### 限制檢查

| Cloudflare Pages 限制 | 本專案 |
| :--- | :--- |
| 單檔 25 MiB | 最大的 `vss2drawio.wasm` 約 1.7 MB |
| Free 方案 20,000 個檔案 | `out/` 約 30 個檔案 |
| 建置 20 分鐘逾時 | `next build` 約 1 分鐘內 |

Cloudflare 會自動以 `application/wasm` 提供 `.wasm`、以 JavaScript MIME 提供 `.mjs`，Worker 以 ES module 方式載入，不需要額外設定。

### 瀏覽器需求

需要支援 WebAssembly exception handling 與 module Worker 的瀏覽器：Chrome / Edge 95+、Firefox 114+、Safari 15.2+。轉換在使用者裝置上進行，行動裝置處理 50 MB 以上的檔案可能較慢或記憶體不足。

---

## 🧪 自動化測試 (Unit & E2E Tests)

```bash
# 執行全部測試套件 (Vitest + Playwright)
npm test

# 單元測試：在 Node 中直接載入 WASM 引擎驗證轉換結果
npm run test:unit

# 瀏覽器端對端測試：會以 `npm run preview` 啟動 out/，請先執行 npm run build
npm run test:e2e
```

---

## 📁 專案目錄結構

```
visio2drawio/
├── public/
│   ├── _headers                 # Cloudflare Pages 回應標頭
│   └── wasm/                    # 瀏覽器端轉換引擎
│       ├── vss2drawio.mjs       # Emscripten 產生的載入器（預先建置）
│       ├── vss2drawio.wasm      # libvisio WebAssembly（預先建置）
│       ├── converter-core.mjs   # 轉換入口、JS ⇄ WASM 資料搬移、EMF 轉 SVG
│       ├── vsdx-diagram.mjs     # .vsdx 頁面 → 可編輯的 Draw.io 頁面（入口）
│       ├── vsdx-model.mjs       # 封裝讀取、shape 模型、cell 繼承（自身 → master → 樣式表）
│       ├── vsdx-geometry.mjs    # Geometry 合併、路徑、SVG
│       ├── vsdx-transform.mjs   # 仿射矩陣、放置與連接點位置
│       ├── vsdx-text.mjs        # 文字與字元樣式 → HTML 標籤
│       ├── vsdx-formula.mjs     # ShapeSheet 公式（只支援幾何需要的部分）
│       ├── vsdx-encode.mjs      # 數字格式、跳脫、base64
│       ├── vsdx-xml.mjs         # 小型 XML 解析器（Worker 沒有 DOMParser）
│       ├── vsdx-zip.mjs         # .vsdx 封裝（ZIP）讀取
│       ├── emf-converter.mjs    # emf-converter 套件（npm run vendor:emf 複製）
│       └── converter.worker.mjs # Web Worker 入口
├── samples/                     # 範例 Visio 檔案 (.vss)
├── scripts/
│   ├── build-wasm.sh            # 以 Emscripten 重建 public/wasm
│   └── libvisio-connection-points.patch # 讓 libvisio 讀出連接點
├── src-native/
│   └── vss2drawio.cpp           # 轉換核心（WASM 匯出 + 原生 CLI）
├── src/
│   ├── app/
│   │   ├── globals.css          # 全域樣式
│   │   ├── layout.tsx           # 根版面
│   │   └── page.tsx             # 前端主頁面與狀態管理
│   ├── components/              # React UI 元件
│   │   ├── FormatSelector.tsx   # 格式選擇與進階排版設定
│   │   ├── ProgressBar.tsx      # 轉換進度
│   │   ├── StencilGallery.tsx   # 形狀庫向量預覽與搜尋畫廊
│   │   └── Uploader.tsx         # 檔案拖曳選取區
│   └── lib/
│       └── converter.ts         # Web Worker client
└── tests/
    ├── fixtures/                # 測試用 Visio 檔（含產生腳本）
    ├── unit/                    # WASM 引擎單元測試
    └── e2e/                     # Playwright 瀏覽器端對端測試
```

---

## 💡 如何在 Draw.io 中使用產出的檔案？

- **開啟 `.drawio` 圖表**：至 [app.diagrams.net](https://app.diagrams.net)，直接將下載的 `.drawio` 檔案拖入瀏覽器視窗中。
- **載入 `.xml` 形狀庫**：在 Draw.io 介面中點選 **「檔案 (File) → 開啟形狀庫 (Open Library from) → 裝置 (Device)」**，選取下載的 `.xml` 檔案，即可在左側工具列看到所有專屬形狀元件。
