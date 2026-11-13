#!/usr/bin/env bash
# 打包扩展为 dist/skip-interstitial-<version>.zip，供 GitHub Release 附件使用
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p "require('./extension/manifest.json').version")
mkdir -p dist
out="dist/skip-interstitial-${version}.zip"
rm -f "$out"

cd extension
zip -r -X "../${out}" . -x "*.DS_Store" >/dev/null
cd ..

echo "built ${out}"
shasum -a 256 "$out"
