import { describe, expect, it } from 'vitest';
import {
  getAiRunInfo,
  hasTerminalStreamMetadata,
  isAiRunStreaming,
  readOwnStreamStatus,
  withoutAiRunCost,
} from './aiRun';
import { STREAM_STATUS_TS_KEY } from './editMetadata';

describe('getAiRunInfo', () => {
  it('extracts metadata from top-level message content', () => {
    const info = getAiRunInfo({
      'io.mindroom.ai_run': {
        version: 1,
        status: 'completed',
        run_id: 'run-1',
        session_id: 'session-1',
        model: {
          config: 'default',
          display_name: '  GPT Mini  ',
          id: 'gpt-4.1-mini',
          provider: 'openai',
        },
        usage: {
          input_tokens: 100,
          output_tokens: 25,
          total_tokens: 125,
          cache_read_tokens: 20,
          cache_write_tokens: 5,
          time_to_first_token: 0.42,
        },
        context: {
          input_tokens: 125,
          window_tokens: 4000,
          cache_read_input_tokens: 20,
          cache_write_input_tokens: 5,
          uncached_input_tokens: 105,
        },
        tools: { count: 2 },
      },
    });

    expect(info).toEqual({
      status: 'completed',
      runId: 'run-1',
      sessionId: 'session-1',
      modelConfig: 'default',
      modelDisplayName: 'GPT Mini',
      modelId: 'gpt-4.1-mini',
      modelProvider: 'openai',
      inputTokens: 100,
      outputTokens: 25,
      cacheReadTokens: 20,
      cacheWriteTokens: 5,
      timeToFirstToken: 0.42,
      contextInputTokens: 125,
      contextWindowTokens: 4000,
      contextCacheReadInputTokens: 20,
      contextUncachedInputTokens: 105,
      toolCount: 2,
    });
  });

  it('reads metadata from m.new_content wrapper payloads', () => {
    const info = getAiRunInfo({
      'io.mindroom.ai_run': {
        version: 1,
        model: { config: 'old', display_name: 'Old Model' },
      },
      'm.new_content': {
        body: 'edited',
        'io.mindroom.ai_run': {
          version: 1,
          status: 'cached',
          model: { config: 'new', display_name: 'New Model' },
          usage: { output_tokens: 50 },
        },
      },
    });

    expect(info?.status).toBe('cached');
    expect(info?.outputTokens).toBe(50);
    expect(info?.modelConfig).toBe('new');
    expect(info?.modelDisplayName).toBe('New Model');
  });

  it.each([undefined, null, '', '   ', 42, {}, []])(
    'ignores missing or invalid model display name %j while preserving the alias',
    (displayName) => {
      const info = getAiRunInfo({
        'io.mindroom.ai_run': {
          version: 1,
          model: { config: 'friendly_alias', display_name: displayName },
        },
      });

      expect(info?.modelDisplayName).toBeUndefined();
      expect(info?.modelConfig).toBe('friendly_alias');
    }
  );

  it('returns undefined when metadata is absent or invalid', () => {
    expect(getAiRunInfo({})).toBeUndefined();
    expect(getAiRunInfo({ 'io.mindroom.ai_run': { version: 1, usage: 'bad' } })).toBeUndefined();
    expect(getAiRunInfo({ 'io.mindroom.ai_run': { version: 3 } })).toBeUndefined();
  });
});

describe('isAiRunStreaming', () => {
  it('returns false when no ai_run metadata is present', () => {
    expect(isAiRunStreaming({})).toBe(false);
    expect(isAiRunStreaming({ 'io.mindroom.ai_run': { version: 2 } })).toBe(false);
  });

  it('returns false for terminal statuses', () => {
    const terminalStatuses = ['completed', 'cached', 'error', 'cancelled', 'interrupted'];
    for (const status of terminalStatuses) {
      expect(isAiRunStreaming({ 'io.mindroom.ai_run': { version: 1, status } })).toBe(false);
      expect(hasTerminalStreamMetadata({ 'io.mindroom.ai_run': { version: 1, status } })).toBe(
        true
      );
    }
  });

  it('returns true for non-terminal statuses', () => {
    const activeStatuses = ['streaming', 'running', 'active', 'thinking'];
    for (const status of activeStatuses) {
      expect(isAiRunStreaming({ 'io.mindroom.ai_run': { version: 1, status } })).toBe(true);
    }
  });

  it('returns true when metadata exists but status is absent', () => {
    expect(isAiRunStreaming({ 'io.mindroom.ai_run': { version: 1 } })).toBe(true);
  });

  it('reads metadata from m.new_content wrapper', () => {
    expect(
      isAiRunStreaming({
        'm.new_content': {
          body: 'partial',
          'io.mindroom.ai_run': { version: 1, status: 'running' },
        },
      })
    ).toBe(true);

    expect(
      isAiRunStreaming({
        'm.new_content': {
          body: 'done',
          'io.mindroom.ai_run': { version: 1, status: 'completed' },
        },
      })
    ).toBe(false);
  });

  it('returns true when io.mindroom.stream_status is active (no ai_run metadata)', () => {
    const activeStatuses = ['pending', 'streaming', 'running', 'active'];
    for (const status of activeStatuses) {
      expect(isAiRunStreaming({ 'io.mindroom.stream_status': status })).toBe(true);
    }
  });

  it('returns false when io.mindroom.stream_status is terminal (no ai_run metadata)', () => {
    const terminalStatuses = [
      'completed',
      'complete',
      'done',
      'error',
      'failed',
      'stopped',
      'cancelled',
    ];
    for (const status of terminalStatuses) {
      expect(isAiRunStreaming({ 'io.mindroom.stream_status': status })).toBe(false);
    }
  });

  it('returns false when io.mindroom.stream_status is unrecognized (no ai_run metadata)', () => {
    expect(isAiRunStreaming({ 'io.mindroom.stream_status': 'unknown' })).toBe(false);
  });

  it('reads stream_status from m.new_content wrapper', () => {
    expect(
      isAiRunStreaming({
        'm.new_content': {
          body: 'partial response',
          'io.mindroom.stream_status': 'streaming',
        },
      })
    ).toBe(true);

    expect(
      isAiRunStreaming({
        'm.new_content': {
          body: 'final response',
          'io.mindroom.stream_status': 'completed',
        },
      })
    ).toBe(false);
  });

  it('is case-insensitive for stream_status', () => {
    expect(isAiRunStreaming({ 'io.mindroom.stream_status': 'STREAMING' })).toBe(true);
    expect(isAiRunStreaming({ 'io.mindroom.stream_status': 'Completed' })).toBe(false);
  });

  it('always treats terminal metadata as not streaming when both ai_run and stream_status are present', () => {
    // ai_run says completed, stream_status says streaming → not streaming
    expect(
      isAiRunStreaming({
        'io.mindroom.ai_run': { version: 1, status: 'completed' },
        'io.mindroom.stream_status': 'streaming',
      })
    ).toBe(false);

    // ai_run says running, stream_status says completed → not streaming (terminal stream_status wins)
    expect(
      isAiRunStreaming({
        'io.mindroom.ai_run': { version: 1, status: 'running' },
        'io.mindroom.stream_status': 'completed',
      })
    ).toBe(false);

    // record-form terminal stream_status also terminates even with active ai_run
    expect(
      isAiRunStreaming({
        'io.mindroom.ai_run': { version: 1, status: 'streaming' },
        'io.mindroom.stream_status': { status: 'cancelled' },
      })
    ).toBe(false);
    // hasTerminalStreamMetadata reads the string form only. An edit counts by it as the one that
    // finished its reply, for good, so a record-form status must not make it one.
    expect(
      hasTerminalStreamMetadata({
        'io.mindroom.ai_run': { version: 1, status: 'streaming' },
        'io.mindroom.stream_status': { status: 'cancelled' },
      })
    ).toBe(false);
  });

  it('handles early status-less ai_run metadata alongside stream_status lifecycle', () => {
    const earlyRun = {
      version: 1,
      model: {
        config: 'gemini4_neon',
        display_name: 'Gemini 4 Neon',
        id: 'google/gemini-4-neon',
        provider: 'openrouter',
      },
    };

    expect(
      isAiRunStreaming({
        'io.mindroom.ai_run': earlyRun,
        'io.mindroom.stream_status': 'pending',
      })
    ).toBe(true);
    expect(
      isAiRunStreaming({
        'io.mindroom.ai_run': earlyRun,
        'io.mindroom.stream_status': 'streaming',
      })
    ).toBe(true);
    expect(
      isAiRunStreaming({
        'io.mindroom.ai_run': earlyRun,
        'io.mindroom.stream_status': 'approval_pending',
      })
    ).toBe(false);
    expect(
      isAiRunStreaming({
        'io.mindroom.ai_run': { ...earlyRun, status: 'streaming' },
        'io.mindroom.stream_status': 'approval_pending',
      })
    ).toBe(false);

    for (const terminal of ['completed', 'cancelled', 'error', 'interrupted']) {
      expect(
        isAiRunStreaming({
          'io.mindroom.ai_run': earlyRun,
          'io.mindroom.stream_status': terminal,
        })
      ).toBe(false);
    }

    expect(
      isAiRunStreaming({
        'io.mindroom.ai_run': earlyRun,
        'io.mindroom.stream_status': 'unknown',
      })
    ).toBe(false);

    // Backward compat: status-less ai_run without stream_status stays streaming
    expect(isAiRunStreaming({ 'io.mindroom.ai_run': earlyRun })).toBe(true);
  });

  // A regenerated reply's first edit carries only its run status, and shows the stream status of
  // the run before it, borrowed (`getEditedEvent`): the reply showed no streaming indicator.
  it('lets a run status that goes on outweigh a borrowed stream status, not one of its own', () => {
    const streamingRun = { 'io.mindroom.ai_run': { version: 1, status: 'streaming' } };
    const earlyRun = { 'io.mindroom.ai_run': { version: 1, model: { config: 'gemini4_neon' } } };
    const borrowed = (status: string) => ({
      'io.mindroom.stream_status': status,
      [STREAM_STATUS_TS_KEY]: 2000,
    });

    for (const status of ['completed', 'cancelled', 'error', 'approval_pending']) {
      expect(readOwnStreamStatus(borrowed(status))).toBeUndefined();
      expect(readOwnStreamStatus({ 'io.mindroom.stream_status': status })).toBe(status);

      // A retry, as shown content and as the edit that wraps it.
      expect(isAiRunStreaming({ ...streamingRun, ...borrowed(status) })).toBe(true);
      expect(isAiRunStreaming({ 'm.new_content': { ...streamingRun, ...borrowed(status) } })).toBe(
        true
      );
      // A stop note, a finish or a pause with the streaming run of the edit before it.
      expect(isAiRunStreaming({ ...streamingRun, 'io.mindroom.stream_status': status })).toBe(
        false
      );
      // A correction of the text, which states no run status: the borrowed status stands.
      expect(isAiRunStreaming({ ...earlyRun, ...borrowed(status) })).toBe(false);
      expect(isAiRunStreaming(borrowed(status))).toBe(false);
    }

    expect(isAiRunStreaming({ ...earlyRun, ...borrowed('streaming') })).toBe(true);
    expect(
      isAiRunStreaming({
        'io.mindroom.ai_run': { version: 1, status: 'completed' },
        ...borrowed('streaming'),
      })
    ).toBe(false);
  });
});

describe('getAiRunInfo reply cost', () => {
  const withRun = (run: Record<string, unknown>) => ({
    'io.mindroom.ai_run': { version: 1, status: 'completed', ...run },
  });

  it('parses cost.usd decimal strings', () => {
    expect(getAiRunInfo(withRun({ cost: { usd: '0.0421' } }))?.costUsd).toBe(0.0421);
  });

  it('accepts a numeric cost', () => {
    expect(getAiRunInfo(withRun({ cost: { usd: 1.5 } }))?.costUsd).toBe(1.5);
  });

  it('rejects malformed cost values', () => {
    ['abc', '-1', 'NaN', 'Infinity', '', ' 1', '1e309', -1, Number.NaN, {}, null].forEach((usd) => {
      expect(getAiRunInfo(withRun({ cost: { usd } }))?.costUsd).toBeUndefined();
    });
    expect(getAiRunInfo(withRun({ cost: '0.5' }))?.costUsd).toBeUndefined();
  });

  it('parses the subagents cost beside the reply cost', () => {
    const info = getAiRunInfo(withRun({ cost: { usd: '0.0125', subagents_usd: '0.375' } }));
    expect(info?.costUsd).toBe(0.0125);
    expect(info?.subagentsCostUsd).toBe(0.375);
    expect(getAiRunInfo(withRun({ cost: { subagents_usd: 2 } }))?.subagentsCostUsd).toBe(2);
  });

  it('leaves the subagents cost out when it is absent or malformed', () => {
    expect(getAiRunInfo(withRun({ cost: { usd: '0.0125' } }))?.subagentsCostUsd).toBeUndefined();
    ['abc', '-1', '', '1e309', -1, {}, null].forEach((subagents) => {
      const info = getAiRunInfo(withRun({ cost: { usd: '0.0125', subagents_usd: subagents } }));
      expect(info?.subagentsCostUsd).toBeUndefined();
      expect(info?.costUsd).toBe(0.0125);
    });
  });

  it('drops both costs for a sender whose cost does not count', () => {
    const info = getAiRunInfo(withRun({ cost: { usd: '0.0125', subagents_usd: '0.375' } }))!;
    const untrusted = withoutAiRunCost(info);
    expect(untrusted.costUsd).toBeUndefined();
    expect(untrusted.subagentsCostUsd).toBeUndefined();
    expect(untrusted.status).toBe('completed');
  });

  it('parses time_to_first_token strings the backend sends', () => {
    expect(
      getAiRunInfo(withRun({ usage: { time_to_first_token: '0.512' } }))?.timeToFirstToken
    ).toBe(0.512);
  });
});

describe('getAiRunInfo uncached input', () => {
  it('reads the uncached input the backend splits from cache reads', () => {
    expect(
      getAiRunInfo({
        'io.mindroom.ai_run': {
          version: 1,
          usage: { input_tokens: 1674, uncached_input_tokens: 266 },
        },
      })?.uncachedInputTokens
    ).toBe(266);
  });
});
