// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RESOLVE_TIP_ID, type ContextualTip } from '../../tour/contextualTips';
import { useContextualTip } from '../../tour/useContextualTip';
import { HelpTab } from './HelpTab';

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});
vi.mock('../../tour/useContextualTip', () => ({ useContextualTip: vi.fn() }));
vi.mock('../../tour/HelpMenu', () => ({
  HelpMenu: ({ below, onClose }: { below?: boolean; onClose: () => void }) => (
    <div data-help-menu-mock={below ? 'below' : 'beside'}>
      <button type="button" onClick={onClose}>
        Close mock
      </button>
    </div>
  ),
}));

const mockTip = (tip?: ContextualTip) => {
  vi.mocked(useContextualTip).mockReturnValue({
    tip,
    dismissTip: vi.fn(),
    openTipTour: vi.fn(),
  });
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('HelpTab', () => {
  it('renders cleanly without a dot when no tip applies and toggles HelpMenu beside the rail', () => {
    mockTip(undefined);
    render(<HelpTab />);

    const button = screen.getByRole('button', { name: 'Help & guides' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-help-tip-dot]')).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-help-menu-mock="beside"]')).toBeTruthy();

    fireEvent.click(button);
    expect(document.querySelector('[data-help-menu-mock]')).toBeNull();
  });

  it('shows the accent dot for an active tip, hides it while open, and opens below in top bar', () => {
    mockTip({ id: RESOLVE_TIP_ID, tourStep: 'resolve', scope: 'all', openCount: 5 });
    render(<HelpTab inTopBar />);

    const button = screen.getByRole('button', { name: 'Help & guides (1 tip)' });
    expect(document.querySelector('[data-help-tip-dot]')).toBeTruthy();

    fireEvent.click(button);
    expect(document.querySelector('[data-help-tip-dot]')).toBeNull();
    expect(document.querySelector('[data-help-menu-mock="below"]')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close mock' }));
    expect(document.querySelector('[data-help-tip-dot]')).toBeTruthy();
  });
});
