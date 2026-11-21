import { defineConfig } from '@playwright/test';
import { PANEL } from './panel.js';

// No webServer: each worker starts its own static server on a free port (see tests/harness.js).
export default defineConfig({
  testDir: './tests',
  outputDir: '../out/test-results',
  reporter: 'list',
  retries: 0,
  fullyParallel: true,
  workers: 2,
  timeout: 15000,
  projects: [{
    name: 'panel',
    use: {
      browserName: 'chromium',
      headless: true,
      viewport: { width: PANEL.widthPx, height: PANEL.heightPx },
      deviceScaleFactor: 1,
      hasTouch: false,
    },
  }],
});
