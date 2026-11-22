export const THREAD_MODEL_KEY = 'io.mindroom.thread_model';

export const threadModelContent = (
  runtimeUserId: string,
  runtimeDeviceId: string,
  model: string
) => ({
  [THREAD_MODEL_KEY]: {
    version: 1,
    runtime_user_id: runtimeUserId,
    runtime_device_id: runtimeDeviceId,
    model,
  },
});

export type ThreadModelContent = ReturnType<typeof threadModelContent>;
