import { describe, expect, it } from 'vitest';
import { sanitizeMindroomMessageExtraHtml } from './messageExtrasHtml';

describe('sanitizeMindroomMessageExtraHtml', () => {
  it('keeps ordinary structured HTML and safe links', () => {
    const sanitized = sanitizeMindroomMessageExtraHtml(`
      <h2>Evidence</h2>
      <p><strong>Result</strong> <em>ok</em> <code class="language-ts">value</code></p>
      <div><blockquote>quoted</blockquote><hr><br></div>
      <ol start="2" type="A"><li>first</li></ol>
      <ul><li><span>second</span></li></ul>
      <table><caption>Rows</caption><thead><tr><th>Name</th></tr></thead><tbody><tr><td>ok</td></tr></tbody></table>
      <pre class="language-js"><code>const value = 1;</code></pre>
      <a href="https://example.test/path?q=1" target="_self" rel="opener">link</a>
      <a href="mailto:user@example.test">mail</a>
    `);

    expect(sanitized).toContain('<h2>Evidence</h2>');
    expect(sanitized).toContain('<strong>Result</strong>');
    expect(sanitized).toContain('<code class="language-ts">value</code>');
    expect(sanitized).toContain('<blockquote>quoted</blockquote>');
    expect(sanitized).toContain('<ol start="2" type="A">');
    expect(sanitized).toContain('<table>');
    expect(sanitized).toContain('<pre class="language-js">');
    expect(sanitized).toContain(
      '<a href="https://example.test/path?q=1" target="_blank" rel="noreferrer noopener">link</a>'
    );
    expect(sanitized).toContain(
      '<a href="mailto:user@example.test" target="_blank" rel="noreferrer noopener">mail</a>'
    );
  });

  it('removes executable, embed, form, media, metadata, reply, and image surfaces', () => {
    const sanitized = sanitizeMindroomMessageExtraHtml(`
      <script>window.__mindroomExtrasXss = true</script>
      <style>body { color: red }</style>
      <iframe src="https://example.test"></iframe>
      <object data="https://example.test"></object>
      <embed src="https://example.test">
      <form><input value="x"><button>submit</button><select><option>one</option></select><textarea>text</textarea></form>
      <svg><circle></circle></svg>
      <math><mi>x</mi></math>
      <canvas>draw</canvas>
      <audio src="x"></audio><video src="x"><source src="x"><track src="x"></video>
      <meta charset="utf-8"><link rel="stylesheet" href="x"><base href="https://example.test">
      <noscript>fallback</noscript><mx-reply>reply</mx-reply><img src="https://example.test/x.png" alt="x">
      <p>safe</p>
    `);

    expect(sanitized).toContain('<p>safe</p>');
    for (const forbidden of [
      'script',
      'style',
      'iframe',
      'object',
      'embed',
      'form',
      'input',
      'button',
      'select',
      'textarea',
      'option',
      'svg',
      'math',
      'canvas',
      'audio',
      'video',
      'source',
      'track',
      'meta',
      'link',
      'base',
      'noscript',
      'mx-reply',
      'img',
      '__mindroomExtrasXss',
    ]) {
      expect(sanitized).not.toContain(forbidden);
    }
  });

  it('strips event handlers, style attributes, data attributes, and unsafe code classes', () => {
    const sanitized = sanitizeMindroomMessageExtraHtml(`
      <p onclick="alert(1)" style="color:red" data-id="x">paragraph</p>
      <code class="language-ts unsafe" onload="alert(1)">code</code>
      <pre class="language-js other">pre</pre>
    `);

    expect(sanitized).toContain('<p>paragraph</p>');
    expect(sanitized).toContain('<code class="language-ts">code</code>');
    expect(sanitized).toContain('<pre class="language-js">pre</pre>');
    expect(sanitized).not.toContain('onclick');
    expect(sanitized).not.toContain('onload');
    expect(sanitized).not.toContain('style=');
    expect(sanitized).not.toContain('data-id');
    expect(sanitized).not.toContain('unsafe');
  });

  it('rejects unsafe, protocol-relative, relative, and malformed href values', () => {
    const scriptHref = `${'java'}script:alert(1)`;
    const sanitized = sanitizeMindroomMessageExtraHtml(`
      <a href="${scriptHref}">javascript</a>
      <a href="data:text/html,evil">data</a>
      <a href="vbscript:msgbox(1)">vbscript</a>
      <a href="file:///etc/passwd">file</a>
      <a href="blob:https://example.test/id">blob</a>
      <a href="//example.test/path">protocol-relative</a>
      <a href="/relative/path">relative</a>
      <a href="https://exa mple.test">malformed</a>
      <a href="http://example.test/safe">safe</a>
    `);

    expect(sanitized).toContain(
      '<a href="http://example.test/safe" target="_blank" rel="noreferrer noopener">safe</a>'
    );
    expect(sanitized).toContain('<a>javascript</a>');
    expect(sanitized).toContain('<a>protocol-relative</a>');
    expect(sanitized).not.toContain(scriptHref);
    expect(sanitized).not.toContain('data:');
    expect(sanitized).not.toContain('vbscript:');
    expect(sanitized).not.toContain('file:');
    expect(sanitized).not.toContain('blob:');
    expect(sanitized).not.toContain('href="//example.test');
    expect(sanitized).not.toContain('href="/relative/path');
    expect(sanitized).not.toContain('https://exa mple.test');
  });

  it('removes nested details, summary, and MindRoom semantic tags', () => {
    const sanitized = sanitizeMindroomMessageExtraHtml(`
      <details open><summary>sender summary</summary><p>sender details</p></details>
      <think>hidden thought</think>
      <debug>debug data</debug>
      <system>system prompt</system>
      <plan>plan text</plan>
      <analysis>analysis text</analysis>
      <research>research text</research>
      <p>visible</p>
    `);

    expect(sanitized).toContain('<p>visible</p>');
    for (const forbidden of [
      'details',
      'summary',
      'sender summary',
      'sender details',
      'think',
      'hidden thought',
      'debug',
      'system',
      'plan text',
      'analysis',
      'research',
    ]) {
      expect(sanitized).not.toContain(forbidden);
    }
  });

  it('handles malformed and deeply nested HTML without throwing', () => {
    const deepHtml = `${'<div>'.repeat(150)}deep${'</div>'.repeat(150)}`;

    expect(() => sanitizeMindroomMessageExtraHtml('<p><strong>broken')).not.toThrow();
    expect(() => sanitizeMindroomMessageExtraHtml(deepHtml)).not.toThrow();
    expect(sanitizeMindroomMessageExtraHtml('<p><strong>broken')).toContain(
      '<p><strong>broken</strong></p>'
    );
  });
});
