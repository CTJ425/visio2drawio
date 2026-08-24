import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs/promises';

test.describe('Visio2Drawio E2E Tests', () => {
  const sampleXrVssPath = path.resolve('samples/Dell-PowerEdge-RackServers/Dell-PowerEdge-XR.vss');
  const sampleRackServersVssPath = path.resolve('samples/Dell-PowerEdge-RackServers/Dell-PowerEdge-RackServers.vss');
  const sampleHpeVssPath = path.resolve('orig_data/HPE-ProLiant-RL.vss');

  test('should display home page with upload dropzone', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveTitle(/Visio to Draw.io/i);
    await expect(page.locator('h1.title')).toContainText('Visio to');
    await expect(page.locator('text=點擊或拖曳 Visio 檔案至此')).toBeVisible();
    await expect(page.getByText('.vss', { exact: true })).toBeVisible();
  });

  test('should click dropzone to open native file picker, upload HPE-ProLiant-RL.vss, render 12 stencils, and download .drawio', async ({ page }) => {
    await page.goto('/');

    // 1. Click on dropzone and handle native filechooser
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('label[for="visio-file-input"]').click(),
    ]);
    await fileChooser.setFiles(sampleHpeVssPath);

    // 2. Immediately verify file card, format selector, and download buttons are displayed
    await expect(page.getByText('HPE-ProLiant-RL.vss', { exact: true })).toBeVisible();
    await expect(page.locator('button:has-text("下載 .drawio 圖表檔")')).toBeVisible();
    await expect(page.locator('button:has-text("下載 .xml 形狀庫")')).toBeVisible();

    // 3. Verify Stencil Gallery loads and shows 12 stencils
    await expect(page.locator('text=形狀庫預覽 (Stencil Gallery)')).toBeVisible({ timeout: 25000 });
    await expect(page.locator('.badge:has-text("12 個元件")')).toBeVisible();

    // 4. Verify specific HPE stencil items
    await expect(page.locator('.stencil-item:has-text("RL300 Gen11")').first()).toBeVisible();

    // 5. Test Download .drawio button
    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("下載 .drawio 圖表檔")').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('HPE-ProLiant-RL.drawio');
  });

  test('should drag and drop HPE-ProLiant-RL.vss onto dropzone, render stencils, and download', async ({ page }) => {
    await page.goto('/');

    // 1. Read HPE file buffer and dispatch drag and drop event
    const fileBuffer = await fs.readFile(sampleHpeVssPath);
    const base64Data = fileBuffer.toString('base64');
    const fileName = 'HPE-ProLiant-RL.vss';

    await page.evaluate(({ base64Data, fileName }) => {
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const file = new File([bytes], fileName, { type: 'application/vnd.visio' });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      const dropzone = document.querySelector('label[for="visio-file-input"]');
      if (dropzone) {
        const dragEnterEvent = new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer });
        const dragOverEvent = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer });
        const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer });

        dropzone.dispatchEvent(dragEnterEvent);
        dropzone.dispatchEvent(dragOverEvent);
        dropzone.dispatchEvent(dropEvent);
      }
    }, { base64Data, fileName });

    // 2. Immediately verify file card is displayed
    await expect(page.getByText('HPE-ProLiant-RL.vss', { exact: true })).toBeVisible();
    await expect(page.locator('button:has-text("下載 .drawio 圖表檔")')).toBeVisible();

    // 3. Verify Stencil Gallery loads 12 stencils
    await expect(page.locator('text=形狀庫預覽 (Stencil Gallery)')).toBeVisible({ timeout: 25000 });
    await expect(page.locator('.badge:has-text("12 個元件")')).toBeVisible();

    // 4. Test Download .drawio button
    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("下載 .drawio 圖表檔")').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('HPE-ProLiant-RL.drawio');
  });

  test('should upload .vss file, render stencil gallery, filter shapes, and trigger download', async ({ page }) => {
    await page.goto('/');

    // 1. Upload sample .vss file
    await page.setInputFiles('#visio-file-input', sampleXrVssPath);

    // 2. Verify file name is displayed
    await expect(page.getByText('Dell-PowerEdge-XR.vss', { exact: true })).toBeVisible();

    // 3. Verify Stencil Gallery loads and shows total shapes count
    await expect(page.locator('text=形狀庫預覽 (Stencil Gallery)')).toBeVisible({ timeout: 25000 });
    await expect(page.locator('.badge:has-text("57 個元件")')).toBeVisible();

    // 4. Verify SVG images are rendered
    const stencilItems = page.locator('.stencil-item');
    await expect(stencilItems.first()).toBeVisible();
    const count = await stencilItems.count();
    expect(count).toBeGreaterThan(0);

    // 5. Test search filter
    const searchInput = page.locator('input[placeholder="搜尋元件名稱..."]');
    await searchInput.fill('XR11');
    await expect(page.locator('.stencil-item:has-text("XR11")').first()).toBeVisible();

    // 6. Test Format Selector toggle inside main
    const mainSection = page.locator('main');
    const drawioOption = mainSection.getByText('Draw.io 圖表檔 (.drawio)');
    const libraryOption = mainSection.getByText('Draw.io 自訂形狀庫 (.xml)');
    await expect(drawioOption).toBeVisible();
    await expect(libraryOption).toBeVisible();

    await libraryOption.click();

    // 7. Test Download .drawio button
    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("下載 .drawio 圖表檔")').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('Dell-PowerEdge-XR.drawio');

    // 8. Test Download .xml button
    const libraryDownloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("下載 .xml 形狀庫")').click();
    const libraryDownload = await libraryDownloadPromise;
    expect(libraryDownload.suggestedFilename()).toBe('Dell-PowerEdge-XR.xml');

    // 9. Test Reset button
    await page.locator('button:has-text("重新上傳")').click();
    await expect(page.locator('text=點擊或拖曳 Visio 檔案至此')).toBeVisible();
    await expect(page.getByText('Dell-PowerEdge-XR.vss', { exact: true })).not.toBeVisible();
  });

  test('should handle large 55MB Visio file (Dell-PowerEdge-RackServers.vss with 281 stencils)', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/');

    await page.setInputFiles('#visio-file-input', sampleRackServersVssPath);
    await expect(page.getByText('Dell-PowerEdge-RackServers.vss', { exact: true })).toBeVisible();

    // Verify Stencil Gallery loads with 281 total stencils (initial 60 preview)
    await expect(page.locator('text=形狀庫預覽 (Stencil Gallery)')).toBeVisible({ timeout: 45000 });
    await expect(page.locator('.badge:has-text("共 281 個元件")')).toBeVisible();

    // Verify search in loaded preview items
    const searchInput = page.locator('input[placeholder="搜尋元件名稱..."]');
    await searchInput.fill('C4140');
    await expect(page.locator('.stencil-item:has-text("C4140")').first()).toBeVisible();

    // Verify download trigger for large file
    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("下載 .drawio 圖表檔")').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('Dell-PowerEdge-RackServers.drawio');
  });
});
