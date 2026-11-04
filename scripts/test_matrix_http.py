"""Tests for scripts/matrix_http.py against a stub homeserver: python3 -m unittest scripts/test_matrix_http.py"""

import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import matrix_http


class StubHomeserver(BaseHTTPRequestHandler):
    """Registration asks for the dummy stage first; sends answer with an event ID; /fail is a 403."""

    requests: list = []

    def log_message(self, *args):
        pass

    def answer(self, status, body):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def handle_any(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        StubHomeserver.requests.append((self.command, self.path, body, self.headers.get("Authorization")))
        if self.path == "/_matrix/client/v3/register":
            if "auth" not in body:
                self.answer(401, {"session": "s1", "flows": [{"stages": ["m.login.dummy"]}]})
            else:
                self.answer(200, {"user_id": f"@{body['username']}:test", "access_token": "token"})
        elif "/send/" in self.path:
            self.answer(200, {"event_id": "$sent"})
        else:
            self.answer(403, {"errcode": "M_FORBIDDEN"})

    do_GET = do_POST = do_PUT = handle_any


class MatrixHttpTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), StubHomeserver)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.homeserver = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        StubHomeserver.requests.clear()

    def test_register_answers_the_dummy_stage(self):
        account = matrix_http.register(self.homeserver, "alice", "pw")
        self.assertEqual(account, {"user_id": "@alice:test", "access_token": "token"})
        self.assertEqual(StubHomeserver.requests[1][2]["auth"], {"type": "m.login.dummy", "session": "s1"})

    def test_send_quotes_the_room_and_returns_the_event_id(self):
        event_id = matrix_http.send(self.homeserver, "token", "!room:test", {"body": "hi"})
        self.assertEqual(event_id, "$sent")
        method, path, body, authorization = StubHomeserver.requests[0]
        self.assertEqual(method, "PUT")
        self.assertTrue(path.startswith("/_matrix/client/v3/rooms/%21room%3Atest/send/m.room.message/"))
        self.assertEqual((body, authorization), ({"body": "hi"}, "Bearer token"))

    def test_call_raises_on_an_error_and_http_json_reports_it(self):
        with self.assertRaisesRegex(RuntimeError, "GET /fail: 403"):
            matrix_http.call(self.homeserver, "GET", "/fail")
        self.assertEqual(matrix_http.http_json("GET", self.homeserver + "/fail")[0], 403)

    def test_http_json_reports_no_answer_as_status_0(self):
        status, body = matrix_http.http_json("GET", "http://127.0.0.1:9/", timeout=1)
        self.assertEqual(status, 0)
        self.assertIn("error", body)


if __name__ == "__main__":
    unittest.main()
