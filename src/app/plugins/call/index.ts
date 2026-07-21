export * from './CallEmbed';
export * from './CallTermination';
export * from './hooks';
// Coordination internals (generation claiming, write tracking, the publish
// gate, room retirement) are deliberately NOT re-exported: their contracts
// are delicate (who may claim, what must be tracked, when a room may be
// retired) and live in `rtcMembershipCleanup.ts`. The modules that
// participate in the ownership protocol import them by module path.
export {
  CallRoomRetiredError,
  clearDeviceCallMemberships,
  expectedDeviceCallMembershipStateKey,
  findDeviceCallMemberships,
  isCallRoomRetired,
} from './rtcMembershipCleanup';
export type { DeviceCallMembershipTarget } from './rtcMembershipCleanup';
export * from './types';
