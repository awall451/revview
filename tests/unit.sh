#!/bin/bash
# Unit tests: install from the lockfile, then run node:test. Lint is left to tools/check.
cd "$(dirname "$0")/.." || exit 1
npm ci --no-audit --no-fund --loglevel=error || exit 1
npm run --silent test:unit
