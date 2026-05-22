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
            _config_cache = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        _config_cache = {}
    return _config_cache


def _save_config(cfg: dict) -> None:
    global _config_cache
    _config_cache = cfg
    with open(CONFIG_FILE, "w") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def _get_auth_token() -> str | None:
    cfg = _load_config()
    return cfg.get("auth_token") or os.getenv("DEEPSEEK_AUTH_TOKEN")


_api: DeepSeekAPI | None = None


def get_api() -> DeepSeekAPI:
    global _api
    token = _get_auth_token()
    if _api is None:
        if not token:
            raise AuthenticationError("لم يتم تعيين توكن DeepSeek بعد")
        _api = DeepSeekAPI(token)
    return _api


def reset_api() -> None:
    global _api
    _api = None


try:
    get_api()
except Exception as e:
    print(f"Warning: Could not initialise API at startup: {e}")


# --------------------------------------------------------------------------- #
# Config / Auth Token endpoints                                                #
# --------------------------------------------------------------------------- #

@app.route("/dsk/config", methods=["GET"])
def get_config():
    token = _get_auth_token()
    if token:
        masked = token[:8] + "..." + token[-4:]
        return {"token_set": True, "masked": masked}
    return {"token_set": False, "masked": None}


@app.route("/dsk/config", methods=["POST"])
def set_config():
    data = request.json or {}
    token = data.get("auth_token", "").strip()
    if not token:
        return {"error": "التوكن لا يمكن أن يكون فارغاً"}, 400

    cfg = _load_config()
    cfg["auth_token"] = token
    _save_config(cfg)
    reset_api()

    try:
        get_api()
        return {"ok": True, "message": "تم حفظ التوكن بنجاح وتم الاتصال بـ DeepSeek"}
    except Exception as e:
        return {"ok": False, "message": f"تم حفظ التوكن لكن فشل الاتصال: {e}"}


@app.route("/dsk/config", methods=["DELETE"])
def delete_config():
    cfg = _load_config()
    cfg.pop("auth_token", None)
    _save_config(cfg)
    reset_api()
    return {"ok": True}


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
                    "choices": [{
                        "index": 0,
                        "delta": {},
                        "finish_reason": "stop",
                    }],
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
            headers={
                "Cache-Control": "no-cache",
                "X-Accel-Buffering": "no",
                "Connection": "keep-alive",
            },
        )

    else:
        full_text = ""
        try:
            for chunk in api.chat_completion(
                session_id, prompt,
                thinking_enabled=thinking_enabled,
            ):
                if chunk.get("type") == "text":
                    full_text += chunk.get("content", "")
        except Exception as e:
            return {"error": {"message": str(e), "type": "server_error"}}, 500

        return {
            "id": completion_id,
            "object": "chat.completion",
            "created": created,
            "model": model,
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": full_text},
                "finish_reason": "stop",
            }],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }


# --------------------------------------------------------------------------- #
# Original chat routes                                                         #
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
                session_id,
                prompt,
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
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
