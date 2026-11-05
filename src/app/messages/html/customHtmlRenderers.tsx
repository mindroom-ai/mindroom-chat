import React from 'react';
import { attributesToProps, domToReact, HTMLReactParserOptions } from 'html-react-parser';
import { ChildNode } from 'domhandler';
import { renderMindroomHtmlBlock } from './HtmlBlocks';
import { renderMatrixMathHtmlElement } from '../../rich-text/matrixMath';
import { ScrollableTable } from '../../rich-text/ScrollableTable';

export const renderMindroomCustomHtmlElement = (
  name: string,
  attribs: Record<string, string>,
  children: ChildNode[],
  opts: HTMLReactParserOptions
): React.ReactElement | undefined => {
  if (name === 'table') {
    return (
      <ScrollableTable {...attributesToProps(attribs)}>
        {domToReact(children, opts)}
      </ScrollableTable>
    );
  }

  return (
    renderMatrixMathHtmlElement(name, attribs, children, opts) ??
    renderMindroomHtmlBlock(name, children, opts)
  );
};
