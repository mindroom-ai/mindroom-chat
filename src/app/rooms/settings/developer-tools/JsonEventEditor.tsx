import { type FormEvent, useState } from 'react';
import { Box, Button, Input, Spinner, Text, TextArea, color, config } from 'folds';
import { useTranslation } from 'react-i18next';
import { useAlive } from '../../../lib/hooks/useAlive';
import { describeError } from '../../../lib/describeError';
import { ErrorDetail } from '../../../ui/ErrorDetail';

const SEND = 'featureUi.commonSettings.developerTools.sendRoomEvent';
const EDITOR = 'featureUi.commonSettings.developerTools.stateEventEditor';

/** What the editor writes: a message event, a state event, or room account data. */
export type JsonEventKind = 'message' | 'state' | 'accountData';

export type JsonEventDraft = { type: string; stateKey: string; content: Record<string, unknown> };

type JsonEventEditorProps = {
  kind: JsonEventKind;
  /** Set when editing an existing event: its type and state key are then fixed. */
  initial?: { type: string; stateKey?: string; content: object };
  onSubmit: (draft: JsonEventDraft) => Promise<unknown>;
  onDone: () => void;
};

const TYPE_LABEL: Record<JsonEventKind, string> = {
  message: `${SEND}.messageEventType`,
  state: `${SEND}.stateEventType`,
  accountData: 'sharedUi.accountDataEditor.accountData',
};

/** Reads the textarea as a JSON object; anything else is a mistake to show. */
const parseObject = (text: string): Record<string, unknown> | undefined => {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * A form for developers to write a raw event: its type (and state key for state), and its JSON
 * content. Invalid JSON and refusals from the server stay in the form, with the reason.
 */
export function JsonEventEditor({ kind, initial, onSubmit, onDone }: JsonEventEditorProps) {
  const { t } = useTranslation();
  const alive = useAlive();
  const [type, setType] = useState(initial?.type ?? '');
  const [stateKey, setStateKey] = useState(initial?.stateKey ?? '');
  const [json, setJson] = useState(() => JSON.stringify(initial?.content ?? {}, null, 2));
  const [busy, setBusy] = useState(false);
  // Invalid JSON is caught here; anything else is what the server answered.
  const [problem, setProblem] = useState<'invalidJson' | { error: unknown }>();
  const fixed = initial !== undefined;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = parseObject(json);
    if (!type.trim() || !content) {
      setProblem('invalidJson');
      return;
    }
    setBusy(true);
    setProblem(undefined);
    onSubmit({ type: type.trim(), stateKey, content })
      .then(() => alive() && onDone())
      .catch((error: unknown) => {
        if (!alive()) return;
        setProblem({ error });
      })
      .finally(() => alive() && setBusy(false));
  };

  const field = (label: string, value: string, onChange: (next: string) => void) => (
    <Box direction="Column" gap="100">
      <Text size="L400">{label}</Text>
      <Input
        aria-label={label}
        value={value}
        onChange={(evt) => onChange(evt.currentTarget.value)}
        readOnly={fixed}
        disabled={busy}
        variant="Background"
        size="300"
        radii="300"
        spellCheck={false}
        autoComplete="off"
      />
    </Box>
  );

  return (
    <Box
      as="form"
      direction="Column"
      gap="300"
      onSubmit={submit}
      style={{ paddingTop: config.space.S200 }}
    >
      {field(t(TYPE_LABEL[kind] as never), type, setType)}
      {kind === 'state' && field(t(`${SEND}.stateKeyOptional`), stateKey, setStateKey)}
      <Box direction="Column" gap="100">
        <Text size="L400">{t(`${SEND}.jsonContent`)}</Text>
        <TextArea
          aria-label={t(`${SEND}.jsonContent`)}
          value={json}
          onChange={(evt) => setJson(evt.currentTarget.value)}
          disabled={busy}
          variant="Background"
          radii="300"
          rows={8}
          spellCheck={false}
          style={{ fontFamily: 'monospace' }}
        />
      </Box>
      {problem && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {problem === 'invalidJson' ? (
            t('featureUi.commonSettings.developerTools.invalidJson')
          ) : (
            <>
              {describeError(t, problem.error)}
              <ErrorDetail error={problem.error} />
            </>
          )}
        </Text>
      )}
      <Box gap="200">
        <Button
          type="submit"
          size="300"
          radii="300"
          variant="Primary"
          disabled={busy}
          before={busy ? <Spinner size="50" variant="Primary" fill="Solid" /> : undefined}
        >
          <Text size="B300">{t(kind === 'message' ? `${SEND}.send` : `${EDITOR}.save`)}</Text>
        </Button>
        <Button
          type="button"
          size="300"
          radii="300"
          variant="Secondary"
          fill="Soft"
          disabled={busy}
          onClick={onDone}
        >
          <Text size="B300">{t(`${EDITOR}.cancel`)}</Text>
        </Button>
      </Box>
    </Box>
  );
}
