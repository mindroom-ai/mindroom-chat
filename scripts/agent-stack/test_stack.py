"""Tests of scripts/agent-stack/stack.py that need no backend: its configs, provider keys and usage summary."""

from __future__ import annotations

import json
import os
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


if __name__ == "__main__":
    unittest.main()
