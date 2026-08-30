#!/usr/bin/env bash
# ============================================================
#  Multi-Company ERP — Ubuntu VPS Auto-Setup Script
#  Is script ko server par ek baar chalaen (as root ya sudo):
#      sudo bash setup-ubuntu.sh
# ============================================================
set -e

echo "=== 1. System update ==="
apt-get update -y && apt-get upgrade -y

echo "=== 2. Install Node.js 20 + PM2 ==="
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2

echo "=== 3. Install project dependencies ==="
cd "$(dirname "$0")"
npm install --production

echo "=== 4. Start ERP with PM2 ==="
pm2 delete erp 2>/dev/null || true
PORT=3000 pm2 start server.js --name erp
pm2 save
pm2 startup | tail -1  # reboot par bhi start hoga

echo ""
echo "=============================================="
echo " DONE! ERP ab chal raha hai."
echo " Local:  http://localhost:3000"
echo " Login:  owner / owner123"
echo " Next: domain + HTTPS ke liye neeche wala guide dekhein."
echo "=============================================="
