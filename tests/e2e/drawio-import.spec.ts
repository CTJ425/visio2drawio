import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { convertVisio } from '../../public/wasm/converter-core.mjs';

test('Test native Draw.io menu: Open Library and drag shape to canvas', async ({ page }) => {
  test.setTimeout(60000);

  const xmlPath = path.resolve('test_demo_hpe.xml');
  const vss = await fs.readFile(path.resolve('orig_data/HPE-ProLiant-RL.vss'));
  await fs.writeFile(xmlPath, await convertVisio(vss, { format: 'mxlibrary', scale: 120 }));

  console.log('Navigating to app.diagrams.net...');
  await page.goto('https://app.diagrams.net/?splash=0&offline=1&local=1', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Click File menu
  console.log('Clicking File menu...');
  const fileMenu = page.locator('.geMenubar a:has-text("File"), .geMenubar a:has-text("文件")').first();
  await fileMenu.click();
  await page.waitForTimeout(500);

  // Hover over "Open Library from"
  console.log('Hovering over Open Library from...');
  const openLibOption = page.locator('.mxPopupMenu tr:has-text("Open Library from"), .mxPopupMenu tr:has-text("開啟形狀庫"), .mxPopupMenu tr:has-text("打開圖庫")').first();
  await openLibOption.hover();
  await page.waitForTimeout(500);

  // Click "Device"
  console.log('Clicking Device...');
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('.mxPopupMenu tr:has-text("Device"), .mxPopupMenu tr:has-text("裝置"), .mxPopupMenu tr:has-text("設備")').last().click(),
  ]);

  console.log('Selecting XML library file in file picker...');
  await fileChooser.setFiles(xmlPath);
  await page.waitForTimeout(3000);

  // Click the first shape in the newly added custom palette to add it to canvas
  console.log('Clicking first shape in custom library...');
  const customPalette = page.locator('.geSidebarContainer .geSidebar').first();
  const firstShape = customPalette.locator('a.geItem').first();
  if (await firstShape.isVisible()) {
    await firstShape.click();
  }

  await page.waitForTimeout(2000);

  // Take screenshot
  await page.screenshot({ path: 'drawio_library_and_canvas_complete.png', fullPage: false });
  console.log('Saved drawio_library_and_canvas_complete.png');
});

test('draw.io uses the Visio connection points as the shape connection points', async ({ page }) => {
  test.setTimeout(90000);

  const vssx = await fs.readFile(path.resolve('tests/fixtures/connection-points.vssx'));
  const xml = new TextDecoder().decode(await convertVisio(vssx, { format: 'drawio' }));

  await page.goto('https://app.diagrams.net/?splash=0&offline=1&local=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => 'Graph' in window && 'mxCodec' in window, null, { timeout: 60000 });

  const points = await page.evaluate((xml) => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const w = window as any;
    const container = document.createElement('div');
    document.body.appendChild(container);
    const graph = new w.Graph(container);
    const doc = w.mxUtils.parseXml(xml);
    new w.mxCodec(doc).decode(doc.querySelector('mxGraphModel'), graph.getModel());
    const cell = Object.values(graph.getModel().cells).find((c: any) => c.vertex);
    const state = graph.view.getState(cell);
    const constraints = graph.getAllConnectionConstraints(state, true) || [];
    // Where an edge attaches, relative to the shape's top-left corner
    return constraints.map((c: any) => {
      const p = graph.getConnectionPoint(state, c);
      return [(p.x - state.x) / state.width, (p.y - state.y) / state.height];
    });
  }, xml);

  expect(points).toEqual([[0, 0.5], [1, 0.5], [0.5, 0]]);
});
