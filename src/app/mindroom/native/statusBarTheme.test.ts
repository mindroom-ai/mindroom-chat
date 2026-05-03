import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StatusBar } from '@capacitor/status-bar';

import { isNativeIOS } from './nativeSso';
import { syncNativeStatusBarBackground } from './statusBarTheme';

vi.mock('@capacitor/status-bar', () => ({
  StatusBar: {
    setBackgroundColor: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('./nativeSso', () => ({
  isNativeIOS: vi.fn(),
}));

describe('syncNativeStatusBarBackground', () => {
  beforeEach(() => {
    vi.mocked(isNativeIOS).mockReset();
    vi.mocked(StatusBar.setBackgroundColor).mockClear();
  });

  it('updates the native iOS status bar background to the resolved app background', () => {
    vi.mocked(isNativeIOS).mockReturnValue(true);

    syncNativeStatusBarBackground('#DEDEDE');

    expect(StatusBar.setBackgroundColor).toHaveBeenCalledWith({ color: '#DEDEDE' });
  });

  it('does nothing outside the native iOS wrapper', () => {
    vi.mocked(isNativeIOS).mockReturnValue(false);

    syncNativeStatusBarBackground('#DEDEDE');

    expect(StatusBar.setBackgroundColor).not.toHaveBeenCalled();
  });
});
