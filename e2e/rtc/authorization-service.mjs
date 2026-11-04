#!/usr/bin/env node
// A small MatrixRTC authorization service for the call specs, written for this repository.
//
// It answers the legacy `POST /sfu/get` exchange that MatrixRTC clients and MindRoom agents use:
// the caller sends a Matrix OpenID token, the service asks the homeserver who it belongs to
// (`/_matrix/federation/v1/openid/userinfo`), and returns a LiveKit access token for the call of
// that Matrix room, with the participant identity `<user id>:<device id>`.
//
// Environment:
//   RTC_AUTH_PORT       port to listen on (127.0.0.1)
//   RTC_HOMESERVER_URL  client-server URL of the homeserver that issued the OpenID tokens
//   RTC_LIVEKIT_URL     WebSocket URL of the LiveKit server handed to callers
//   RTC_LIVEKIT_KEY     LiveKit API key
//   RTC_LIVEKIT_SECRET  LiveKit API secret
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const port = Number(process.env.RTC_AUTH_PORT);
const homeserver = (process.env.RTC_HOMESERVER_URL ?? '').replace(/\/+$/, '');
const livekitUrl = process.env.RTC_LIVEKIT_URL;
const apiKey = process.env.RTC_LIVEKIT_KEY;
const apiSecret = process.env.RTC_LIVEKIT_SECRET;
if (!port || !homeserver || !livekitUrl || !apiKey || !apiSecret) {
  process.stderr.write('authorization-service: set the RTC_* variables (see the header)\n');
  process.exit(2);
}

/** A grant lasts as long as a long call; LiveKit checks it only when a participant connects. */
const GRANT_SECONDS = 6 * 60 * 60;

const base64Url = (input) => Buffer.from(input).toString('base64url');

/** An HS256 JSON Web Token, as LiveKit servers accept them. */
const signToken = (claims) => {
  const head = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64Url(JSON.stringify(claims));
  const signature = createHmac('sha256', apiSecret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
};

const livekitToken = (roomName, identity, userId) => {
  const now = Math.floor(Date.now() / 1000);
  return signToken({
    iss: apiKey,
    sub: identity,
    name: userId,
    nbf: now - 10,
    exp: now + GRANT_SECONDS,
    video: {
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  });
};

/** The Matrix user an OpenID token belongs to, or undefined when the homeserver denies it. */
const openIdUser = async (accessToken) => {
  const url = `${homeserver}/_matrix/federation/v1/openid/userinfo?access_token=${encodeURIComponent(
    accessToken
  )}`;
  const response = await fetch(url);
  if (!response.ok) return undefined;
  const body = await response.json();
  return typeof body.sub === 'string' ? body.sub : undefined;
};

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const reply = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', ...corsHeaders });
  res.end(JSON.stringify(body));
};

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      text += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(text || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });

const exchange = async (req, res) => {
  const body = await readJson(req).catch(() => undefined);
  const roomId = body?.room;
  const deviceId = body?.device_id;
  const token = body?.openid_token;
  if (typeof roomId !== 'string' || typeof deviceId !== 'string' || !token?.access_token) {
    reply(res, 400, { errcode: 'M_BAD_JSON', error: 'room, device_id and openid_token are required' });
    return;
  }
  const userId = await openIdUser(token.access_token).catch(() => undefined);
  const serverName = userId?.slice(userId.indexOf(':') + 1);
  if (!userId || (token.matrix_server_name && token.matrix_server_name !== serverName)) {
    reply(res, 401, { errcode: 'M_UNAUTHORIZED', error: 'the OpenID token was not accepted' });
    return;
  }
  const identity = `${userId}:${deviceId}`;
  reply(res, 200, { url: livekitUrl, jwt: livekitToken(roomId, identity, userId) });
};

createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }
  if (req.method === 'GET' && req.url === '/healthz') {
    reply(res, 200, { ok: true });
    return;
  }
  if (req.method === 'POST' && req.url === '/sfu/get') {
    exchange(req, res).catch((error) => reply(res, 500, { error: String(error) }));
    return;
  }
  reply(res, 404, { errcode: 'M_NOT_FOUND' });
}).listen(port, '127.0.0.1', () => {
  process.stdout.write(`authorization-service: http://127.0.0.1:${port} -> ${livekitUrl}\n`);
});
