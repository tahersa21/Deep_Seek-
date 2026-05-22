from curl_cffi import requests
from typing import Optional, Dict, Any, Generator
import json
import threading
import sys
from pathlib import Path
import subprocess
import time

try:
    from importlib.metadata import version as pkg_version
    _cffi_version = pkg_version('curl-cffi')
    if _cffi_version != '0.8.1b9':
        print(f"\033[93mWarning: curl-cffi {_cffi_version} found; 0.8.1b9 is recommended.\033[0m", file=sys.stderr)
except Exception:
    pass


class DeepSeekError(Exception):
    pass

class AuthenticationError(DeepSeekError):
    pass

class RateLimitError(DeepSeekError):
    pass

class NetworkError(DeepSeekError):
    pass

class CloudflareError(DeepSeekError):
    pass

class APIError(DeepSeekError):
    def __init__(self, message: str, status_code: Optional[int] = None):
        super().__init__(message)
        self.status_code = status_code


class DeepSeekAPI:
    BASE_URL = "https://chat.deepseek.com/api/v0"

    def __init__(self, auth_token: str):
        if not auth_token or not isinstance(auth_token, str):
            raise AuthenticationError("Invalid auth token provided")

        self.auth_token = auth_token

        from .pow import DeepSeekPOW
        self.pow_solver = DeepSeekPOW()

        # Cookies
        cookies_path = Path(__file__).parent / 'cookies.json'
        try:
            with open(cookies_path, 'r') as f:
                self.cookies = json.load(f).get('cookies', {})
        except (FileNotFoundError, json.JSONDecodeError):
            self.cookies = {}

        # PoW pre-fetch cache
        self._pow_cache: Optional[Dict[str, Any]] = None
        self._pow_lock = threading.Lock()
        self._pow_fetching = False

        # Session pre-fetch cache
        self._session_cache: Optional[str] = None
        self._session_lock = threading.Lock()
        self._session_fetching = False

        self._schedule_pow_prefetch()     # warm up PoW immediately
        self._schedule_session_prefetch() # warm up session immediately

    # ------------------------------------------------------------------ #
    # PoW helpers                                                          #
    # ------------------------------------------------------------------ #

    def _schedule_pow_prefetch(self) -> None:
        """Fetch the next PoW challenge in a background thread."""
        with self._pow_lock:
            if self._pow_fetching:
                return
            self._pow_fetching = True

        def _fetch():
            try:
                challenge = self._fetch_pow_from_server()
                with self._pow_lock:
                    self._pow_cache = challenge
            except Exception:
                pass
            finally:
                with self._pow_lock:
                    self._pow_fetching = False

        threading.Thread(target=_fetch, daemon=True).start()

    def _fetch_pow_from_server(self) -> Dict[str, Any]:
        response = self._make_request(
            'POST',
            '/chat/create_pow_challenge',
            {'target_path': '/api/v0/chat/completion'},
        )
        try:
            return response['data']['biz_data']['challenge']
        except KeyError:
            raise APIError("Invalid PoW challenge format from server")

    def _is_challenge_valid(self, challenge: Dict[str, Any]) -> bool:
        """Return True if the challenge has at least 30 seconds left before expiry."""
        expire_at = challenge.get('expire_at', 0)
        return time.time() < (expire_at - 30)

    def _get_pow_challenge(self) -> Dict[str, Any]:
        """Return a valid cached challenge or fetch a fresh one synchronously."""
        challenge = None
        with self._pow_lock:
            if self._pow_cache:
                challenge = self._pow_cache
                self._pow_cache = None
                self._pow_fetching = False  # allow re-scheduling

        if challenge and self._is_challenge_valid(challenge):
            self._schedule_pow_prefetch()
            return challenge

        # Cache miss or challenge expired — fetch synchronously
        return self._fetch_pow_from_server()

    # ------------------------------------------------------------------ #
    # Session pre-fetch helpers                                            #
    # ------------------------------------------------------------------ #

    def _schedule_session_prefetch(self) -> None:
        """Create a chat session in the background and cache it."""
        with self._session_lock:
            if self._session_fetching:
                return
            self._session_fetching = True

        def _fetch():
            try:
                response = self._make_request('POST', '/chat_session/create', {'character_id': None})
                session_id = response['data']['biz_data']['id']
                with self._session_lock:
                    self._session_cache = session_id
            except Exception:
                pass
            finally:
                with self._session_lock:
                    self._session_fetching = False

        threading.Thread(target=_fetch, daemon=True).start()

    def _get_session(self) -> str:
        """Return a pre-fetched session or create one synchronously."""
        session_id = None
        with self._session_lock:
            if self._session_cache:
                session_id = self._session_cache
                self._session_cache = None
                self._session_fetching = False

        if session_id:
            self._schedule_session_prefetch()
            return session_id

        # Cache miss — create synchronously
        try:
            response = self._make_request('POST', '/chat_session/create', {'character_id': None})
            return response['data']['biz_data']['id']
        except KeyError:
            raise APIError("Invalid session creation response from server")

    # ------------------------------------------------------------------ #
    # HTTP helpers                                                         #
    # ------------------------------------------------------------------ #

    def _get_headers(self, pow_response: Optional[str] = None) -> Dict[str, str]:
        headers = {
            'accept': '*/*',
            'accept-language': 'en,fr-FR;q=0.9,fr;q=0.8,es-ES;q=0.7,es;q=0.6,en-US;q=0.5,am;q=0.4,de;q=0.3',
            'authorization': f'Bearer {self.auth_token}',
            'content-type': 'application/json',
            'origin': 'https://chat.deepseek.com',
            'referer': 'https://chat.deepseek.com/',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
            'x-app-version': '20241129.1',
            'x-client-locale': 'en_US',
            'x-client-platform': 'web',
            'x-client-version': '1.0.0-always',
        }
        if pow_response:
            headers['x-ds-pow-response'] = pow_response
        return headers

    def _make_request(self, method: str, endpoint: str, json_data: Dict[str, Any]) -> Any:
        url = f"{self.BASE_URL}{endpoint}"
        try:
            response = requests.request(
                method=method,
                url=url,
                headers=self._get_headers(),
                json=json_data,
                cookies=self.cookies,
                impersonate='chrome120',
                timeout=30,
            )
            if response.status_code == 401:
                raise AuthenticationError("Invalid or expired authentication token")
            if response.status_code == 429:
                raise RateLimitError("API rate limit exceeded")
            if response.status_code >= 500:
                raise APIError(f"Server error: {response.text}", response.status_code)
            if response.status_code != 200:
                raise APIError(f"Request failed: {response.text}", response.status_code)
            return response.json()
        except requests.exceptions.RequestException as e:
            raise NetworkError(f"Network error: {e}")

    def _refresh_cookies(self) -> None:
        try:
            script_path = Path(__file__).parent / 'bypass.py'
            subprocess.run([sys.executable, str(script_path)], check=True)
            time.sleep(2)
            cookies_path = Path(__file__).parent / 'cookies.json'
            with open(cookies_path, 'r') as f:
                self.cookies = json.load(f).get('cookies', {})
        except Exception as e:
            print(f"\033[93mWarning: Failed to refresh cookies: {e}\033[0m", file=sys.stderr)

    # ------------------------------------------------------------------ #
    # Public API                                                           #
    # ------------------------------------------------------------------ #

    def create_chat_session(self) -> str:
        """Return a pre-fetched session ID (or create one synchronously)."""
        return self._get_session()

    def chat_completion(
        self,
        chat_session_id: str,
        prompt: str,
        parent_message_id: Optional[str] = None,
        thinking_enabled: bool = False,
        search_enabled: bool = False,
    ) -> Generator[Dict[str, Any], None, None]:
        """
        Stream a chat completion.

        Yields dicts with keys:
          - type: 'text' | 'thinking'
          - content: str
          - message_id: int | None
        """
        if not isinstance(prompt, str) or not prompt:
            raise ValueError("Prompt must be a non-empty string")
        if not isinstance(chat_session_id, str) or not chat_session_id:
            raise ValueError("chat_session_id must be a non-empty string")

        # Solve PoW — uses pre-fetched cache when available
        challenge = self._get_pow_challenge()
        pow_response = self.pow_solver.solve_challenge(challenge)
        headers = self._get_headers(pow_response)

        json_data = {
            'chat_session_id': chat_session_id,
            'parent_message_id': parent_message_id,
            'prompt': prompt,
            'ref_file_ids': [],
            'thinking_enabled': thinking_enabled,
            'search_enabled': search_enabled,
        }

        try:
            response = requests.post(
                f"{self.BASE_URL}/chat/completion",
                headers=headers,
                json=json_data,
                cookies=self.cookies,
                impersonate='chrome120',
                stream=True,
                timeout=None,
            )
        except requests.exceptions.RequestException as e:
            raise NetworkError(f"Network error during streaming: {e}")

        if response.status_code == 401:
            raise AuthenticationError("Invalid or expired authentication token")
        if response.status_code == 429:
            raise RateLimitError("API rate limit exceeded")
        if response.status_code != 200:
            raise APIError(f"Chat request failed ({response.status_code})", response.status_code)

        response_message_id = None
        active_path = None  # tracks which field is being streamed

        try:
            for line in response.iter_lines():
                if not line:
                    continue

                # SSE event line
                if line.startswith(b'event: '):
                    event = line[7:].decode('utf-8', 'ignore').strip()
                    if event == 'finish':
                        break
                    continue

                if not line.startswith(b'data: '):
                    continue

                raw = line[6:]
                if raw in (b'{}', b''):
                    continue

                try:
                    data = json.loads(raw)
                except json.JSONDecodeError:
                    continue

                # Initial handshake: {"request_message_id":1,"response_message_id":2}
                if 'response_message_id' in data:
                    response_message_id = data['response_message_id']
                    continue

                # Full patch: {"p":"response/content","o":"APPEND","v":"..."}
                if 'p' in data and 'v' in data:
                    path = data['p']
                    operation = data.get('o', 'SET')
                    value = data['v']

                    if operation == 'APPEND':
                        active_path = path

                    if path == 'response/content' and operation == 'APPEND' and value:
                        yield {'type': 'text', 'content': value, 'message_id': response_message_id}
                    elif path == 'response/thinking_content' and operation == 'APPEND' and value:
                        yield {'type': 'thinking', 'content': value, 'message_id': response_message_id}
                    elif path == 'response/status' and value == 'FINISHED':
                        break
                    continue

                # Delta-only: {"v":"..."} — continuation of active_path
                if tuple(data.keys()) == ('v',) and active_path and data['v']:
                    value = data['v']
                    if active_path == 'response/content':
                        yield {'type': 'text', 'content': value, 'message_id': response_message_id}
                    elif active_path == 'response/thinking_content':
                        yield {'type': 'thinking', 'content': value, 'message_id': response_message_id}

        except Exception as e:
            raise APIError(f"Error while streaming response: {e}")
        finally:
            # Pre-fetch PoW for the next message as soon as streaming ends
            self._schedule_pow_prefetch()
