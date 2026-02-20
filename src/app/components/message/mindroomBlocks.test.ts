import { describe, expect, it } from 'vitest';
import { parseMindroomToolBlock } from './mindroomBlocks';

describe('parseMindroomToolBlock', () => {
  it('parses pending tool call without newline', () => {
    expect(parseMindroomToolBlock('search_web(query=latest AI news)')).toEqual({
      status: 'pending',
      command: 'search_web(query=latest AI news)',
      resultInline: false,
    });
  });

  it('parses completed tool call with empty result body', () => {
    expect(parseMindroomToolBlock('search_web(query=latest AI news)\n')).toEqual({
      status: 'completed',
      command: 'search_web(query=latest AI news)',
      resultInline: false,
    });
  });

  it('parses completed tool call with inline result', () => {
    expect(parseMindroomToolBlock('search_web(query=latest AI news)\nResults found: 5')).toEqual({
      status: 'completed_with_result',
      command: 'search_web(query=latest AI news)',
      result: 'Results found: 5',
      resultInline: true,
    });
  });

  it('parses completed tool call with multiline result block', () => {
    expect(
      parseMindroomToolBlock('read_file(path=/tmp/data.json)\n{"k":"v"}\n{"k2":"v2"}')
    ).toEqual({
      status: 'completed_with_result',
      command: 'read_file(path=/tmp/data.json)',
      result: '{"k":"v"}\n{"k2":"v2"}',
      resultInline: false,
    });
  });
});
