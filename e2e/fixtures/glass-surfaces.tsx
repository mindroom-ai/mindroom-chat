import React from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, MsgType } from 'matrix-js-sdk';
import { Provider } from 'jotai';
import { AvatarFallback, MenuItem, Text, config } from 'folds';
import { Header, Menu, Modal } from '../../src/app/components/glass/GlassPrimitives';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import '../../src/app/i18n';
import {
  ButterTheme,
  DarkTheme,
  LightTheme,
  MidnightTheme,
  SilverTheme,
} from '../../src/app/hooks/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { MatrixClientProvider } from '../../src/app/hooks/useMatrixClient';
import { SpecVersionsProvider } from '../../src/app/hooks/useSpecVersions';
import { CustomEditor, useEditor } from '../../src/app/components/editor';
import { SidebarAvatar } from '../../src/app/components/sidebar';
import { MAudio } from '../../src/app/components/message/MsgTypeRenderers';

const themes = {
  light: LightTheme,
  silver: SilverTheme,
  dark: DarkTheme,
  midnight: MidnightTheme,
  butter: ButterTheme,
};
const themeName = new URLSearchParams(window.location.search).get('theme') ?? 'light';
const theme = themes[themeName as keyof typeof themes] ?? LightTheme;
applyThemeToDom(theme);

const audioContent = {
  msgtype: MsgType.Audio,
  body: 'Design review.wav',
  url: 'mxc://fixture/glass-audio',
  info: { mimetype: 'audio/wav', duration: 12000, size: 192044 },
};

function Fixture() {
  const editor = useEditor();

  return (
    <main
      style={{
        boxSizing: 'border-box',
        width: '100%',
        minHeight: '100vh',
        padding: 20,
        color: 'var(--cpd-color-surface-on-container)',
        background:
          'radial-gradient(circle at 18% 12%, rgb(93 123 255 / 32%), transparent 30%), radial-gradient(circle at 82% 72%, rgb(185 111 255 / 24%), transparent 35%), var(--cpd-color-background-container)',
      }}
    >
      <div
        aria-hidden="true"
        style={{ display: 'grid', gap: 8, margin: '0 auto 18px', maxWidth: 680, opacity: 0.75 }}
      >
        <div>Alex: The compact layout is ready for review.</div>
        <div>Riley: Great, I will check the keyboard flow.</div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 16,
          width: 'min(100%, 680px)',
          margin: '0 auto',
        }}
      >
        <Modal data-testid="glass-modal" size="500" style={{ width: '100%', maxWidth: '100%' }}>
          <Header data-testid="glass-header" variant="Critical" size="400">
            <Text size="H4">Review controls</Text>
          </Header>
          <div style={{ display: 'grid', gap: 12, padding: config.space.S400 }}>
            <SidebarAvatar as="button" aria-label="Open workspace" outlined>
              <AvatarFallback>MR</AvatarFallback>
            </SidebarAvatar>
            <div data-testid="editor-host">
              <CustomEditor editor={editor} editableName="Message" placeholder="Send a message" />
            </div>
            <section
              data-testid="audio-host"
              aria-label="Audio attachment"
              style={{ minWidth: 0, maxWidth: '100%' }}
            >
              <MAudio content={audioContent} renderAsFile={() => <div>Unsupported audio</div>} />
            </section>
          </div>
        </Modal>

        <Menu data-testid="glass-menu" aria-label="Message actions">
          <MenuItem>Reply</MenuItem>
          <MenuItem>Copy link</MenuItem>
        </Menu>
      </div>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <Provider>
    <MatrixClientProvider value={createClient({ baseUrl: window.location.origin })}>
      <SpecVersionsProvider value={{ versions: ['v1.10'] }}>
        <Fixture />
      </SpecVersionsProvider>
    </MatrixClientProvider>
  </Provider>
);
