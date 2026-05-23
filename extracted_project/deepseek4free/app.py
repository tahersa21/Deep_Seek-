import os
import json
import secrets
import time
import threading
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


def _get_active_account() -> dict | None:
    cfg = _load_config()
    active_id = cfg.get("active_id")
    for acc in cfg.get("accounts", []):
        if acc["id"] == active_id:
            return acc
    return None


def get_api() -> DeepSeekAPI:
    cfg = _load_config()
    active_id = cfg.get("active_id")
    token = _get_active_token()
    if not token:
        raise AuthenticationError("لم يتم تعيين حساب نشط بعد")

    acc = _get_active_account()
    proxy = acc.get("proxy") if acc else None

    key = active_id or "env"
    if key not in _api_instances:
        _api_instances[key] = DeepSeekAPI(token, proxy=proxy)
    return _api_instances[key]


def reset_api(account_id: str | None = None) -> None:
    global _api_instances
    if account_id:
        _api_instances.pop(account_id, None)
    else:
        _api_instances.clear()


# --------------------------------------------------------------------------- #
# Round-Robin Load Balancer                                                    #
# --------------------------------------------------------------------------- #

class AccountRotator:
    """
    Distributes /v1/chat/completions requests across all accounts in round-robin
    order.  Unhealthy accounts (auth errors, rate-limits, Cloudflare blocks) are
    quarantined for RECOVERY_TIMEOUT seconds before being retried automatically.
    """
    RECOVERY_TIMEOUT = 300  # seconds (5 minutes)

    def __init__(self):
        self._lock  = threading.Lock()
        self._index = 0          # round-robin pointer into the healthy list
        # {acc_id: {healthy, failed_at, error, requests, successes, failures}}
        self._health: dict[str, dict] = {}

    # ---------------------------------------------------------------------- #

    def _init_health(self, acc_id: str) -> None:
        if acc_id not in self._health:
            self._health[acc_id] = {
                "healthy": True, "failed_at": None, "error": None,
                "requests": 0, "successes": 0, "failures": 0,
            }

    def _maybe_recover(self, accounts: list) -> None:
        """Auto-recover accounts whose quarantine period has elapsed."""
        now = time.time()
        for acc in accounts:
            h = self._health.get(acc["id"], {})
            if not h.get("healthy") and h.get("failed_at"):
                if now - h["failed_at"] >= self.RECOVERY_TIMEOUT:
                    self._health[acc["id"]].update(
                        healthy=True, failed_at=None, error=None
                    )
                    reset_api(acc["id"])

    # ---------------------------------------------------------------------- #

    def get_next(self) -> tuple["DeepSeekAPI", str]:
        """Pick the next healthy account (round-robin) and return (api, acc_id)."""
        with self._lock:
            accounts = _load_config().get("accounts", [])
            if not accounts:
                raise AuthenticationError("لا توجد حسابات — أضف حساباً أولاً")

            for acc in accounts:
                self._init_health(acc["id"])

            self._maybe_recover(accounts)

            healthy = [a for a in accounts if self._health[a["id"]]["healthy"]]
            if not healthy:
                # All quarantined — reset all as last resort
                for acc in accounts:
                    self._health[acc["id"]].update(healthy=True, failed_at=None, error=None)
                    reset_api(acc["id"])
                healthy = accounts

            # Clamp index then advance
            self._index = self._index % len(healthy)
            acc = healthy[self._index]
            self._index = (self._index + 1) % len(healthy)

            acc_id = acc["id"]
            self._health[acc_id]["requests"] += 1

            if acc_id not in _api_instances:
                _api_instances[acc_id] = DeepSeekAPI(acc["token"], proxy=acc.get("proxy"))

            return _api_instances[acc_id], acc_id

    def mark_success(self, acc_id: str) -> None:
        with self._lock:
            if acc_id in self._health:
                self._health[acc_id]["successes"] += 1

    def mark_failure(self, acc_id: str, error: str) -> None:
        with self._lock:
            if acc_id not in self._health:
                self._health[acc_id] = {
                    "healthy": True, "failed_at": None, "error": None,
                    "requests": 0, "successes": 0, "failures": 0,
                }
            self._health[acc_id]["failures"] += 1
            self._health[acc_id]["healthy"]   = False
            self._health[acc_id]["failed_at"] = time.time()
            self._health[acc_id]["error"]     = error
            reset_api(acc_id)

    def reset_account(self, acc_id: str) -> None:
        with self._lock:
            if acc_id in self._health:
                self._health[acc_id].update(healthy=True, failed_at=None, error=None)
            reset_api(acc_id)

    def get_status(self) -> list[dict]:
        accounts = _load_config().get("accounts", [])
        now = time.time()
        result = []
        for acc in accounts:
            h = self._health.get(acc["id"], {
                "healthy": True, "failed_at": None, "error": None,
                "requests": 0, "successes": 0, "failures": 0,
            })
            failed_at = h.get("failed_at")
            recovery_in = None
            if failed_at and not h.get("healthy"):
                remaining = self.RECOVERY_TIMEOUT - (now - failed_at)
                recovery_in = max(0, int(remaining))
            result.append({
                "id":          acc["id"],
                "name":        acc["name"],
                "proxy":       acc.get("proxy") or "",
                "healthy":     h.get("healthy", True),
                "failed_at":   failed_at,
                "error":       h.get("error"),
                "requests":    h.get("requests", 0),
                "successes":   h.get("successes", 0),
                "failures":    h.get("failures", 0),
                "recovery_in": recovery_in,
            })
        return result


# Global rotator instance
rotator = AccountRotator()


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
            "proxy": acc.get("proxy") or "",
        })
    return {"accounts": result, "active_id": active_id}


@app.route("/dsk/accounts", methods=["POST"])
def add_account():
    data = request.json or {}
    token = data.get("token", "").strip()
    name = data.get("name", "").strip() or "حساب جديد"
    proxy_val = (data.get("proxy") or "").strip()
    if not token:
        return {"error": "التوكن مطلوب"}, 400
    if proxy_val and not any(proxy_val.startswith(p) for p in ("http://", "https://", "socks5://", "socks4://")):
        return {"error": "صيغة البروكسي غير صحيحة"}, 400

    cfg = _load_config()
    acc_id = secrets.token_hex(8)
    new_acc = {
        "id": acc_id, "name": name, "token": token,
        "created_at": int(time.time()),
        "proxy": proxy_val if proxy_val else None,
    }
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
def update_account(acc_id):
    data = request.json or {}
    cfg = _load_config()
    acc = next((a for a in cfg["accounts"] if a["id"] == acc_id), None)
    if not acc:
        return {"error": "الحساب غير موجود"}, 404

    if "name" in data:
        name = data["name"].strip()
        if not name:
            return {"error": "الاسم مطلوب"}, 400
        acc["name"] = name

    if "proxy" in data:
        proxy_val = (data["proxy"] or "").strip()
        # Basic validation: must be empty or start with http/https/socks5
        if proxy_val and not any(proxy_val.startswith(p) for p in ("http://", "https://", "socks5://", "socks4://")):
            return {"error": "صيغة البروكسي غير صحيحة (مثال: http://host:port أو socks5://host:port)"}, 400
        acc["proxy"] = proxy_val if proxy_val else None
        # Reset cached API instance so next request picks up the new proxy
        reset_api(acc_id)

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
        role    = msg.get("role", "user")
        content = msg.get("content") or ""
        # Handle list-type content (some clients send [{"type":"text","text":"..."}])
        if isinstance(content, list):
            content = " ".join(
                p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"
            )
        if role == "system":
            parts.append(f"[تعليمات النظام]: {content}")
        elif role == "assistant":
            # If previous message was a tool_call, include it
            tool_calls = msg.get("tool_calls")
            if tool_calls:
                parts.append(f"[المساعد استدعى أداة]: {json.dumps(tool_calls, ensure_ascii=False)}")
            else:
                parts.append(f"[المساعد]: {content}")
        elif role == "tool":
            parts.append(f"[نتيجة الأداة ({msg.get('name','')})]: {content}")
        else:
            parts.append(f"[المستخدم]: {content}")
    return "\n\n".join(parts)


# ── Tool-calling helpers ─────────────────────────────────────────────────── #

_TOOL_CALL_INSTRUCTION = """
===== TOOL USE PROTOCOL =====
You have access to the following tools. When you decide to call a tool, you MUST respond with ONLY a raw JSON object — no markdown, no explanation, no extra text. The JSON must follow this exact structure:
{"tool_call":{"name":"<tool_name>","arguments":{...}}}

If you do NOT need to call a tool, respond normally with plain text.

Available tools:
{tools_json}
===== END TOOL USE PROTOCOL =====
"""

def _inject_tools(messages: list, tools: list) -> list:
    """Prepend tool definitions to the system prompt (or create one)."""
    tools_json = json.dumps(tools, ensure_ascii=False, indent=2)
    instruction = _TOOL_CALL_INSTRUCTION.format(tools_json=tools_json)
    msgs = list(messages)
    if msgs and msgs[0].get("role") == "system":
        msgs[0] = {**msgs[0], "content": instruction + "\n\n" + (msgs[0].get("content") or "")}
    else:
        msgs.insert(0, {"role": "system", "content": instruction})
    return msgs


import re as _re

def _extract_tool_call(text: str) -> dict | None:
    """
    Try to find a tool_call JSON object in model output.
    Returns the parsed tool_call dict or None if not found.
    """
    # First: try direct JSON parse
    stripped = text.strip()
    if stripped.startswith("{"):
        try:
            obj = json.loads(stripped)
            if "tool_call" in obj:
                return obj["tool_call"]
        except json.JSONDecodeError:
            pass

    # Second: regex search for the pattern anywhere in text
    match = _re.search(r'\{\s*"tool_call"\s*:\s*\{.*?\}\s*\}', stripped, _re.DOTALL)
    if match:
        try:
            obj = json.loads(match.group())
            return obj.get("tool_call")
        except json.JSONDecodeError:
            pass

    # Third: try to find just {"name":..., "arguments":...} pattern
    match2 = _re.search(r'\{\s*"name"\s*:\s*"([^"]+)"\s*,\s*"arguments"\s*:\s*(\{.*?\})\s*\}', stripped, _re.DOTALL)
    if match2:
        try:
            args = json.loads(match2.group(2))
            return {"name": match2.group(1), "arguments": args}
        except json.JSONDecodeError:
            pass

    return None


def _build_tool_call_response(tool_call: dict, completion_id: str, created: int, model: str) -> dict:
    """Format a tool_call dict into a proper OpenAI tool_calls response."""
    call_id = "call_" + secrets.token_hex(12)
    name    = tool_call.get("name", "")
    args    = tool_call.get("arguments", {})
    args_str = json.dumps(args, ensure_ascii=False) if isinstance(args, dict) else str(args)
    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": created,
        "model": model,
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": None,
                "tool_calls": [{
                    "id": call_id,
                    "type": "function",
                    "function": {"name": name, "arguments": args_str},
                }],
            },
            "finish_reason": "tool_calls",
        }],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
    }


def _build_tool_call_stream_chunks(tool_call: dict, completion_id: str, created: int, model: str):
    """Yield SSE chunks for a tool_call response (streaming mode)."""
    call_id  = "call_" + secrets.token_hex(12)
    name     = tool_call.get("name", "")
    args     = tool_call.get("arguments", {})
    args_str = json.dumps(args, ensure_ascii=False) if isinstance(args, dict) else str(args)

    # First chunk: role + tool_call start
    yield f"data: {json.dumps({'id':completion_id,'object':'chat.completion.chunk','created':created,'model':model,'choices':[{'index':0,'delta':{'role':'assistant','content':None,'tool_calls':[{'index':0,'id':call_id,'type':'function','function':{'name':name,'arguments':''}}]},'finish_reason':None}]})}\n\n"
    # Second chunk: arguments
    yield f"data: {json.dumps({'id':completion_id,'object':'chat.completion.chunk','created':created,'model':model,'choices':[{'index':0,'delta':{'tool_calls':[{'index':0,'function':{'arguments':args_str}}]},'finish_reason':None}]})}\n\n"
    # Final chunk
    yield f"data: {json.dumps({'id':completion_id,'object':'chat.completion.chunk','created':created,'model':model,'choices':[{'index':0,'delta':{},'finish_reason':'tool_calls'}]})}\n\n"
    yield "data: [DONE]\n\n"


def _is_fatal_error(exc: Exception) -> bool:
    """Return True if the error means the account should be quarantined."""
    return isinstance(exc, (AuthenticationError, RateLimitError, CloudflareError))


@app.route("/v1/chat/completions", methods=["POST"])
def openai_chat():
    ok, info = _check_api_key(request)
    if not ok:
        return {"error": {"message": info, "type": "invalid_request_error"}}, 401

    data     = request.json or {}
    messages = data.get("messages", [])
    stream   = bool(data.get("stream", False))
    model    = data.get("model", "deepseek-chat")
    tools    = data.get("tools") or []          # list of OpenAI tool defs
    thinking_enabled = "reason" in model.lower() or data.get("thinking_enabled", False)

    if not messages:
        return {"error": {"message": "messages is required", "type": "invalid_request_error"}}, 400

    # Inject tool definitions into the prompt when tools are provided
    effective_messages = _inject_tools(messages, tools) if tools else messages
    prompt = _messages_to_prompt(effective_messages)

    completion_id = "chatcmpl-" + secrets.token_hex(12)
    created       = int(time.time())

    # ── Pick next account via round-robin ────────────────────────────────── #
    try:
        api, acc_id = rotator.get_next()
        session_id  = api.create_chat_session()
    except Exception as e:
        return {"error": {"message": str(e), "type": "server_error"}}, 500

    # ── When tools are requested: always collect full response first ──────── #
    # (We need the full text to detect whether it's a tool call or plain text)
    if tools:
        full_text = ""
        try:
            for chunk in api.chat_completion(session_id, prompt, thinking_enabled=False):
                if chunk.get("type") == "text":
                    full_text += chunk.get("content", "")
            rotator.mark_success(acc_id)
        except Exception as e:
            if _is_fatal_error(e):
                rotator.mark_failure(acc_id, str(e))
            return {"error": {"message": str(e), "type": "server_error"}}, 500

        tool_call = _extract_tool_call(full_text)

        if tool_call:
            resp = _build_tool_call_response(tool_call, completion_id, created, model)
            if stream:
                def _stream_tool():
                    yield from _build_tool_call_stream_chunks(tool_call, completion_id, created, model)
                return Response(stream_with_context(_stream_tool()), mimetype="text/event-stream",
                                headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no","Connection":"keep-alive"})
            return resp

        # Plain text reply (model chose not to call a tool)
        if stream:
            def _stream_text():
                for word in full_text:          # character-by-character for smooth streaming
                    payload = {"id":completion_id,"object":"chat.completion.chunk","created":created,
                               "model":model,"choices":[{"index":0,"delta":{"content":word},"finish_reason":None}]}
                    yield f"data: {json.dumps(payload)}\n\n"
                finish = {"id":completion_id,"object":"chat.completion.chunk","created":created,
                          "model":model,"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}
                yield f"data: {json.dumps(finish)}\n\n"
                yield "data: [DONE]\n\n"
            return Response(stream_with_context(_stream_text()), mimetype="text/event-stream",
                            headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no","Connection":"keep-alive"})

        return {
            "id": completion_id, "object": "chat.completion", "created": created, "model": model,
            "choices": [{"index":0,"message":{"role":"assistant","content":full_text},"finish_reason":"stop"}],
            "usage": {"prompt_tokens":0,"completion_tokens":0,"total_tokens":0},
        }

    # ── No tools: normal streaming / non-streaming path ───────────────────── #
    if stream:
        def generate_stream():
            try:
                for chunk in api.chat_completion(session_id, prompt, thinking_enabled=thinking_enabled):
                    if chunk.get("type") != "text":
                        continue
                    content = chunk.get("content", "")
                    if not content:
                        continue
                    payload = {
                        "id": completion_id, "object": "chat.completion.chunk",
                        "created": created, "model": model,
                        "choices": [{"index":0,"delta":{"content":content},"finish_reason":None}],
                    }
                    yield f"data: {json.dumps(payload)}\n\n"

                finish_payload = {
                    "id": completion_id, "object": "chat.completion.chunk",
                    "created": created, "model": model,
                    "choices": [{"index":0,"delta":{},"finish_reason":"stop"}],
                }
                yield f"data: {json.dumps(finish_payload)}\n\n"
                yield "data: [DONE]\n\n"
                rotator.mark_success(acc_id)

            except Exception as e:
                if _is_fatal_error(e):
                    rotator.mark_failure(acc_id, str(e))
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
            rotator.mark_success(acc_id)
        except Exception as e:
            if _is_fatal_error(e):
                rotator.mark_failure(acc_id, str(e))
            return {"error": {"message": str(e), "type": "server_error"}}, 500

        return {
            "id": completion_id, "object": "chat.completion", "created": created, "model": model,
            "choices": [{"index":0,"message":{"role":"assistant","content":full_text},"finish_reason":"stop"}],
            "usage": {"prompt_tokens":0,"completion_tokens":0,"total_tokens":0},
        }


# --------------------------------------------------------------------------- #
# Load-Balancer status endpoints                                               #
# --------------------------------------------------------------------------- #

@app.route("/dsk/balancer", methods=["GET"])
def balancer_status():
    return {"accounts": rotator.get_status()}


@app.route("/dsk/balancer/<acc_id>/reset", methods=["POST"])
def balancer_reset(acc_id):
    rotator.reset_account(acc_id)
    return {"ok": True}


@app.route("/dsk/balancer/reset-all", methods=["POST"])
def balancer_reset_all():
    accounts = _load_config().get("accounts", [])
    for acc in accounts:
        rotator.reset_account(acc["id"])
    return {"ok": True}


# --------------------------------------------------------------------------- #
# Chat routes                                                                  #
# --------------------------------------------------------------------------- #

@app.route("/healthz")
def healthz():
    return {"status": "ok"}, 200


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
