# Grok4Free

بروكسي **OpenAI-compatible** يُوفّر وصولاً مجانياً لنماذج **Grok** من xAI عبر reverse engineering لـ grok.com، مع نظام إدارة حسابات متعدد، موازن حمل تلقائي، وواجهة لوحة تحكم عربية RTL.

---

## النماذج المدعومة

| النموذج | الوصف |
|---------|-------|
| `grok-3` | نموذج Grok الرئيسي |
| `grok-3-thinking` | مع تفكير مرئي (chain-of-thought) |
| `grok-2` | نسخة سابقة أخف |

---

## المتطلبات

- Python 3.10+
- حساب على [grok.com](https://grok.com) (مجاني)

---

## التثبيت والتشغيل

```bash
git clone <repo_url>
cd extracted_project/grok4free

pip install -r requirements.txt

# تشغيل محلي
python app.py

# أو عبر gunicorn (للإنتاج)
gunicorn --bind=0.0.0.0:19803 --workers=2 --timeout=120 app:app
```

---

## إضافة حساب — كيف تحصل على كوكي sso؟

```
1. افتح grok.com وسجّل الدخول
2. اضغط F12 → تبويب Application
3. في الشريط الجانبي: Cookies ← https://grok.com
4. ابحث عن الكوكي المسمى "sso"
5. انسخ قيمته والصقها في لوحة التحكم
```

---

## الاستخدام — OpenAI-compatible API

```bash
# Non-streaming
curl http://localhost:19803/grok/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "grok-3",
    "messages": [{"role": "user", "content": "مرحباً!"}]
  }'

# Streaming
curl http://localhost:19803/grok/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-3",
    "messages": [{"role": "user", "content": "مرحباً!"}],
    "stream": true
  }'
```

---

## نقاط النهاية

| Method | Path | الوصف |
|--------|------|-------|
| `GET`  | `/grok/` | لوحة التحكم |
| `POST` | `/grok/v1/chat/completions` | بروكسي OpenAI |
| `GET`  | `/grok/v1/models` | قائمة النماذج |
| `GET`  | `/grok/healthz` | حالة الخادم |
| `GET`  | `/grok/api/accounts` | قائمة الحسابات |
| `POST` | `/grok/api/accounts` | إضافة حساب |
| `DELETE` | `/grok/api/accounts/<id>` | حذف حساب |
| `POST` | `/grok/api/accounts/<id>/activate` | تفعيل حساب |
| `POST` | `/grok/api/accounts/<id>/test` | اختبار حساب |
| `GET`  | `/grok/api/keys` | مفاتيح API |
| `POST` | `/grok/api/keys` | إنشاء مفتاح |
| `DELETE` | `/grok/api/keys/<key>` | حذف مفتاح |
| `GET`  | `/grok/api/stats` | إحصاءات موازن الحمل |

---

## الاستخدام مع n8n / LangChain / أي client

```
Base URL:  https://your-domain.replit.app/grok/v1
API Key:   grok4f-xxxx (من لوحة مفاتيح API)
Model:     grok-3
```

---

## البنية الداخلية

```
grok4free/
├── app.py                  ← Flask server (نقطة الدخول)
├── config.json             ← حسابات Grok (ينشأ تلقائياً)
├── api_keys.json           ← مفاتيح API (ينشأ تلقائياً)
├── requirements.txt
├── grok/
│   ├── __init__.py
│   └── api.py              ← عميل HTTP (curl_cffi + SSE parser)
├── templates/
│   └── index.html          ← لوحة التحكم (4 تبويبات)
└── static/
    ├── css/style.css       ← تصميم RTL dark
    └── js/app.js           ← منطق الواجهة + streaming
```

---

## قرارات معمارية

- **curl_cffi**: يُعطي Chrome TLS fingerprint لتجاوز Cloudflare — ضروري لـ grok.com
- **JSON files**: لا حاجة لقاعدة بيانات — الإعدادات بسيطة وخفيفة
- **Round-Robin + Auto-Failover**: عزل الحسابات الفاشلة 5 دقائق تلقائياً
- **SSE Parser**: يحلل `result.response.token` و `result.response.thinking` من stream الاستجابة

---

## ملاحظات مهمة

- الكوكي `sso` يصلح عادةً لأسابيع — جدّده عند انتهاء صلاحيته
- لا تشارك كوكي الجلسة مع أحد — يمنح وصولاً كاملاً لحسابك
- الاستخدام التجاري قد يخالف شروط xAI — للاستخدام الشخصي والتعليمي فقط
