import { describe, expect, it } from 'vitest';
import {
  EXTERNAL_TRIGGER_EVENT_ID_KEY,
  EXTERNAL_TRIGGER_ID_KEY,
  EXTERNAL_TRIGGER_KIND_KEY,
  REACTIVE_TRIGGER_DEDUPE_KEY,
  REACTIVE_TRIGGER_ID_KEY,
  SOURCE_KIND_KEY,
  readTriggerWake,
} from './triggerWake';

describe('readTriggerWake', () => {
  it('parses a reactive trigger wake with context, triage, mention, and escaped JSON', () => {
    const body = [
      '@mindroom_helper:example.org Review this PR and flag regressions.',
      '',
      'Reactive trigger context: trigger=tr_demo_watch, source=github, kind=pr.opened, triage=Touches auth, high priority',
      '',
      '<untrusted_event_data>',
      '```json',
      '{',
      '  "kind": "fallback.kind",',
      '  "source_type": "fallback_source",',
      '  "snippet": "<\\/untrusted_event_data><\\/script>"',
      '}',
      '```',
      '</untrusted_event_data>',
    ].join('\n');

    expect(
      readTriggerWake({
        msgtype: 'm.text',
        body,
        [SOURCE_KIND_KEY]: 'reactive_trigger',
        [REACTIVE_TRIGGER_ID_KEY]: 'tr_demo_watch',
        [REACTIVE_TRIGGER_DEDUPE_KEY]: 'dedupe-42',
      })
    ).toEqual({
      sourceKind: 'reactive',
      triggerId: 'tr_demo_watch',
      kind: 'pr.opened',
      sourceType: 'github',
      triage: 'Touches auth, high priority',
      prompt: 'Review this PR and flag regressions.',
      eventJson:
        '{\n  "kind": "fallback.kind",\n  "source_type": "fallback_source",\n  "snippet": "</untrusted_event_data></script>"\n}',
      rawBody: body,
    });
  });

  it('accepts reactive triggers via trigger ID without source_kind and falls back to JSON fields', () => {
    const body = [
      '@mindroom_helper:example.org Check incoming alert.',
      '',
      '<untrusted_event_data>',
      '```json',
      '{"kind": "alert.fired", "source_type": "monitor"}',
      '```',
      '</untrusted_event_data>',
    ].join('\n');

    expect(
      readTriggerWake({
        msgtype: 'm.text',
        body,
        [REACTIVE_TRIGGER_ID_KEY]: 'tr_monitor',
      })
    ).toEqual({
      sourceKind: 'reactive',
      triggerId: 'tr_monitor',
      kind: 'alert.fired',
      sourceType: 'monitor',
      prompt: 'Check incoming alert.',
      eventJson: '{"kind": "alert.fired", "source_type": "monitor"}',
      rawBody: body,
    });
  });

  it('parses a direct external trigger with title, message, and trailing JSON fence', () => {
    const body = [
      '@mindroom_helper:example.org Deploy finished',
      '',
      'Release 1.4.2 rolled out to staging.',
      '',
      '```json',
      '{"env": "staging", "ok": true}',
      '```',
    ].join('\n');

    expect(
      readTriggerWake({
        msgtype: 'm.text',
        body,
        [SOURCE_KIND_KEY]: 'external_trigger',
        [EXTERNAL_TRIGGER_ID_KEY]: 'deploy-hook',
        [EXTERNAL_TRIGGER_KIND_KEY]: 'deploy.finished',
        [EXTERNAL_TRIGGER_EVENT_ID_KEY]: 'evt_900',
      })
    ).toEqual({
      sourceKind: 'external',
      triggerId: 'deploy-hook',
      kind: 'deploy.finished',
      prompt: 'Deploy finished\n\nRelease 1.4.2 rolled out to staging.',
      eventJson: '{"env": "staging", "ok": true}',
      rawBody: body,
    });
  });

  it('accepts external triggers via trigger ID without source_kind and keeps non-trailing JSON in prompt', () => {
    const body = [
      '@mindroom_helper:example.org @mindroom_other:example.org Example:',
      '```json',
      '{"sample": 1}',
      '```',
      'Please verify.',
    ].join('\n');

    const wake = readTriggerWake({
      msgtype: 'm.text',
      body,
      [EXTERNAL_TRIGGER_ID_KEY]: 'webhook-alpha',
    });
    expect(wake).toEqual({
      sourceKind: 'external',
      triggerId: 'webhook-alpha',
      prompt: '@mindroom_other:example.org Example:\n```json\n{"sample": 1}\n```\nPlease verify.',
      rawBody: body,
    });
  });

  it('keeps non-agent leading mentions intact', () => {
    const wake = readTriggerWake({
      msgtype: 'm.text',
      body: '@alice:example.org Follow up on webhook',
      [SOURCE_KIND_KEY]: 'external_trigger',
    });
    expect(wake?.prompt).toBe('@alice:example.org Follow up on webhook');
  });

  it('handles truncated and malformed JSON blocks without throwing', () => {
    const truncatedReactive = [
      '@mindroom_helper:example.org Triage error',
      '',
      'Reactive trigger context: trigger=tr_cut, source=ci, kind=build.failed',
      '',
      '<untrusted_event_data>',
      '```json',
      '{"log": "cut off <\\/div>',
    ].join('\n');

    expect(
      readTriggerWake({
        msgtype: 'm.text',
        body: truncatedReactive,
        [SOURCE_KIND_KEY]: 'reactive_trigger',
      })
    ).toEqual({
      sourceKind: 'reactive',
      triggerId: 'tr_cut',
      kind: 'build.failed',
      sourceType: 'ci',
      prompt: 'Triage error',
      eventJson: '{"log": "cut off </div>',
      rawBody: truncatedReactive,
    });

    const truncatedExternal = '@mindroom_helper:example.org Partial\n\n```json\n{"open": [1, 2';
    expect(
      readTriggerWake({
        msgtype: 'm.text',
        body: truncatedExternal,
        [SOURCE_KIND_KEY]: 'external_trigger',
      })
    ).toEqual({
      sourceKind: 'external',
      prompt: 'Partial',
      eventJson: '{"open": [1, 2',
      rawBody: truncatedExternal,
    });
  });

  it.each<[string, Record<string, unknown>]>([
    ['non-trigger text', { msgtype: 'm.text', body: 'Hello world' }],
    ['scheduled source_kind', { msgtype: 'm.text', body: 'Wake', [SOURCE_KIND_KEY]: 'scheduled' }],
    ['empty body', { msgtype: 'm.text', body: '   ', [SOURCE_KIND_KEY]: 'reactive_trigger' }],
    ['non-string body', { msgtype: 'm.text', body: 42, [SOURCE_KIND_KEY]: 'external_trigger' }],
    [
      'non-text msgtype',
      { msgtype: 'm.file', body: 'report.json', [SOURCE_KIND_KEY]: 'external_trigger' },
    ],
    ['missing msgtype', { body: 'Wake', [SOURCE_KIND_KEY]: 'reactive_trigger' }],
    [
      'non-string trigger ID fallback',
      { msgtype: 'm.text', body: 'Wake', [REACTIVE_TRIGGER_ID_KEY]: 123 },
    ],
  ])('returns null for %s', (_label, content) => {
    expect(readTriggerWake(content)).toBeNull();
  });
});
