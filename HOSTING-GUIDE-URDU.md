# 🌐 Apne ERP ko ONLINE (hosting) par chalana — Urdu Guide

Yeh guide bataati hai ke is web ERP ko kisi online platform par kaise deploy karein,
taake aap **kisi bhi laptop/mobile se, kisi bhi jagah**, hamesha chalate rahein
— chahe yahan chat band ho jaye.

> **Login default:** `owner` / `owner123`

---

## 🚀 Sabse aasan tareeka — GitHub + Render ya Railway (free suru)

Ye tareeka laptop par kuch install karne ki **zaroorat nahi** rakhta. Aapko bas
ek GitHub account chahiye.

### Step 1 — Project ko GitHub par upload karo
1. GitHub par ek nayi **private repository** banao (jaise `erp`).
2. Is `erp/` folder ki saari files (source) ko repo me daalo.
   > `node_modules` aur `data` folder **mat daalo** — unki zaroorat nahi.
3. Upload karne ke baad GitHub par `.gitignore` add karo (neeche diya hai).

### Step 2 — Render par deploy karo (RECOMMENDED, free starter)
Render par **persistent disk** milti hai — data hamesha bacha rehta hai. Perfect.

1. [render.com](https://render.com) par sign up karo (free).
2. Dashboard me **"New" → "Blueprint"** par click karo.
3. Apni GitHub repo connect karo.
4. Render khud `render.yaml` padh lega aur app deploy kar dega (Docker + disk).
5. Kuch min me app ready — Render ek **live URL** degi (`https://your-app.onrender.com`).

**Render par persistent disk:** `render.yaml` me `/data` volume set hai, is liye
saara data (invoices, products, users) restart ke baad bhi bacha rahega.

### Step 3 — Railway par deploy karo (alternative)
1. [railway.app](https://railway.app) par sign up karo.
2. **"New Project" → "Deploy from GitHub repo"**.
3. Railway `railway.json` + `Dockerfile` khud padh lega.
4. Railway par bhi ek **persistent Volume** `/data` par mount karo (dashboard se).
5. Live URL milegi.

---

## 🔑 Login aur pehla istemal
Deploy hone ke baad:
1. Live URL kholo (mobile/laptop dono se).
2. `owner` / `owner123` se login karo.
3. Dashboard, Invoices, Reports — sab kaam karega.

---

## 💾 Data hamesha kahan bachta hai?
- Data SQLite file `data/erp.db` me hai.
- Hosting par `/data` volume me jaata hai (Render/Railway persistent disk).
- **Backup:** kabhi bhi apna data download rakhna:
  `render dashboard → Disk → download` (ya app me existing backup feature use karo).

---

## 🧪 Locally test karna (agar laptop par hi chalana ho)
```bash
cd erp
npm install      # sirf pehli baar
npm start        # -> http://localhost:3000
```
Laptop par Node.js 18+ install ho to yeh chalta hai.

---

## ⚙️ Environment variables (hosting par set karein)

| Variable | Default | Matlab |
|----------|---------|--------|
| `PORT` | `3000` | Server ka port (Render/ Railway khud set karte hain) |
| `DATA_DIR` | `./data` | Data folder (persistent volume ka path, jaise `/data`) |

Render/Railway par `PORT` aur `DATA_DIR=/data` already config me set hain.

---

## 📦 Deploy files is package me shamil hain
- `Dockerfile` — Docker image (Render/Railway/Fly ke liye)
- `render.yaml` — Render blueprint (disk + port + health check)
- `railway.json` — Railway config
- `setup-ubuntu.sh` — Ubuntu VPS ke liye auto-setup
- `DEPLOY.md` — Technical (English) guide

---

## ❓ Koi masla aa jaye to
Mujhe error message batao — main help karunga. Good luck! 🎉
