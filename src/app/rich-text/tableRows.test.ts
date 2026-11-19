import { describe, expect, it } from 'vitest';
import { htmlToDOM } from 'html-react-parser';
import { isTag, isText } from 'domhandler';
import type { ChildNode } from 'domhandler';
import { simpleTableRows } from './tableRows';

const rowsOf = (html: string) => {
  const [table] = htmlToDOM(html);
  const cells = table && isTag(table) ? simpleTableRows(table.children) : undefined;
  const text = (nodes: ChildNode[]): string =>
    nodes
      .map((node) => (isText(node) ? node.data : isTag(node) ? text(node.children) : ''))
      .join('');
  return (
    cells && {
      caption: cells.caption && text(cells.caption),
      headers: cells.headers.map(text),
      rows: cells.rows.map((row) => row.map(text)),
    }
  );
};

describe('simpleTableRows', () => {
  it('reads one header row and its body rows, links kept as nodes', () => {
    expect(
      rowsOf(
        '<table><caption>Plan</caption><thead><tr><th>Month</th><th>Revenue</th></tr></thead>' +
          '<tbody><tr><td>M1</td><td><a href="https://example.com">$610k</a></td></tr>\n' +
          '<tr><td>M2</td></tr></tbody></table>'
      )
    ).toEqual({ caption: 'Plan', headers: ['Month', 'Revenue'], rows: [['M1', '$610k'], ['M2']] });
  });

  it('reads a table without sections whose first row is all headers', () => {
    expect(
      rowsOf('<table><tr><th>A</th><th>B</th></tr><tr><th>x</th><td>1</td></tr></table>')
    ).toEqual({ caption: undefined, headers: ['A', 'B'], rows: [['x', '1']] });
  });

  it.each([
    ['a span', '<table><tr><th>A</th><th>B</th></tr><tr><td colspan="2">x</td></tr></table>'],
    ['a row span', '<table><tr><th>A</th><th rowspan="2">B</th></tr><tr><td>x</td></tr></table>'],
    [
      'a second header row',
      '<table><tr><th>A</th><th>B</th></tr><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>',
    ],
    ['no header row', '<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>'],
    ['a single column', '<table><tr><th>A</th></tr><tr><td>1</td></tr></table>'],
    ['no body rows', '<table><tr><th>A</th><th>B</th></tr></table>'],
    [
      'a row wider than its header',
      '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td><td>3</td></tr></table>',
    ],
  ])('keeps a table with %s as a table', (_, html) => {
    expect(rowsOf(html)).toBeUndefined();
  });
});
