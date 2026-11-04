"""Tests for scripts/reference/seed.py without a homeserver: python3 -m unittest scripts/reference/test_seed.py"""

import importlib
import io
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

FOLDER_VARIABLES = ("E2E_SEED_AGENT_AVATARS", "E2E_SEED_PEOPLE_AVATARS")


def load_seed(**env):
    """Imports seed.py afresh, with only the given avatar folder variables set."""
    with mock.patch.dict(os.environ):
        for name in FOLDER_VARIABLES:
            os.environ.pop(name, None)
        os.environ.update(env)
        sys.modules.pop("seed", None)
        return importlib.import_module("seed")


class AvatarFolders(unittest.TestCase):
    def test_the_variables_name_the_folders(self):
        seed = load_seed(E2E_SEED_AGENT_AVATARS="/srv/agents", E2E_SEED_PEOPLE_AVATARS="/srv/people")
        self.assertEqual((seed.AGENTS, seed.PEOPLE), ("/srv/agents", "/srv/people"))

    def test_without_them_the_documented_defaults_apply(self):
        seed = load_seed()
        self.assertEqual(seed.AGENTS, "/home/basnijholt/Work/dev/assets/avatars/painted/agents")
        self.assertEqual(seed.PEOPLE, "/home/basnijholt/Work/dev/demo/world/avatars/people")


class Register(unittest.TestCase):
    def setUp(self):
        self.seed = load_seed()
        self.requests = []

        def fake_call(method, path, token, body=None, **kwargs):
            self.requests.append((method, path.split("?")[0].rsplit("/", 1)[-1]))
            return {"content_uri": "mxc://matrix.localhost/avatar"}

        patches = [
            mock.patch.object(self.seed, "register_account", return_value={"access_token": "t", "user_id": "@u:x"}),
            mock.patch.object(self.seed, "call", side_effect=fake_call),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def test_a_missing_picture_leaves_the_account_without_an_avatar(self):
        with mock.patch("sys.stderr", new_callable=io.StringIO) as stderr:
            user = self.seed.register("u", "Una", "/nonexistent/una.png")
        self.assertEqual(user, {"id": "@u:x", "tok": "t", "name": "Una"})
        self.assertEqual(self.requests, [("PUT", "displayname")])
        self.assertIn("/nonexistent/una.png", stderr.getvalue())

    def test_a_picture_is_uploaded_and_set(self):
        with tempfile.NamedTemporaryFile(suffix=".png") as picture:
            picture.write(b"\x89PNG")
            picture.flush()
            self.seed.register("u", "Una", picture.name)
        self.assertEqual(self.requests, [("PUT", "displayname"), ("POST", "upload"), ("PUT", "avatar_url")])


if __name__ == "__main__":
    unittest.main()
