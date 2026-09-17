#!/usr/bin/env bash
set -euo pipefail
bun build src/index.ts --compile --target bun-darwin-arm64 --outfile chart-room-darwin-arm64
if [[ "$(uname -s)" == Darwin ]]; then
  codesign --force --sign - chart-room-darwin-arm64
  codesign --verify --verbose=2 chart-room-darwin-arm64
fi
