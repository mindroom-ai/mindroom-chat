// @vitest-environment jsdom

import React, { useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { useRoomFolderNavVirtualizer } from '../../mindroom/room-folders/useRoomFolderNavVirtualizer';
import { PageNavContent } from './Page';

vi.mock('../../styles/ContainerColor.css', () => ({
  ContainerColor: () => '',
}));

vi.mock('./style.css', () => ({
  PageNav: () => '',
  PageNavHeader: () => '',
  PageNavContent: '',
  PageContent: '',
  PageHeroEmpty: '',
  PageHeroSection: '',
  PageContentCenter: '',
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type RoomFolderNavVirtualizer = ReturnType<typeof useRoomFolderNavVirtualizer>;
type VirtualizerRender = {
  virtualizer: RoomFolderNavVirtualizer;
  enabled: boolean;
  scrollElement: HTMLDivElement | null;
  virtualItemCount: number;
};

function RoomFolderVirtualizerProbe({
  onRender,
}: {
  onRender: (render: VirtualizerRender) => void;
}) {
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
  const virtualizer = useRoomFolderNavVirtualizer(3, scrollElement);
  onRender({
    virtualizer,
    enabled: virtualizer.options.enabled,
    scrollElement: virtualizer.options.getScrollElement(),
    virtualItemCount: virtualizer.getVirtualItems().length,
  });

  return (
    <PageNavContent scrollRef={setScrollElement}>
      <output data-testid="virtual-row-count">{virtualizer.getVirtualItems().length}</output>
    </PageNavContent>
  );
}

describe('PageNavContent', () => {
  let container: HTMLDivElement | undefined;
  let root: Root | undefined;
  let originalOffsetHeight: PropertyDescriptor | undefined;
  let originalOffsetWidth: PropertyDescriptor | undefined;

  beforeAll(() => {
    originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 120,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => 320,
    });
  });

  afterAll(() => {
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
    } else {
      delete (HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    }
    if (originalOffsetWidth) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
    } else {
      delete (HTMLElement.prototype as { offsetWidth?: number }).offsetWidth;
    }
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it('mounts the scroll element before enabling and populating the room virtualizer', () => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const renders: VirtualizerRender[] = [];

    act(() => {
      root?.render(<RoomFolderVirtualizerProbe onRender={(render) => renders.push(render)} />);
    });

    expect(renders[0]).toMatchObject({
      enabled: false,
      scrollElement: null,
      virtualItemCount: 0,
    });

    const mountedRender = renders.find((render) => render.enabled && render.virtualItemCount > 0);
    expect(mountedRender?.scrollElement).toBeInstanceOf(HTMLDivElement);
    expect(mountedRender?.virtualItemCount).toBe(3);
    expect(container.querySelector('[data-testid="virtual-row-count"]')?.textContent).toBe('3');

    act(() => root?.unmount());
    expect(mountedRender?.virtualizer.scrollElement).toBeNull();
    root = undefined;
  });
});
