import { FormEvent, ReactNode, useId, useState } from 'react';
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
import { SequenceCard } from '../../ui/SequenceCard';
import { SettingTile } from '../../ui/SettingTile';
import { CreateRoomAccess } from '../../matrix/createRoomTypes';
import { createRoom } from '../../matrix/createRoom';
import { CreateRoomAccessSelector } from './CreateRoomAccessSelector';
import { CreateRoomAliasInput } from './CreateRoomAliasInput';
import { RoomVersionSelector } from './RoomVersionSelector';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useCapabilities } from '../../matrix/hooks/useCapabilities';
import { useClientConfig } from '../../config/useClientConfig';
import { RoomType } from '../../matrix/types/room';
import { describeError } from '../../lib/describeError';
import { ErrorDetail } from '../../ui/ErrorDetail';

type RoomCreatedHandler = (roomId: string) => void;

type CreateRoomFormProps = {
  /** Whether the form creates a room (the default) or a space. */
  kind?: 'room' | 'space';
  defaultAccess?: CreateRoomAccess;
  onCreate?: RoomCreatedHandler;
  /** The space the new room or subspace joins, if any. */
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
  /** The ID of the one field the label is for; without it the label names a group of controls. */
  fieldId?: string;
  children: ReactNode;
};

function LabeledField({ label, fieldId, children }: LabeledFieldProps) {
  const labelId = useId();
  if (fieldId) {
    return (
      <Box direction="Column" gap="100">
        <Text as="label" htmlFor={fieldId} size="L400">
          {label}
        </Text>
        {children}
      </Box>
    );
  }
  return (
    <Box direction="Column" gap="100" role="group" aria-labelledby={labelId}>
      <Text id={labelId} size="L400">
        {label}
      </Text>
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
  const toggle = (
    <Switch
      variant="Primary"
      value={value}
      onChange={onChange}
      disabled={disabled}
      aria-label={title}
    />
  );
  return (
    <SequenceCard variant="SurfaceVariant" direction="Column" gap="300" style={OPTION_CARD_STYLE}>
      <SettingTile title={title} description={description} after={toggle} />
    </SequenceCard>
  );
}

const optionalValue = (field?: HTMLInputElement | HTMLTextAreaElement): string | undefined =>
  field?.value.trim() || undefined;

/**
 * The form that creates a room or a space. Deployments can hide the encryption and federation
 * choices and preset them; public rooms are never encrypted, since anyone can read them anyway,
 * and spaces never are, since they hold no messages.
 */
export function CreateRoomForm({
  kind = 'room',
  defaultAccess,
  space,
  onCreate,
}: CreateRoomFormProps) {
  const { t } = useTranslation();
  const isSpace = kind === 'space';
  const strings = isSpace ? 'featureUi.createSpace' : 'featureUi.createRoom';
  const nameId = useId();
  const topicId = useId();
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
  const [error, setError] = useState<{ reason: unknown }>();

  const isPublic = access === CreateRoomAccess.Public;
  const encryptable = !isSpace && !isPublic;
  const encryptionToggleVisible = encryptable && (policy?.showEncryptionOption ?? true);
  const federationToggleVisible = policy?.showFederationOption ?? true;

  const submitRoom = async (form: CreateRoomFormElements) => {
    const name = form.nameInput?.value.trim();
    if (!name || creating) return;

    setError(undefined);
    setCreating(true);
    try {
      const createdRoomId = await createRoom(client, {
        type: isSpace ? RoomType.Space : undefined,
        version,
        parent: space,
        access,
        name,
        topic: optionalValue(form.topicTextAria),
        aliasLocalPart: isPublic ? optionalValue(form.aliasInput) : undefined,
        encryption: encryptable && encryption,
        knock: !isPublic && knock,
        allowFederation: federation,
      });
      onCreate?.(createdRoomId);
    } catch (reason) {
      setError({ reason });
    } finally {
      setCreating(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
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
      title: t(`${strings}.knockToJoin`),
      description: t(`${strings}.anyoneCanSendRequestToJoinThis`),
      value: knock,
      onChange: setKnock,
    },
    {
      id: 'federation',
      visible: federationToggleVisible,
      title: t(`${strings}.allowFederation`),
      description: t(`${strings}.usersFromOtherServersCanJoin`),
      value: federation,
      onChange: setFederation,
    },
  ];

  const spinner = <Spinner variant="Primary" fill="Solid" size="200" />;
  const chevron = advanced ? Icons.ChevronTop : Icons.ChevronBottom;

  return (
    <Box
      as="form"
      grow="Yes"
      direction="Column"
      gap="500"
      onSubmit={(event: FormEvent<HTMLFormElement>) => void handleSubmit(event)}
    >
      <LabeledField label={t(`${strings}.access`)}>
        <CreateRoomAccessSelector
          value={access}
          canRestrict={Boolean(space)}
          disabled={creating}
          onSelect={setAccess}
        />
      </LabeledField>
      <LabeledField label={t(`${strings}.name`)} fieldId={nameId}>
        <Input
          id={nameId}
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
      <LabeledField label={t(`${strings}.topicOptional`)} fieldId={topicId}>
        <TextArea
          id={topicId}
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
      <LabeledField label={t(`${strings}.options`)}>
        <Box direction="Column" gap="200">
          {optionToggles.map(({ id, visible, ...toggle }) =>
            visible ? <OptionToggle key={id} disabled={creating} {...toggle} /> : null
          )}
          <Box>
            {/* A button in a form submits it unless told otherwise. */}
            <Chip
              type="button"
              radii="Pill"
              aria-expanded={advanced}
              variant={advanced ? 'Success' : 'SurfaceVariant'}
              before={<Icon size="50" src={chevron} />}
              onClick={() => setAdvanced((open) => !open)}
            >
              <Text size="T200">{t(`${strings}.advancedOptions`)}</Text>
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
        <Text size="T300" role="alert" style={{ color: color.Critical.Main }}>
          {describeError(t, error.reason)}
          <ErrorDetail error={error.reason} />
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
          <Text size="B500">{t(`${strings}.create`)}</Text>
        </Button>
      </Box>
    </Box>
  );
}
