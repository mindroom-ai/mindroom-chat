import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import parse from 'html-react-parser';
import { MatrixClient } from 'matrix-js-sdk';
import { color, configClass, varsClass } from 'folds';
import 'folds/dist/style.css';
import '@fontsource-variable/inter';
import '../../src/index.css';
import '../../src/app/i18n/i18n';
import { darkTheme, lightTheme } from '../../src/app/theme/colors.css';
import { BreakWord } from '../../src/app/ui/styles/Text.css';
import { ScreenSizeProvider, useScreenSize } from '../../src/app/lib/hooks/useScreenSize';
import {
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
} from '../../src/app/messages/html/react-custom-html-parser';
import { sanitizeCustomHtml } from '../../src/app/rich-text/sanitize';
import { useToolTraceMarkerParserOptions } from '../../src/app/messages/html/HtmlBlocks';
import { resolveHtmlReactParserOptions } from '../../src/app/rich-text/htmlReactParserOptions';
import { showToolCalls } from '../../src/test/utils/showToolCalls';

// The page shows agent replies' tool calls, which the app hides until the reader shows them.
showToolCalls();

const params = new URLSearchParams(window.location.search);
const dark = params.has('dark');
document.documentElement.className = `${configClass} ${varsClass} ${
  dark ? darkTheme : lightTheme
} ${dark ? 'dark-theme' : 'light-theme'}`;
const parser = getReactCustomHtmlParser({} as MatrixClient, undefined, {
  linkifyOpts: LINKIFY_OPTS,
});
const headers = ['Project name', 'Current status', 'Assigned team', 'Next milestone', 'Notes'];
const values = [
  'Community workspace',
  'Ready for review',
  'Client experience team',
  'September release candidate',
  'Keyboard and touch support',
];

// `?matrix`: a wide numeric table with a linked source column; `&span` (or the button) adds a
// spanning row.
const matrixHeaders = ['Month', 'Opening cash', 'Revenue', 'Payroll', 'Other opex', 'Capex'];
const matrixRow = (month: number) =>
  [`M${month}`, '$4,200.0k', '$610.0k', '$520.0k', '$140.0k', '$0.0k']
    .map((cell) => `<td>${cell}</td>`)
    .join('') + `<td><a href="https://example.com/ledger/${month}">Ledger M${month}</a></td>`;

function Fixture() {
  const [wide, setWide] = useState(true);
  const [months, setMonths] = useState(3);
  const [span, setSpan] = useState(params.has('span'));
  const screenSize = useScreenSize();
  const columns = wide ? headers : ['Item', 'Count'];
  const cells = wide ? values : ['Tea', '2'];
  // Markdown-capable senders supply tables as formatted_body HTML.
  const caption = params.get('format') === 'html' ? '<caption>Project overview</caption>' : '';
  const html = params.has('matrix')
    ? `<table><thead><tr>${[...matrixHeaders, 'Source']
        .map((header) => `<th>${header}</th>`)
        .join('')}</tr></thead><tbody>${Array.from(
        { length: months },
        (_, index) => `<tr>${matrixRow(index + 1)}</tr>`
      ).join('')}${
        span ? '<tr><td colspan="7">Forecast file missing</td></tr>' : ''
      }</tbody></table>`
    : `<table>${caption}<thead><tr>${columns
        .map((header) => `<th>${header}</th>`)
        .join('')}</tr></thead><tbody>${[0, 1]
        .map(() => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
        .join('')}</tbody></table>`;
  const toolPrefix = params.has('tools')
    ? ['<p>🔧 <code>first_tool</code> [1]</p>', '<p>🔧 <code>second_tool</code> [2]</p>', ''].join(
        params.has('whitespace') ? '\n  ' : ''
      )
    : '';
  const formattedBody = toolPrefix + html;
  const options = resolveHtmlReactParserOptions(
    useToolTraceMarkerParserOptions(parser, { formatted_body: formattedBody })
  );

  return (
    <ScreenSizeProvider value={screenSize}>
      <main
        style={{ padding: 16, color: color.Surface.OnContainer, fontSize: 16, lineHeight: 1.5 }}
      >
        <button type="button" onClick={() => setWide(!wide)}>
          Toggle table width
        </button>
        <button type="button" onClick={() => setMonths(months + 1)}>
          Add row
        </button>
        <button type="button" onClick={() => setSpan(true)}>
          Add spanning row
        </button>
        <div style={{ display: 'flex', marginTop: 16 }}>
          <div className={BreakWord} style={{ minWidth: 0, flex: 1, whiteSpace: 'pre-wrap' }}>
            {parse(sanitizeCustomHtml(formattedBody), options)}
          </div>
        </div>
      </main>
    </ScreenSizeProvider>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
