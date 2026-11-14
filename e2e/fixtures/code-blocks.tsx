import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import parse from 'html-react-parser';
import { MatrixClient } from 'matrix-js-sdk';
import { color, configClass, varsClass } from 'folds';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import '../../src/app/i18n/i18n';
import { roundedRadii } from '../../src/app/theme/config.css';
import { LightTheme, THEMES } from '../../src/app/theme/useTheme';
import {
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
} from '../../src/app/messages/html/react-custom-html-parser';

// The palette goes on the root element and the code scheme on <body>, without the theme's ID class.
const themeName = new URLSearchParams(window.location.search).get('theme');
const theme = THEMES.find(({ name }) => name === themeName) ?? LightTheme;
const [, paletteClass = '', prismClass = ''] = theme.classNames;
document.documentElement.className = `${configClass} ${varsClass} ${paletteClass} ${roundedRadii}`;
document.body.className = prismClass;

const parser = getReactCustomHtmlParser({} as MatrixClient, undefined, {
  linkifyOpts: LINKIFY_OPTS,
});
const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const block = (code: string, language?: string, label?: string) =>
  `<pre><code${language ? ` class="language-${language}"` : ''}${
    label ? ` data-label="${label}"` : ''
  }>${escape(code)}</code></pre>`;

const blocks = [
  block(
    [
      'launchctl bootout gui/$(id -u)/com.jackielii.skhd',
      'rm ~/Library/LaunchAgents/com.jackielii.skhd.plist',
      'brew uninstall --formula --force skhd-zig',
      'brew untap jackielii/tap',
    ].join('\n'),
    'bash'
  ),
  block(
    'export const greet = (name: string) => <p className="greeting">Hello {name}</p>;',
    'tsx',
    'Greeting.tsx'
  ),
  block('def fib(n):\n    return n if n < 2 else fib(n - 1) + fib(n - 2)', 'python'),
  block(
    'A plain fence with no language keeps a text label and wraps its very long lines instead of scrolling them sideways.'
  ),
  block(
    JSON.stringify(
      Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`key${index}`, index])),
      null,
      2
    ),
    'json'
  ),
];

// A streamed reply edits its code block in place, one line at a time. Edits
// arrive from sync rather than input events, hence the timeout.
function StreamingBlock() {
  const [lines, setLines] = useState(1);
  const code = Array.from({ length: lines }, (_, index) => `const line${index} = ${index};`);
  // A busy timeline's commit outlasts React's frame budget, so effects that are
  // not layout effects run in a later task, after the browser may have painted.
  useLayoutEffect(() => {
    const end = performance.now() + 20;
    while (performance.now() < end);
  }, [lines]);
  return (
    <section aria-label="Streaming code">
      <button type="button" onClick={() => setTimeout(() => setLines((count) => count + 1))}>
        Stream another line
      </button>
      {parse(block(code.join('\n'), 'js'), parser)}
    </section>
  );
}

createRoot(document.getElementById('root')!).render(
  <main
    style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr)',
      gap: 12,
      alignContent: 'start',
      minHeight: '100vh',
      padding: 16,
      boxSizing: 'border-box',
      background: color.Surface.Container,
      color: color.Surface.OnContainer,
      fontSize: 16,
    }}
  >
    {blocks.map((html) => (
      <section key={html}>{parse(html, parser)}</section>
    ))}
    <StreamingBlock />
  </main>
);
