// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SnoozeEndedMarker } from './SnoozeEndedMarker';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('./SnoozeEndedMarker.css', () => ({ Marker: 'Marker', Note: 'Note' }));
vi.mock('@tabler/icons-react', () => ({ IconClock: () => <svg /> }));

afterEach(cleanup);

describe('SnoozeEndedMarker', () => {
  it('shows Snooze ended and the note', () => {
    const { container } = render(<SnoozeEndedMarker note="check CI" />);
    expect(container.textContent).toBe('Snooze ended: check CI');
  });

  it('shows Snooze ended alone without a note', () => {
    const { container } = render(<SnoozeEndedMarker />);
    expect(container.textContent).toBe('Snooze ended');
    expect(screen.queryByText(/:/)).toBeNull();
  });
});
