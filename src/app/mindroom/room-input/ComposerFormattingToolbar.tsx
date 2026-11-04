import { MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlate } from 'slate-react';
import { Box, Icon, Icons, IconSrc, Line, config } from 'folds';
import { IconButton } from '../../components/glass/GlassPrimitives';
import { BlockType, MarkType } from '../../components/editor/types';
import { isMarkActive, toggleMark } from '../../components/editor/keyboard';
import { getActiveBlockFormat, toggleBlockFormat } from '../../components/editor/blockFormat';
import { IconTooltip } from '../tooltip/IconTooltip';

const markControls = [
  { format: MarkType.Bold, icon: Icons.Bold, labelKey: 'sharedUi.toolbar.bold' },
  { format: MarkType.Italic, icon: Icons.Italic, labelKey: 'sharedUi.toolbar.italic' },
  { format: MarkType.Underline, icon: Icons.Underline, labelKey: 'sharedUi.toolbar.underline' },
  {
    format: MarkType.StrikeThrough,
    icon: Icons.Strike,
    labelKey: 'sharedUi.toolbar.strikeThrough',
  },
  { format: MarkType.Code, icon: Icons.Code, labelKey: 'sharedUi.toolbar.inlineCode' },
  { format: MarkType.Spoiler, icon: Icons.EyeBlind, labelKey: 'sharedUi.toolbar.spoiler' },
] as const;

const blockControls = [
  { format: BlockType.Heading, icon: Icons.Heading1, labelKey: 'sharedUi.toolbar.heading1' },
  { format: BlockType.BlockQuote, icon: Icons.BlockQuote, labelKey: 'sharedUi.toolbar.blockQuote' },
  { format: BlockType.CodeBlock, icon: Icons.BlockCode, labelKey: 'sharedUi.toolbar.blockCode' },
  {
    format: BlockType.UnorderedList,
    icon: Icons.UnorderList,
    labelKey: 'sharedUi.toolbar.unorderedList',
  },
  {
    format: BlockType.OrderedList,
    icon: Icons.OrderList,
    labelKey: 'sharedUi.toolbar.orderedList',
  },
] as const;

// A pointer press would move focus, and with it the caret, out of the text box first.
const keepEditorFocus = (event: MouseEvent) => event.preventDefault();

function FormatButton({
  label,
  icon,
  pressed,
  onPress,
}: {
  label: string;
  icon: IconSrc;
  pressed: boolean;
  onPress: () => void;
}) {
  return (
    <IconTooltip position="Top" label={label}>
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          aria-label={label}
          aria-pressed={pressed}
          variant="SurfaceVariant"
          size="300"
          radii="300"
          onMouseDown={keepEditorFocus}
          onClick={onPress}
        >
          <Icon size="100" src={icon} filled={pressed} />
        </IconButton>
      )}
    </IconTooltip>
  );
}

/**
 * The composer's formatting row: text marks, then line formats. Rendered inside the editor's
 * Slate context, so each button shows whether its format applies where the caret is.
 */
export function ComposerFormattingToolbar() {
  const { t } = useTranslation();
  const editor = useSlate();
  const activeBlock = getActiveBlockFormat(editor);
  return (
    <Box
      role="toolbar"
      aria-label={t('composer.formatting')}
      wrap="Wrap"
      gap="100"
      alignItems="Center"
      style={{ padding: `0 ${config.space.S200} ${config.space.S200}` }}
    >
      {markControls.map(({ format, icon, labelKey }) => (
        <FormatButton
          key={format}
          label={t(labelKey)}
          icon={icon}
          pressed={isMarkActive(editor, format)}
          onPress={() => toggleMark(editor, format)}
        />
      ))}
      <Line
        direction="Vertical"
        size="300"
        variant="SurfaceVariant"
        style={{ height: '1.25rem' }}
      />
      {blockControls.map(({ format, icon, labelKey }) => (
        <FormatButton
          key={format}
          label={t(labelKey)}
          icon={icon}
          pressed={activeBlock === format}
          onPress={() => toggleBlockFormat(editor, format)}
        />
      ))}
    </Box>
  );
}
