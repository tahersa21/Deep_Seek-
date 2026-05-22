import os
import json
import secrets
import time
from flask import Flask, render_template, request, Response, stream_with_context
from dotenv import load_dotenv
from dsk.api import (
    DeepSeekAPI, AuthenticationError, RateLimitError,
    NetworkError, APIError, CloudflareError
)

load_dotenv()

app = Flask(__name__)

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")

_config_cache: dict | None = None


def _load_config() -> dict:
    global _config_cache
    if _config_cache is not None:
        return _config_cache
    try:
        with open(CONFIG_FILE, "r") as f:
            data = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}

    # Migrate old single-token format → new multi-account format
    if "auth_token" in data and "accounts" not in data:
        old_token = data["auth_token"]
        acc_id = secrets.token_hex(8)
        data = {
            "accounts": [{"id": acc_id, "name": "الحساب الافتراضي", "token": old_token}],
            "active_id": acc_id,
        }
        with open(CONFIG_FILE, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    if "accounts" not in data:
        data["accounts"] = []
    if "active_id" not in data:
        data["active_id"] = None

    _config_cache = data
    return _config_cache


def _save_config(cfg: dict) -> None:
    global _config_cache
    _config_cache = cfg
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def _get_active_token() -> str | None:
    cfg = _load_config()
    active_id = cfg.get("active_id")
    for acc in cfg.get("accounts", []):
        if acc["id"] == active_id:
            return acc["token"]
    # Fallback: use env var
    return os.getenv("DEEPSEEK_AUTH_TOKEN")


# Cache of per-account API instances  {account_id: DeepSeekAPI}
_api_instances: dict[str, DeepSeekAPI] = {}


def get_api() -> DeepSeekAPI:
    cfg = _load_config()
    active_id = cfg.get("active_id")
    token = _get_active_token()
    if not token:
        raise AuthenticationError("لم يتم تعيين حساب نشط بعد")

    key = active_id or "env"
    if key not in _api_instances:
        _api_instances[key] = DeepSeekAPI(token)
    return _api_instances[key]


def reset_api(account_id: str | None = None) -> None:
    global _api_instances
    if account_id:
        _api_instances.pop(account_id, None)
    else:
        _api_instances.clear()


try:
    get_api()
except Exception as e:
    print(f"Warning: Could not initialise API at startup: {e}")


# --------------------------------------------------------------------------- #
# Accounts endpoints                                                           #
# --------------------------------------------------------------------------- #

def _mask(token: str) -> str:
    if len(token) <= 12:
        return "***"
    return token[:8] + "..." + token[-4:]


@app.route("/dsk/accounts", methods=["GET"])
def list_accounts():
    cfg = _load_config()
    active_id = cfg.get("active_id")
    result = []
    for acc in cfg.get("accounts", []):
        result.append({
            "id": acc["id"],
            "name": acc["name"],
            "masked": _mask(acc["token"]),
            "active": acc["id"] == active_id,
            "created_at": acc.get("created_at", 0),
        })
    return {"accounts": result, "active_id": active_id}


@app.route("/dsk/accounts", methods=["POST"])
def add_account():
    data = request.json or {}
    token = data.get("token", "").strip()
    name = data.get("name", "").strip() or "حساب جديد"
    if not token:
        return {"error": "التوكن مطلوب"}, 400

    cfg = _load_config()
    acc_id = secrets.token_hex(8)
    new_acc = {"id": acc_id, "name": name, "token": token, "created_at": int(time.time())}
    cfg["accounts"].append(new_acc)

    # Auto-activate if it's the first account or no active account
    if not cfg.get("active_id") or not any(a["id"] == cfg["active_id"] for a in cfg["accounts"]):
        cfg["active_id"] = acc_id

    _save_config(cfg)
    reset_api(acc_id)

    # Try connecting to verify token
    try:
        reset_api(acc_id)
        get_api()
        ok_msg = "تم إضافة الحساب بنجاح"
    except Exception as e:
        ok_msg = f"تم الحفظ لكن تحقق من التوكن: {e}"

    return {
        "ok": True,
        "id": acc_id,
        "message": ok_msg,
        "active": cfg["active_id"] == acc_id,
    }, 201


@app.route("/dsk/accounts/<acc_id>", methods=["PATCH"])
def rename_account(acc_id):
    data = request.json or {}
    name = data.get("name", "").strip()
    if not name:
        return {"error": "الاسم مطلوب"}, 400
    cfg = _load_config()
    acc = next((a for a in cfg["accounts"] if a["id"] == acc_id), None)
    if not acc:
        return {"error": "الحساب غير موجود"}, 404
    acc["name"] = name
    _save_config(cfg)
    return {"ok": True}


@app.route("/dsk/accounts/<acc_id>", methods=["DELETE"])
def remove_account(acc_id):
    cfg = _load_config()
    before = len(cfg["accounts"])
    cfg["accounts"] = [a for a in cfg["accounts"] if a["id"] != acc_id]
    if len(cfg["accounts"]) == before:
        return {"error": "الحساب غير موجود"}, 404

    # If the deleted account was active, activate the first remaining one
    if cfg.get("active_id") == acc_id:
        cfg["active_id"] = cfg["accounts"][0]["id"] if cfg["accounts"] else None

    _save_config(cfg)
    reset_api(acc_id)
    return {"ok": True}


@app.route("/dsk/accounts/<acc_id>/activate", methods=["POST"])
def activate_account(acc_id):
    cfg = _load_config()
    acc = next((a for a in cfg["accounts"] if a["id"] == acc_id), None)
    if not acc:
        return {"error": "الحساب غير موجود"}, 404
    cfg["active_id"] = acc_id
    _save_config(cfg)
    reset_api()  # clear all cached APIs so next request uses the new active token
    return {"ok": True, "name": acc["name"]}


@app.route("/dsk/config", methods=["GET"])
def get_config():
    token = _get_active_token()
    cfg = _load_config()
    active_id = cfg.get("active_id")
    active_name = None
    for acc in cfg.get("accounts", []):
        if acc["id"] == active_id:
            active_name = acc["name"]
            break
    if token:
        return {"token_set": True, "masked": _mask(token), "active_name": active_name}
    return {"token_set": False, "masked": None, "active_name": None}


# --------------------------------------------------------------------------- #
# API Key management                                                           #
# --------------------------------------------------------------------------- #

KEYS_FILE = os.path.join(os.path.dirname(__file__), "api_keys.json")

_keys_cache: dict | None = None


def _load_keys() -> dict:
    global _keys_cache
    if _keys_cache is not None:
        return _keys_cache
    try:
        with open(KEYS_FILE, "r") as f:
            _keys_cache = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        _keys_cache = {}
    return _keys_cache


def _save_keys(keys: dict) -> None:
    global _keys_cache
    _keys_cache = keys
    with open(KEYS_FILE, "w") as f:
        json.dump(keys, f, ensure_ascii=False, indent=2)


def _check_api_key(req) -> tuple[bool, str]:
    auth = req.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return False, "Missing or invalid Authorization header"
    key = auth[7:].strip()
    keys = _load_keys()
    if key not in keys:
        return False, "Invalid API key"
    return True, key


@app.route("/dsk/keys", methods=["GET"])
def list_keys():
    keys = _load_keys()
    result = []
    for k, v in keys.items():
        masked = k[:7] + "..." + k[-4:]
        result.append({
            "id": v["id"],
            "name": v["name"],
            "masked": masked,
            "created_at": v["created_at"],
        })
    return {"keys": result}


@app.route("/dsk/keys", methods=["POST"])
def create_key():
    data = request.json or {}
    name = data.get("name", "مفتاح جديد").strip() or "مفتاح جديد"
    raw_key = "sk-" + secrets.token_hex(24)
    kid = secrets.token_hex(8)
    keys = _load_keys()
    keys[raw_key] = {
        "id": kid,
        "name": name,
        "created_at": int(time.time()),
    }
    _save_keys(keys)
    return {"key": raw_key, "id": kid, "name": name}, 201


@app.route("/dsk/keys/<kid>", methods=["DELETE"])
def delete_key(kid):
    keys = _load_keys()
    target = next((k for k, v in keys.items() if v["id"] == kid), None)
    if not target:
        return {"error": "Key not found"}, 404
    del keys[target]
    _save_keys(keys)
    return {"ok": True}


# --------------------------------------------------------------------------- #
# OpenAI-compatible endpoint  /v1/chat/completions                            #
# --------------------------------------------------------------------------- #

def _messages_to_prompt(messages: list) -> str:
    parts = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "system":
            parts.append(f"[تعليمات النظام]: {content}")
        elif role == "assistant":
            parts.append(f"[المساعد]: {content}")
        else:
            parts.append(f"[المستخدم]: {content}")
    return "\n\n".join(parts)


@app.route("/v1/chat/completions", methods=["POST"])
def openai_chat():
    ok, info = _check_api_key(request)
    if not ok:
        return {"error": {"message": info, "type": "invalid_request_error"}}, 401

    data = request.json or {}
    messages = data.get("messages", [])
    stream = bool(data.get("stream", False))
    model = data.get("model", "deepseek-chat")
    thinking_enabled = "reason" in model.lower() or data.get("thinking_enabled", False)

    if not messages:
        return {"error": {"message": "messages is required", "type": "invalid_request_error"}}, 400

    prompt = _messages_to_prompt(messages)
    completion_id = "chatcmpl-" + secrets.token_hex(12)
    created = int(time.time())

    try:
        api = get_api()
        session_id = api.create_chat_session()
    except Exception as e:
        return {"error": {"message": str(e), "type": "server_error"}}, 500

    if stream:
        def generate_stream():
            try:
                for chunk in api.chat_completion(
                    session_id, prompt,
                    thinking_enabled=thinking_enabled,
                ):
                    if chunk.get("type") != "text":
                        continue
                    content = chunk.get("content", "")
                    if not content:
                        continue
                    payload = {
                        "id": completion_id,
                        "object": "chat.completion.chunk",
                        "created": created,
                        "model": model,
                        "choices": [{
                            "index": 0,
                            "delta": {"content": content},
                            "finish_reason": None,
                        }],
                    }
                    yield f"data: {json.dumps(payload)}\n\n"

                finish_payload = {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created,
                    "model": model,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                }
                yield f"data: {json.dumps(finish_payload)}\n\n"
                yield "data: [DONE]\n\n"

            except Exception as e:
                err = {"error": {"message": str(e), "type": "server_error"}}
                yield f"data: {json.dumps(err)}\n\n"
                yield "data: [DONE]\n\n"

        return Response(
            stream_with_context(generate_stream()),
            mimetype="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
        )

    else:
        full_text = ""
        try:
            for chunk in api.chat_completion(session_id, prompt, thinking_enabled=thinking_enabled):
                if chunk.get("type") == "text":
                    full_text += chunk.get("content", "")
        except Exception as e:
            return {"error": {"message": str(e), "type": "server_error"}}, 500

        return {
            "id": completion_id,
            "object": "chat.completion",
            "created": created,
            "model": model,
            "choices": [{"index": 0, "message": {"role": "assistant", "content": full_text}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }


# --------------------------------------------------------------------------- #
# Chat routes                                                                  #
# --------------------------------------------------------------------------- #

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/dsk/session", methods=["POST"])
def create_session():
    try:
        session_id = get_api().create_chat_session()
        return {"session_id": session_id}
    except AuthenticationError as e:
        return {"error": str(e), "needs_token": True}, 401
    except Exception as e:
        return {"error": str(e)}, 500


@app.route("/dsk/chat", methods=["POST"])
def chat():
    data = request.json or {}
    session_id = data.get("session_id", "").strip()
    prompt = data.get("prompt", "").strip()
    thinking_enabled = bool(data.get("thinking_enabled", False))
    search_enabled = bool(data.get("search_enabled", False))
    parent_message_id = data.get("parent_message_id")

    if not prompt:
        return {"error": "Prompt is required"}, 400
    if not session_id:
        return {"error": "Session ID is required"}, 400

    def generate():
        BATCH_CHARS = 60
        text_buffer = ""

        def flush_text():
            nonlocal text_buffer
            if text_buffer:
                yield f"data: {json.dumps({'type': 'text', 'content': text_buffer})}\n\n"
                text_buffer = ""

        try:
            api = get_api()
            for chunk in api.chat_completion(
                session_id, prompt,
                parent_message_id=parent_message_id,
                thinking_enabled=thinking_enabled,
                search_enabled=search_enabled,
            ):
                chunk_type = chunk.get("type", "")
                content = chunk.get("content", "")

                if chunk_type == "text" and content:
                    text_buffer += content
                    if len(text_buffer) >= BATCH_CHARS:
                        yield from flush_text()
                else:
                    yield from flush_text()
                    if content:
                        yield f"data: {json.dumps(chunk)}\n\n"

            yield from flush_text()

        except AuthenticationError as e:
            yield from flush_text()
            yield f"data: {json.dumps({'type': 'error', 'content': f'خطأ في المصادقة: {e}'})}\n\n"
        except RateLimitError:
            yield from flush_text()
            yield f"data: {json.dumps({'type': 'error', 'content': 'تجاوزت حد الطلبات. انتظر لحظة ثم حاول مجدداً.'})}\n\n"
        except CloudflareError:
            yield from flush_text()
            yield f"data: {json.dumps({'type': 'error', 'content': 'حماية Cloudflare نشطة.'})}\n\n"
        except NetworkError as e:
            yield from flush_text()
            yield f"data: {json.dumps({'type': 'error', 'content': f'خطأ في الشبكة: {e}'})}\n\n"
        except APIError as e:
            yield from flush_text()
            yield f"data: {json.dumps({'type': 'error', 'content': f'خطأ في API: {e}'})}\n\n"
        except Exception as e:
            yield from flush_text()
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)})}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
