import React from 'react';
import { createRoot } from 'react-dom/client';
import { color, configClass, varsClass } from 'folds';
import '@fontsource/inter/variable.css';
import 'folds/dist/style.css';
import '../../src/index.css';
import '../../src/app/i18n';
import { darkTheme, lightTheme } from '../../src/colors.css';
import { ClientConfigProvider } from '../../src/app/hooks/useClientConfig';
import { MindroomThinkingPlaceholder } from '../../src/app/mindroom/messages/MindroomThinkingPlaceholder';

const dark = new URLSearchParams(window.location.search).has('dark');
document.documentElement.className = `${configClass} ${varsClass} ${dark ? darkTheme : lightTheme}`;

createRoot(document.getElementById('root')!).render(
  <ClientConfigProvider value={{ mindroom: { thinkingPlaceholderMessages: ['Thinking...'] } }}>
    <main style={{ padding: 24, color: color.Surface.OnContainer, lineHeight: 1.5 }}>
      <p style={{ fontSize: 16 }}>
        <MindroomThinkingPlaceholder />
      </p>
      <p style={{ fontSize: 14 }}>
        <MindroomThinkingPlaceholder />
      </p>
    </main>
  </ClientConfigProvider>
);
