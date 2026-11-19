import { isTag } from 'domhandler';
import type { ChildNode, Element } from 'domhandler';

/** A table's caption, header labels and body rows, each cell as T. */
export type TableRows<T> = { caption?: T; headers: T[]; rows: T[][] };

const SECTIONS = ['thead', 'tbody', 'tfoot'];
const spans = (cell: Element): boolean =>
  Number(cell.attribs.colspan ?? 1) > 1 || Number(cell.attribs.rowspan ?? 1) > 1;

/**
 * The cells of a table that reads row by row: one header row of at least two `th` cells, then body
 * rows of no more cells than that and no spans. Any other shape (spans, a second header row) gives
 * undefined, so it stays a table. A row still streaming in may be short.
 */
export const simpleTableRows = (table: ChildNode[]): TableRows<ChildNode[]> | undefined => {
  let caption: ChildNode[] | undefined;
  const rows: Element[] = [];
  for (const node of table.filter(isTag)) {
    if (node.name === 'caption') caption = node.children;
    else if (node.name === 'tr') rows.push(node);
    else if (SECTIONS.includes(node.name)) rows.push(...node.children.filter(isTag));
    else if (node.name !== 'colgroup') return undefined;
  }
  if (rows.some((row) => row.name !== 'tr')) return undefined;
  const [head, ...body] = rows.map((row) => row.children.filter(isTag)).filter((row) => row.length);
  if (!head || head.length < 2 || body.length === 0) return undefined;
  if (head.some((cell) => cell.name !== 'th')) return undefined;
  const cells = [...head, ...body.flat()];
  if (cells.some((cell) => (cell.name !== 'th' && cell.name !== 'td') || spans(cell))) {
    return undefined;
  }
  if (body.some((row) => row.length > head.length || row.every((cell) => cell.name === 'th'))) {
    return undefined;
  }
  return {
    caption,
    headers: head.map((cell) => cell.children),
    rows: body.map((row) => row.map((cell) => cell.children)),
  };
};
