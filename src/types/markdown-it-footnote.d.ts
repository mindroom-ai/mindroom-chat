// Types for markdown-it-footnote 4.0, which ships none.
declare module 'markdown-it-footnote' {
  import type { MarkdownIt } from 'markdown-it';

  export default function footnotePlugin(md: MarkdownIt): void;
}
