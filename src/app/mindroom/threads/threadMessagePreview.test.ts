import { describe, expect, it } from 'vitest';
import {
  getThreadMessagePreviewText,
  getThreadPreviewLocalization,
  stripPreviewMarkdown,
  VOICE_MESSAGE_PREVIEW_TEXT,
} from './threadMessagePreview';

const textContent = (body: string): Record<string, unknown> => ({
  msgtype: 'm.text',
  body,
});

describe('stripPreviewMarkdown', () => {
  it('preserves fence-like lines that are code content rather than closing boundaries', () => {
    expect(stripPreviewMarkdown('```text\n```literal text\nvalue\n```\nAfter')).toContain(
      '```literal text'
    );
  });
  it('strips inline emphasis, code, and strikethrough markers', () => {
    expect(stripPreviewMarkdown('**bold** and *italic* and ~~gone~~ and `code`')).toBe(
      'bold and italic and gone and code'
    );
  });

  it('strips link and image syntax down to their labels', () => {
    expect(
      stripPreviewMarkdown('see [the docs](https://example.com) and ![diagram](mxc://x)')
    ).toBe('see the docs and diagram');
  });

  it('strips links whose destinations contain balanced parentheses', () => {
    expect(stripPreviewMarkdown('read [docs](https://example.com/a(b)c) now')).toBe(
      'read docs now'
    );
    expect(stripPreviewMarkdown('see ![chart](https://en.wikipedia.org/wiki/Foo_(bar)) here')).toBe(
      'see chart here'
    );
  });

  it('strips heading, blockquote, and list markers at line starts', () => {
    expect(stripPreviewMarkdown('## Title\n> quoted\n- item one\n2. item two')).toBe(
      'Title\nquoted\nitem one\nitem two'
    );
  });

  it('drops code fence lines but keeps fenced content', () => {
    expect(stripPreviewMarkdown('```ts\nconst x = 1;\n```')).toContain('const x = 1;');
    expect(stripPreviewMarkdown('```ts\nconst x = 1;\n```')).not.toContain('```');
  });

  it('leaves underscore identifiers untouched', () => {
    expect(stripPreviewMarkdown('call __init__ on snake_case_name')).toBe(
      'call __init__ on snake_case_name'
    );
  });

  it('does not treat multiplication or bullet asterisks as emphasis', () => {
    expect(stripPreviewMarkdown('2 * 3 * 4')).toBe('2 * 3 * 4');
    expect(stripPreviewMarkdown('* bullet item')).toBe('bullet item');
  });

  it('does not pair ** exponentiation operators as bold', () => {
    expect(stripPreviewMarkdown('x**2 + y**2')).toBe('x**2 + y**2');
    expect(stripPreviewMarkdown('compute `x**2 + y**2` now')).toBe('compute x**2 + y**2 now');
  });

  it('does not pair glob asterisks across spaces as emphasis', () => {
    expect(stripPreviewMarkdown('delete *.log and *.tmp files')).toBe(
      'delete *.log and *.tmp files'
    );
    expect(stripPreviewMarkdown('run `ls *.txt` and `rm *.old` now')).toBe(
      'run ls *.txt and rm *.old now'
    );
  });

  it('does not strip four-digit numbers as ordered list markers', () => {
    expect(stripPreviewMarkdown('2026. A good year')).toBe('2026. A good year');
  });

  it('reads a table as its cells, without pipes or the delimiter row', () => {
    const table = '| Rule | Vantrell | Kessler |\n|---|:---:|---|\n| Hotels | $250 | €180 |';
    expect(stripPreviewMarkdown(`Three rules differ:\n\n${table}\n\nWhich one wins?`)).toBe(
      'Three rules differ:\n\nRule · Vantrell · Kessler\n \n· Hotels · $250 · €180\n\nWhich one wins?'
    );
  });

  it('leaves pipes in prose and fenced tables alone', () => {
    expect(stripPreviewMarkdown('pick a | b')).toBe('pick a | b');
    expect(stripPreviewMarkdown('```\n| a | b |\n```')).toContain('| a | b |');
  });
});

describe('getThreadMessagePreviewText', () => {
  it('previews an agent reply with a table as its cells', () => {
    const body =
      '🔧 `google_drive_search_files` [1]\n\nThree rules differ:\n\n' +
      '| Rule | Vantrell | Kessler |\n|---|---|---|\n| Hotels | $250 | €180 |\n| Meals | $75 | €60 |';
    expect(getThreadMessagePreviewText(textContent(body))).toBe(
      '🔧 1 tool · Three rules differ: Rule · Vantrell · Kessler · Hotels · $250 · €180 · Meals · $75 · €60'
    );
  });

  it('localizes only actual tool calls when code examples are present', () => {
    const content = textContent('```\n🔧 `example` [1]\n```\n\n🔧 `read_file` [2]');
    expect(getThreadPreviewLocalization(content, getThreadMessagePreviewText(content))).toEqual({
      kind: 'tools',
      count: 1,
      prose: '🔧 example [1]',
    });
  });
  it.each([
    ['``` literal text\n🔧 `read_file` [1]\n```', '🔧 1 tool · ``` literal text'],
    ['```\n````\n🔧 `example` [1]\n```\n\n🔧 `read_file` [2]', '🔧 1 tool · ```` 🔧 example [1]'],
    ['```foo`bar\n🔧 `example` [1]\n```\n\n🔧 `read_file` [2]', '🔧 1 tool · 🔧 example [1]'],
    ['```\n🔧 `example` [1]\n```', '🔧 example [1]'],
    ['~~~text\n🔧 `example` [1]\n~~~', '🔧 example [1]'],
    ['    🔧 `example` [1]', '🔧 example [1]'],
    ['> ```\n> 🔧 `example` [1]\n> ```', '🔧 example [1]'],
    ['- ```\n  🔧 `example` [1]\n  ```', '🔧 example [1]'],
    ['```\n🔧 `example` [1]\n```\n\n🔧 `read_file` [2]', '🔧 1 tool · 🔧 example [1]'],
  ])('preserves literal tool examples in %s', (body, preview) => {
    expect(getThreadMessagePreviewText(textContent(body))).toBe(preview);
  });
  it('returns plain prose unchanged', () => {
    expect(getThreadMessagePreviewText(textContent('hello there'))).toBe('hello there');
  });

  // Each formatted_body is MindRoom's markdown_to_html output for its body.
  const htmlContent = (body: string, formattedBody: string): Record<string, unknown> => ({
    ...textContent(body),
    format: 'org.matrix.custom.html',
    formatted_body: formattedBody,
  });
  const thermalLens = htmlContent(
    'Using the standard thermal-lens estimate for a uniformly pumped rod:\n\n$$f \\approx \\frac{\\pi K w^2}{P_h \\, (dn/dT)}$$\n\nWith $P_h = 0.3 \\times 40\\,\\text{W} = 12\\,\\text{W}$, $K = 14\\,\\text{W/m·K}$, $dn/dT = 7.3\\times10^{-6}\\,\\text{K}^{-1}$ and a 1.5 mm pump radius:\n\n$$f \\approx 1.1\\,\\text{m}$$\n\nThat ignores end effects and stress birefringence, which typically shorten it by 10–20%.',
    '<p>Using the standard thermal-lens estimate for a uniformly pumped rod:</p>\n<div>$$\nf \\approx \\frac{\\pi K w^2}{P_h \\, (dn/dT)}\n$$</div>\n<p>With $P_h = 0.3 \\times 40\\,\\text{W} = 12\\,\\text{W}$, $K = 14\\,\\text{W/m·K}$, $dn/dT = 7.3\\times10^{-6}\\,\\text{K}^{-1}$ and a 1.5 mm pump radius:</p>\n<div>$$\nf \\approx 1.1\\,\\text{m}\n$$</div>\n<p>That ignores end effects and stress birefringence, which typically shorten it by 10–20%.</p>\n'
  );
  const strayLight = htmlContent(
    'Not at 0.1%. With a stray-light fraction $s$, the detector sees $T + s$ out of $1 + s$, so',
    '<p>Not at 0.1%. With a stray-light fraction $s$, the detector sees $T + s$ out of $1 + s$, so</p>\n'
  );

  it('previews each rendered formula as an ellipsis', () => {
    expect(getThreadMessagePreviewText(thermalLens)).toBe(
      'Using the standard thermal-lens estimate for a uniformly pumped rod: … With …, …, … and a 1.5 mm pump radius: … That ignores end effects and stress birefringence, which typically shorten it by 10–20%.'
    );
    expect(getThreadMessagePreviewText(strayLight)).toBe(
      'Not at 0.1%. With a stray-light fraction …, the detector sees … out of …, so'
    );
    // Chat sends math as data-mx-maths elements.
    expect(
      getThreadMessagePreviewText(
        htmlContent('Area $\\pi r^2$', 'Area <span data-mx-maths="\\pi r^2">\\pi r^2</span>')
      )
    ).toBe('Area …');
  });

  it.each([
    [
      'a code span',
      'Type `$x$` to get $x$.',
      '<p>Type <code>$x$</code> to get $x$.</p>\n',
      'Type $x$ to get ….',
    ],
    [
      'a ``` fence',
      '```\n$x$\n```\nthen $x$',
      '<pre><code>$x$\n</code></pre>\n<p>then $x$</p>\n',
      '$x$ then …',
    ],
    [
      'a ~~~ fence',
      '~~~\n$x$\n~~~\nthen $x$',
      '<pre><code>$x$\n</code></pre>\n<p>then $x$</p>\n',
      '$x$ then …',
    ],
    [
      'an indented code block',
      'Example:\n\n    echo $x$\n\nDone $x$',
      '<p>Example:</p>\n<pre><code>echo $x$\n</code></pre>\n<p>Done $x$</p>\n',
      'Example: echo $x$ Done …',
    ],
    [
      'an indented code block in a quote',
      '> Quote:\n>\n>     echo $x$\n\nDone $x$',
      '<blockquote>\n<p>Quote:</p>\n<pre><code>echo $x$\n</code></pre>\n</blockquote>\n<p>Done $x$</p>\n',
      'Quote: echo $x$ Done …',
    ],
    [
      'inline link text',
      'See [$x$](https://example.com) and $x$',
      '<p>See <a href="https://example.com">$x$</a> and $x$</p>\n',
      'See $x$ and …',
    ],
    [
      'reference link text',
      'See [$x$][ref] and $x$\n\n[ref]: https://example.com',
      '<p>See <a href="https://example.com">$x$</a> and $x$</p>\n',
      'See [$x$][ref] and … [ref]: https://example.com',
    ],
    [
      'code next to letters',
      'Type `a$x$` or `$x$b` then $x$',
      '<p>Type <code>a$x$</code> or <code>$x$b</code> then $x$</p>\n',
      'Type a$x$ or $x$b then …',
    ],
    [
      'a highlighted ```latex fence',
      '```latex\n$E = mc^2$\n```\nSo $E = mc^2$ holds.',
      '<pre><code class="language-latex"><span style="color: #BA2121">$</span><span style="color: #008000">E </span><span style="color: #666">=</span><span style="color: #008000"> mc^</span><span style="color: #666">2</span><span style="color: #BA2121">$</span>\n</code></pre>\n<p>So $E = mc^2$ holds.</p>\n',
      '$E = mc^2$ So … holds.',
    ],
    [
      'spaced dollars',
      'Pay $ x $ now, then $x$',
      '<p>Pay $ x $ now, then $x$</p>\n',
      'Pay $ x $ now, then …',
    ],
    [
      'a space before the closing dollar',
      'Use $n $ then $n$',
      '<p>Use $n $ then $n$</p>\n',
      'Use $n $ then …',
    ],
    [
      'mid-line $$',
      'Not $$x$$ inline, but $x$',
      '<p>Not $$x$$ inline, but $x$</p>\n',
      'Not $$x$$ inline, but …',
    ],
  ])(
    'keeps the formula in %s literal, as the message does',
    (_name, body, formattedBody, preview) => {
      expect(getThreadMessagePreviewText(htmlContent(body, formattedBody))).toBe(preview);
    }
  );

  it('skips math in the reply fallback, which the message hides', () => {
    const content = htmlContent(
      '> <@alice:example.org> Is $y$ right?\n\nYes, $x$ is.',
      '<mx-reply><blockquote><a href="https://matrix.to/#/!room:example.org/$event">In reply to</a> <a href="https://matrix.to/#/@alice:example.org">@alice:example.org</a><br>Is $y$ right?</blockquote></mx-reply>Yes, $x$ is.'
    );
    expect(getThreadMessagePreviewText(content)).toBe('Yes, … is.');
  });

  it('keeps prices literal', () => {
    expect(
      getThreadMessagePreviewText(
        htmlContent(
          'Rooms cost $5-$10 a night, meals $75',
          '<p>Rooms cost $5-$10 a night, meals $75</p>\n'
        )
      )
    ).toBe('Rooms cost $5-$10 a night, meals $75');
  });

  it('keeps a finished message from reading as a streaming placeholder', () => {
    const body = 'Thinking about $x$ gives the answer.';
    expect(getThreadMessagePreviewText(htmlContent(body, `<p>${body}</p>\n`))).toBe(body);
  });

  it('previews from the body alone past 16 KB of formatted_body', () => {
    const html = `<p>Fit $x$</p>\n<pre><code>${'a'.repeat(17_000)}</code></pre>\n`;
    expect(getThreadMessagePreviewText(htmlContent('Fit $x$', html))).toBe('Fit $x$');
  });

  it('stays fast on formulas that could backtrack', () => {
    const start = performance.now();
    const spaces = ' '.repeat(60_000);
    const empty = '<span data-mx-maths=""></span>';
    expect(getThreadMessagePreviewText(htmlContent(`$${spaces}x`, empty))).toBe('$');
    expect(getThreadMessagePreviewText(htmlContent(`$x$${spaces}x`, `<p>$x$</p>${empty}`))).toBe(
      '…'
    );
    const lines = `$$${' '.repeat(40)}\n`.repeat(40);
    expect(
      getThreadMessagePreviewText(htmlContent(`$x$\n${lines}`, '<p>$x$</p><div>$$\nb\n$$</div>'))
    ).toBe(`… ${'$$ '.repeat(40).trim()}`);
    expect(performance.now() - start).toBeLessThan(500);
  });

  it('previews a body without formatted_body as before, even after the same body with it', () => {
    getThreadMessagePreviewText(strayLight);
    expect(getThreadMessagePreviewText(textContent(strayLight.body as string))).toBe(
      'Not at 0.1%. With a stray-light fraction $s$, the detector sees $T + s$ out of $1 + s$, so'
    );
  });

  it('strips markdown from the body preview', () => {
    expect(
      getThreadMessagePreviewText(textContent('**Nightly run for 2026-07-02** ✅ — 3 meetings'))
    ).toBe('Nightly run for 2026-07-02 ✅ — 3 meetings');
  });

  it('collapses whitespace across lines', () => {
    expect(getThreadMessagePreviewText(textContent('# Report\n\nAll good'))).toBe(
      'Report All good'
    );
  });

  it('summarizes a tool-call-only body as a tool badge', () => {
    expect(
      getThreadMessagePreviewText(
        textContent(
          '🔧 `get_skill_instructions` [1]\n🔧 `get_skill_instructions` [2]\n🔧 `get_skill_reference` [3]'
        )
      )
    ).toBe('🔧 3 tools');
  });

  it('uses singular wording for a single tool call', () => {
    expect(getThreadMessagePreviewText(textContent('🔧 `run_shell_command` [1]'))).toBe(
      '🔧 1 tool'
    );
  });

  it('prefixes the tool badge to remaining prose', () => {
    expect(
      getThreadMessagePreviewText(
        textContent('🔧 `delegate_task` [1]\n🔧 `delegate_task` [2]\nAll subtasks finished.')
      )
    ).toBe('🔧 2 tools · All subtasks finished.');
  });

  it('cleans up orphan separators left at prose edges after marker removal', () => {
    expect(getThreadMessagePreviewText(textContent('Running the build:\n\n🔧 `build` [1]'))).toBe(
      '🔧 1 tool · Running the build'
    );
  });

  it('only collapses whole-line indexed markers, matching timeline rendering', () => {
    // blocks.ts (MINDROOM_TOOL_REF_TEXT_REG) renders only the standalone
    // indexed form as a tool ref; anything else stays prose here too.
    expect(getThreadMessagePreviewText(textContent('🔧 `tool_name`'))).toBe('🔧 tool_name');
    expect(getThreadMessagePreviewText(textContent('Done. 🔧 `a` [1]'))).toBe('Done. 🔧 a [1]');
    expect(
      getThreadMessagePreviewText(textContent('tighten it with a 🔧 `M5 bolt` works well'))
    ).toBe('tighten it with a 🔧 M5 bolt works well');
  });

  it('consumes the pending ⏳ suffix on still-running tool markers', () => {
    expect(getThreadMessagePreviewText(textContent('🔧 `run_shell_command` [1] ⏳'))).toBe(
      '🔧 1 tool'
    );
    expect(
      getThreadMessagePreviewText(textContent('🔧 `a` [1]\n\n🔧 `b` [2] ⏳\n\nPartial output'))
    ).toBe('🔧 2 tools · Partial output');
  });

  it('collapses an emoji-only remainder to just the tool badge', () => {
    expect(getThreadMessagePreviewText(textContent('🔧 `a` [1]\n\n🎉'))).toBe('🔧 1 tool');
  });

  it('handles the real serialization shape: blank-line wrapped markers with separators', () => {
    expect(
      getThreadMessagePreviewText(
        textContent('🔧 `search` [1]\n\n---\n\n🔧 `read_file` [2]\n\n---\n\nHere is the answer.')
      )
    ).toBe('🔧 2 tools · Here is the answer.');
  });

  it('passes streaming placeholders through unbadged so edit-backfill checks still fire', () => {
    expect(getThreadMessagePreviewText(textContent('🔧 `a` [1]\nThinking...'))).toBe('Thinking...');
  });

  it('does not treat a bare wrench emoji in prose as a tool call', () => {
    expect(getThreadMessagePreviewText(textContent('we need a 🔧 for this'))).toBe(
      'we need a 🔧 for this'
    );
  });

  it('keeps emoji-only messages', () => {
    expect(getThreadMessagePreviewText(textContent('🎉'))).toBe('🎉');
  });

  it('prefers m.new_content over the fallback body', () => {
    expect(
      getThreadMessagePreviewText({
        msgtype: 'm.text',
        body: '* old **body**',
        'm.new_content': { msgtype: 'm.text', body: '**new** body' },
      })
    ).toBe('new body');
  });

  it('names a canvas by its title, not the fallback for other clients', () => {
    const canvasNotice = (title: string) => ({
      msgtype: 'm.notice',
      body: `Interactive panel: ${title}. Open it in MindRoom Chat to respond.`,
      'io.mindroom.ui_action': {
        version: 1,
        action: 'show_canvas',
        canvas: { title, html: '<p></p>' },
      },
    });
    expect(getThreadMessagePreviewText(canvasNotice('Pick a time'))).toBe('Pick a time');
    // A title is plain text, not Markdown.
    expect(getThreadMessagePreviewText(canvasNotice('1. Pick a time'))).toBe('1. Pick a time');
    expect(getThreadMessagePreviewText(canvasNotice('---'))).toBe('---');
    // An update in place is previewed by its new title.
    expect(
      getThreadMessagePreviewText({
        ...canvasNotice('Pick a time'),
        body: '* Interactive panel: Plan the days. Open it in MindRoom Chat to respond.',
        'm.new_content': canvasNotice('Plan the days'),
      })
    ).toBe('Plan the days');
  });

  it('trims reply fallback before stripping', () => {
    expect(
      getThreadMessagePreviewText(textContent('> <@user:hs> quoted **text**\n\n**actual** reply'))
    ).toBe('actual reply');
  });

  it('keeps media fallbacks intact', () => {
    expect(getThreadMessagePreviewText({ msgtype: 'm.image', body: '' })).toBe('Image');
    expect(getThreadMessagePreviewText({ msgtype: 'm.file', body: '' })).toBe('File');
  });

  it('keeps the voice message preview', () => {
    expect(
      getThreadMessagePreviewText({
        msgtype: 'm.audio',
        body: 'voice.ogg',
        'org.matrix.msc3245.voice': {},
        'org.matrix.msc1767.audio': {},
      })
    ).toBe(VOICE_MESSAGE_PREVIEW_TEXT);
  });

  it('returns undefined for empty or non-string bodies', () => {
    expect(getThreadMessagePreviewText(textContent('   '))).toBeUndefined();
    expect(getThreadMessagePreviewText({ msgtype: 'm.text', body: 42 })).toBeUndefined();
    expect(getThreadMessagePreviewText(undefined)).toBeUndefined();
  });

  it('bounds giant bodies before markdown stripping', () => {
    const preview = getThreadMessagePreviewText(textContent(`**lead** ${'x'.repeat(50_000)}`));
    expect(preview?.startsWith('lead x')).toBe(true);
    expect(preview!.length).toBeLessThanOrEqual(2000);
  });

  it('stays fast on pathological markdown floods', () => {
    const start = performance.now();
    expect(getThreadMessagePreviewText(textContent('['.repeat(60_000)))).toBeDefined();
    expect(getThreadMessagePreviewText(textContent(' **a'.repeat(15_000)))).toBeDefined();
    expect(performance.now() - start).toBeLessThan(500);
  });
});
