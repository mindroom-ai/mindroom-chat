import { Switch } from 'folds';
import { useTranslation } from 'react-i18next';
import { SettingTile } from '../../ui/SettingTile';
import { useSetting } from '../../preferences/useSetting';
import {
  MessageLayout,
  type MessageSpacing,
  PAGE_ZOOM_DEFAULT,
  settingsAtom,
} from '../../preferences/settings';
import { THEMES, ThemeKind } from '../../theme/useTheme';
import { SettingsPageFrame, type SettingsPageProps } from '../../ui/settings/SettingsPageFrame';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { AdvancedFold } from '../../ui/settings/AdvancedFold';
import { ChoiceButton } from '../../ui/settings/ChoiceButton';

const THEME_LABEL_KEYS = {
  'light-theme': 'options.themeName.light',
  'silver-theme': 'options.themeName.silver',
  'dark-theme': 'options.themeName.dark',
  'midnight-theme': 'options.themeName.midnight',
  'butter-theme': 'options.themeName.butter',
  'green-theme': 'options.themeName.green',
  'orange-theme': 'options.themeName.orange',
} as const;

type ThemeLabelKey = (typeof THEME_LABEL_KEYS)[keyof typeof THEME_LABEL_KEYS];

const themeLabelKey = (themeId: string): ThemeLabelKey =>
  THEME_LABEL_KEYS[themeId as keyof typeof THEME_LABEL_KEYS] ?? THEME_LABEL_KEYS['light-theme'];

const ZOOM_STEPS = [50, 75, 90, 100, 110, 125, 150];

const LAYOUT_CHOICES = [
  [MessageLayout.Modern, 'options.messageLayout.modern'],
  [MessageLayout.Compact, 'options.messageLayout.compact'],
  [MessageLayout.Bubble, 'options.messageLayout.bubble'],
] as const;

const SPACING_CHOICES = [
  ['0', 'options.messageSpacing.none'],
  ['100', 'options.messageSpacing.ultraSmall'],
  ['200', 'options.messageSpacing.extraSmall'],
  ['300', 'options.messageSpacing.small'],
  ['400', 'options.messageSpacing.normal'],
  ['500', 'options.messageSpacing.large'],
] as const satisfies ReadonlyArray<readonly [MessageSpacing, string]>;

type ThemePick = {
  /** The setting that stores this pick. */
  key: 'themeId' | 'lightThemeId' | 'darkThemeId';
  /** The pick in the settings registry. */
  focusId: string;
  titleKey:
    | 'settings.general.appearance.theme'
    | 'settings.general.appearance.lightTheme'
    | 'settings.general.appearance.darkTheme';
  /** Only themes of this kind are offered; all of them without one. */
  kind?: ThemeKind;
  fallback: string;
};

// With the system theme off, one fixed theme; with it on, a pick for each system mode.
const FIXED_PICKS: ThemePick[] = [
  {
    key: 'themeId',
    focusId: 'theme',
    titleKey: 'settings.general.appearance.theme',
    fallback: 'light-theme',
  },
];
const SYSTEM_PICKS: ThemePick[] = [
  {
    key: 'lightThemeId',
    focusId: 'lightTheme',
    titleKey: 'settings.general.appearance.lightTheme',
    kind: ThemeKind.Light,
    fallback: 'light-theme',
  },
  {
    key: 'darkThemeId',
    focusId: 'darkTheme',
    titleKey: 'settings.general.appearance.darkTheme',
    kind: ThemeKind.Dark,
    fallback: 'dark-theme',
  },
];

/** One theme picker tile; the fixed theme explains when it applies. */
function ThemePickTile({ pick }: { pick: ThemePick }) {
  const { t } = useTranslation();
  const [picked, setPicked] = useSetting(settingsAtom, pick.key);
  const title = t(pick.titleKey);
  const offered = THEMES.filter((theme) => pick.kind === undefined || theme.kind === pick.kind);

  return (
    <SettingTile
      focusId={pick.focusId}
      title={title}
      description={
        pick.kind === undefined ? t('settings.general.appearance.themeDescription') : undefined
      }
      after={
        <ChoiceButton
          label={title}
          value={picked ?? pick.fallback}
          choices={offered.map((theme) => ({ value: theme.id, label: t(themeLabelKey(theme.id)) }))}
          onChoose={setPicked}
        />
      }
    />
  );
}

function ThemeSection() {
  const { t } = useTranslation();
  const [followSystem, setFollowSystem] = useSetting(settingsAtom, 'useSystemTheme');
  const systemTitle = t('settings.general.appearance.systemTheme');

  return (
    <SettingsSection title={t('settings.general.appearance.theme')}>
      <SettingTile
        focusId="systemTheme"
        title={systemTitle}
        description={t('settings.general.appearance.systemThemeDescription')}
        after={
          <Switch
            variant="Primary"
            aria-label={systemTitle}
            value={followSystem}
            onChange={setFollowSystem}
          />
        }
      />
      {(followSystem ? SYSTEM_PICKS : FIXED_PICKS).map((pick) => (
        <ThemePickTile key={pick.key} pick={pick} />
      ))}
    </SettingsSection>
  );
}

function PageZoomTile() {
  const { t } = useTranslation();
  const [pageZoom, setPageZoom] = useSetting(settingsAtom, 'pageZoom');
  // A pinch on a phone can store a value between the steps; it stays selectable.
  const steps = ZOOM_STEPS.includes(pageZoom)
    ? ZOOM_STEPS
    : [...ZOOM_STEPS, pageZoom].sort((a, b) => a - b);
  const label = t('settings.general.appearance.pageZoom');

  return (
    <SettingTile
      focusId="pageZoom"
      title={label}
      after={
        <ChoiceButton
          label={label}
          value={pageZoom ?? PAGE_ZOOM_DEFAULT}
          choices={steps.map((step) => ({ value: step, label: `${step}%` }))}
          onChoose={setPageZoom}
        />
      }
    />
  );
}

function MessageLayoutTile() {
  const { t } = useTranslation();
  const [layout, setLayout] = useSetting(settingsAtom, 'messageLayout');
  const label = t('settings.general.messages.messageLayout');

  return (
    <SettingTile
      focusId="messageLayout"
      title={label}
      after={
        <ChoiceButton
          label={label}
          value={layout}
          choices={LAYOUT_CHOICES.map(([value, key]) => ({ value, label: t(key) }))}
          onChoose={setLayout}
        />
      }
    />
  );
}

function MessageSpacingTile() {
  const { t } = useTranslation();
  const [spacing, setSpacing] = useSetting(settingsAtom, 'messageSpacing');
  const label = t('settings.general.messages.messageSpacing');

  return (
    <SettingTile
      focusId="messageSpacing"
      title={label}
      after={
        <ChoiceButton
          label={label}
          value={spacing}
          choices={SPACING_CHOICES.map(([value, key]) => ({ value, label: t(key) }))}
          onChoose={setSpacing}
        />
      }
    />
  );
}

/** Theme, zoom and how the timeline lays out messages, all stored on this device. */
export function Appearance({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();

  return (
    <SettingsPageFrame
      title={t('settings.general.appearance.sectionTitle')}
      requestClose={requestClose}
    >
      <ThemeSection />
      <SettingsSection title={t('featureUi.settings.sections.display')}>
        <PageZoomTile />
        <MessageLayoutTile />
      </SettingsSection>
      <AdvancedFold>
        <SettingsSection>
          <MessageSpacingTile />
        </SettingsSection>
      </AdvancedFold>
    </SettingsPageFrame>
  );
}
