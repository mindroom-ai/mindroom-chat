import React, { ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useAtomValue } from 'jotai';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useResolvedRoomIdOrAlias } from '../../hooks/router/useResolvedRoomIdOrAlias';
import { IsDirectRoomProvider, RoomProvider } from '../../hooks/useRoom';
import { mDirectAtom } from '../../state/mDirectList';
import { JoinBeforeNavigate } from '../../features/join-before-navigate/JoinBeforeNavigate';
import { getRoomSearchParams } from '../pathSearchParam';
import { KnownMembership } from 'matrix-js-sdk';

/**
 * A room route: `children` (the room) inside the room's providers when joined, otherwise its
 * summary with a way to join.
 */
export function RoomRoute({ children }: { children: ReactNode }) {
  const mx = useMatrixClient();
  const { roomIdOrAlias: encoded, eventId } = useParams();
  const [searchParams] = useSearchParams();
  const { viaServers } = getRoomSearchParams(searchParams);
  const roomIdOrAlias = encoded ? decodeURIComponent(encoded) : '';
  const resolved = useResolvedRoomIdOrAlias(roomIdOrAlias) as unknown;
  const roomId = typeof resolved === 'string' ? resolved : roomIdOrAlias;
  const directs = useAtomValue(mDirectAtom);
  const room = mx.getRoom(roomId);

  if (!room || room.getMyMembership() !== KnownMembership.Join) {
    return (
      <JoinBeforeNavigate














