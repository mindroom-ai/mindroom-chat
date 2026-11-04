"""Tests of scripts/agent-stack/stack.py that need no backend: its configs, provider keys and usage summary."""

from __future__ import annotations

import contextlib
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stack  # noqa: E402

TESTER = "@tester_t1:matrix.localhost"
STUB_URL = "http://127.0.0.1:29716/v1"


class ConfigTests(unittest.TestCase):
    def test_stub_config_runs_two_agents_on_the_stub(self) -> None:
        config = stack.config_yaml("stub", TESTER, STUB_URL, 0.0003)
        self.assertIn(f"base_url: {STUB_URL}", config)
        self.assertIn("  scout:\n", config)
        self.assertIn("router:\n  model: default\n", config)
        self.assertNotIn("thread_summary_model", config)
        self.assertNotIn("anthropic", config)

    def test_real_config_runs_the_helper_on_haiku_and_luna_for_the_rest(self) -> None:
        config = stack.config_yaml("real", TESTER, STUB_URL, 0.0003)
        self.assertIn("provider: anthropic\n    id: claude-haiku-5-5\n", config)
        self.assertIn("  luna:\n    provider: openai\n    id: gpt-6-luna\n", config)
        self.assertIn("router:\n  model: luna\n", config)
        self.assertIn("  thread_summary_model: luna\n", config)
        self.assertNotIn("  scout:", config)
        self.assertNotIn(STUB_URL, config)
        # Every scenario of the stub has a line in the script.
        script = "\n".join(stack.REAL_INSTRUCTIONS)
        for tag in ("#slow", "#stopme", "#long", "#multi", "#approve", "#title", "#tag", "#expire", "#job"):
            self.assertIn(f"{tag}:", script)

    def test_a_key_in_the_environment_never_reaches_the_config(self) -> None:
        with mock.patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-test-secret", "OPENAI_API_KEY": "sk-two"}):
            config = stack.config_yaml("real", TESTER, STUB_URL, 0.0003)
        self.assertNotIn("sk-test-secret", config)
        self.assertNotIn("sk-two", config)


class ProviderKeyTests(unittest.TestCase):
    def test_only_the_provider_keys_are_taken(self) -> None:
        env = {"ANTHROPIC_API_KEY": "a", "OPENAI_API_KEY": "", "GITHUB_TOKEN": "g"}
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(stack.provider_keys(), {"ANTHROPIC_API_KEY": "a"})


CONSOLE_LINE = (
    "2026-11-04T17:00:03.689917Z [info     ] LLM usage                      "
    "[mindroom.providers.pipeline.request_log] agent_id=helper cache_read_ratio=0.0 cache_read_tokens=0 "
    "cache_write_tokens=18382 context_input_tokens=18386 input_tokens=4 model_id=claude-haiku-5-5 "
    "model_name=default output_tokens=13 provider=Anthropic reasoning_tokens=0 stop_reason=end "
    "uncached_input_tokens=18386 usage_available=True"
)
JSON_LINE = json.dumps(
    {
        "event": "LLM usage",
        "model_name": "luna",
        "model_id": "gpt-6-luna",
        "context_input_tokens": 1000,
        "uncached_input_tokens": 400,
        "cache_read_tokens": 600,
        "cache_write_tokens": 0,
        "output_tokens": 100,
        "reasoning_tokens": 50,
    }
)


class UsageTests(unittest.TestCase):
    def test_usage_sums_and_prices_console_and_json_lines(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            slot_dir = Path(directory)
            lines = [CONSOLE_LINE, "something else", JSON_LINE, CONSOLE_LINE]
            (slot_dir / "backend.log").write_text("\n".join(lines) + "\n")
            summary = stack.usage_summary({"model": "real", "slot": 16, "namespace": "t1"}, slot_dir)
        self.assertEqual(summary["calls"], 3)
        haiku = summary["models"]["default"]
        self.assertEqual(haiku["calls"], 2)
        self.assertEqual(haiku["context_input_tokens"], 36772)
        self.assertEqual(haiku["output_tokens"], 26)
        # 8 plain input tokens, 36764 cache writes, 26 output tokens at the Haiku prices.
        self.assertAlmostEqual(haiku["usd"], round((8 * 0.1 + 36764 * 0.2 + 26 * 0.5) / 1e6, 4))
        luna = summary["models"]["luna"]
        self.assertAlmostEqual(luna["usd"], round((400 * 0.1 + 600 * 0.01 + 100 * 0.5) / 1e6, 4))
        self.assertAlmostEqual(summary["usd"], round(haiku["usd"] + luna["usd"], 4), places=4)

    def test_a_stub_stack_has_no_price(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            slot_dir = Path(directory)
            (slot_dir / "backend.log").write_text(CONSOLE_LINE + "\n")
            summary = stack.usage_summary({"model": "stub"}, slot_dir)
        self.assertEqual(summary["calls"], 1)
        self.assertEqual(summary["usd"], 0)
        self.assertNotIn("usd", summary["models"]["default"])


class CallsTests(unittest.TestCase):
    SERVICE = "http://127.0.0.1:29521"

    def calls(self, profile: str = "realtime") -> dict | None:
        args = mock.Mock(calls=self.SERVICE + "/", calls_profile=profile)
        return stack.calls_setting(args)

    def test_no_calls_without_the_option(self) -> None:
        self.assertIsNone(stack.calls_setting(mock.Mock(calls=None, calls_profile="realtime")))
        self.assertNotIn("calls:", stack.config_yaml("stub", TESTER, STUB_URL, 0.0003))

    def test_the_helper_answers_calls_on_the_slot_service_with_the_cheap_realtime_model(self) -> None:
        calls = self.calls()
        self.assertEqual(calls, {"serviceUrl": self.SERVICE, "profile": "realtime", "model": "gpt-realtime-2.1-mini"})
        config = stack.config_yaml("stub", TESTER, STUB_URL, 0.0003, calls)
        self.assertIn(f"calls:\n  enabled: true\n  livekit_service_url: {self.SERVICE}\n", config)
        self.assertIn("      backend: realtime\n      model: gpt-realtime-2.1-mini\n", config)
        self.assertIn("      credentials_service: openai\n", config)
        self.assertIn("  agents:\n    helper: voice\n", config)

    def test_the_live_profile_speaks_through_gpt_live(self) -> None:
        config = stack.config_yaml("real", TESTER, STUB_URL, 0.0003, self.calls("live"))
        self.assertIn("      backend: live\n      model: gpt-live-1\n", config)

    def test_the_stub_models_keep_a_key_of_their_own_when_calls_bring_the_real_one(self) -> None:
        config = stack.config_yaml("stub", TESTER, STUB_URL, 0.0003, self.calls())
        # MindRoom gives a model's own key precedence over OPENAI_API_KEY, so the stub never receives the real one.
        self.assertEqual(config.count("      api_key: stub-key-no-model-is-called\n"), 2)

    def test_voice_usage_comes_from_the_session_database(self) -> None:
        # Realtime calls count tokens; GPT-Live bills the call's seconds.
        usage = {
            "kind": "realtime_voice",
            "model": "gpt-realtime-2.1-mini",
            "metrics": {
                "input_tokens": 14392,
                "output_tokens": 542,
                "audio_input_tokens": 52,
                "audio_output_tokens": 355,
            },
            "requests": [{}, {}],
        }
        with tempfile.TemporaryDirectory() as directory:
            slot_dir = Path(directory)
            folder = slot_dir / "storage" / "agents" / "helper" / "sessions"
            folder.mkdir(parents=True)
            with contextlib.closing(sqlite3.connect(folder / "helper.db")) as connection:
                connection.execute("CREATE TABLE helper_sessions_usage (id INTEGER PRIMARY KEY, usage_data TEXT)")
                connection.execute("INSERT INTO helper_sessions_usage (usage_data) VALUES (?)", (json.dumps(usage),))
                connection.execute("INSERT INTO helper_sessions_usage (usage_data) VALUES (?)", ('{"kind": "run"}',))
                live = {"kind": "live_voice", "model": "gpt-live-1", "voice": {"seconds": 15.94, "finalized": True}}
                connection.execute("INSERT INTO helper_sessions_usage (usage_data) VALUES (?)", (json.dumps(live),))
                connection.commit()
            summary = stack.usage_summary({"model": "stub", "calls": self.calls()}, slot_dir)
        self.assertEqual(
            summary["voice"],
            [
                {
                    "kind": "realtime_voice",
                    "model": "gpt-realtime-2.1-mini",
                    "responses": 2,
                    "seconds": 0.0,
                    "input_tokens": 14392,
                    "output_tokens": 542,
                    "cache_read_tokens": 0,
                    "audio_input_tokens": 52,
                    "audio_output_tokens": 355,
                },
                {
                    "kind": "live_voice",
                    "model": "gpt-live-1",
                    "responses": 0,
                    "seconds": 15.9,
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "cache_read_tokens": 0,
                    "audio_input_tokens": 0,
                    "audio_output_tokens": 0,
                },
            ],
        )


if __name__ == "__main__":
    unittest.main()
