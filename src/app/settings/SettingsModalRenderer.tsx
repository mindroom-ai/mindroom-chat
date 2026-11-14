import { useAtom } from 'jotai';
import { Modal500 } from '../ui/Modal500';
import { settingsModalAtom } from '../navigation/settingsModal';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { SettingsDialog } from '../ui/settings/frame.css';
import { Settings } from './Settings';

export function SettingsModalRenderer() {
  const [state, setState] = useAtom(settingsModalAtom);
  // Wider screens get the larger dialog; a phone keeps the dialog's margin.
  const phone = useScreenSizeContext() === ScreenSize.Mobile;

  if (!state) return null;

  const closeSettings = () => setState(undefined);

  return (
    <Modal500 requestClose={closeSettings} className={phone ? undefined : SettingsDialog}>
      <Settings
        key={state.requestId}
        initialPage={state.initialPage}
        requestClose={closeSettings}
      />
    </Modal500>
  );
}
