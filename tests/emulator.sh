#!/bin/bash
# Panel emulator tests: Playwright (headless Chromium) against the placeholder view at 1280x400.
cd "$(dirname "$0")/.." || exit 1
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-/opt/ms-playwright}"
npm ci --no-audit --no-fund --loglevel=error || exit 1
npx playwright test -c emulator/playwright.config.js
