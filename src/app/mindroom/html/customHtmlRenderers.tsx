import React from 'react';
import { HTMLReactParserOptions } from 'html-react-parser';
import { ChildNode } from 'domhandler';
import { renderMindroomHtmlBlock } from '../messages/MindroomHtmlBlocks';
import { renderMatrixMathHtmlElement } from './matrixMath';

export const renderMindroomCustomHtmlElement = (
  name: string,
  attribs: Record<string, string>,
  children: ChildNode[],
  opts: HTMLReactParserOptions
): React.ReactElement | undefined =>
  renderMatrixMathHtmlElement(name, attribs, children, opts) ??
  renderMindroomHtmlBlock(name, children, opts);
