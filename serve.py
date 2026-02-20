"""SPA-aware static file server. Falls back to index.html for non-file routes."""

import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
DIRECTORY = os.getcwd()


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        # If the path maps to an actual file, serve it normally
        path = self.translate_path(self.path)
        if os.path.isfile(path):
            return super().do_GET()
        # Otherwise serve index.html (SPA client-side routing)
        self.path = "/index.html"
        return super().do_GET()


if __name__ == "__main__":
    server = http.server.HTTPServer(("0.0.0.0", PORT), SPAHandler)
    print(f"Serving SPA on 0.0.0.0:{PORT}")
    server.serve_forever()
