import { describe, expect, it } from 'vitest';
import {
  MINDROOM_TOOL_REF_HTML_REG_G,
  formatMindroomToolRefTextBodyAsHtml,
  parseMindroomToolRefHtml,
  parseMindroomToolRefText,
} from './blocks';

describe('MINDROOM_TOOL_REF_HTML_REG_G', () => {
  it('matches the formatted_body marker contract', () => {
    MINDROOM_TOOL_REF_HTML_REG_G.lastIndex = 0;
    const match = MINDROOM_TOOL_REF_HTML_REG_G.exec('🔧 <code>search_web</code> [12] ⏳');

    expect(match?.[1]).toBe('search_web');
    expect(match?.[2]).toBe('12');
    expect(match?.[3]).toBe(' ⏳');
  });
});

describe('parseMindroomToolRefHtml', () => {
  it('parses a pending HTML tool ref marker', () => {
    expect(parseMindroomToolRefHtml('🔧 <code>search_web</code> [1] ⏳')).toEqual({
      toolName: 'search_web',
      index: 1,
      pending: true,
    });
  });

  it('parses a completed HTML tool ref marker', () => {
    expect(parseMindroomToolRefHtml('🔧 <code>read_file</code> [2]')).toEqual({
      toolName: 'read_file',
      index: 2,
      pending: false,
    });
  });

  it('requires the full marker string to match', () => {
    expect(
      parseMindroomToolRefHtml('prefix 🔧 <code>search_web</code> [1] suffix')
    ).toBeUndefined();
  });
});

describe('parseMindroomToolRefText', () => {
  it('parses the plain text body marker contract', () => {
    expect(parseMindroomToolRefText('🔧 `shell` [3]')).toEqual({
      toolName: 'shell',
      index: 3,
      pending: false,
    });
  });

  it('returns undefined for non-marker text', () => {
    expect(parseMindroomToolRefText('normal response text')).toBeUndefined();
  });
});

describe('formatMindroomToolRefTextBodyAsHtml', () => {
  it('converts plain text tool marker lines to the formatted marker contract', () => {
    expect(
      formatMindroomToolRefTextBodyAsHtml(
        [
          'Before <unsafe>',
          '',
          '🔧 `run_shell_command` [1]',
          '',
          'After & done',
          'same paragraph',
          '🔧 `edit_file` [2] ⏳',
        ].join('\n')
      )
    ).toBe(
      [
        '<p>Before &lt;unsafe&gt;</p>',
        '<p>🔧 <code>run_shell_command</code> [1]</p>',
        '<p>After &amp; done<br/>same paragraph</p>',
        '<p>🔧 <code>edit_file</code> [2] ⏳</p>',
      ].join('')
    );
  });

  it('returns undefined when the plain body has no tool refs', () => {
    expect(formatMindroomToolRefTextBodyAsHtml('plain response')).toBeUndefined();
  });
});
