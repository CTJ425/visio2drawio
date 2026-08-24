import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Visio to Draw.io Converter",
  description: "線上將 Visio 檔案 (.vss, .vsd, .vssx, .vsdx) 轉換為 draw.io 圖表與形狀庫",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-TW">
      <body>{children}</body>
    </html>
  );
}
