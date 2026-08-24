import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

test.describe('QA Deep Verification Suite', () => {
  const HPE_FILE = path.resolve('orig_data/HPE-ProLiant-RL.vss');
  const LARGE_FILE = path.resolve('samples/Dell-PowerEdge-RackServers/Dell-PowerEdge-RackServers.vss');

  test('QA-1: Native Dropzone Click & File Picker selection for HPE-ProLiant-RL.vss', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const dropzoneLabel = page.locator('label[for="visio-file-input"]');
    await expect(dropzoneLabel).toBeVisible();

    // Trigger click on dropzone label to verify native label/input binding
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      dropzoneLabel.click(),
    ]);
    expect(fileChooser).toBeDefined();

    await fileChooser.setFiles(HPE_FILE);
    await expect(page.getByText('HPE-ProLiant-RL.vss', { exact: true })).toBeVisible();

    // Verify Stencil Gallery rendered with 12 items
    await expect(page.locator('text=形狀庫預覽 (Stencil Gallery)')).toBeVisible({ timeout: 25000 });
    await expect(page.locator('.badge:has-text("12 個元件")')).toBeVisible();

    const stencilCards = page.locator('.stencil-item');
    await expect(stencilCards).toHaveCount(12);

    // Verify all 12 stencils have valid data:image/svg+xml;base64 thumbnails
    const count = await stencilCards.count();
    for (let i = 0; i < count; i++) {
      const card = stencilCards.nth(i);
      const img = card.locator('.stencil-img-wrapper img');
      await expect(img).toBeVisible();
      const src = await img.getAttribute('src');
      expect(src).toMatch(/^data:image\/svg\+xml;base64,/);
    }
  });

  test('QA-2: Deep validation of downloaded .drawio XML and .xml mxlibrary contents', async ({ page }) => {
    await page.goto('/');
    await page.setInputFiles('#visio-file-input', HPE_FILE);
    await expect(page.locator('text=形狀庫預覽 (Stencil Gallery)')).toBeVisible({ timeout: 25000 });

    // Download and validate .drawio
    const [drawioDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button:has-text("下載 .drawio 圖表檔")').click(),
    ]);
    const drawioPath = await drawioDownload.path();
    const drawioContent = await fs.readFile(drawioPath, 'utf8');

    expect(drawioContent).toContain('<?xml');
    expect(drawioContent).toContain('<mxfile');
    expect(drawioContent).toContain('<mxGraphModel');
    expect(drawioContent).toContain('RL300');
    expect(drawioContent).toContain('image/svg+xml');

    // Download and validate .xml mxlibrary
    const [xmlDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button:has-text("下載 .xml 形狀庫")').click(),
    ]);
    const xmlPath = await xmlDownload.path();
    const xmlContent = await fs.readFile(xmlPath, 'utf8');

    expect(xmlContent).toContain('<mxlibrary>');
    expect(xmlContent).toContain('</mxlibrary>');

    const libraryJsonMatch = xmlContent.match(/<mxlibrary>([\s\S]*?)<\/mxlibrary>/);
    expect(libraryJsonMatch).not.toBeNull();
    const libraryItems = JSON.parse(libraryJsonMatch![1].trim());
    expect(Array.isArray(libraryItems)).toBe(true);
    expect(libraryItems).toHaveLength(12);

    const firstItem = libraryItems[0];
    expect(firstItem).toHaveProperty('title');
    expect(firstItem).toHaveProperty('xml');
    expect(firstItem).toHaveProperty('w');
    expect(firstItem).toHaveProperty('h');
    expect(typeof firstItem.w).toBe('number');
    expect(typeof firstItem.h).toBe('number');
  });

  test('QA-3: Native HTML5 Drag and Drop verification for HPE-ProLiant-RL.vss', async ({ page }) => {
    await page.goto('/');

    const fileBuffer = await fs.readFile(HPE_FILE);
    const base64Data = fileBuffer.toString('base64');
    const fileName = 'HPE-ProLiant-RL.vss';

    await page.evaluate(({ base64Data, fileName }) => {
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const file = new File([bytes], fileName, { type: 'application/vnd.visio' });
      const dt = new DataTransfer();
      dt.items.add(file);

      const dropzone = document.querySelector('label[for="visio-file-input"]');
      if (dropzone) {
        dropzone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
        dropzone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        dropzone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
      }
    }, { base64Data, fileName });

    await expect(page.getByText('HPE-ProLiant-RL.vss', { exact: true })).toBeVisible();
    await expect(page.locator('text=形狀庫預覽 (Stencil Gallery)')).toBeVisible({ timeout: 25000 });
    await expect(page.locator('.badge:has-text("12 個元件")')).toBeVisible();
  });

  test('QA-4: Large 55MB Visio file stress test & full download integrity', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/');

    const dropzoneLabel = page.locator('label[for="visio-file-input"]');
    const [fileChooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      dropzoneLabel.click(),
    ]);
    await fileChooser.setFiles(LARGE_FILE);

    await expect(page.getByText('Dell-PowerEdge-RackServers.vss', { exact: true })).toBeVisible();
    await expect(page.locator('text=形狀庫預覽 (Stencil Gallery)')).toBeVisible({ timeout: 45000 });
    await expect(page.locator('.badge:has-text("共 281 個元件")')).toBeVisible();

    // Verify search filter
    const searchInput = page.locator('input[placeholder="搜尋元件名稱..."]');
    await searchInput.fill('R750');
    await expect(page.locator('.stencil-item:has-text("R750")').first()).toBeVisible();

    // Test download of 55MB converted .drawio
    const [drawioDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.locator('button:has-text("下載 .drawio 圖表檔")').click(),
    ]);
    const drawioPath = await drawioDownload.path();
    const stat = await fs.stat(drawioPath);
    expect(stat.size).toBeGreaterThan(100000);
  });
});
