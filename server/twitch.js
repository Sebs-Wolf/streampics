import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { requestJson, form } from './http.js';
import { normalizeTwitchEvent } from './designs.js';

const oauth = 'https://id.twitch.tv/oauth2';
const eventUrl = 'wss://eventsub.wss.twitch.tv/ws';
export class Twitch {
  constructor(store, onEvent, onChange) {
    this.store = store; this.onEvent = onEvent; this.onChange = onChange; this.pending = new Map();
    this.mock = false; this.generation = 0; this.endpoint = eventUrl; this.connected = false; this.subscriptionErrors = []; this.stopped = false; this.sockets = new Set();
  }
  config() { return { id: process.env.TWITCH_CLIENT_ID, secret: process.env.TWITCH_CLIENT_SECRET, redirect: process.env.TWITCH_REDIRECT_URI || 'http://localhost:3000/auth/twitch/callback' }; }
  status() { return { mock:this.mock, mockPort:this.mock?Number(new URL(this.endpoint).port):8080, configured: !!this.config().id && !!this.config().secret, authorized: !!this.store.data.twitch?.access_token, connected: this.connected, username: this.store.data.twitch?.username, errors: this.subscriptionErrors }; }
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
    this.endpoint=eventUrl; this.subscriptionErrors=[];
    await this.validate();
    this.open(eventUrl, false);
    this.validationTimer = setInterval(() => this.validate().catch(() => { this.disconnect(); this.subscriptionErrors = ['Twitch session expired. Reconnect Twitch.']; this.onChange(); }), 3600000);
    this.validationTimer.unref();
  }
  async connectMock(port=8080) {
    if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Choose a local CLI port between 1024 and 65535.');
    this.disconnect();this.mock=true;this.stopped=false;this.subscriptionErrors=[];
    this.endpoint=`ws://127.0.0.1:${port}/ws`;
    const socket=this.open(this.endpoint,false);
    try {
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>finish(new Error('Twitch CLI did not send a welcome message.')),6000);
        const welcome=raw=>{try{if(JSON.parse(raw.toString()).metadata?.message_type==='session_welcome')finish();}catch{}};
        const error=()=>finish(new Error('Start the Twitch CLI mock server on this port, then try again.'));
        const finish=err=>{clearTimeout(timer);socket.off('message',welcome);socket.off('error',error);socket.off('close',error);err?reject(err):resolve();};
        socket.on('message',welcome);socket.once('error',error);socket.once('close',error);
      });
    } catch(error) {this.disconnect();this.subscriptionErrors=[error.message];this.onChange();throw error;}
  }
  open(url, transfer, previous) {
    const target=new URL(url),generation=this.generation,mock=this.mock;
    if(mock ? target.origin!==new URL(this.endpoint).origin||target.protocol!=='ws:' : target.protocol!=='wss:'||target.hostname !== 'eventsub.wss.twitch.tv') throw new Error('Unexpected Twitch reconnect host.');
    const socket = new WebSocket(url); this.sockets.add(socket);
    let watchdog;
    const resetWatchdog = seconds => { clearTimeout(watchdog); watchdog = setTimeout(() => socket.terminate(), seconds * 1000 + 5000); watchdog.unref(); };
    resetWatchdog(15);
    let keepalive = 10;
    socket.on('error', () => {});
    socket.on('message', async raw => {
      if(generation!==this.generation||this.stopped)return;
      try {
        const message = JSON.parse(raw.toString()); const { metadata, payload } = message;
        resetWatchdog(keepalive);
        if (metadata.message_type === 'session_welcome') {
          keepalive = payload.session.keepalive_timeout_seconds || 10;
          resetWatchdog(keepalive); this.active = socket;
          if (!transfer&&!mock) await this.subscribe(payload.session.id);
          if(generation!==this.generation||this.stopped)return;
          this.connected = true; this.retry = 0; previous?.close(); this.onChange();
        } else if (metadata.message_type === 'session_reconnect') {
          this.open(payload.session.reconnect_url, true, socket);
        } else if (metadata.message_type === 'notification') {
          const seen = this.store.data.seen;
          const messageId=mock?`cli:${metadata.message_id}`:metadata.message_id;
          if (seen.includes(messageId)) return;
          seen.push(messageId); this.store.data.seen = seen.slice(-2000); await this.store.save();
          const event = normalizeTwitchEvent(payload.subscription.type, payload.event);
          if (event) await this.onEvent(mock?{...event,test:true}:event);
        } else if (metadata.message_type === 'revocation') {
          this.subscriptionErrors.push(`${payload.subscription.type}: ${payload.subscription.status}`); this.onChange();
        }
      } catch (error) { this.subscriptionErrors = [error.message]; this.onChange(); }
    });
    socket.on('close', () => {
      clearTimeout(watchdog); this.sockets.delete(socket);
      if(generation!==this.generation)return;
      if (this.active && this.active !== socket && this.active.readyState === WebSocket.OPEN) return;
      this.connected = false; this.onChange();
      if (!this.stopped) {
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.open(this.endpoint, false), Math.min(30000, 1000 * 2 ** (this.retry = Math.min((this.retry || 0) + 1, 5))));
        this.retryTimer.unref();
      }
    });
    return socket;
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
    this.generation++;this.mock=false;this.stopped = true; clearTimeout(this.retryTimer); clearInterval(this.validationTimer);
    this.active = null; for (const socket of this.sockets) socket.close(); this.connected = false;
  }
}
