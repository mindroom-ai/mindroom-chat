import { describe, expect, it } from 'vitest';
import { getMindroomAiRunInfo, hasMindroomAiRunMetadata } from './mindroomAiRun';

describe('hasMindroomAiRunMetadata', () => {
  it('returns true only for version 1 ai_run metadata', () => {
    expect(hasMindroomAiRunMetadata({})).toBe(false);
    expect(hasMindroomAiRunMetadata({ 'io.mindroom.ai_run': { version: 2 } })).toBe(false);
    expect(hasMindroomAiRunMetadata({ 'io.mindroom.ai_run': { version: 1 } })).toBe(true);
  });
});

describe('getMindroomAiRunInfo', () => {
  it('extracts metadata from top-level message content', () => {
    const info = getMindroomAiRunInfo({
      'io.mindroom.ai_run': {
        version: 1,
        status: 'completed',
        run_id: 'run-1',
        session_id: 'session-1',
        model: { config: 'default', id: 'gpt-4.1-mini', provider: 'openai' },
        usage: {
          input_tokens: 100,
          output_tokens: 25,
          total_tokens: 125,
          time_to_first_token: 0.42,
        },
        context: { input_tokens: 100, window_tokens: 4000 },
        tools: { count: 2 },
      },
    });

    expect(info).toEqual({
      status: 'completed',
      runId: 'run-1',
      sessionId: 'session-1',
      modelConfig: 'default',
      modelId: 'gpt-4.1-mini',
      modelProvider: 'openai',
      inputTokens: 100,
      outputTokens: 25,
      totalTokens: 125,
      timeToFirstToken: 0.42,
      contextInputTokens: 100,
      contextWindowTokens: 4000,
      toolCount: 2,
    });
  });

  it('reads metadata from m.new_content wrapper payloads', () => {
    const info = getMindroomAiRunInfo({
      'm.new_content': {
        body: 'edited',
        'io.mindroom.ai_run': {
          version: 1,
          status: 'cached',
          usage: { total_tokens: 50 },
        },
      },
    });

    expect(info?.status).toBe('cached');
    expect(info?.totalTokens).toBe(50);
  });

  it('returns undefined when metadata is absent or invalid', () => {
    expect(getMindroomAiRunInfo({})).toBeUndefined();
    expect(
      getMindroomAiRunInfo({ 'io.mindroom.ai_run': { version: 1, usage: 'bad' } })
    ).toBeUndefined();
    expect(getMindroomAiRunInfo({ 'io.mindroom.ai_run': { version: 3 } })).toBeUndefined();
  });
});
