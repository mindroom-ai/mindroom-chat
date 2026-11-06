import { createContext, useContext, useMemo } from 'react';
import { Icons, type IconSrc } from 'folds';
import {
  ConditionKind,
  IPushRule,
  IPushRules,
  MatrixClient,
  PushRuleActionName,
  PushRuleKind,
  TweakName,
} from 'matrix-js-sdk';
import { AccountDataEvent } from '../types/accountData';
import { useAccountData } from './useAccountData';
import { useMatrixClient } from './useMatrixClient';

/**
 * A room's notification setting, stored as push rules whose ID is the room ID: an override rule
 * that does nothing mutes the room; a room rule that notifies (or does nothing) overrides the
 * account default for every message (or leaves only mentions and keywords).
 */
export enum RoomNotificationMode {
  Unset = 'unset',
  AllMessages = 'all_messages',
  SpecialMessages = 'special_messages',
  Mute = 'mute',
}

type RoomToNotificationMode = Map<string, RoomNotificationMode>;

const notifies = (rule: IPushRule): boolean =>
  rule.actions.some((action) => action === PushRuleActionName.Notify);

const isRoomMuteRule = (rule: IPushRule): boolean => {
  if (!rule.enabled || notifies(rule) || rule.conditions?.length !== 1) return false;
  const [condition] = rule.conditions;
  return (
    condition?.kind === ConditionKind.EventMatch &&
    condition.key === 'room_id' &&
    condition.pattern === rule.rule_id
  );
};

/** Whether the account's push rules mute the room. */
export const isRoomMuted = (pushRules: IPushRules | undefined, roomId: string): boolean =>
  pushRules?.global?.override?.some((rule) => rule.rule_id === roomId && isRoomMuteRule(rule)) ??
  false;

/** Every room with its own notification setting, read from the account's push rules. */
const getRoomsNotificationPreferences = (
  pushRules: IPushRules | undefined
): RoomToNotificationMode => {
  const modes: RoomToNotificationMode = new Map();
  const global = pushRules?.global;
  global?.room?.forEach((rule) => {
    if (!rule.enabled) return;
    modes.set(
      rule.rule_id,
      notifies(rule) ? RoomNotificationMode.AllMessages : RoomNotificationMode.SpecialMessages
    );
  });
  global?.override?.forEach((rule) => {
    if (isRoomMuteRule(rule)) modes.set(rule.rule_id, RoomNotificationMode.Mute);
  });
  return modes;
};

export const getRoomNotificationMode = (
  preferences: RoomToNotificationMode,
  roomId: string
): RoomNotificationMode => preferences.get(roomId) ?? RoomNotificationMode.Unset;

const MODE_ICONS: Record<RoomNotificationMode, IconSrc> = {
  [RoomNotificationMode.Unset]: Icons.Bell,
  [RoomNotificationMode.AllMessages]: Icons.BellRing,
  [RoomNotificationMode.SpecialMessages]: Icons.BellPing,
  [RoomNotificationMode.Mute]: Icons.BellMute,
};

/** The bell that stands for a mode in menus: plain, ringing, pinged (mentions) or crossed out. */
export const getRoomNotificationModeIcon = (mode: RoomNotificationMode): IconSrc =>
  MODE_ICONS[mode] ?? Icons.Bell;

/** Deletes the room's own rule of `kind`; a rule that is already gone counts as deleted. */
const removeRule = async (mx: MatrixClient, kind: PushRuleKind, roomId: string): Promise<void> => {
  try {
    await mx.deletePushRule('global', kind, roomId);
  } catch (error) {
    if ((error as { httpStatus?: number }).httpStatus !== 404) throw error;
  }
};

/** An override rule without actions keeps every event in the room silent (spec: push rules). */
export const roomMuteRule = (roomId: string): Pick<IPushRule, 'actions' | 'conditions'> => ({
  actions: [],
  conditions: [{ kind: ConditionKind.EventMatch, key: 'room_id', pattern: roomId }],
});

/**
 * Moves a room from the `previous` mode to the `next` one. The rule behind the previous mode goes
 * first, then the new mode's rule is added (client-server API, "Push Rules": override rules win
 * over room rules, so a mute is an override rule that matches the room ID). `Unset` adds no rule.
 */
export async function setRoomNotificationPreference(
  client: MatrixClient,
  roomId: string,
  next: RoomNotificationMode,
  previous: RoomNotificationMode
): Promise<void> {
  if (next === previous) return;

  if (previous === RoomNotificationMode.Mute) {
    await removeRule(client, PushRuleKind.Override, roomId);
  } else if (
    previous === RoomNotificationMode.AllMessages ||
    previous === RoomNotificationMode.SpecialMessages
  ) {
    await removeRule(client, PushRuleKind.RoomSpecific, roomId);
  }

  if (next === RoomNotificationMode.Mute) {
    await client.addPushRule('global', PushRuleKind.Override, roomId, roomMuteRule(roomId));
  } else if (next === RoomNotificationMode.AllMessages) {
    await client.addPushRule('global', PushRuleKind.RoomSpecific, roomId, {
      actions: [PushRuleActionName.Notify, { set_tweak: TweakName.Sound, value: 'default' }],
    });
  } else if (next === RoomNotificationMode.SpecialMessages) {
    await client.addPushRule('global', PushRuleKind.RoomSpecific, roomId, { actions: [] });
  }
}

/** Per-room notification settings, following push rule changes. */
export const useRoomsNotificationPreferences = (): RoomToNotificationMode => {
  const mx = useMatrixClient();
  const pushRulesEvent = useAccountData(AccountDataEvent.PushRules);

  return useMemo(() => {
    const pushRules = pushRulesEvent?.getContent<IPushRules>() ?? mx.pushRules;
    return getRoomsNotificationPreferences(pushRules);
  }, [mx, pushRulesEvent]);
};

const RoomsNotificationPreferencesContext = createContext<RoomToNotificationMode | null>(null);

export const RoomsNotificationPreferencesProvider = RoomsNotificationPreferencesContext.Provider;

export const useRoomsNotificationPreferencesContext = (): RoomToNotificationMode => {
  const preferences = useContext(RoomsNotificationPreferencesContext);
  if (!preferences) throw new Error('Notification preferences are not provided!');
  return preferences;
};
