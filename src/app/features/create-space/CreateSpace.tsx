import { FormEvent, ReactNode, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Icon,
  Icons,
  Input,
  Spinner,
  Switch,
  Text,
  TextArea,
  color,
} from 'folds';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { MatrixError, type Room } from 'matrix-js-sdk';
import { SequenceCard } from '../../components/sequence-card';
import { SettingTile } from '../../components/setting-tile';
import {
  CreateRoomAccess,
  CreateRoomAccessSelector,
  CreateRoomAliasInput,
  RoomVersionSelector,
  createRoom,
} from '../../components/create-room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useCapabilities } from '../../hooks/useCapabilities';
import { useClientConfig } from '../../hooks/useClientConfig';
import { RoomType } from '../../../types/matrix/room';
import { errorMessage } from '../../utils/errorMessage';

type CreateSpaceFormProps = {
  /** The space the new one is created in, as a subspace. */
  parent?: Room;
  onCreate?: (spaceId: string) => void;
};

/** The named fields of the form, as the submit event's target carries them. */
type SpaceFormFields = HTMLFormElement & {
  spaceName?: HTMLInputElement;
  spaceTopic?: HTMLTextAreaElement;
  aliasInput?: HTMLInputElement;
};

const FALLBACK_ROOM_VERSION = '10';
const SWITCH_CARD = { padding: '12px' };
const MINUTE_MS = 60_000;

/** A labelled part of the form: its caption above what it holds. */
function FormSection({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{caption}</Text>
      {children}
    </Box>
  );
}

type SwitchCardProps = {
  title: string;
  description: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  disabled: boolean;
};

/** One on/off option of the new space, in its own card. */
function SwitchCard({ title, description, checked, onToggle, disabled }: SwitchCardProps) {
  return (
    <SequenceCard variant="SurfaceVariant" direction="Column" gap="300" style={SWITCH_CARD}>
      <SettingTile
        title={title}
        description={description}
        after={
          <Switch
            variant="Primary"
            value={checked}
            onChange={onToggle}
            disabled={disabled}
            aria-label={title}
          />
        }
      />
    </SequenceCard>
  );
}

/** What went wrong, in words; a rate limit says how long to wait, rounded up to minutes. */
const explainFailure = (failure: unknown, t: TFunction): string => {
  if (failure instanceof MatrixError && failure.isRateLimitError()) {
    const waitMs = failure.getRetryAfterMs() ?? MINUTE_MS;
    return t('featureUi.createSpace.rateLimited', {
      count: Math.max(1, Math.ceil(waitMs / MINUTE_MS)),
    });
  }
  return errorMessage(failure);
};

/**
 * Creates a space: who may join it, its name, topic and (when public) address, knocking,
 * federation and the room version. Inside another space it can admit that space's members and
 * becomes one of its children. Spaces hold no messages, so they are never encrypted.
 */
export function CreateSpaceForm({ parent, onCreate }: CreateSpaceFormProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const roomVersions = useCapabilities()['m.room_versions'];
  const { createRoom: policy } = useClientConfig();
  const offeredVersions = Object.keys(roomVersions?.available ?? {});

  const [access, setAccess] = useState<CreateRoomAccess>(
    parent ? CreateRoomAccess.Restricted : CreateRoomAccess.Private
  );
  const [knock, setKnock] = useState(false);
  const [federate, setFederate] = useState(policy?.defaultFederation ?? true);
  const [version, setVersion] = useState(roomVersions?.default ?? FALLBACK_ROOM_VERSION);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string>();

  const isPublic = access === CreateRoomAccess.Public;
  const showFederation = policy?.showFederationOption ?? true;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fields = event.currentTarget as SpaceFormFields;
    const name = fields.spaceName?.value.trim();
    if (!name || busy) return;
    setFailure(undefined);
    setBusy(true);
    try {
      const spaceId = await createRoom(client, {
        type: RoomType.Space,
        name,
        topic: fields.spaceTopic?.value.trim() || undefined,
        aliasLocalPart: isPublic ? fields.aliasInput?.value.trim() || undefined : undefined,
        access,
        knock: !isPublic && knock,
        allowFederation: federate,
        encryption: false,
        version,
        parent,
      });
      onCreate?.(spaceId);
    } catch (reason) {
      setFailure(explainFailure(reason, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      as="form"
      grow="Yes"
      direction="Column"
      gap="500"
      onSubmit={(event: FormEvent<HTMLFormElement>) => void submit(event)}
    >
      <FormSection caption={t('featureUi.createSpace.access')}>
        <CreateRoomAccessSelector
          value={access}
          canRestrict={!!parent}
          disabled={busy}
          onSelect={setAccess}
        />
      </FormSection>
      <FormSection caption={t('featureUi.createSpace.name')}>
        <Input
          name="spaceName"
          aria-label={t('featureUi.createSpace.name')}
          variant="SurfaceVariant"
          size="500"
          radii="400"
          autoComplete="off"
          autoFocus
          required
          disabled={busy}
        />
      </FormSection>
      <FormSection caption={t('featureUi.createSpace.topicOptional')}>
        <TextArea
          name="spaceTopic"
          aria-label={t('featureUi.createSpace.topicOptional')}
          variant="SurfaceVariant"
          size="500"
          radii="400"
          disabled={busy}
        />
      </FormSection>
      {isPublic && (
        <FormSection caption={t('sharedUi.createRoomAliasInput.addressOptional')}>
          <CreateRoomAliasInput disabled={busy} />
        </FormSection>
      )}
      <FormSection caption={t('featureUi.createSpace.options')}>
        <Box direction="Column" gap="200">
          {!isPublic && (
            <SwitchCard
              title={t('featureUi.createSpace.knockToJoin')}
              description={t('featureUi.createSpace.anyoneCanSendRequestToJoinThis')}
              checked={knock}
              onToggle={setKnock}
              disabled={busy}
            />
          )}
          {showFederation && (
            <SwitchCard
              title={t('featureUi.createSpace.allowFederation')}
              description={t('featureUi.createSpace.usersFromOtherServersCanJoin')}
              checked={federate}
              onToggle={setFederate}
              disabled={busy}
            />
          )}
          <Box>
            <Chip
              radii="Pill"
              variant={showAdvanced ? 'Success' : 'SurfaceVariant'}
              aria-expanded={showAdvanced}
              before={
                <Icon size="50" src={showAdvanced ? Icons.ChevronTop : Icons.ChevronBottom} />
              }
              onClick={() => setShowAdvanced((shown) => !shown)}
            >
              <Text size="T200">{t('featureUi.createSpace.advancedOptions')}</Text>
            </Chip>
          </Box>
          {showAdvanced && (
            <RoomVersionSelector
              value={version}
              versions={offeredVersions.length > 0 ? offeredVersions : [version]}
              disabled={busy}
              onChange={setVersion}
            />
          )}
        </Box>
      </FormSection>
      {failure && (
        <Text size="T300" role="alert" style={{ color: color.Critical.Main }}>
          {failure}
        </Text>
      )}
      <Button
        type="submit"
        variant="Primary"
        size="500"
        radii="400"
        disabled={busy}
        before={busy ? <Spinner variant="Primary" fill="Solid" size="200" /> : undefined}
      >
        <Text size="B500">{t('featureUi.createSpace.create')}</Text>
      </Button>
    </Box>
  );
}
