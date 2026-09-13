import React from 'react';
import parse, { HTMLReactParserOptions } from 'html-react-parser';
import { Opts } from 'linkifyjs';
import { MessageEmptyContent } from './content';
import { sanitizeCustomHtml } from '../../utils/sanitize';
import { renderTextWithLatex } from '../../plugins/react-custom-html-parser';

type RenderBodyProps = {
  body: string;
  customBody?: string;

  highlightRegex?: RegExp;
  htmlReactParserOptions: HTMLReactParserOptions;
  linkifyOpts: Opts;
};
export function RenderBody({
  body,
  customBody,
  highlightRegex,
  htmlReactParserOptions,
  linkifyOpts,
}: RenderBodyProps) {
  if (body === '') <MessageEmptyContent />;
  if (customBody) {
    if (customBody === '') <MessageEmptyContent />;
    return parse(sanitizeCustomHtml(customBody), htmlReactParserOptions);
  }
  return renderTextWithLatex(body, {
    linkify: true,
    linkifyOpts,
    highlightRegex,
    keyPrefix: 'body',
  });
}
