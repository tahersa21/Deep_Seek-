# Grok4Free — دليل المطوّر

## تشغيل المشروع

```bash
# workflow رئيسي (Replit)
artifacts/grok4free: web
→ gunicorn --bind=0.0.0.0:19803 --workers=2 --timeout=120 app:app

# أو يدوياً
cd /home/runner/workspace/extracted_project/grok4free
gunicorn --bind=0.0.0.0:19803 --workers=2 --timeout=120 app:app
```

## المسارات

- **لوحة التحكم**: `/grok/`
- **API**: `/grok/v1/chat/completions`
- **الصحة**: `/grok/healthz`

## متغيرات البيئة

| المتغير | القيمة | الوصف |
|---------|--------|-------|
| `PORT` | `19803` | منفذ الخادم |
| `BASE_PATH` | `/grok` | مسار الـ Flask routes |

## كيف يعمل الـ SSE Parser

```
grok.com يُرسل:
  data: {"result":{"response":{"token":"مرحباً"}}}
  data: {"result":{"response":{"token":" كيف"}}}
  data: {"result":{"response":{"isSoftStop":true,"responseId":"xxx"}}}

نحوّله إلى OpenAI format:
  data: {"choices":[{"delta":{"content":"مرحباً"}}]}
  data: {"choices":[{"delta":{"content":" كيف"}}]}
  data: {"choices":[{"delta":{},"finish_reason":"stop"}]}
  data: [DONE]
```

## نموذج grok-3-thinking

عند استخدام `grok-3-thinking`، يُرسل Grok chunks إضافية:
```json
{"result":{"response":{"thinking":"<think>أفكر في..."}}}
```

الـ dashboard يعرضها في مربع قابل للطي "جاري التفكير..."

## إضافة حساب جديد

1. افتح `grok.com` وسجّل الدخول
2. `F12` → Application → Cookies → `grok.com`
3. انسخ قيمة الكوكي `sso`
4. في لوحة التحكم: تبويب الحسابات → إضافة حساب

## هيكل config.json

```json
{
  "accounts": [
    {
      "id": "abc123",
      "name": "الحساب الأول",
      "sso_token": "eyJ...",
      "proxy": null
    }
  ],
  "active_id": "abc123"
}
```

## Gotchas

- `static_url_path` في Flask يجب أن يُضبط على `BASE_PATH + "/static"` وإلا CSS لا يُحمَّل
- عند إعادة التشغيل تأكد من تحرير port 19803: `kill $(lsof -ti:19803)`
- ملفات JSON تُخزَّن نسبةً إلى `__file__` — لا تشغّل من مسار مختلف
- الكوكي `sso` قد ينتهي بعد أسابيع — أعد الإضافة عند الحاجة
