import { useTranslation } from 'react-i18next';
import { Icon, IconButton, Icons, Text } from 'folds';
import { IconTooltip } from '../IconTooltip';
import { ExpandIcon, ShrinkIcon } from './panelIcons';
import type { PanelFrame } from './panelFrameContext';
import * as css from './PanelFrame.css';

/**
 * The frame's strip at the panel's start edge: Fill the room and Fold beside the conversation or
 * across the room. Folded, the strip is all of the panel that shows: a tab with its name, which
 * brings it back beside the conversation.
 */
export function PanelFrameStrip({ frame: { label, layout, setLayout } }: { frame: PanelFrame }) {
  const { t } = useTranslation();
  if (layout === 'folded') {
    return (
      <button
        type="button"
        className={css.Tab}
        aria-label={t('mindroomUi.sidePanel.unfold', { label })}
        onClick={() => setLayout('beside')}
      >
        <Icon size="200" src={Icons.ChevronLeft} data-directional />
        <Text as="span" size="L400" className={css.TabLabel}>
          {label}
        </Text>
      </button>
    );
  }
  const filled = layout === 'filled';
  const fill = t('mindroomUi.sidePanel.fill', { label });
  const fold = t('mindroomUi.sidePanel.fold', { label });
  return (
    <div className={css.Strip}>
      <IconTooltip label={fill} position="Right">
        {(triggerRef) => (
          <IconButton
            ref={triggerRef}
            size="300"
            radii="300"
            aria-label={fill}
            aria-pressed={filled}
            onClick={() => setLayout(filled ? 'beside' : 'filled')}
          >
            <Icon size="200" src={filled ? ShrinkIcon : ExpandIcon} />
          </IconButton>
        )}
      </IconTooltip>
      <IconTooltip label={fold} position="Right">
        {(triggerRef) => (
          <IconButton
            ref={triggerRef}
            size="300"
            radii="300"
            aria-label={fold}
            onClick={() => setLayout('folded')}
          >
            <Icon size="200" src={Icons.ChevronRight} data-directional />
          </IconButton>
        )}
      </IconTooltip>
    </div>
  );
}
