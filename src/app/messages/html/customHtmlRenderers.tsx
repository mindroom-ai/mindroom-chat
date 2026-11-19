import React from 'react';
import { attributesToProps, domToReact, HTMLReactParserOptions } from 'html-react-parser';
import { ChildNode } from 'domhandler';
import { renderHtmlBlock } from './HtmlBlocks';
import { renderMatrixMathHtmlElement } from '../../rich-text/matrixMath';
import { ScrollableTable } from '../../rich-text/ScrollableTable';
import { simpleTableRows } from '../../rich-text/tableRows';

export const renderCustomHtmlElement = (
  name: string,
  attribs: Record<string, string>,
  children: ChildNode[],
  opts: HTMLReactParserOptions
): React.ReactElement | undefined => {
  if (name === 'table') {
    const cells = simpleTableRows(children);
    const render = (nodes: ChildNode[]) => domToReact(nodes, opts);
    // The cells render as label: value pairs only while the table is read by row, in its place.
    const readRows =
      cells &&
      (() => ({
        caption: cells.caption && render(cells.caption),
        headers: cells.headers.map(render),
        rows: cells.rows.map((row) => row.map(render)),
      }));
    return (
      <ScrollableTable {...attributesToProps(attribs)} readRows={readRows}>
        {domToReact(children, opts)}
      </ScrollableTable>
    );
  }

  return (
    renderMatrixMathHtmlElement(name, attribs, children, opts) ??
    renderHtmlBlock(name, children, opts)
  );
};
