# DeepSeek4Free

بروكسي OpenAI-compatible يُوفّر وصولاً مجانياً لنماذج DeepSeek عبر reverse engineering،
مع نظام إدارة حسابات متعدد، موازن حمل تلقائي بـ Auto-Failover، وواجهة لوحة تحكم عربية RTL.

---

## ✨ المميزات

| الميزة | الوصف |
|--------|-------|
| 🔄 **OpenAI-compatible API** | `/v1/chat/completions` يعمل مع n8n، LangChain، وأي client يدعم OpenAI |
| 👥 **Multi-Account** | إدارة حسابات DeepSeek متعددة من واجهة واحدة |
| ⚖️ **Round-Robin Load Balancer** | توزيع الطلبات تلقائياً مع عزل الحسابات الفاشلة |
| 🔁 **Auto-Failover** | عند فشل حساب ينتقل للتالي تلقائياً دون فشل الطلب |
| 🔑 **API Key Auth** | مصادقة بمفاتيح قابلة للإضافة والحذف من الواجهة |
| 🛠️ **Tool Calling** | دعم `tools` متوافق مع OpenAI عبر system prompt injection |
| 🌙 **Arabic RTL Dashboard** | لوحة تحكم عربية dark theme بـ 4 تبويبات |
| 🌊 **Streaming** | ردود فورية token-by-token عبر SSE |

---

## 📦 التثبيت والتشغيل

### تشغيل محلي

```bash
git clone https://github.com/tahersa21/Deep_Seek-.git
cd Deep_Seek-/extracted_project/deepseek4free

pip install -r requirements.txt

gunicorn --bind=0.0.0.0:5000 --workers=2 --timeout=120 app:app
```

افتح المتصفح على `http://localhost:5000`

### المتطلبات

```
Python 3.10+
curl-cffi==0.8.1b9
wasmtime
numpy
flask
gunicorn
python-dotenv
nodriver      # مطلوب فقط لـ Cloudflare bypass
drissionpage  # مطلوب فقط لـ Cloudflare bypass
```

---

## 🔑 إعداد الحسابات

### الحصول على التوكن من DeepSeek

1. افتح [chat.deepseek.com](https://chat.deepseek.com) وسجّل الدخول
2. افتح DevTools (F12) → تبويب **Application**
3. في الشريط الجانبي: **Local Storage** → `https://chat.deepseek.com`
4. ابحث عن مفتاح `userToken` وانسخ قيمة `"value"`

أو عبر Console:
```js
JSON.parse(localStorage.getItem("userToken")).value
```

### إضافة الحسابات

من لوحة التحكم → تبويب **حسابات** → أدخل التوكن وانقر إضافة.

أو مباشرةً في `config.json`:
```json
{
  "accounts": [
    { "id": "acc1", "token": "YOUR_TOKEN_HERE", "proxy": null }
  ]
}
```

---

## 🔌 استخدام الـ API

### مثال أساسي

```python
import openai

client = openai.OpenAI(
    base_url="http://localhost:5000/v1",
    api_key="your-api-key"          # من تبويب مفاتيح API
)

response = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "مرحبا!"}]
)
print(response.choices[0].message.content)
```

### Streaming

```python
stream = client.chat.completions.create(
    model="deepseek-chat",
    messages=[{"role": "user", "content": "اشرح الذكاء الاصطناعي"}],
    stream=True
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
```

### Tool Calling (n8n AI Agent)

```json
{
  "model": "deepseek-chat",
  "messages": [{"role": "user", "content": "ما الطقس في الرياض؟"}],
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "الحصول على الطقس",
      "parameters": {
        "type": "object",
        "properties": { "city": {"type": "string"} },
        "required": ["city"]
      }
    }
  }]
}
```

---

## ⚖️ موازن الحمل والـ Failover

```
طلب جديد
    ↓
[حساب A] → فشل؟ → عزل 5 دقائق → [حساب B] → فشل؟ → [حساب C] → نجاح ✓
                                                          ↓
                                      (كل الحسابات فشلت → خطأ للعميل)
```

- **Auto-Recovery**: الحساب المعزول يعود تلقائياً بعد 5 دقائق
- **Last Resort**: إذا عُزلت جميع الحسابات تُعاد جميعها دفعةً واحدة
- **فحص الحالة**: `GET /dsk/balancer`
- **إعادة تعيين حساب**: `POST /dsk/balancer/{id}/reset`

---

## ☁️ النشر على Google Cloud

### متطلبات ما قبل النشر

```bash
# تثبيت Chrome (مطلوب لـ Cloudflare bypass فقط)
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install -y ./google-chrome-stable_current_amd64.deb

# تأكد من المسار
which google-chrome  # يجب أن يكون /usr/bin/google-chrome
```

### الخيار 1: Google Compute Engine VM (موصى به)

```bash
# إنشاء VM
gcloud compute instances create deepseek4free \
  --machine-type=e2-small \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --tags=http-server

# فتح المنفذ 80
gcloud compute firewall-rules create allow-http \
  --allow=tcp:80 \
  --target-tags=http-server

# على الـ VM بعد SSH
sudo apt update && sudo apt install -y python3-pip python3-venv
git clone https://github.com/tahersa21/Deep_Seek-.git
cd Deep_Seek-/extracted_project/deepseek4free
pip install -r requirements.txt
gunicorn --bind=0.0.0.0:80 --workers=4 --timeout=120 app:app
```

> **لماذا GCE وليس Cloud Run؟**
> التطبيق يخزّن الإعدادات في `config.json` و `api_keys.json` على القرص.
> Cloud Run stateless يمسح الملفات عند كل restart.
> **GCE VM يحتفظ بالبيانات** دائماً.

### الخيار 2: Cloud Run (مع تعديل)

لاستخدام Cloud Run تحتاج نقل التخزين لـ Cloud Storage أو Firestore بدلاً من JSON files.
غير موصى به دون تعديل الكود.

### متغيرات البيئة (اختيارية)

```bash
export PORT=8080                    # المنفذ (الافتراضي: يُمرَّر لـ gunicorn)
export SECRET_KEY="your-secret"     # للـ sessions
```

### Systemd Service (تشغيل تلقائي)

```ini
# /etc/systemd/system/deepseek4free.service
[Unit]
Description=DeepSeek4Free
After=network.target

[Service]
WorkingDirectory=/home/user/Deep_Seek-/extracted_project/deepseek4free
ExecStart=/usr/local/bin/gunicorn --bind=0.0.0.0:80 --workers=4 --timeout=120 app:app
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable deepseek4free
sudo systemctl start deepseek4free
```

---

## ⚠️ مشاكل Google Cloud المعروفة

| المشكلة | السبب | الحل |
|---------|-------|------|
| خطأ `nodriver` | Chrome غير مثبّت | `apt install google-chrome-stable` |
| مسار Chrome خاطئ | `dsk/server.py` يفترض `/usr/bin/google-chrome` | تثبيت Chrome في نفس المسار |
| فقدان الإعدادات بعد restart | Cloud Run stateless | استخدم GCE VM |
| `wasmtime` لا يعمل | معمارية CPU غير مدعومة | استخدم `x86_64` وليس `arm` |

---

## 📡 نقاط النهاية الكاملة

| Method | Path | الوصف |
|--------|------|-------|
| `GET` | `/` | لوحة التحكم (HTML) |
| `GET` | `/healthz` | فحص صحة الخادم |
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat |
| `GET` | `/dsk/accounts` | قائمة الحسابات |
| `POST` | `/dsk/accounts` | إضافة حساب |
| `DELETE` | `/dsk/accounts/{id}` | حذف حساب |
| `GET` | `/dsk/balancer` | حالة موازن الحمل |
| `POST` | `/dsk/balancer/{id}/reset` | إعادة تعيين حساب |
| `POST` | `/dsk/balancer/reset-all` | إعادة تعيين الكل |
| `GET` | `/dsk/keys` | قائمة مفاتيح API |
| `POST` | `/dsk/keys` | إنشاء مفتاح |
| `DELETE` | `/dsk/keys/{key}` | حذف مفتاح |

---

## 📄 الترخيص

MIT License — انظر ملف `LICENSE`
