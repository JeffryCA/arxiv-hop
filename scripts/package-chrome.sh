#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(node -p 'require("./manifest.json").version')
if [[ ${GITHUB_REF_TYPE:-} == tag && ${GITHUB_REF_NAME:-} != "v$version" ]]; then
  echo "Tag ${GITHUB_REF_NAME:-} must match manifest version v$version." >&2
  exit 1
fi

mkdir -p dist
staging=$(mktemp -d dist/chrome.XXXXXX)
trap 'rm -rf -- "$staging"' EXIT
zip -Xq "$staging/arxiv-hop-chrome.zip" \
  manifest.json background.js resolver.js downloads.js content.js content.css \
  popup.html popup.js popup.css icons/icon{16,32,48,128}.png
unzip -tq "$staging/arxiv-hop-chrome.zip"
mv "$staging/arxiv-hop-chrome.zip" dist/arxiv-hop-chrome.zip
