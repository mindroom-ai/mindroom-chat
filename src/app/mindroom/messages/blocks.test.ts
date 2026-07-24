import { describe, expect, it } from 'vitest';
import {
  MINDROOM_TOOL_REF_HTML_REG_G,
  formatMindroomMarkdownTextBodyAsHtml,
  formatMindroomMessageTextBodyAsHtml,
  formatMindroomToolRefTextBodyAsHtml,
  parseMindroomToolRefHtml,
  parseMindroomToolRefText,
} from './blocks';

const PASTE_MARKER =
  '[[mindroom-paste:{"v":1,"id":"paste-a3f19c","chars":11,"file":"mindroom-paste-a3f19c.txt"}]]';

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

    expect(formattedBody).toContain('<pre data-md="````"><code>🔧 `run_shell_command` [1]\n');
    expect(formattedBody).toContain('[[mindroom-paste:{&quot;v&quot;:1');
    expect(formattedBody).not.toContain('data-mindroom-paste-marker');
    expect(formattedBody).toContain('<p>🔧 <code>outside_tool</code> [2]</p>');
  });

  it('keeps markers inside CommonMark tilde and unclosed fences as code', () => {
    const tildeFence = formatMindroomMarkdownTextBodyAsHtml(
      [
        '  ~~~~ typescript example.ts',
        '🔧 `inside_tilde` [1]',
        '   ~~~~~',
        '🔧 `outside_tool` [2]',
      ].join('\n')
    );
    const unclosedFence = formatMindroomMarkdownTextBodyAsHtml(
      ['```text', '🔧 `inside_unclosed` [3]'].join('\n')
    );

    expect(tildeFence).toContain(
      '<pre data-md="```"><code class="language-typescript">🔧 `inside_tilde` [1]\n'
    );
    expect(tildeFence).toContain('<p>🔧 <code>outside_tool</code> [2]</p>');
    expect(unclosedFence).toContain(
      '<pre data-md="````"><code class="language-text">🔧 `inside_unclosed` [3]\n'
    );
    expect(unclosedFence).not.toContain('<p>🔧 <code>inside_unclosed</code>');
  });

  it('does not turn blank lines between tool references into grouping boundaries', () => {
    expect(
      formatMindroomMarkdownTextBodyAsHtml(
        [
          '🔧 `run_shell_command` [1]',
          '',
          '',
          '🔧 `run_shell_command` [2]',
          '',
          '',
          '🔧 `run_shell_command` [3]',
        ].join('\n')
      )
    ).toBe(
      [
        '<p>🔧 <code>run_shell_command</code> [1]</p>',
        '<p>🔧 <code>run_shell_command</code> [2]</p>',
        '<p>🔧 <code>run_shell_command</code> [3]</p>',
      ].join('')
    );
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

  it('keeps paste markers inside inline code literal', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(`\`${PASTE_MARKER}\``);

    expect(formattedBody).toContain('<code data-md="`">[[mindroom-paste:');
    expect(formattedBody).not.toContain('data-mindroom-paste-marker');
  });

  it('keeps paste markers inside variable-length and multiline code spans literal', () => {
    const variableLength = formatMindroomMarkdownTextBodyAsHtml(
      `\`\`before \` ${PASTE_MARKER} after\`\``
    );
    const multiline = formatMindroomMarkdownTextBodyAsHtml(
      `\`\`before\n${PASTE_MARKER}\nafter\`\``
    );

    expect(variableLength).toContain('[[mindroom-paste:');
    expect(variableLength).not.toContain('data-mindroom-paste-marker');
    expect(variableLength).not.toContain('\uE000MINDROOMPASTE');
    expect(multiline).toContain('[[mindroom-paste:');
    expect(multiline).not.toContain('data-mindroom-paste-marker');
    expect(multiline).not.toContain('\uE000MINDROOMPASTE');
  });

  it('keeps paste markers inside math and link destinations literal', () => {
    const inlineMath = formatMindroomMarkdownTextBodyAsHtml(`$${PASTE_MARKER}$`);
    const displayMath = formatMindroomMarkdownTextBodyAsHtml(`$$\n${PASTE_MARKER}\n$$`);
    const linkDestination = formatMindroomMarkdownTextBodyAsHtml(
      `[click](https://example.com/${PASTE_MARKER})`
    );

    [inlineMath, displayMath, linkDestination].forEach((formattedBody) => {
      expect(formattedBody).toContain('[[mindroom-paste:');
      expect(formattedBody).not.toContain('data-mindroom-paste-marker');
      expect(formattedBody).not.toContain('\uE000MINDROOMPASTE');
    });
    expect(linkDestination).toContain('>click</a>');
  });

  it('falls back when markers occur inside unsupported container fences', () => {
    expect(formatMindroomMarkdownTextBodyAsHtml(`> ~~~\n> ${PASTE_MARKER}\n> ~~~`)).toBe('');
    expect(
      formatMindroomMarkdownTextBodyAsHtml(
        ['- ~~~', '  🔧 `run_shell_command` [1]', '  ~~~'].join('\n')
      )
    ).toBe('');
  });

  it('still formats markers after a closed container fence', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      ['> ~~~', '> ordinary code', '> ~~~', '', PASTE_MARKER].join('\n')
    );

    expect(formattedBody).toContain('data-mindroom-paste-marker="true"');
  });

  it('sanitizes math exactly once', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      ['$x < y & z$ holds', '', '$$', 'a < b & c', '$$'].join('\n')
    );

    expect(formattedBody).toContain(
      '<span data-mx-maths="x &lt; y &amp; z">x &lt; y &amp; z</span> holds'
    );
    expect(formattedBody).toContain('<div data-mx-maths="a &lt; b &amp; c">a &lt; b &amp; c</div>');
    expect(formattedBody).not.toContain('&amp;lt;');
    expect(formattedBody).not.toContain('&amp;amp;');
  });

  it('preserves escaped blockquotes and renders dash bullets as unordered lists', () => {
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(
      [
        '\\> one slash',
        '\\\\> two slashes',
        '\\\\\\> three slashes',
        '',
        '- alpha',
        '-  beta',
        '-    gamma',
      ].join('\n')
    );

    expect(formattedBody).toContain('&gt; one slash');
    expect(formattedBody).toContain('&#92;&gt; two slashes');
    expect(formattedBody).toContain('&#92;&gt; three slashes');
    expect(formattedBody).toContain('<ul data-md="*">');
    expect(formattedBody).not.toContain('<ol');
  });

  it('normalizes empty fences and unsafe tilde info strings into code blocks', () => {
    const emptyFence = formatMindroomMarkdownTextBodyAsHtml('```\n```');
    const unclosedEmptyFence = formatMindroomMarkdownTextBodyAsHtml('```');
    const tildeFence = formatMindroomMarkdownTextBodyAsHtml(
      ['~~~ `typescript', 'code line', '~~~'].join('\n')
    );

    expect(emptyFence).toContain('<pre');
    expect(unclosedEmptyFence).toContain('<pre');
    expect(tildeFence).toContain('<pre');
    expect(tildeFence).toContain('code line');
  });

  it('falls back safely for recursion-heavy Markdown previews', () => {
    const body = Array.from({ length: 4_000 }, (_, index) => `# heading ${index}`).join('\n');

    expect(() => formatMindroomMarkdownTextBodyAsHtml(body)).not.toThrow();
    expect(formatMindroomMarkdownTextBodyAsHtml(body)).toBe('');
  });

  it('falls back before parsing recursion-heavy inline Markdown', () => {
    const body = String.raw`\*`.repeat(513);

    expect(formatMindroomMarkdownTextBodyAsHtml(body)).toBe('');
  });

  it('chooses paste placeholders in one pass when the base prefix is hostile', () => {
    const body = `\uE000MINDROOMPASTE${'X'.repeat(2_000)}\n${PASTE_MARKER}`;
    const formattedBody = formatMindroomMarkdownTextBodyAsHtml(body);

    expect(formattedBody).toContain('data-mindroom-paste-marker="true"');
    expect(formattedBody).not.toContain('\uE000MINDROOMPASTEX0\uE001');
  });
});
