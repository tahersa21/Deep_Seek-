# DeepSeek4Free

بروكسي OpenAI-compatible يُوفّر وصولاً مجانياً لنماذج DeepSeek عبر reverse engineering،
مع نظام إدارة حسابات متعدد، موازن حمل تلقائي، وواجهة لوحة تحكم عربية RTL.

## Run & Operate

- `artifacts/deepseek4free: web` — تشغيل تطبيق Flask (port 19802, path `/`)
- `artifacts/api-server: API Server` — خادم Node.js المساعد (port 8080, path `/api`)

```bash
# تشغيل يدوي محلي
cd extracted_project/deepseek4free
gunicorn --bind=0.0.0.0:19802 --workers=2 --timeout=120 app:app
```

## Stack

- **Backend**: Python 3.12 + Flask + Gunicorn
- **Frontend**: HTML/CSS/JS أحادي الملف — واجهة عربية RTL (dark theme)
- **Workspace**: pnpm monorepo — Node.js 24 + TypeScript 5.9
- **API Proxy**: Express 5 (path `/api`) لنقاط نهاية Node.js مساعدة

## Where things live

```
extracted_project/deepseek4free/
├── app.py                  ← خادم Flask الرئيسي (نقطة الدخول الوحيدة)
├── config.json             ← إعدادات الحسابات والـ proxy (ينشأ تلقائياً)
├── api_keys.json           ← مفاتيح API للمصادقة (ينشأ تلقائياً)
├── requirements.txt        ← تبعيات Python
├── dsk/
│   ├── api.py              ← عميل DeepSeek (HTTP + curl-cffi + PoW)
│   ├── pow.py              ← حل Proof-of-Work عبر WASM
│   ├── server.py           ← خادم Cloudflare bypass (FastAPI + Chrome)
│   └── wasm/               ← ملف sha3 ثنائي لحل PoW
├── templates/index.html    ← الواجهة الكاملة (4 تبويبات)
└── static/
    ├── css/style.css       ← تصميم RTL dark
    └── js/app.js           ← منطق الواجهة + streaming

artifacts/api-server/       ← Node.js/Express server (مساعد)
artifacts/deepseek4free/    ← Vite scaffold (shell — الإنتاج يشغّل Flask)
```

## Architecture decisions

- **Flask بدلاً من Node.js**: curl-cffi يُعطي Chrome TLS fingerprint لتجاوز Cloudflare — غير متاح في Node.js
- **JSON files للتخزين**: لا حاجة لقاعدة بيانات — الإعدادات بسيطة وتُعدَّل يدوياً
- **Round-robin rotator مع Auto-Failover**: عند فشل حساب ينتقل تلقائياً للتالي دون إعلام العميل
- **Tool calling عبر System Prompt**: يُحقن تعريف الأدوات في الـ prompt لأن DeepSeek لا يدعمه مباشرةً
- **Artifact kind="web"**: الـ artifact يحتوي على Vite scaffold لكنّ الإنتاج يُشغّل gunicorn (Flask)

## Product

- لوحة تحكم عربية RTL بـ 4 تبويبات: حسابات | موازن الحمل | مفاتيح API | اختبار الاتصال
- بروكسي `/v1/chat/completions` متوافق مع OpenAI (streaming + tool calling)
- إدارة حسابات متعددة مع عزل تلقائي للحسابات الفاشلة (5 دقائق)
- Auto-Failover: عند فشل حساب ينتقل للتالي تلقائياً دون فشل الطلب
- مصادقة بمفاتيح API قابلة للإضافة والحذف من الواجهة

## User preferences

- واجهة عربية RTL دائماً
- Dashboard-first (لوحة التحكم، ليس chat)
- متوافق مع n8n AI Agent عبر tool calling
- Deployment نوع VM (always-running) — ليس autoscale لأن الحالة محفوظة في ملفات

## Gotchas

- `artifacts/api-server: DeepSeek4Free` workflow قديم — استخدم `artifacts/deepseek4free: web` بدلاً منه
- عند إعادة التشغيل تأكد من تحرير port 19802 أولاً: `kill $(lsof -ti:19802)`
- `nodriver`/`drissionpage` في requirements.txt ضرورية فقط لـ Cloudflare bypass — غير مستخدمة في التشغيل العادي
- ملفات JSON تُخزَّن نسبةً إلى `__file__` — لا تشغّل من مسار مختلف

## Pointers

- توثيق تفصيلي عربي: `extracted_project/deepseek4free/replit.md`
- دليل نشر Google Cloud: `extracted_project/deepseek4free/README.md`
