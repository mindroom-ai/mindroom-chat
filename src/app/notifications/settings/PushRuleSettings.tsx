import { FormEvent, useState } from 'react';
import { Box, Button, Icon, IconButton, Icons, Input, Spinner, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import { type IPushRule, type IPushRules, PushRuleKind } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useAccountData } from '../../matrix/hooks/useAccountData';
import { useAlive } from '../../lib/hooks/useAlive';
import { SettingTile } from '../../ui/SettingTile';
import { AccountDataEvent } from '../../matrix/types/accountData';
import { getMxIdLocalPart } from '../../matrix/matrix';
import { ChoiceButton } from '../../ui/settings/ChoiceButton';
import { SettingsCard } from '../../ui/settings/SettingsCard';
import { actionsFor, loudnessOf, type Loudness } from './pushRuleLoudness';

const NOTIFY = 'featureUi.settings.notifications';

/** The account's global push rules as the server stores them, following changes. */
const useGlobalPushRules = (): IPushRules['global'] | undefined =>
  useAccountData(AccountDataEvent.PushRules)?.getContent<IPushRules>()?.global;

type RuleRef = { kind: PushRuleKind; rule: IPushRule; highlight: boolean };

/** Changes one rule's loudness, showing the new choice while the server takes it. */
function useLoudnessSetter({ kind, rule, highlight }: RuleRef) {
  const client = useMatrixClient();
  const alive = useAlive();
  const [pending, setPending] = useState<Loudness>();
  const [failed, setFailed] = useState(false);

  const choose = (next: Loudness) => {
    setPending(next);
    setFailed(false);
    const steps = async () => {
      await client.setPushRuleActions('global', kind, rule.rule_id, actionsFor(next, highlight));
      // A disabled default rule only notifies again once it is enabled.
      if (!rule.enabled && next !== 'off') {
        await client.setPushRuleEnabled('global', kind, rule.rule_id, true);
      }
    };
    steps()
      .catch(() => alive() && setFailed(true))
      .finally(() => alive() && setPending(undefined));
  };

  return { shown: pending ?? loudnessOf(rule), choose, failed };
}

function LoudnessChoice({
  label,
  value,
  onChoose,
}: {
  label: string;
  value: Loudness;
  onChoose: (next: Loudness) => void;
}) {
  const { t } = useTranslation();
  return (
    <ChoiceButton
      label={label}
      value={value}
      onChoose={onChoose}
      choices={[
        { value: 'off', label: t(`${NOTIFY}.mode.disable`) },
        { value: 'silent', label: t(`${NOTIFY}.mode.notifySilent`) },
        { value: 'loud', label: t(`${NOTIFY}.mode.notifyLoud`) },
      ]}
    />
  );
}

function FailedNote({ shown }: { shown: boolean }) {
  const { t } = useTranslation();
  return shown ? (
    <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
      {t('featureUi.settings.emojisStickers.globalPacks.failedToApplyChangesPleaseTryAgain')}
    </Text>
  ) : null;
}

/** One rule with its loudness picker. */
function RuleTile({
  focusId,
  title,
  ruleRef,
}: {
  focusId: string;
  title: string;
  ruleRef: RuleRef;
}) {
  const { shown, choose, failed } = useLoudnessSetter(ruleRef);
  return (
    <SettingTile
      focusId={focusId}
      title={title}
      after={<LoudnessChoice label={title} value={shown} onChoose={choose} />}
    >
      <FailedNote shown={failed} />
    </SettingTile>
  );
}

/** A push rule's row; `focusId` names its setting in the settings registry. */
type RuleRow = {
  id: string;
  focusId: string;
  kind: PushRuleKind;
  title: string;
  highlight: boolean;
};

/** The rows whose rule the server has; a server may leave out some default rules. */
const presentRows = (global: IPushRules['global'] | undefined, rows: RuleRow[]) =>
  rows.flatMap((row) => {
    const rule = global?.[row.kind]?.find((candidate) => candidate.rule_id === row.id);
    return rule ? [{ row, rule }] : [];
  });

function RuleSection({ title, rows }: { title: string; rows: RuleRow[] }) {
  const global = useGlobalPushRules();
  const present = presentRows(global, rows);
  if (present.length === 0) return null;

  return (
    <Box direction="Column" gap="100">
      <Text size="L400" data-settings-heading="">
        {title}
      </Text>
      <SettingsCard>
        {present.map(({ row, rule }) => (
          <RuleTile
            key={row.id}
            focusId={row.focusId}
            title={row.title}
            ruleRef={{ kind: row.kind, rule, highlight: row.highlight }}
          />
        ))}
      </SettingsCard>
    </Box>
  );
}

/** Account defaults for direct chats and rooms, encrypted or not. */
export function AllMessagesNotifications() {
  const { t } = useTranslation();
  const key = `${NOTIFY}.allMessages`;
  const defaults: [id: string, focusId: string, title: string][] = [
    ['.m.rule.room_one_to_one', 'notifyDirect', t(`${key}.1To1Chats`)],
    ['.m.rule.encrypted_room_one_to_one', 'notifyDirectEncrypted', t(`${key}.1To1ChatsEncrypted`)],
    ['.m.rule.message', 'notifyRooms', t(`${key}.rooms`)],
    ['.m.rule.encrypted', 'notifyRoomsEncrypted', t(`${key}.roomsEncrypted`)],
  ];
  const rows: RuleRow[] = defaults.map(([id, focusId, title]) => ({
    id,
    focusId,
    title,
    kind: PushRuleKind.Underride,
    highlight: false,
  }));

  return <RuleSection title={t(`${key}.allMessages`)} rows={rows} />;
}

/** Mentions of this account, of the whole room, and the legacy name rules. */
export function SpecialMessagesNotifications() {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const userId = client.getSafeUserId();
  const key = `${NOTIFY}.specialMessages`;
  const override = PushRuleKind.Override;
  const rows: RuleRow[] = [
    {
      id: '.m.rule.is_user_mention',
      focusId: 'notifyUserMention',
      kind: override,
      title: t(`${key}.mentionUserId`, { userId }),
      highlight: true,
    },
    {
      id: '.m.rule.contains_display_name',
      focusId: 'notifyDisplayName',
      kind: override,
      title: t(`${key}.containsDisplayNameGeneric`),
      highlight: true,
    },
    {
      id: '.m.rule.contains_user_name',
      focusId: 'notifyUsername',
      kind: PushRuleKind.ContentSpecific,
      title: t(`${key}.containsUsername`, { username: getMxIdLocalPart(userId) ?? userId }),
      highlight: true,
    },
    {
      id: '.m.rule.is_room_mention',
      focusId: 'notifyRoomMention',
      kind: override,
      title: t(`${key}.mentionRoom`),
      highlight: true,
    },
    {
      id: '.m.rule.roomnotif',
      focusId: 'notifyRoomText',
      kind: override,
      title: t(`${key}.containsRoom`),
      highlight: true,
    },
  ];

  return <RuleSection title={t(`${key}.specialMessages`)} rows={rows} />;
}

function KeywordTile({ rule }: { rule: IPushRule }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const ruleRef = { kind: PushRuleKind.ContentSpecific, rule, highlight: true };
  const { shown, choose, failed } = useLoudnessSetter(ruleRef);
  const [removing, setRemoving] = useState(false);
  const [removeFailed, setRemoveFailed] = useState(false);
  const keyword = rule.pattern ?? rule.rule_id;
  const removeLabel = `${t(`${NOTIFY}.keywordMessages.remove`)} ${keyword}`;

  const remove = () => {
    setRemoving(true);
    setRemoveFailed(false);
    client.deletePushRule('global', PushRuleKind.ContentSpecific, rule.rule_id).catch(() => {
      if (!alive()) return;
      setRemoveFailed(true);
      setRemoving(false);
    });
  };

  return (
    <SettingTile
      title={keyword}
      after={
        <Box gap="200" alignItems="Center">
          <LoudnessChoice label={keyword} value={shown} onChoose={choose} />
          <IconButton
            size="300"
            radii="300"
            variant="Critical"
            fill="None"
            aria-label={removeLabel}
            disabled={removing}
            onClick={remove}
          >
            {removing ? <Spinner size="50" /> : <Icon size="100" src={Icons.Delete} />}
          </IconButton>
        </Box>
      }
    >
      <FailedNote shown={failed || removeFailed} />
    </SettingTile>
  );
}

/** Words that notify wherever they appear (content rules the person added). */
export function KeywordNotifications() {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const global = useGlobalPushRules();
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [failed, setFailed] = useState(false);
  const key = `${NOTIFY}.keywordMessages`;
  // Server default rules start with a dot; the rest are the person's keywords.
  const keywords = (global?.content ?? []).filter((rule) => !rule.rule_id.startsWith('.'));
  const keyword = draft.trim();
  const canAdd = keyword !== '' && !keywords.some((rule) => rule.rule_id === keyword);

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canAdd) return;
    setAdding(true);
    setFailed(false);
    client
      .addPushRule('global', PushRuleKind.ContentSpecific, keyword, {
        pattern: keyword,
        actions: actionsFor('loud', true),
      })
      .then(() => alive() && setDraft(''))
      .catch(() => alive() && setFailed(true))
      .finally(() => alive() && setAdding(false));
  };

  return (
    <Box direction="Column" gap="100">
      <Text size="L400" data-settings-heading="">
        {t(`${key}.keywordMessages`)}
      </Text>
      <SettingsCard>
        <SettingTile
          focusId="notifyKeywords"
          title={t(`${key}.selectKeyword`)}
          description={t(`${key}.setANotificationPreferenceForMessageContaining`)}
        >
          <Box as="form" gap="200" alignItems="Center" onSubmit={add}>
            <Box grow="Yes" direction="Column">
              <Input
                aria-label={t(`${key}.selectKeyword`)}
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                variant="Background"
                size="300"
                radii="300"
                autoComplete="off"
              />
            </Box>
            <Button
              type="submit"
              size="300"
              radii="300"
              variant="Primary"
              fill="Soft"
              disabled={!canAdd || adding}
              before={adding ? <Spinner size="50" variant="Primary" /> : undefined}
            >
              <Text size="B300">{t(`${key}.save`)}</Text>
            </Button>
          </Box>
          <FailedNote shown={failed} />
        </SettingTile>
        {keywords.map((rule) => (
          <KeywordTile key={rule.rule_id} rule={rule} />
        ))}
      </SettingsCard>
    </Box>
  );
}
