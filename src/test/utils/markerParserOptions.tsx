import { renderToStaticMarkup } from 'react-dom/server';
import type { HTMLReactParserOptions } from 'html-react-parser';
import { useToolTraceMarkerParserOptions } from '../../app/messages/html/HtmlBlocks';
import type { ToolMetadataStatus } from '../../app/matrix/protocol/toolTrace';
import {
  type HtmlReactParserOptionsSource,
  resolveHtmlReactParserOptions,
} from '../../app/rich-text/htmlReactParserOptions';

/** What `useToolTraceMarkerParserOptions` gives a message with this content. */
export const renderMarkerParserOptions = (
  baseOpts: HTMLReactParserOptions,
  content: Record<string, unknown>,
  metadataStatus?: ToolMetadataStatus
): HtmlReactParserOptionsSource => {
  let source: HtmlReactParserOptionsSource = baseOpts;
  function Probe() {
    source = useToolTraceMarkerParserOptions(baseOpts, content, metadataStatus);
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return source;
};

/** The parser options for one parse of a message with this content, as RenderBody gets them. */
export const markerParserOptions = (
  baseOpts: HTMLReactParserOptions,
  content: Record<string, unknown>,
  metadataStatus?: ToolMetadataStatus
): HTMLReactParserOptions =>
  resolveHtmlReactParserOptions(renderMarkerParserOptions(baseOpts, content, metadataStatus));
