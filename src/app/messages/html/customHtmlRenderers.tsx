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
    const readRows = simpleTableRows(children, (nodes) => domToReact(nodes, opts));
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
