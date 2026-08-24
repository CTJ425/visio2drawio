import { test, expect } from '@playwright/test';
import path from 'node:path';

test('Test native Draw.io menu: Open Library and drag shape to canvas', async ({ page }) => {
  test.setTimeout(60000);

  const xmlPath = path.resolve('test_demo_hpe.xml');
  const { execSync } = await import('child_process');
  execSync(`./bin/vss2drawio orig_data/HPE-ProLiant-RL.vss "${xmlPath}" --format mxlibrary --scale 120`);

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
