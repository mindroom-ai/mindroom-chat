// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PAGE_MAIN_ID } from '../ui/page/Page';
import { SkipToContent } from './SkipToContent';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The skip link and a page whose conversation, with the room's title, a side panel may hide. */
const renderPage = (conversationHidden: boolean) =>
  render(
    <>
      <SkipToContent />
      <main id={PAGE_MAIN_ID}>
        <div ref={(element) => element?.toggleAttribute('inert', conversationHidden)}>
          <h1>Room</h1>
        </div>
        <button type="button">Fill the room with Call</button>
      </main>
    </>
  );

it("lands on the page's title", () => {
  renderPage(false);
  fireEvent.click(screen.getByRole('link'));
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Room' }));
});

it('lands on the first control while a side panel hides the conversation and its title', () => {
  // jsdom lays nothing out; the page's controls take up room.
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as never);
  renderPage(true);
  fireEvent.click(screen.getByRole('link'));
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Fill the room with Call' })
  );
});
