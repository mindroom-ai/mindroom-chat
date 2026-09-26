import { describe, expect, it } from 'vitest';
import { getRenderedMindroomToolRefs } from './toolRefDom';

const indexesOf = (html: string) =>
  getRenderedMindroomToolRefs(html).toolBlocks.map(({ index, toolName }) => [index, toolName]);

// Parity with the full renderer lives in react-custom-html-parser.test.ts,
// which renders the backend fixtures with the app's real base parser.
describe('getRenderedMindroomToolRefs', () => {
  it('reads leading markers of top-level paragraphs, divs, and list items', () => {
    expect(
      indexesOf(
        '<p>🔧 <code>a</code> [1]</p><div>🔧 <code>b</code> [2] ⏳</div><li>🔧 <code>c</code> [3]</li>'
      )
    ).toEqual([
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ]);
  });

  it('follows markers in the content the renderer re-wraps after a marker', () => {
    expect(indexesOf('<p>🔧 <code>a</code> [1]<br>\n🔧 <code>b</code> [2]<br>tail</p>')).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
  });

  it('ignores markers in code, mid-paragraph, nested containers, or loose text', () => {
    expect(
      indexesOf(
        [
          '<pre><code>🔧 `a` [1]</code></pre>',
          '<p>text<br>🔧 <code>b</code> [2]</p>',
          '<ul><li>🔧 <code>c</code> [3]</li></ul>',
          '<blockquote><p>🔧 <code>d</code> [4]</p></blockquote>',
          '🔧 <code>e</code> [5]',
        ].join('')
      )
    ).toEqual([]);
  });

  it('counts every rendered 🔧 and those inside tool-block markers', () => {
    expect(
      getRenderedMindroomToolRefs(
        '<p>🔧 <code>x</code> [1]</p><pre><code>🔧 `x` [1]</code></pre><p>🔧 <code>🔧</code> [2]</p>'
      )
    ).toMatchObject({ iconCount: 4, toolBlockIconCount: 3 });
  });
});
