import { describe, expect, it } from 'vitest';
import {
  MINDROOM_TOOL_REF_HTML_REG_G,
  formatMindroomMarkdownTextBodyAsHtml,
  formatMindroomMessageTextBodyAsHtml,
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

describe('formatMindroomMessageTextBodyAsHtml', () => {
  it('formats paste markers and keeps tool refs parseable', () => {
    expect(
      formatMindroomMessageTextBodyAsHtml(
        [
          'Before [[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"mindroom-paste-a3f19c.txt"}]] after',
          '',
          '🔧 `run_shell_command` [1]',
        ].join('\n')
      )
    ).toBe(
      [
        '<p>Before ',
        '<span data-mindroom-paste-marker="true" data-mindroom-paste-id="paste-a3f19c" data-mindroom-paste-chars="11" data-mindroom-paste-file="mindroom-paste-a3f19c.txt">',
        '[[mindroom-paste:{&quot;v&quot;:1,&quot;id&quot;:&quot;paste-a3f19c&quot;,&quot;chars&quot;:11,&quot;file&quot;:&quot;mindroom-paste-a3f19c.txt&quot;}]]',
        '</span>',
        ' after</p>',
        '<p>🔧 <code>run_shell_command</code> [1]</p>',
      ].join('')
    );
  });

  it('returns undefined without special MindRoom markers', () => {
    expect(formatMindroomMessageTextBodyAsHtml('plain response')).toBeUndefined();
  });
});

describe('formatMindroomMarkdownTextBodyAsHtml', () => {
  it('renders safe Markdown and tool references from a long-text preview body', () => {
    expect(
      formatMindroomMarkdownTextBodyAsHtml(
        ['# Preview <unsafe>', '', 'Ready **now**.', '', '🔧 `run_shell_command` [1]'].join('\n')
      )
    ).toBe(
      [
        '<h1 data-md="#">Preview &lt;unsafe&gt;</h1>',
        '<br/>Ready <strong data-md="**">now</strong>.<br/>',
        '<p>🔧 <code>run_shell_command</code> [1]</p>',
      ].join('')
    );
  });

  it('keeps tool markers inside fenced code as code', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      [
        '```',
        '🔧 `run_shell_command` [1]',
        '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"mindroom-paste-a3f19c.txt"}]]',
        '```',
        '',
        '🔧 `outside_tool` [2]',
      ].join('\n')
    );

    expect(formattedBody).toContain('<pre data-md="```"><code>🔧 `run_shell_command` [1]\n');
    expect(formattedBody).toContain('[[mindroom-paste:{&quot;v&quot;:1');
    expect(formattedBody).not.toContain('data-mindroom-paste-marker');
    expect(formattedBody).toContain('<p>🔧 <code>outside_tool</code> [2]</p>');
  });

  it('preserves blockquote Markdown while escaping its content', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml('> Safe <unsafe> and **quoted**');

    expect(formattedBody).toContain('<blockquote data-md=">">');
    expect(formattedBody).toContain('&lt;unsafe&gt;');
    expect(formattedBody).toContain('<strong data-md="**">quoted</strong>');
    expect(formattedBody).not.toContain('<unsafe>');
  });

  it('renders Markdown surrounding an inline paste marker', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      [
        'Before **bold** ',
        '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"mindroom-paste-a3f19c.txt"}]]',
        ' after *italic*',
      ].join('')
    );

    expect(formattedBody).toContain('<strong data-md="**">bold</strong>');
    expect(formattedBody).toContain('data-mindroom-paste-marker="true"');
    expect(formattedBody).toContain('<i data-md="*">italic</i>');
    expect(formattedBody).not.toContain('**bold**');
  });
});
