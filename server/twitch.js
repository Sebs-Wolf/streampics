import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { requestJson, form } from './http.js';
import { normalizeTwitchEvent } from './designs.js';

const oauth = 'https://id.twitch.tv/oauth2';
const eventUrl = 'wss://eventsub.wss.twitch.tv/ws';
export class Twitch {
  constructor(store, onEvent, onChange) {
    this.store = store; this.onEvent = onEvent; this.onChange = onChange; this.pending = new Map();
    this.connected = false; this.subscriptionErrors = []; this.stopped = false; this.sockets = new Set();
  }
  config() { return { id: process.env.TWITCH_CLIENT_ID, secret: process.env.TWITCH_CLIENT_SECRET, redirect: process.env.TWITCH_REDIRECT_URI || 'http://localhost:3000/auth/twitch/callback' }; }
  status() { return { configured: !!this.config().id && !!this.config().secret, authorized: !!this.store.data.twitch?.access_token, connected: this.connected, username: this.store.data.twitch?.username, errors: this.subscriptionErrors }; }
  start() {
    const { id, secret, redirect } = this.config();
    if (!id || !secret) throw new Error('Add your Twitch client ID and secret to .env, then restart the server.');
    const state = randomBytes(32).toString('base64url');
    for (const [key, at] of this.pending) if (Date.now() - at > 600000) this.pending.delete(key);
    this.pending.set(state, Date.now());
    return `${oauth}/authorize?${new URLSearchParams({client_id:id, redirect_uri:redirect, response_type:'code', scope:'bits:read channel:read:subscriptions', state})}`;
  }
  async callback(query) {
    const at = this.pending.get(query.state); this.pending.delete(query.state);
    if (!at || Date.now() - at > 600000) throw new Error('Twitch sign-in expired. Please try again.');
    if (query.error) throw new Error('Twitch sign-in was declined.');
    const { id, secret, redirect } = this.config();
    const tokens = await requestJson(`${oauth}/token`, form({client_id:id, client_secret:secret, code:query.code, grant_type:'authorization_code', redirect_uri:redirect}));
    const identity = await requestJson(`${oauth}/validate`, {headers:{Authorization:`OAuth ${tokens.access_token}`}});
    if (identity.client_id !== id) throw new Error('Twitch returned an unexpected application identity.');
    this.store.data.twitch = { ...tokens, userId:identity.user_id, username:identity.login, expires_at:Date.now()+identity.expires_in*1000 };
    await this.store.save();
    await this.connect();
  }
  async token() {
    let account = this.store.data.twitch;
    if (!account) throw new Error('Connect Twitch first.');
    if (account.expires_at < Date.now()+60000) {
      if (!this.refreshing) this.refreshing = (async () => {
        const { id, secret } = this.config();
        const tokens = await requestJson(`${oauth}/token`, form({grant_type:'refresh_token', refresh_token:account.refresh_token, client_id:id, client_secret:secret}));
        this.store.data.twitch = { ...account, ...tokens, expires_at:Date.now()+tokens.expires_in*1000 };
        await this.store.save();
      })().finally(() => { this.refreshing = null; });
      await this.refreshing;
    }
    return this.store.data.twitch.access_token;
  }
  async validate() {
    const token = await this.token();
    const identity = await requestJson(`${oauth}/validate`, {headers:{Authorization:`OAuth ${token}`}});
    if (identity.user_id !== this.store.data.twitch.userId || identity.client_id !== this.config().id) throw new Error('Twitch session changed. Reconnect Twitch.');
  }
  async connect() {
    this.disconnect(); this.stopped = false;
    await this.validate();
    this.open(eventUrl, false);
    this.validationTimer = setInterval(() => this.validate().catch(() => { this.disconnect(); this.subscriptionErrors = ['Twitch session expired. Reconnect Twitch.']; this.onChange(); }), 3600000);
    this.validationTimer.unref();
  }
  open(url, transfer, previous) {
    if (new URL(url).hostname !== 'eventsub.wss.twitch.tv') throw new Error('Unexpected Twitch reconnect host.');
    const socket = new WebSocket(url); this.sockets.add(socket);
    let watchdog;
    const resetWatchdog = seconds => { clearTimeout(watchdog); watchdog = setTimeout(() => socket.terminate(), seconds * 1000 + 5000); watchdog.unref(); };
    resetWatchdog(15);
    let keepalive = 10;
    socket.on('error', () => {});
    socket.on('message', async raw => {
      try {
        const message = JSON.parse(raw.toString()); const { metadata, payload } = message;
        resetWatchdog(keepalive);
        if (metadata.message_type === 'session_welcome') {
          keepalive = payload.session.keepalive_timeout_seconds || 10;
          resetWatchdog(keepalive); this.active = socket;
          if (!transfer) await this.subscribe(payload.session.id);
          this.connected = true; this.retry = 0; previous?.close(); this.onChange();
        } else if (metadata.message_type === 'session_reconnect') {
          this.open(payload.session.reconnect_url, true, socket);
        } else if (metadata.message_type === 'notification') {
          const seen = this.store.data.seen;
          if (seen.includes(metadata.message_id)) return;
          seen.push(metadata.message_id); this.store.data.seen = seen.slice(-2000); await this.store.save();
          const event = normalizeTwitchEvent(payload.subscription.type, payload.event);
          if (event) await this.onEvent(event);
        } else if (metadata.message_type === 'revocation') {
          this.subscriptionErrors.push(`${payload.subscription.type}: ${payload.subscription.status}`); this.onChange();
        }
      } catch (error) { this.subscriptionErrors = [error.message]; this.onChange(); }
    });
    socket.on('close', () => {
      clearTimeout(watchdog); this.sockets.delete(socket);
      if (this.active && this.active !== socket && this.active.readyState === WebSocket.OPEN) return;
      this.connected = false; this.onChange();
      if (!this.stopped) {
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.open(eventUrl, false), Math.min(30000, 1000 * 2 ** (this.retry = Math.min((this.retry || 0) + 1, 5))));
        this.retryTimer.unref();
      }
    });
  }
  async subscribe(sessionId) {
    this.subscriptionErrors = [];
    for (const type of ['channel.cheer', 'channel.subscribe', 'channel.subscription.gift', 'channel.subscription.message']) {
      try {
        await requestJson('https://api.twitch.tv/helix/eventsub/subscriptions', {method:'POST', headers:{Authorization:`Bearer ${await this.token()}`, 'Client-Id':this.config().id, 'Content-Type':'application/json'}, body:JSON.stringify({type,version:'1',condition:{broadcaster_user_id:this.store.data.twitch.userId},transport:{method:'websocket',session_id:sessionId}})});
      } catch (error) { this.subscriptionErrors.push(`${type}: ${error.message}`); }
    }
  }
  disconnect() {
    this.stopped = true; clearTimeout(this.retryTimer); clearInterval(this.validationTimer);
    this.active = null; for (const socket of this.sockets) socket.close(); this.connected = false;
  }
}
