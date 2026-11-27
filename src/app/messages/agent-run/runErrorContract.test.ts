import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { parseAiRunError } from '../../matrix/protocol/aiRun';
import { prepareRunErrorBody } from './runErrorHtml';

type ContractCase = {
  name: string;
  body: string;
  formatted_body: string;
  ai_run: {
    version: 1;
    status: 'error';
    error: { kind: string; title: string; summary: string; retryable: boolean; fallback: string };
  };
  hasPartialText: boolean;
};

const PYTHON_SCRIPT = `
import json
from typing import get_args
from mindroom.ai_runtime import EMPTY_RESPONSE_NOTICE
from mindroom.error_handling import _ReplyErrorKind, describe_reply_error, empty_response_error_info, with_error_fallback
from mindroom.llm.errors import (
    MISSING_API_KEY, QUOTA_EXHAUSTED, STREAM_STALLED, TOKENS_PER_MINUTE, TRANSPORT_TIMEOUT,
    AuthenticationFailed, ContextWindowExceeded, ModelSafeguardRefusal, ProviderError, ProviderUnavailable, RateLimited,
)
from mindroom.llm.usage import MessageMetrics
from mindroom.matrix.message_builder import markdown_to_html
from mindroom.reply_presentation import format_error_note

make = lambda name, body, error, partial=False: {
    "name": name, "body": body, "formatted_body": markdown_to_html(body),
    "ai_run": {"version": 1, "status": "error", "error": error}, "hasPartialText": partial,
}
errors = [
    ("missing_api_key", AuthenticationFailed("No key", provider="openrouter", code=MISSING_API_KEY)),
    ("authentication_failed", AuthenticationFailed("Invalid key", provider="openrouter", status_code=401)),
    ("quota_exhausted", ProviderError("No credits", provider="openrouter", status_code=402, code=QUOTA_EXHAUSTED)),
    ("rate_limited", RateLimited("Slow down", provider="openrouter", status_code=429)),
    ("tokens_per_minute", ContextWindowExceeded("Too many TPM", provider="openrouter", code=TOKENS_PER_MINUTE)),
    ("context_window", ContextWindowExceeded("Too long", provider="openrouter")),
    ("stream_stalled", ProviderUnavailable("No data for 300s", provider="openrouter", code=STREAM_STALLED)),
    ("provider_unavailable", ProviderUnavailable("Down", provider="openrouter", status_code=503)),
    ("timeout", ProviderUnavailable("Timed out", provider="openrouter", code=TRANSPORT_TIMEOUT)),
    ("safeguard_refusal", ModelSafeguardRefusal(provider="openrouter", usage=MessageMetrics(), provider_code="safety")),
    ("runtime_error", RuntimeError("boom")),
]
infos = {name: describe_reply_error(exc, model_label="Neon", provider="openrouter") for name, exc in errors}
assert {i.kind for i in infos.values()} == set(get_args(_ReplyErrorKind.__value__))
cases = [make(name, info.plain_text, info.to_wire()) for name, info in infos.items()]
cases.append(make("empty_response", EMPTY_RESPONSE_NOTICE, empty_response_error_info(summary=EMPTY_RESPONSE_NOTICE, model_label="Neon", provider="openrouter")))
team_text = f"[ResearchTeam] {infos['rate_limited'].plain_text}"
cases.append(make("team_prefix", team_text, infos["rate_limited"].to_wire(fallback=team_text)))
note_text = format_error_note("setup failed")
cases.append(make("note_error", note_text, with_error_fallback(describe_reply_error(RuntimeError("setup failed")).to_wire(), note_text)))
cases.append(make("partial_plus_fallback", f"I checked the logs.\\n\\n{infos['stream_stalled'].plain_text}", infos["stream_stalled"].to_wire(), partial=True))
print(json.dumps(cases))
`;

const mindroomCheckout = process.env.E2E_MINDROOM_CHECKOUT;

describe.skipIf(!mindroomCheckout)('backend run-error contract', () => {
  it('parses and strips every backend error fallback in both plain text and Matrix HTML', () => {
    if (!mindroomCheckout) throw new Error('E2E_MINDROOM_CHECKOUT is required');
    const childEnv = { ...process.env };
    delete childEnv.VIRTUAL_ENV;
    delete childEnv.MINDROOM_BUILD_FRONTEND;
    const raw = execFileSync(
      'uv',
      ['run', '--frozen', '--no-dev', '--project', mindroomCheckout, 'python', '-c', PYTHON_SCRIPT],
      { env: childEnv, encoding: 'utf8' }
    );
    const cases = JSON.parse(raw) as ContractCase[];
    expect(cases).toHaveLength(15);

    for (const c of cases) {
      const parsed = parseAiRunError(c.ai_run.error);
      expect(parsed, c.name).toMatchObject({
        kind: c.ai_run.error.kind,
        title: c.ai_run.error.title,
        summary: c.ai_run.error.summary,
        retryable: c.ai_run.error.retryable,
        fallback: c.ai_run.error.fallback,
      });

      const aiRun = { status: 'error', error: parsed };
      const plain = prepareRunErrorBody({ enabled: true, body: c.body, html: undefined, aiRun });
      const html = prepareRunErrorBody({
        enabled: true,
        body: c.body,
        html: c.formatted_body,
        aiRun,
      });

      if (c.hasPartialText) {
        expect(plain, `${c.name} plain`).toMatchObject({
          bodyEmpty: false,
          body: 'I checked the logs.',
        });
        expect(html.bodyEmpty, `${c.name} html`).toBe(false);
        expect(html.html, `${c.name} html`).toContain('I checked the logs.');
        expect(html.html, `${c.name} html`).not.toContain(c.ai_run.error.fallback);
        expect(html.html, `${c.name} html`).not.toContain(c.ai_run.error.summary);
      } else {
        expect(plain, `${c.name} plain`).toMatchObject({ bodyEmpty: true, body: '' });
        expect(html, `${c.name} html`).toMatchObject({ bodyEmpty: true, html: undefined });
      }
    }
  }, 120_000);
});
