import { describe, expect, it } from 'vitest';
import {
  getThreadMessagePreviewText,
  stripPreviewMarkdown,
  VOICE_MESSAGE_PREVIEW_TEXT,
} from './threadMessagePreview';

const textContent = (body: string): Record<string, unknown> => ({
  msgtype: 'm.text',
  body,
});

describe('stripPreviewMarkdown', () => {
  it('strips inline emphasis, code, and strikethrough markers', () => {
    expect(stripPreviewMarkdown('**bold** and *italic* and ~~gone~~ and `code`')).toBe(
      'bold and italic and gone and code'
    );
  });

  it('strips link and image syntax down to their labels', () => {
    expect(stripPreviewMarkdown('see [the docs](https://example.com) and ![diagram](mxc://x)')).toBe(
      'see the docs and diagram'
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
});

describe('getThreadMessagePreviewText', () => {
  it('returns plain prose unchanged', () => {
    expect(getThreadMessagePreviewText(textContent('hello there'))).toBe('hello there');
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
        textContent('🔨 `get_skill_instructions` [1]\n🔨 `get_skill_instructions` [2]\n🔨 `get_skill_reference` [3]')
      )
    ).toBe('🔧 3 tools');
  });

  it('uses singular wording for a single tool call', () => {
    expect(getThreadMessagePreviewText(textContent('🔨 `run_shell_command` [1]'))).toBe(
      '🔧 1 tool'
    );
  });

  it('prefixes the tool badge to remaining prose', () => {
    expect(
      getThreadMessagePreviewText(
        textContent('🔨 `delegate_task` [1]\n🔨 `delegate_task` [2]\nAll subtasks finished.')
      )
    ).toBe('🔧 2 tools · All subtasks finished.');
  });

  it('cleans up orphan separators left between removed tool markers', () => {
    expect(
      getThreadMessagePreviewText(textContent('🔨 `a` [1], 🔨 `b` [2], then **done**'))
    ).toBe('🔧 2 tools · then done');
  });

  it('counts markers without a trace index and at the end of prose', () => {
    expect(getThreadMessagePreviewText(textContent('🔨 `tool_name`'))).toBe('🔧 1 tool');
    expect(getThreadMessagePreviewText(textContent('Done. 🔨 `a` [1]'))).toBe(
      '🔧 1 tool · Done.'
    );
  });

  it('collapses an emoji-only remainder to just the tool badge', () => {
    expect(getThreadMessagePreviewText(textContent('🔨 `a` [1] 🎉'))).toBe('🔧 1 tool');
  });

  it('passes streaming placeholders through unbadged so edit-backfill checks still fire', () => {
    expect(getThreadMessagePreviewText(textContent('🔨 `a` [1]\nThinking...'))).toBe(
      'Thinking...'
    );
  });

  it('does not treat a bare hammer emoji in prose as a tool call', () => {
    expect(getThreadMessagePreviewText(textContent('we need a 🔨 for this'))).toBe(
      'we need a 🔨 for this'
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
});
