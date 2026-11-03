import React, { FormEventHandler, ReactNode, useState } from 'react';
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
import type { Room } from 'matrix-js-sdk';
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

type RoomCreatedHandler = (roomId: string) => void;

type CreateRoomFormProps = {
  defaultAccess?: CreateRoomAccess;
  onCreate?: RoomCreatedHandler;
  /** The space the new room joins, if any. */
  space?: Room;
};

type CreateRoomFormElements = HTMLFormElement & {
  nameInput?: HTMLInputElement;
  topicTextAria?: HTMLTextAreaElement;
  aliasInput?: HTMLInputElement;
};

const DEFAULT_ROOM_VERSION = '10';

const OPTION_CARD_STYLE = { padding: '12px' };

type LabeledFieldProps = {
  label: string;
  children: ReactNode;
};

function LabeledField({ label, children }: LabeledFieldProps) {
  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{label}</Text>
      {children}
    </Box>
  );
}

type OptionToggleProps = {
  title: string;
  description: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled: boolean;
};

/** An option switch of the form; hidden ones are skipped. */
type OptionToggleSpec = Omit<OptionToggleProps, 'disabled'> & { id: string; visible: boolean };

function OptionToggle({ title, description, value, onChange, disabled }: OptionToggleProps) {
  const toggle = <Switch variant="Primary" value={value} onChange={onChange} disabled={disabled} />;
  return (
    <SequenceCard variant="SurfaceVariant" direction="Column" gap="300" style={OPTION_CARD_STYLE}>
      <SettingTile title={title} description={description} after={toggle} />
    </SequenceCard>
  );
}

const optionalValue = (field?: HTMLInputElement | HTMLTextAreaElement): string | undefined =>
  field?.value.trim() || undefined;

const describeError = (reason: unknown): string =>
  reason instanceof Error ? reason.message : String(reason);

/**
 * The create room form. Deployments can hide the encryption and federation
 * choices and preset them; public rooms are never encrypted, since anyone can
 * read them anyway.
 */
export function CreateRoomForm({ defaultAccess, space, onCreate }: CreateRoomFormProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const capabilities = useCapabilities();
  const { createRoom: policy } = useClientConfig();
  const roomVersions = capabilities['m.room_versions'];
  const versions = Object.keys(roomVersions?.available ?? {});

  const initialAccess =
    defaultAccess ?? (space ? CreateRoomAccess.Restricted : CreateRoomAccess.Private);
  const [access, setAccess] = useState<CreateRoomAccess>(initialAccess);
  const [encryption, setEncryption] = useState(policy?.defaultEncryption ?? true);
  const [federation, setFederation] = useState(policy?.defaultFederation ?? true);
  const [knock, setKnock] = useState(false);
  const [version, setVersion] = useState(roomVersions?.default ?? DEFAULT_ROOM_VERSION);
  const [advanced, setAdvanced] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string>();

  const isPublic = access === CreateRoomAccess.Public;
  const encryptionToggleVisible = !isPublic && (policy?.showEncryptionOption ?? true);
  const federationToggleVisible = policy?.showFederationOption ?? true;

  const submitRoom = async (form: CreateRoomFormElements) => {
    const name = form.nameInput?.value.trim();
    if (!name) return;

    setError(undefined);
    setCreating(true);
    try {
      const createdRoomId = await createRoom(client, {
        version,
        parent: space,
        access,
        name,
        topic: optionalValue(form.topicTextAria),
        aliasLocalPart: isPublic ? optionalValue(form.aliasInput) : undefined,
        encryption: !isPublic && encryption,
        knock: !isPublic && knock,
        allowFederation: federation,
      });
      onCreate?.(createdRoomId);
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setCreating(false);
    }
  };

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    return submitRoom(event.currentTarget as CreateRoomFormElements);
  };

  const optionToggles: OptionToggleSpec[] = [
    {
      id: 'encryption',
      visible: encryptionToggleVisible,
      title: t('featureUi.createRoom.endToEndEncryption'),
      description: t('featureUi.createRoom.onceThisFeatureIsEnabledItCan'),
      value: encryption,
      onChange: setEncryption,
    },
    {
      id: 'knock',
      visible: !isPublic,
      title: t('featureUi.createRoom.knockToJoin'),
      description: t('featureUi.createRoom.anyoneCanSendRequestToJoinThis'),
      value: knock,
      onChange: setKnock,
    },
    {
      id: 'federation',
      visible: federationToggleVisible,
      title: t('featureUi.createRoom.allowFederation'),
      description: t('featureUi.createRoom.usersFromOtherServersCanJoin'),
      value: federation,
      onChange: setFederation,
    },
  ];

  const spinner = <Spinner variant="Primary" fill="Solid" size="200" />;
  const chevron = advanced ? Icons.ChevronTop : Icons.ChevronBottom;

  return (
    <Box as="form" grow="Yes" direction="Column" gap="500" onSubmit={handleSubmit}>
      <LabeledField label={t('featureUi.createRoom.access')}>
        <CreateRoomAccessSelector
          value={access}
          canRestrict={Boolean(space)}
          disabled={creating}
          onSelect={setAccess}
        />
      </LabeledField>
      <LabeledField label={t('featureUi.createRoom.name')}>
        <Input
          name="nameInput"
          variant="SurfaceVariant"
          size="500"
          radii="400"
          autoComplete="off"
          autoFocus
          required
          disabled={creating}
        />
      </LabeledField>
      <LabeledField label={t('featureUi.createRoom.topicOptional')}>
        <TextArea
          name="topicTextAria"
          variant="SurfaceVariant"
          size="500"
          radii="400"
          disabled={creating}
        />
      </LabeledField>
      {isPublic ? (
        <LabeledField label={t('sharedUi.createRoomAliasInput.addressOptional')}>
          <CreateRoomAliasInput disabled={creating} />
        </LabeledField>
      ) : null}
      <LabeledField label={t('featureUi.createRoom.options')}>
        <Box direction="Column" gap="200">
          {optionToggles.map(({ id, visible, ...toggle }) =>
            visible ? <OptionToggle key={id} disabled={creating} {...toggle} /> : null
          )}
          <Box>
            <Chip
              radii="Pill"
              variant={advanced ? 'Success' : 'SurfaceVariant'}
              before={<Icon size="50" src={chevron} />}
              onClick={() => setAdvanced((open) => !open)}
            >
              <Text size="T200">{t('featureUi.createRoom.advancedOptions')}</Text>
            </Chip>
          </Box>
          {advanced ? (
            <RoomVersionSelector
              value={version}
              versions={versions.length === 0 ? [version] : versions}
              disabled={creating}
              onChange={setVersion}
            />
          ) : null}
        </Box>
      </LabeledField>
      {error ? (
        <Text size="T300" style={{ color: color.Critical.Main }}>
          {error}
        </Text>
      ) : null}
      <Box direction="Column" shrink="No">
        <Button
          type="submit"
          variant="Primary"
          size="500"
          radii="400"
          disabled={creating}
          before={creating ? spinner : undefined}
        >
          <Text size="B500">{t('featureUi.createRoom.create')}</Text>
        </Button>
      </Box>
    </Box>
  );
}
