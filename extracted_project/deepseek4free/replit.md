# DeepSeek4Free — توثيق المشروع

واجهة ويب عربية RTL للتحدث مع DeepSeek AI مجاناً عبر reverse engineering،
مع نظام مفاتيح API متوافق مع OpenAI للاستخدام في n8n وغيرها.

---

## هيكل الملفات وترابطها

```
DeepSeek4Free/
├── app.py                          ← خادم Flask الرئيسي (نقطة الدخول)
├── requirements.txt                ← المكتبات المطلوبة
├── api_keys.json                   ← مفاتيح API المحفوظة (ينشأ تلقائياً)
│
├── dsk/                            ← حزمة التواصل مع DeepSeek
│   ├── __init__.py                 ← ملف فارغ يجعل dsk حزمة Python
│   ├── api.py                      ← العميل الرئيسي لـ DeepSeek API
│   ├── pow.py                      ← حل تحديات Proof-of-Work (WASM)
│   ├── cookies.json                ← كوكيز الجلسة {"cookies": {}}
│   └── wasm/
│       └── sha3_wasm_bg.*.wasm     ← ملف SHA3 الثنائي لحل PoW
│
├── templates/
│   └── index.html                  ← الواجهة الأمامية الكاملة (HTML)
│
└── static/
    ├── css/style.css               ← تصميم الواجهة (dark theme عربي RTL)
    └── js/app.js                   ← منطق الواجهة (streaming + API keys)
```

---

## ترابط الملفات — كيف تعمل معاً

```
المستخدم (المتصفح)
       │
       ▼
  index.html          ← الواجهة: تحميل style.css و app.js
       │
  app.js              ← يرسل طلبات إلى Flask عبر fetch()
       │
       ▼
  app.py (Flask)       ← يستقبل الطلبات ويوزعها على المسارات
       │
       ├─ GET  /                    → يعيد index.html
       ├─ POST /api/session         → ينشئ جلسة DeepSeek
       ├─ POST /api/chat            → يبث الرد (SSE streaming)
       ├─ GET  /api/keys            → يُعيد قائمة المفاتيح
       ├─ POST /api/keys            → ينشئ مفتاح API جديد
       ├─ DELETE /api/keys/<id>     → يحذف مفتاح
       └─ POST /v1/chat/completions → نقطة نهاية متوافقة مع OpenAI
                │
                ▼
          dsk/api.py (DeepSeekAPI)
                │
                ├─ _get_pow_challenge()  → يحل تحدي PoW (dsk/pow.py)
                ├─ create_chat_session() → يُنشئ جلسة على سيرفر DeepSeek
                └─ chat_completion()    → يبث الرد عبر SSE من DeepSeek
```

---

## وصف الواجهة الأمامية

### التصميم العام
- **اتجاه:** عربي RTL (من اليمين لليسار)
- **نمط:** Dark theme داكن بألوان أزرق-بنفسجي
- **خط:** Cairo (عربي) + Fira Code (للكود)
- **استجابة:** يعمل على الشاشات الصغيرة والكبيرة

### مكونات الواجهة

```
┌─────────────────────────────────────────────────────┐
│  [☰]  محادثة ذكية                        ● متصل    │  ← شريط علوي
├────────────────┬────────────────────────────────────┤
│                │                                    │
│  [دردشة] [API] │   منطقة المحادثة                   │
│  ─────────     │                                    │
│  + محادثة      │   [مرحباً بك في DeepSeek4Free]     │
│    جديدة       │   [بطاقات اقتراحات × 4]            │
│                │                                    │
│  الإعدادات:    │   رسالة المستخدم ←                 │
│  🤔 وضع التفكير│        → رد النموذج               │
│  🔍 بحث الويب  │           ⏱ 1.23s                 │
│                │                                    │
├────────────────┴────────────────────────────────────┤
│  [ اكتب رسالتك هنا...                          ➤ ] │  ← خانة الإدخال
│         Enter للإرسال • Shift+Enter لسطر جديد       │
└─────────────────────────────────────────────────────┘
```

### الشريط الجانبي — تبويبان

**تبويب "دردشة":**
- زر "محادثة جديدة" — يمسح الشاشة ويجلب جلسة جديدة مسبقاً
- مفتاح "وضع التفكير" — يُفعّل DeepSeek R1 (تفكير عميق أبطأ)
- مفتاح "بحث الويب" — يُفعّل البحث في الإنترنت

**تبويب "مفاتيح API":**
- عرض Base URL قابل للنسخ
- إنشاء مفاتيح `sk-` جديدة بأسماء مخصصة
- عرض المفاتيح المحفوظة (مُقنّعة)
- حذف المفاتيح
- دليل الاستخدام في n8n

### تدفق المحادثة (app.js)

```
المستخدم يكتب ويضغط Enter
         │
         ▼
  ensureSession()     ← يتأكد من وجود جلسة (مُجلَبة مسبقاً)
         │
         ▼
  fetch('/api/chat')  ← POST مع: session_id, prompt, thinking, search
         │
         ▼
  قراءة SSE stream    ← يقرأ chunks واحداً تلو الآخر
         │
         ├── chunk.type == 'thinking' → يعرض في مربع التفكير (قابل للطي)
         ├── chunk.type == 'text'     → يُضاف للفقاعة مع formatText()
         └── '[DONE]'                → ينهي الجلسة ويعرض الوقت النهائي ⏱
```

### مؤقت الاستجابة
- يبدأ العد فور إرسال الرسالة (كل 100ms)
- يتحول للون الأزرق ويثبت عند اكتمال الرد: `⏱ 2.37s`

---

## آلية العمل الداخلية (dsk/api.py)

### Proof-of-Work (PoW)
DeepSeek يطلب حل تحدي رياضي قبل كل رسالة:
```
1. جلب التحدي من /chat/create_pow_challenge
2. حل التحدي عبر WASM (sha3_wasm_bg.wasm) → رقم صحيح
3. إرسال الحل في header: x-ds-pow-response
```
**التحسين:** يُجلب التحدي التالي في الخلفية فور انتهاء الرد،
ويُتحقق من صلاحيته قبل الاستخدام (30 ثانية هامش أمان).

### Session Pre-fetch
بدلاً من إنشاء جلسة DeepSeek عند كل طلب، الجلسة تُنشأ مسبقاً
في خيط خلفي (background thread) وتُخزن جاهزة للاستخدام الفوري.

### SSE Streaming Format
DeepSeek يبث الرد بتنسيق خاص يختلف عن OpenAI:
```
# أول chunk يحدد المسار:
{"p":"response/content","o":"APPEND","v":"أول كلمة"}

# الـ chunks التالية delta فقط:
{"v":" كلمة"}
{"v":" أخرى"}

# نهاية عند:
{"p":"response/status","v":"FINISHED"}
```
متغير `active_path` يتتبع أين نحن (content أو thinking_content).

---

## نقطة النهاية المتوافقة مع OpenAI

```
POST /v1/chat/completions
Authorization: Bearer sk-YOUR_KEY
Content-Type: application/json

{
  "model": "deepseek-chat",        // أو "deepseek-reasoner" للتفكير العميق
  "messages": [
    {"role": "user", "content": "مرحبا"}
  ],
  "stream": false                  // true للـ streaming
}
```

الرد يأتي في: `choices[0].message.content`

---

## الإعدادات المطلوبة

| المتغير | المصدر | الوصف |
|---|---|---|
| `DEEPSEEK_AUTH_TOKEN` | Replit Secrets | توكن المصادقة من chat.deepseek.com |

**كيفية الحصول على التوكن:**
1. افتح chat.deepseek.com وسجّل الدخول
2. افتح DevTools (F12) → Network
3. أرسل أي رسالة → ابحث عن طلب `/api/v0/chat/completion`
4. انسخ قيمة `Authorization` header (بدون كلمة "Bearer")

---

## التشغيل والنشر

| البيئة | الأمر |
|---|---|
| تطوير | `python app.py` (port 5000) |
| إنتاج | `gunicorn --bind=0.0.0.0:5000 --workers=2 --timeout=120 app:app` |

**ملاحظة النشر:** يجب استخدام نوع `vm` (وليس autoscale) بسبب:
- خيوط خلفية (PoW + Session pre-fetch)
- ملف `api_keys.json` المحلي
- اتصالات SSE طويلة المدة

---

## المكتبات الرئيسية

| المكتبة | الإصدار | الغرض |
|---|---|---|
| `curl-cffi` | 0.8.1b9 | طلبات HTTP مع TLS fingerprint (Chrome120) |
| `wasmtime` | latest | تشغيل WASM لحل تحديات PoW |
| `numpy` | latest | قراءة نتيجة WASM (float64) |
| `flask` | latest | خادم الويب |
| `gunicorn` | latest | خادم الإنتاج |
