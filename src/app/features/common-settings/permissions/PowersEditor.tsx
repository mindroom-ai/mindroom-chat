import React, { FormEventHandler, useMemo, useState } from 'react';
import { Box, Button, Chip, Icon, IconButton, Icons, Input, Spinner, Text, config } from 'folds';
import { useTranslation } from 'react-i18next';
import { Page, PageContent, PageHeader, PageScroll } from '../../../components/page';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { useRoom } from '../../../hooks/useRoom';
import { useStateEvent } from '../../../hooks/useStateEvent';
import type { IPowerLevels } from '../../../hooks/usePowerLevels';
import {
  readPowerLevelTags,
  type PowerLevelTag,
  type PowerLevelTags,
} from '../../../hooks/usePowerLevelTags';
import { StateEvent } from '../../../../types/matrix/room';
import { SequenceCardStyle } from '../styles.css';




};

/** An edit the user made: a new or changed tag, or `null` for a removed one. */
type TagEdits = Map<number, PowerLevelTag | null>;

const DEFAULT_TAG_KEYS = {
  100: 'sharedUi.powerLevels.admin',
  50: 'sharedUi.powerLevels.moderator',
  0: 'sharedUi.powerLevels.member',
} as const;

const applyEdits = (base: PowerLevelTags, edits: TagEdits): PowerLevelTags => {
  const next: PowerLevelTags = { ...base };
  edits.forEach((tag, level) => {
    if (tag) next[level] = tag;
    else delete next[level];
  });
  return next;
};

/**
 * Names for power levels in this room. Defaults show in the app language but
 * are never written; saving applies only the user's edits on top of the
 * room's latest stored tags, so concurrent changes by others survive.
 */




  const storedTags = readPowerLevelTags(
    useStateEvent(room, StateEvent.PowerLevelTags)?.getContent()
  );
  const [edits, setEdits] = useState<TagEdits>(() => new Map());
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  const shownTags = useMemo(() => {
    const defaults: PowerLevelTags = {};
    (Object.keys(DEFAULT_TAG_KEYS) as unknown as Array<keyof typeof DEFAULT_TAG_KEYS>).forEach(
      (level) => {
        defaults[Number(level)] = { name: t(DEFAULT_TAG_KEYS[level]) };
      }
    );
    const tags = applyEdits({ ...defaults, ...storedTags }, edits);
    return Object.entries(tags)
      .map(([level, tag]) => [Number(level), tag] as const)
      .sort(([a], [b]) => b - a);
  }, [t, storedTags, edits]);

  const usedLevels = useMemo(() => {
    const levels = new Set<number>();
    Object.values(powerLevels.users ?? {}).forEach((level) => levels.add(level));
    return levels;
  }, [powerLevels.users]);

  const setEdit = (level: number, tag: PowerLevelTag | null) =>
    setEdits((current) => new Map(current).set(level, tag));

  const handleCreate: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const target = event.target as HTMLFormElement & {
      powerInput: HTMLInputElement;
      nameInput: HTMLInputElement;
    };
    const level = Number(target.powerInput.value);
    const name = target.nameInput.value.trim();
    if (!Number.isInteger(level) || !name) return;
    setEdit(level, { name, color: undefined, icon: undefined });
    setCreating(false);
  };

  const handleApply = async () => {
    setSaving(true);
    setSaveFailed(false);
    try {
      await mx.sendStateEvent(
        room.roomId,
        StateEvent.PowerLevelTags as never,
        applyEdits(storedTags, edits) as never
      );
      setEdits(new Map());
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page>
      <PageScroll
        header={
          <PageHeader outlined={false} balance>
            <Box grow="Yes" gap="200" alignItems="Center">
              <IconButton
                size="300"
                radii="300"
                onClick={requestClose}
                aria-label={t('featureUi.commonSettings.permissions.powersEditor.back')}
              >
                <Icon src={Icons.ArrowLeft} />
              </IconButton>
              <Text size="H3" truncate>
                {t('featureUi.commonSettings.permissions.powersEditor.title')}
              </Text>
            </Box>
          </PageHeader>
        }






              </Text>
              <SequenceCard
                className={SequenceCardStyle}
                variant="SurfaceVariant"
                direction="Column"
                gap="400"
              >
                <SettingTile
                  title={t('featureUi.commonSettings.permissions.powersEditor.description')}
                  after={
                    !creating && (
                      <Button
                        size="300"
                        variant="Secondary"
                        fill="Soft"
                        radii="300"
                        onClick={() => setCreating(true)}
                      >
                        <Text size="B300">
                          {t('featureUi.commonSettings.permissions.powersEditor.create')}
                        </Text>
                      </Button>
                    )
                  }
                />
                {creating && (
                  <Box as="form" onSubmit={handleCreate} gap="200" alignItems="End">
                    <Box direction="Column" gap="100">
                      <Text size="L400">
                        {t('featureUi.commonSettings.permissions.powersEditor.level')}
                      </Text>
                      <Input
                        name="powerInput"
                        type="number"
                        size="300"
                        radii="300"
                        required
                        style={{ width: '6rem' }}
                      />
                    </Box>
                    <Box grow="Yes" direction="Column" gap="100">
                      <Text size="L400">
                        {t('featureUi.commonSettings.permissions.powersEditor.name')}
                      </Text>
                      <Input name="nameInput" size="300" radii="300" required />
                    </Box>
                    <Button type="submit" size="300" variant="Success" radii="300">
                      <Text size="B300">
                        {t('featureUi.commonSettings.permissions.powersEditor.save')}
                      </Text>
                    </Button>
                    <IconButton
                      size="300"
                      radii="300"
                      onClick={() => setCreating(false)}
                      aria-label={t('featureUi.commonSettings.permissions.powersEditor.cancel')}
                    >
                      <Icon src={Icons.Cross} />
                    </IconButton>
                  </Box>
                )}
                {shownTags.map(([level, tag]) => (
                  <SettingTile
                    key={level}
                    title={tag.name}
                    description={t('featureUi.commonSettings.permissions.powersEditor.levelValue', {
                      level,
                    })}
                    after={
                      <Box gap="200" alignItems="Center">
                        <Chip
                          variant="Critical"
                          radii="Pill"
                          disabled={usedLevels.has(level)}
                          aria-label={t(
                            'featureUi.commonSettings.permissions.powersEditor.remove',
                            {
                              name: tag.name,
                            }
                          )}
                          onClick={() => setEdit(level, null)}
                          before={<Icon size="50" src={Icons.Delete} />}
                        />
                      </Box>
                    }
                  />
                ))}
              </SequenceCard>
            </Box>
            <Box gap="200" alignItems="Center">
              <Button
                variant="Success"
                radii="300"
                disabled={edits.size === 0 || saving}
                onClick={handleApply}
                before={saving ? <Spinner size="100" variant="Success" /> : undefined}
              >
                <Text size="B300">
                  {t('featureUi.commonSettings.permissions.powersEditor.applyChanges')}
                </Text>
              </Button>
              {saveFailed && (
                <Text size="T200" style={{ paddingInline: config.space.S200 }}>
                  {t('featureUi.commonSettings.permissions.powersEditor.saveFailed')}
                </Text>
              )}
            </Box>
          </Box>
        </PageContent>
      </PageScroll>
    </Page>
  );
}
