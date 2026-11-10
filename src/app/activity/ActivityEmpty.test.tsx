// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import { ThreadsEmpty } from '../threads/page/ThreadsEmpty';
import { ActivityEmpty } from './ActivityEmpty';

afterEach(cleanup);

describe('the empty Activity and Threads pages', () => {
  it('point to the list beside them, and on a phone to the menu that holds it', () => {
    for (const Empty of [ActivityEmpty, ThreadsEmpty]) {
      render(
        <ScreenSizeProvider value={ScreenSize.Desktop}>
          <Empty />
        </ScreenSizeProvider>
      );
      expect(screen.getByText(/beside the list/)).toBeTruthy();
      cleanup();
      render(
        <ScreenSizeProvider value={ScreenSize.Mobile}>
          <Empty />
        </ScreenSizeProvider>
      );
      expect(screen.queryByText(/beside the list/)).toBeNull();
      expect(screen.getByText('Open the menu to pick one.')).toBeTruthy();
      cleanup();
    }
  });
});
