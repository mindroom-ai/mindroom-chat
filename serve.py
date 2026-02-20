"""SPA-aware static file server. Falls back to index.html for non-file routes."""

import http.server
import os
import sys
from urllib.parse import urlsplit, urlunsplit

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
DIRECTORY = os.getcwd()

def normalize_base_path(value: str | None) -> str:
    raw = (value or "").strip()
    if raw == "" or raw == "/":
        return "/"
    raw = raw.rstrip("/")
    raw = raw.lstrip("/")
    if raw == "":
        return "/"
    return f"/{raw}"

BASE_PATH = normalize_base_path(os.environ.get("APP_BASE_PATH"))
RUNTIME_CONFIG_JS = f"window.__APP_BASE_PATH__ = \"{BASE_PATH}\";\n"


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def _resolve_path(self):
        parsed = urlsplit(self.path)
        request_path = parsed.path

        if BASE_PATH != "/":
            if request_path == "/":
                redirect_target = urlunsplit(("", "", f"{BASE_PATH}/", "", ""))
                return ("redirect", redirect_target)
            if not request_path.startswith(f"{BASE_PATH}/"):
                return ("not_found", None)

            request_path = request_path[len(BASE_PATH) :] or "/"

        return ("path", request_path)

    def do_GET(self):
        status, value = self._resolve_path()
        if status == "redirect":
            self.send_response(302)
            self.send_header("Location", value)
            self.end_headers()
            return
        if status == "not_found":
            self.send_error(404, "Not found")
            return

        request_path = value
        if request_path == "/runtime-config.js":
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(RUNTIME_CONFIG_JS.encode("utf-8"))
            return

        # If the path maps to an actual file, serve it normally
        path = self.translate_path(request_path)
        if os.path.isfile(path):
            self.path = request_path
            return super().do_GET()
        # Otherwise serve index.html (SPA client-side routing)
        self.path = "/index.html"
        return super().do_GET()

    def do_HEAD(self):
        status, value = self._resolve_path()
        if status == "redirect":
            self.send_response(302)
            self.send_header("Location", value)
            self.end_headers()
            return
        if status == "not_found":
            self.send_error(404, "Not found")
            return

        request_path = value
        if request_path == "/runtime-config.js":
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            return
        path = self.translate_path(request_path)
        if os.path.isfile(path):
            self.path = request_path
            return super().do_HEAD()
        self.path = "/index.html"
        return super().do_HEAD()


if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", PORT), SPAHandler)
    print(f"Serving SPA on 0.0.0.0:{PORT}")
    server.serve_forever()
