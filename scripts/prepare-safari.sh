#!/bin/bash
# Chuẩn bị thư mục extension tương thích Safari từ bản build dist/.
# Chạy trên Mac (hoặc VM): ./scripts/prepare-safari.sh
# Kết quả: thư mục ./safari-extension/ sẵn sàng cho:
#   xcrun safari-web-extension-converter safari-extension --app-name "ChessMate" --ios-only
set -e
cd "$(dirname "$0")/.."

echo "[1/3] Build extension (Vite)..."
npm run build

echo "[2/3] Copy dist -> safari-extension/..."
rm -rf safari-extension
cp -r dist safari-extension

echo "[3/3] Patch manifest cho Safari..."
node -e "
const fs = require('fs');
const p = 'safari-extension/manifest.json';
const m = JSON.parse(fs.readFileSync(p, 'utf8'));
// Safari không có chrome.offscreen -> bỏ permission lạ để converter không báo lỗi.
// (Code đã tự fallback sang iframe khi không có offscreen, như trên Orion iOS.)
m.permissions = (m.permissions || []).filter(x => x !== 'offscreen');
// Safari iOS không hỗ trợ commands API -> bỏ để tránh warning (không ảnh hưởng tính năng).
delete m.commands;
fs.writeFileSync(p, JSON.stringify(m, null, 2));
console.log('permissions:', JSON.stringify(m.permissions));
console.log('version:', m.version);
"

echo "OK: ./safari-extension/ sẵn sàng."
echo "Tiếp theo trên Mac:"
echo "  xcrun safari-web-extension-converter safari-extension --app-name \"ChessMate\" --ios-only"
