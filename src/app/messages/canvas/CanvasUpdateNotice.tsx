import { Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { CanvasHost } from './useCanvasHost';
import * as css from './canvasHost.css';

/** The agent changed the page while the user worked in it; the update waits for their click. */
export function CanvasUpdateNotice({
  host,
  agentName,
  inline = false,
}: {
  host: CanvasHost;
  agentName: string;
  /** In the thread the update is to a page, not a panel. */
  inline?: boolean;
}) {
  const { t } = useTranslation();
  if (!host.updateAvailable) return null;
  return (
    <div className={css.Notice} role="status">
      <Text size="T300">
        {t(inline ? 'mindroomUi.canvas.pageUpdated' : 'mindroomUi.canvas.updated', {
          agent: agentName,
        })}
      </Text>
      <Button
        size="300"
        variant="Secondary"
        onClick={host.loadUpdate}
        fill="Soft"
        outlined
        radii="300"
      >
        <Text size="B300">{t('mindroomUi.canvas.loadUpdate')}</Text>
      </Button>
    </div>
  );
}
