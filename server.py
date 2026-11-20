#!/usr/bin/env python3
"""
Zero-dependency local server & MyAnimeList autocomplete proxy.
Requires only the Python 3 standard library and no admin permissions.
Binds strictly to 127.0.0.1 to avoid Windows Firewall prompts on university PCs.
"""

import http.server
import json
import os
import socketserver
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PORT = 4173
CACHE_TTL_SEC = 300
MAL_CACHE = {}
CACHE_LOCK = threading.Lock()


def fetch_mal_characters(query: str) -> bytes:
    key = query.strip().lower()
    now = time.time()
    with CACHE_LOCK:
        cached = MAL_CACHE.get(key)
        if cached and now - cached[0] < CACHE_TTL_SEC:
            return cached[1]

    url = (
        "https://myanimelist.net/search/prefix.json?type=character&keyword="
        + urllib.parse.quote(query)
        + "&v=1"
    )
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; TournamentBracket/1.0)",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=8) as resp:
        body = resp.read()

    with CACHE_LOCK:
        if len(MAL_CACHE) > 200:
            MAL_CACHE.clear()
        MAL_CACHE[key] = (now, body)

    return body


class BracketHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT_DIR, **kwargs)

    def log_message(self, format, *args):
        # Keep console output concise
        pass

    def _send_json(self, status: int, payload: bytes):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)

        if parsed.path == "/api/health":
            self._send_json(200, json.dumps({"ok": True, "malProxy": True}).encode("utf-8"))
            return

        if parsed.path == "/api/mal/characters":
            params = urllib.parse.parse_qs(parsed.query)
            query = (params.get("q") or [""])[0].strip()
            if not query:
                self._send_json(200, b'{"categories":[]}')
                return
            try:
                body = fetch_mal_characters(query)
                self._send_json(200, body)
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                err = json.dumps({"error": str(exc)}).encode("utf-8")
                self._send_json(502, err)
            return

        if parsed.path == "/":
            self.path = "/index.html"

        super().do_GET()


class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True


def start_server(port: int, open_browser: bool):
    server = None
    for candidate in (port, port + 1, port + 2, 0):
        try:
            server = ThreadedTCPServer(("127.0.0.1", candidate), BracketHandler)
            break
        except OSError:
            continue

    if server is None:
        print("Error: Unable to bind a local port.", file=sys.stderr)
        sys.exit(1)

    actual_port = server.server_address[1]
    url = f"http://127.0.0.1:{actual_port}/"
    print(f"Tournament Bracket running at {url}")
    print("Press Ctrl+C to stop.")

    if open_browser:
        threading.Timer(0.35, lambda: webbrowser.open(url)).start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    no_open = "--no-open" in sys.argv
    port = DEFAULT_PORT
    for arg in sys.argv[1:]:
        if arg.startswith("--port="):
            try:
                port = int(arg.split("=", 1)[1])
            except ValueError:
                pass
    start_server(port, open_browser=not no_open)
