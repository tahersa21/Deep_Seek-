# Free AI Proxies — DeepSeek4Free + Grok4Free

مشروعان مستقلان من بروكسيات OpenAI-compatible توفران وصولاً مجانياً لنماذج AI عبر reverse engineering، مع نظام إدارة حسابات متعدد، موازن حمل تلقائي، وواجهة لوحة تحكم عربية RTL.

---

## المشاريع

| المشروع | النماذج | المسار | المنفذ |
|---------|---------|--------|--------|
| **DeepSeek4Free** | deepseek-chat, deepseek-reasoner | `/` | 19802 |
| **Grok4Free** | grok-3, grok-3-thinking, grok-2 | `/grok/` | 19803 |

---

## Run & Operate

```bash
# DeepSeek4Free
artifacts/deepseek4free: web
→ gunicorn --bind=0.0.0.0:19802 --workers=2 --timeout=120 app:app

# Grok4Free
artifacts/grok4free: web
→ gunicorn --bind=0.0.0.0:19803 --workers=2 --timeout=120 app:app

# Node.js API server (مساعد)
artifacts/api-server: API Server
→ pnpm --filter @workspace/api-server run dev (port 8080, path /api)
```

---

## Stack

- **Backend**: Python 3.12 + Flask + Gunicorn
- **HTTP Client**: curl-cffi (Chrome TLS fingerprint لتجاوز Cloudflare)
- **Frontend**: HTML/CSS/JS أحادي الملف — واجهة عربية RTL (dark theme)
- **Workspace**: pnpm monorepo — Node.js 24 + TypeScript 5.9
- **API Proxy**: Express 5 (path `/api`) لنقاط نهاية Node.js مساعدة

---

## Where things live

```
extracted_project/
├── deepseek4free/
│   ├── app.py                  ← خادم Flask الرئيسي
│   ├── config.json             ← حسابات DeepSeek (تلقائي)
│   ├── api_keys.json           ← مفاتيح API (تلقائي)
│   ├── requirements.txt
│   ├── dsk/
│   │   ├── api.py              ← عميل DeepSeek (HTTP + curl-cffi + PoW)
│   │   ├── pow.py              ← حل Proof-of-Work عبر WASM
│   │   ├── server.py           ← Cloudflare bypass (FastAPI + Chrome)
│   │   └── wasm/               ← sha3 binary لـ PoW
│   ├── templates/index.html    ← لوحة التحكم (4 تبويبات)
│   └── static/
│       ├── css/style.css       ← تصميم RTL dark
│       └── js/app.js           ← منطق الواجهة + streaming
│
└── grok4free/
    ├── app.py                  ← خادم Flask الرئيسي
    ├── config.json             ← حسابات Grok (تلقائي)
    ├── api_keys.json           ← مفاتيح API (تلقائي)
    ├── requirements.txt
    ├── grok/
    │   ├── __init__.py
    │   └── api.py              ← عميل Grok (curl-cffi + SSE parser)
    ├── templates/index.html    ← لوحة التحكم (4 تبويبات)
    └── static/
        ├── css/style.css       ← تصميم RTL dark
        └── js/app.js           ← منطق الواجهة + streaming

artifacts/
├── deepseek4free/              ← scaffold + artifact.toml (يشغّل Flask)
├── grok4free/                  ← scaffold + artifact.toml (يشغّل Flask)
└── api-server/                 ← Node.js/Express server (مساعد)
```

---

## Architecture decisions

- **Flask بدلاً من Node.js**: curl-cffi يُعطي Chrome TLS fingerprint — غير متاح في Node.js
- **JSON files للتخزين**: لا حاجة لقاعدة بيانات — الإعدادات بسيطة وخفيفة
- **Round-Robin + Auto-Failover**: عزل الحسابات الفاشلة 5 دقائق تلقائياً
- **Artifact kind="web"**: كل artifact يحتوي Vite scaffold لكنّ الإنتاج يُشغّل gunicorn
- **SSE Streaming**: كلا المشروعين يدعمان streaming كامل متوافق مع OpenAI format

---

## DeepSeek4Free — المصادقة

```
1. سجّل دخول على chat.deepseek.com
2. F12 → Application → Cookies → chat.deepseek.com
3. انسخ قيمة الكوكي "userToken" أو من Network → Authorization header
```

## Grok4Free — المصادقة

```
1. سجّل دخول على grok.com
2. F12 → Application → Cookies → grok.com
3. انسخ قيمة الكوكي "sso"
```

---

## الاستخدام مع n8n / LangChain

```
DeepSeek → Base URL: https://your-domain.replit.app/v1
Grok     → Base URL: https://your-domain.replit.app/grok/v1
```

---

## User preferences

- واجهة عربية RTL دائماً
- Dashboard-first (لوحة التحكم، ليس chat)
- متوافق مع n8n AI Agent عبر tool calling
- Deployment نوع VM (always-running) — ليس autoscale لأن الحالة محفوظة في ملفات

---

## Gotchas

- **DeepSeek**: عند إعادة التشغيل: `kill $(lsof -ti:19802)`
- **Grok**: عند إعادة التشغيل: `kill $(lsof -ti:19803)`
- **Grok**: `static_url_path` يجب أن يُضبط على `BASE_PATH + "/static"` في Flask
- `nodriver`/`drissionpage` في DeepSeek ضروريان فقط لـ Cloudflare bypass المتقدم
- ملفات JSON تُخزَّن نسبةً إلى `__file__` — لا تشغّل من مسار مختلف

---

## Pointers

- توثيق DeepSeek التفصيلي: `extracted_project/deepseek4free/replit.md`
- توثيق Grok التفصيلي: `extracted_project/grok4free/replit.md`
- دليل نشر Google Cloud: `extracted_project/deepseek4free/README.md`
- دليل استخدام Grok4Free: `extracted_project/grok4free/README.md`
