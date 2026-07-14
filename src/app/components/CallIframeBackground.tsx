import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CallEmbed } from '../plugins/call';
import { MindRoomParticleBackground } from './particle-background';

type MountedCallBackground = {
  cleanup: () => void;
  portalRoot: HTMLDivElement;
};

export function mountCallBackgroundPortal(
  iframe: HTMLIFrameElement
): MountedCallBackground | undefined {
  const callDocument = iframe.contentDocument ?? iframe.contentWindow?.document;
  const appRoot = callDocument?.getElementById('root');
  if (!callDocument?.head || !callDocument.body || !appRoot) return undefined;

  const portalRoot = callDocument.createElement('div');
  portalRoot.dataset.mindroomCallBackground = '';
  Object.assign(portalRoot.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
  });

  const portalStyles = callDocument.createElement('style');
  portalStyles.dataset.mindroomCallBackgroundStyles = '';
  portalStyles.textContent = `
    @media (prefers-reduced-motion: reduce) {
      [data-mindroom-call-background] > div { opacity: 0.75; }
      [data-mindroom-call-background] canvas { display: none !important; }
    }
  `;

  const previousAppRootPosition = appRoot.style.position;
  // Keep the root in the same stacking layer as body-level Element Call portals.
  // The prepended background still paints first, while later settings and menu portals paint last.
  appRoot.style.position = 'relative';
  callDocument.head.append(portalStyles);
  callDocument.body.prepend(portalRoot);

  return {
    portalRoot,
    cleanup: () => {
      portalRoot.remove();
      portalStyles.remove();
      appRoot.style.position = previousAppRootPosition;
    },
  };
}

type CallIframeBackgroundProps = {
  callEmbed?: CallEmbed;
  visible: boolean;
};

export function CallIframeBackground({ callEmbed, visible }: CallIframeBackgroundProps) {
  const [portalRoot, setPortalRoot] = useState<HTMLDivElement>();

  useEffect(() => {
    if (!callEmbed || !visible) {
      setPortalRoot(undefined);
      return undefined;
    }

    const { iframe } = callEmbed;
    let mounted = mountCallBackgroundPortal(iframe);
    setPortalRoot(mounted?.portalRoot);

    const handleLoad = () => {
      mounted?.cleanup();
      mounted = mountCallBackgroundPortal(iframe);
      setPortalRoot(mounted?.portalRoot);
    };
    iframe.addEventListener('load', handleLoad);

    return () => {
      iframe.removeEventListener('load', handleLoad);
      mounted?.cleanup();
    };
  }, [callEmbed, visible]);

  return portalRoot ? createPortal(<MindRoomParticleBackground selfContained />, portalRoot) : null;
}
