import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, MemoryStore } from 'matrix-js-sdk';
import { color, config } from 'folds';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import '../../src/app/i18n';
import { DarkTheme, LightTheme } from '../../src/app/hooks/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { ClientConfigProvider } from '../../src/app/hooks/useClientConfig';
import { RenderBody } from '../../src/app/components/message/RenderBody';
import { MessageTextBody } from '../../src/app/components/message/layout/layout.css';
import {
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  LINKIFY_OPTS,
} from '../../src/app/plugins/react-custom-html-parser';

// `?dark` switches to the dark theme. Site icons come from the real message parser; the spec
// answers every icon request itself, so nothing leaves the machine.
applyThemeToDom(new URLSearchParams(window.location.search).has('dark') ? DarkTheme : LightTheme);

const client = createClient({
  baseUrl: window.location.origin,
  userId: '@fixture:localhost',
  store: new MemoryStore(),
});

type Sample = { id: string; body: string; html?: string };

const brokenLink = '<p>The <a href="https://broken-site.com/notes">Updated link</a> moved.</p>';
const fixedLink = '<p>The <a href="https://github.com/example/notes">Updated link</a> moved.</p>';

const roomSamples = (edited: boolean): Sample[] => [
  { id: 'plain', body: 'Release notes live at https://github.com/example/chat/ for now.' },
  {
    id: 'formatted',
    body: 'Read the docs first.',
    html: '<p>Read <a href="https://github.com/example/docs"><strong>the docs</strong></a> first, then try <code>https://example.com/code</code> in a terminal.</p>',
  },
  {
    id: 'spoilers',
    body: 'Spoilers',
    html: '<p>Hidden: <span data-mx-spoiler="">the <a href="https://github.com/example/answer">answer page</a></span> and <a href="https://github.com/example/nested"><span data-mx-spoiler="">Nested secret</span></a>.</p>',
  },
  { id: 'edited', body: 'The Updated link moved.', html: edited ? fixedLink : brokenLink },
];

// The thread runs right to left at the smaller thread text size.
const threadSample: Sample = {
  id: 'thread',
  body: 'الملاحظات في https://github.com/example/thread اليوم',
};

function Messages({ samples, favicons }: { samples: Sample[]; favicons: boolean }) {
  const parserOptions = useMemo(
    () =>
      getReactCustomHtmlParser(client, '!fixture:localhost', {
        linkifyOpts: LINKIFY_OPTS,
        showLinkFavicons: favicons,
      }),
    [favicons]
  );
  const linkifyOpts = useMemo(
    () => ({ ...LINKIFY_OPTS, render: factoryRenderLinkifyWithMention(() => undefined, favicons) }),
    [favicons]
  );
  return (
    <>
      {samples.map(({ id, body, html }) => (
        <div key={id} className={MessageTextBody({ preWrap: !html })}>
          <RenderBody
            body={body}
            customBody={html}
            htmlReactParserOptions={parserOptions}
            linkifyOpts={linkifyOpts}
          />
        </div>
      ))}
    </>
  );
}

// Read at render, once the theme has set the color tokens.
const pageStyle = (): React.CSSProperties => ({
  background: color.Surface.Container,
  color: color.Surface.OnContainer,
  minHeight: '100vh',
  boxSizing: 'border-box',
  padding: `${config.space.S500} ${config.space.S400}`,
  display: 'flex',
  flexDirection: 'column',
  rowGap: config.space.S500,
});

function Fixture() {
  const [edited, setEdited] = useState(false);
  const [favicons, setFavicons] = useState(true);
  return (
    <main style={pageStyle()}>
      <div style={{ display: 'flex', gap: config.space.S200, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setEdited(true)}>
          Edit link
        </button>
        <button type="button" onClick={() => setFavicons((shown) => !shown)}>
          Toggle previews
        </button>
      </div>
      <section
        aria-label="Room messages"
        style={{ display: 'grid', gap: config.space.S300, fontSize: 16, lineHeight: 1.5 }}
      >
        <Messages samples={roomSamples(edited)} favicons={favicons} />
      </section>
      <section
        aria-label="Thread messages"
        dir="rtl"
        lang="ar"
        style={{ display: 'grid', gap: config.space.S300, fontSize: 14, lineHeight: 1.5 }}
      >
        <Messages samples={[threadSample]} favicons={favicons} />
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <ClientConfigProvider value={{}}>
    <Fixture />
  </ClientConfigProvider>
);
