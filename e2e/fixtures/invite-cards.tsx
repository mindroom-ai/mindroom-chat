import { createRoot } from 'react-dom/client';
import { Box } from 'folds';
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import 'folds/dist/style.css';
import '@fontsource/inter/variable.css';
import '../../src/index.css';
import i18n from '../../src/app/i18n/i18n';
import { LightTheme } from '../../src/app/theme/useTheme';
import { applyThemeToDom } from '../../src/app/theme/themeBootstrap';
import { MatrixClientProvider } from '../../src/app/matrix/hooks/useMatrixClient';
import { InviteCard, makeInviteData } from '../../src/app/notifications/inbox/Invites';

// Invite cards whose inviters pick display names that try to pass for
// someone else: each card must still show the inviter's real ID, left to
// right, after the name. Query parameter: `lang` (default en).

const params = new URLSearchParams(window.location.search);
applyThemeToDom(LightTheme);

const me = '@reader:matrix.localhost';
const client = createClient({ baseUrl: 'https://matrix.localhost', userId: me });

const inviters: { id: string; name: string }[] = [
  { id: '@maya:matrix.localhost', name: 'Maya' },
  { id: '@maya:matrix.localhost', name: 'مايا الحسيني' },
  // A closing isolate, then an embedding and an isolate that would pull the real ID inside.
  { id: '@mallory:evil.example', name: '⁩‫⁧Maya (@maya:matrix.localhost)‎' },
  // A right-to-left override that would print the real ID backwards.
  { id: '@mallory:evil.example', name: '‮Maya (@maya:matrix.localhost)' },
  // Paragraph separators end every isolate the card puts around the name.
  { id: '@mallory:evil.example', name: 'Maya (@maya:matrix.localhost) \u0085‏' },
  // Long enough that, uncut, the real ID would end up far off to the side.
  { id: '@mallory:evil.example', name: `Maya (@maya:matrix.localhost)${' ⠀'.repeat(400)}` },
];

const inviteFrom = (index: number, inviterId: string, name: string): Room => {
  const roomId = `!invite-${index}:matrix.localhost`;
  const room = new Room(roomId, client, me);
  room.currentState.setStateEvents([
    new MatrixEvent({
      room_id: roomId,
      type: 'm.room.name',
      state_key: '',
      sender: inviterId,
      content: { name: `Project room ${index + 1}` },
    }),
    new MatrixEvent({
      room_id: roomId,
      type: 'm.room.member',
      state_key: inviterId,
      sender: inviterId,
      content: { membership: 'join', displayname: name },
    }),
    new MatrixEvent({
      room_id: roomId,
      type: 'm.room.member',
      state_key: me,
      sender: inviterId,
      origin_server_ts: Date.UTC(2026, 10, 3, 9, index),
      content: { membership: 'invite' },
    }),
  ]);
  // The room's name comes from its state only once it is recalculated.
  room.recalculate();
  return room;
};

const invites = inviters.map(({ id, name }, index) =>
  makeInviteData(client, inviteFrom(index, id, name), false)
);

function Fixture() {
  return (
    <MatrixClientProvider value={client}>
      <Box direction="Column" gap="300" style={{ padding: 24, maxWidth: 960 }}>
        {invites.map((invite) => (
          <InviteCard
            key={invite.roomId}
            invite={invite}
            onNavigate={() => undefined}
            hideAvatar={false}
            hour24Clock
            dateFormatString="D MMM YYYY"
          />
        ))}
      </Box>
    </MatrixClientProvider>
  );
}

void i18n.changeLanguage(params.get('lang') ?? 'en').then(async () => {
  createRoot(document.getElementById('root')!).render(<Fixture />);
  await document.fonts.ready;
  document.body.dataset.fixtureReady = 'true';
});
