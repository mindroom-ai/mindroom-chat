import { describe, expect, it } from 'vitest';
import { matchRoute } from './routeTemplate';

const room = encodeURIComponent('!AbCdEfGhIjKl:example.org');
const event = encodeURIComponent('$Ev3ntIdAbCdEfGhIjKlMnOpQrStUvWxYz0123456789');
const space = encodeURIComponent('#falcon:example.org');

describe('matchRoute', () => {
  it.each([
    ['/home/', '', '/home/'],
    [`/home/${room}/`, '', '/home/:roomIdOrAlias/:eventId?/'],
    [`/home/${room}/${event}/`, '', '/home/:roomIdOrAlias/:eventId?/'],
    [`/home/${room}/`, `?threadId=${event}`, '/home/:roomIdOrAlias/:eventId?/?threadId=:eventId'],
    [`/direct/${encodeURIComponent('!dm:example.org')}/`, '', '/direct/:roomIdOrAlias/:eventId?/'],
    [`/${space}/`, '', '/:spaceIdOrAlias/'],
    [`/${space}/${room}/`, '', '/:spaceIdOrAlias/:roomIdOrAlias/:eventId?/'],
    [`/${space}/lobby/`, '', '/:spaceIdOrAlias/lobby/'],
    ['/login/matrix.example.org/', '', '/login/:server?/'],
    ['/settings/about/', '', '/settings/:page?/'],
    ['/explore/matrix.example.org/', '', '/explore/:server/'],
    ['/activity/invites/', '', '/activity/invites/'],
    [`/activity/${room}/`, '', '/activity/:roomIdOrAlias/:eventId?/'],
    [`/threads/${room}/`, '', '/threads/:roomIdOrAlias/:eventId?/'],
    ['/a/b/c/d/e/', '', '/<unknown>/'],
  ])('%s%s is %s', (pathname, search, template) => {
    expect(matchRoute(pathname, search).template).toBe(template);
  });

  it('names the room of a room route, and no room elsewhere', () => {
    expect(matchRoute(`/home/${room}/${event}/`).room).toBe('!AbCdEfGhIjKl:example.org');
    expect(matchRoute('/home/').room).toBeUndefined();
  });
});
