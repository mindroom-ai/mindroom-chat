import { Capacitor, registerPlugin } from '@capacitor/core';
import { randomUuid } from '../lib/randomUuid';

type NativeVoiceLeftover = {
  id: string;
  path: string;
  startedAt: number;
  duration: number;
  userId: string;
};
type RecordingId = { id: string };
type MindRoomVoiceRecorderPlugin = {
  start(options: { nonce: string; userId: string }): Promise<RecordingId>;
  level(options: RecordingId): Promise<{ level: number }>;
  pause(options: RecordingId): Promise<void>;
  resume(options: RecordingId): Promise<void>;
  stop(options: RecordingId): Promise<{ path: string }>;
  cancel(options: RecordingId): Promise<void>;
  clear(options: { userId: string }): Promise<void>;
  listLeftovers(): Promise<{ recordings: NativeVoiceLeftover[] }>;
};

const START_ERROR_NAMES: Record<string, string> = {
  PERMISSION_DENIED: 'NotAllowedError',
  NO_MICROPHONE: 'NotFoundError',
};

let voiceRecorderPlugin: MindRoomVoiceRecorderPlugin | undefined;
const getVoiceRecorderPlugin = () =>
  (voiceRecorderPlugin ??= registerPlugin<MindRoomVoiceRecorderPlugin>('MindRoomVoiceRecorder'));

export const isNativeVoiceRecorderAvailable = (): boolean =>
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'ios' &&
  Capacitor.isPluginAvailable('MindRoomVoiceRecorder');

export const clearNativeVoiceRecordings = async (userId: string): Promise<void> => {
  if (isNativeVoiceRecorderAvailable()) await getVoiceRecorderPlugin().clear({ userId });
};

export const listNativeVoiceLeftovers = () => getVoiceRecorderPlugin().listLeftovers();
export const cancelNativeVoiceRecording = (id: string) => getVoiceRecorderPlugin().cancel({ id });

export const readNativeVoiceFile = async (path: string): Promise<Blob | undefined> => {
  const response = await fetch(Capacitor.convertFileSrc(path), {
    signal: AbortSignal.timeout(5_000),
  });
  // Capacitor answers a local media file without an HTTP status, which WebKit reports as 0.
  if (!response.ok && response.status !== 0) return undefined;
  const data = await response.blob();
  return data.size > 0 ? data : undefined;
};

/** The part of `MediaRecorder` the voice capture session drives, over the native recorder. */
export class NativeVoiceRecorder extends EventTarget {
  state: 'inactive' | 'recording' | 'paused' = 'recording';

  readonly mimeType = 'audio/mp4';

  private newestLevel = 0;

  constructor(readonly id: string) {
    super();
  }

  /** The level the native recorder answered last, 0 before the first; asks it for the next. */
  level(): number {
    if (this.state === 'recording') {
      getVoiceRecorderPlugin()
        .level({ id: this.id })
        .then(
          ({ level }) => {
            this.newestLevel = level;
          },
          () => undefined
        );
    }
    return this.newestLevel;
  }

  pause(): void {
    this.transition('paused', (plugin) => plugin.pause({ id: this.id }));
  }

  resume(): void {
    this.transition('recording', (plugin) => plugin.resume({ id: this.id }));
  }

  /** Raises `dataavailable` (an Event with `data: Blob`) when there is audio, then `stop`. */
  stop(): void {
    if (this.state === 'inactive') return;
    this.state = 'inactive';
    this.deliver().then(
      () => this.end(),
      (error: { code?: string }) => this.end(error)
    );
  }

  private transition(
    state: 'recording' | 'paused',
    call: (plugin: MindRoomVoiceRecorderPlugin) => Promise<void>
  ): void {
    if (this.state === 'inactive') return;
    this.state = state;
    call(getVoiceRecorderPlugin()).catch((error: { code?: string }) => {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      this.end(error);
    });
  }

  private async deliver(): Promise<void> {
    const { path } = await getVoiceRecorderPlugin().stop({ id: this.id });
    const data = await readNativeVoiceFile(path);
    if (data) this.dispatchEvent(Object.assign(new Event('dataavailable'), { data }));
  }

  private end(error?: { code?: string }): void {
    // A reload may already have finalized the file. Leave it for recovery.
    if (error?.code !== 'NOT_RECORDING') cancelNativeVoiceRecording(this.id).catch(() => undefined);
    this.dispatchEvent(new Event('stop'));
  }
}

/** Asks for the microphone and starts recording. Rejects with an Error named as getUserMedia
 *  names it. */
export const startNativeVoiceRecorder = async (userId: string): Promise<NativeVoiceRecorder> => {
  // The plugin reads this name back from the page after the microphone prompt, and records only
  // for the newest start of the page that is still loaded.
  const nonce = randomUuid();
  Object.assign(globalThis, { mindroomVoiceStart: nonce });
  try {
    const { id } = await getVoiceRecorderPlugin().start({ nonce, userId });
    return new NativeVoiceRecorder(id);
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    throw Object.assign(new Error(message), {
      name: START_ERROR_NAMES[code ?? ''] ?? 'NotReadableError',
    });
  }
};
