# Deployment Guide — Multi-Company ERP

Ye guide batati hai ke is web ERP ko apne computer, mobile, ya online server par kaise chalaen.

---

## 1) Requirements

- **Node.js 18+** (LTS recommended) — download: https://nodejs.org
  - Test karein: `node -v` (≥ v18) aur `npm -v`
- Kisi hosting ki zaroorat nahi — ye **single server** app hai (Express + SQLite).

---

## 2) Local run (apne computer par)

```bash
cd erp
npm install          # pehli baar: dependencies install (sirf ek baar)
npm start            # server start -> http://localhost:3000
```

- **Default login:** `owner` / `owner123`
- Data file: `data/erp.db` (SQLite) — server folder me banti hai.

> Note: `node_modules` folder delete/change karne par `npm install` phir se chalein.

---

## 3) Network access (dusre devices / mobile se)

Server `0.0.0.0` par sunta hai, is liye same WiFi/LAN par koi bhi device access kar sakta hai:

1. Apne computer ka IP janein:
   - **Windows:** `ipconfig` (IPv4 address dekhein)
   - **Mac/Linux:** `ifconfig` ya `hostname -I`
2. Dusre device par browser me kholen:
   ```
   http://AAPKE-IP:3000
   ```
   Example: `http://192.168.1.10:3000`

Firewall me port `3000` open rakhna na bhoolen.

---

## 4) Production run (long-running, VPS / online server)

Best practice: **PM2** process manager se run karein taake crash par auto-restart ho.

```bash
cd erp
npm install
npm i -g pm2                    # globally install pm2
PORT=3000 pm2 start server.js --name erp
pm2 save
pm2 startup                     # system reboot par bhi start (guidance deta hai)
```

**PM2 commands:**
```bash
pm2 logs erp        # logs dekhne
pm2 restart erp     # restart
pm2 stop erp        # stop
pm2 status          # status
```

---

## 5) Domain + HTTPS (public website banane ke liye)

Jab server up ho, to domain aur SSL (HTTPS) ke liye reverse-proxy use karein.

**Option A — Caddy (sabse aasaan, auto SSL):**
```caddyfile
yourdomain.com {
    reverse_proxy localhost:3000
}
```

**Option B — Nginx:**
```nginx
server {
    server_name yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
SSL ke liye: `certbot --nginx` (Let's Encrypt free cert).

> **Important:** Jaaqeen karein ke `data/` folder ke andar `erp.db` ka **backup** rakhen — yehi aap ka saara data hai.

---

## 6) Cloud Platforms (No-server — easy deploy)

Project ko GitHub repo par daalein, phir inme se kisi ek par deploy karein (auto `npm install` + `npm start`):

| Platform | Steps |
|----------|-------|
| **Render** | New Web Service → connect repo → Build: `npm install` → Start: `npm start` → Environment: `PORT` |
| **Railway** | New Project → Deploy from GitHub → (auto detects Node) |
| **Fly.io** | `fly launch` → follows `package.json` |
| **Heroku** | `heroku create` → `git push heroku main` |

> SQLite file (local disk) har restart par reset ho sakti hai in free tiers. Persistent production ke liye VPS ya managed SQLite volume use karein.

---

## 7) Environment variables

| Env | Default | Matlab |
|-----|---------|--------|
| `PORT` | `3000` | Port jis par server chale |

DB path abhi fixed hai `data/erp.db`. Agar custom chahiye to `src/db.js` me `DB_PATH` change karein ya env se override karein.

---

## 8) Tests

```bash
npm test      # 39 automated tests (business rules, permissions, PDF/Excel, users)
```

---

## 9) Backup

Har kabhi backup lete rahen:
```bash
cp data/erp.db backups/erp-$(date +%F).db
```
App ke andar bhi "backup" record feature hai (seed data me example) — production me us se download bhi kar sakte hain.
