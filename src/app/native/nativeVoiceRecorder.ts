import { Capacitor, registerPlugin } from '@capacitor/core';
import { randomUuid } from '../lib/randomUuid';

/** Plugin `MindRoomVoiceRecorder` (Mac Catalyst, whose WebKit has no media capture):
 *  start({ nonce }) resolving { id }; level, pause, resume, stop and cancel({ id }) act on that
 *  recording only; level resolves { level } from 0 to 1, stop { path } of its `.m4a`, kept until
 *  cancel; orphans resolves the files no recorder of the loaded page holds; rejections carry
 *  `code`. */
type MindRoomVoiceRecorderPlugin = {
  start(options: { nonce: string }): Promise<{ id: string }>;
  level(options: { id: string }): Promise<{ level: number }>;
  pause(options: { id: string }): Promise<void>;
  resume(options: { id: string }): Promise<void>;
  stop(options: { id: string }): Promise<{ path: string }>;
  cancel(options: { id: string }): Promise<void>;
  orphans(): Promise<{ recordings: { id: string; path: string; startedAt: number }[] }>;
};

const START_ERROR_NAMES: Record<string, string> = {
  PERMISSION_DENIED: 'NotAllowedError',
  NO_MICROPHONE: 'NotFoundError',
};

let voiceRecorderPlugin: MindRoomVoiceRecorderPlugin | undefined;

const getVoiceRecorderPlugin = (): MindRoomVoiceRecorderPlugin => {
  if (!voiceRecorderPlugin) {
    voiceRecorderPlugin = registerPlugin<MindRoomVoiceRecorderPlugin>('MindRoomVoiceRecorder');
  }
  return voiceRecorderPlugin;
};

/** A file of the native recorder, read through Capacitor; undefined when it is empty or not
 *  answered. */
const readNativeFile = async (path: string): Promise<Blob | undefined> => {
  const response = await fetch(Capacitor.convertFileSrc(path), {
    signal: AbortSignal.timeout(5_000),
  });
  // Capacitor answers a local media file without an HTTP status, which WebKit reports as 0.
  if (!response.ok && response.status !== 0) return undefined;
  const data = await response.blob();
  return data.size > 0 ? data : undefined;
};

export const isNativeVoiceRecorderAvailable = (): boolean =>
  Capacitor.isNativePlatform() &&
  Capacitor.getPlatform() === 'ios' &&
  Capacitor.isPluginAvailable('MindRoomVoiceRecorder');

/** The part of `MediaRecorder` the voice capture session drives, over the native recorder. */
export class NativeVoiceRecorder extends EventTarget {
  state: 'inactive' | 'recording' | 'paused' = 'recording';

  readonly mimeType = 'audio/mp4';

  private newestLevel = 0;

  constructor(private readonly id: string) {
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
    this.deliver()
      .catch(() => undefined)
      .finally(() => this.end());
  }

  private transition(
    state: 'recording' | 'paused',
    call: (plugin: MindRoomVoiceRecorderPlugin) => Promise<void>
  ): void {
    if (this.state === 'inactive') return;
    this.state = state;
    // A transition the native recorder refuses would leave a wrong duration: end the recording.
    call(getVoiceRecorderPlugin()).catch(() => {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      this.end();
    });
  }

  private async deliver(): Promise<void> {
    const { path } = await getVoiceRecorderPlugin().stop({ id: this.id });
    const data = await readNativeFile(path);
    if (data) this.dispatchEvent(Object.assign(new Event('dataavailable'), { data }));
  }

  /** Every way out, once (`state` is `inactive` by then): the native side deletes the file. */
  private end(): void {
    getVoiceRecorderPlugin()
      .cancel({ id: this.id })
      .catch(() => undefined);
    this.dispatchEvent(new Event('stop'));
  }
}

/** Asks for the microphone and starts recording. Rejects with an Error named as getUserMedia
 *  names it. */
export const startNativeVoiceRecorder = async (): Promise<NativeVoiceRecorder> => {
  // The plugin reads this name back from the page after the microphone prompt, and records only
  // for the newest start of the page that is still loaded.
  const nonce = randomUuid();
  Object.assign(globalThis, { mindroomVoiceStart: nonce });
  try {
    const { id } = await getVoiceRecorderPlugin().start({ nonce });
    return new NativeVoiceRecorder(id);
  } catch (error) {
    const { code, message } = error as { code?: string; message?: string };
    throw Object.assign(new Error(message), {
      name: START_ERROR_NAMES[code ?? ''] ?? 'NotReadableError',
    });
  }
};

export type NativeVoiceOrphan = { id: string; file: File; startedAt: number };

/** The recordings a killed app, a reloaded page or a closed window left on disk, oldest first;
 *  none off the Mac app. One that cannot be read is left out. Each stays on disk until
 *  `forgetNativeVoiceRecording`. */
export const listNativeVoiceOrphans = async (): Promise<NativeVoiceOrphan[]> => {
  if (!isNativeVoiceRecorderAvailable()) return [];
  const { recordings } = await getVoiceRecorderPlugin().orphans();
  const orphans = await Promise.all(
    recordings.map(async ({ id, path, startedAt }): Promise<NativeVoiceOrphan | undefined> => {
      const data = await readNativeFile(path).catch(() => undefined);
      return data && { id, file: new File([data], `${id}.m4a`, { type: 'audio/mp4' }), startedAt };
    })
  );
  return orphans
    .filter((orphan): orphan is NativeVoiceOrphan => orphan !== undefined)
    .sort((a, b) => a.startedAt - b.startedAt);
};

/** Deletes the file of a recording `listNativeVoiceOrphans` listed. */
export const forgetNativeVoiceRecording = async (id: string): Promise<void> => {
  await getVoiceRecorderPlugin().cancel({ id });
};
