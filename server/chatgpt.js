import { randomBytes, createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { requestJson, form } from './http.js';
import { canvasFor, validateArtwork } from './artwork.js';

const issuer = 'https://auth.openai.com';
const resource = 'https://api.openai.com/v1';
const tokenUrl = `${issuer}/api/accounts/oauth/token`;
const jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
const random = () => randomBytes(32).toString('base64url');

export class ChatGPT {
  constructor(store, port) { this.store = store; this.port = port; this.pending = new Map(); }
  status() {
    const account = this.store.data.chatgpt;
    return { connected: !!account?.access_token, email: account?.email, sharing: !!account?.access_token && (account.scopes || []).includes('chatgpt.tokens.use.direct') };
  }
  start() {
    const state = random(), verifier = random(), nonce = random();
    const saved = this.store.data.chatgpt;
    const redirect = `http://127.0.0.1:${this.port}/auth/chatgpt/callback`;
    for (const [key, value] of this.pending) if (Date.now() - value.at > 600000) this.pending.delete(key);
    this.pending.set(state, { verifier, nonce, redirect, clientId: saved?.client_id, subject: saved?.subject, at: Date.now() });
    const url = new URL(`${issuer}/api/accounts/authorize`);
    url.search = new URLSearchParams({
      client_id: saved?.client_id || 'dynamic_agent_client', ext_agent_host_id: this.store.data.hostId,
      ...(!saved?.client_id ? { agent_name_hint: 'StreamPics' } : {}),
      response_type: 'code', redirect_uri: redirect,
      scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct', resource,
      state, nonce, code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url')
    }).toString();
    return url.href;
  }
  async callback(query) {
    const attempt = this.pending.get(query.state); this.pending.delete(query.state);
    if (!attempt || Date.now() - attempt.at > 600000) throw new Error('ChatGPT sign-in expired. Please try again.');
    if (query.error) throw new Error('ChatGPT sign-in was declined. You can try again when ready.');
    const clientId = query.client_id || attempt.clientId;
    if (!clientId || clientId === 'dynamic_agent_client' || (attempt.clientId && clientId !== attempt.clientId)) throw new Error('ChatGPT registration did not return the expected client ID.');
    // Retain an issued registration even if its authorization code expires.
    this.store.data.chatgpt = { ...this.store.data.chatgpt, client_id: clientId };
    await this.store.save();
    const tokens = await requestJson(tokenUrl, form({ grant_type: 'authorization_code', client_id: clientId,
      code: query.code, code_verifier: attempt.verifier, redirect_uri: attempt.redirect, resource }));
    const { payload } = await jwtVerify(tokens.id_token, jwks, { issuer, audience: clientId, requiredClaims: ['sub', 'exp', 'nonce'] });
    if (payload.nonce !== attempt.nonce || (attempt.subject && payload.sub !== attempt.subject)) throw new Error('ChatGPT identity verification failed.');
    this.store.data.chatgpt = { client_id: clientId, subject: payload.sub, email: payload.email,
      ...tokens, scopes: (tokens.scope || '').split(' '), expires_at: Date.now() + tokens.expires_in * 1000 };
    await this.store.save();
  }
  async accessToken() {
    let account = this.store.data.chatgpt;
    if (!this.status().sharing) throw new Error('Continue with ChatGPT and allow plan usage to design with AI.');
    if (account.expires_at < Date.now() + 60000) {
      if (!this.refreshing) this.refreshing = (async () => {
        const tokens = await requestJson(tokenUrl, form({ grant_type: 'refresh_token', client_id: account.client_id, refresh_token: account.refresh_token, resource }));
        account = { ...account, ...tokens, scopes: tokens.scope ? tokens.scope.split(' ') : account.scopes,
          expires_at: Date.now() + tokens.expires_in * 1000 };
        this.store.data.chatgpt = account; await this.store.save();
      })().finally(() => { this.refreshing = null; });
      await this.refreshing;
    }
    if (!this.status().sharing) throw new Error('ChatGPT plan usage is no longer enabled. Reconnect and review permissions.');
    return this.store.data.chatgpt.access_token;
  }
  async models() {
    const result = await requestJson(`${resource}/models`, { headers: { Authorization: `Bearer ${await this.accessToken()}` } });
    return (result.models || []).filter(m => m.visibility === 'list').map(m => ({ slug: m.slug, name: m.display_name }));
  }
  async design(kind, prompt, model, format='instant') {
    const size=canvasFor(kind,format);
    const models = await this.models();
    if (!models.some(m => m.slug === model)) throw new Error('Select an available ChatGPT model.');
    const response = await fetch(`${resource}/responses`, {
      method: 'POST', signal: AbortSignal.timeout(300000),
      headers: { Authorization: `Bearer ${await this.accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, store: false, stream: true,
        text:{format:{type:'json_schema',name:'stream_artwork',strict:true,schema:{type:'object',additionalProperties:false,properties:{name:{type:'string'},description:{type:'string'},html:{type:'string'},css:{type:'string'}},required:['name','description','html','css']}}},
        instructions: `You are an exceptional visual artist designing bespoke stream collectibles. Create original, richly composed artwork, not a reskin of a preset. Fully realize the user's idea with elaborate self-contained HTML and CSS: painterly gradients, textures, ornaments, typography, layered geometry, inline SVG illustrations, intricate patterns, light, depth, material effects, and expressive composition. There is NO fixed motif list, color palette, or layout template. Use any static HTML/CSS visual technique. Do not default to a plain rectangle with a tiny symbol. The artwork should feel custom-made, detailed, and coherent.\nReturn ONLY JSON with name (60 chars), description (180 chars), html (HTML fragment), css (stylesheet). Output under 180 KB total; aim for 8–30 KB of efficient, richly detailed artwork. Canvas is exactly ${size.width} × ${size.height} CSS pixels. The host wraps your fragment in #sp-canvas. html/body/canvas background is transparent unless your artwork paints it. Self-contained assets only: CSS, inline SVG, or data images. No scripts, event handlers, external URLs/fonts, forms, embeds, documents, or interactive controls. All animation is frozen when rendered.\nTechnical composition contract, not creative restrictions:\n- Mark background artwork containers data-layer="background". Mark any decoration meant to sit ON TOP of the live photo data-layer="foreground". Every decorative element must belong to one of those layers. Use absolute positions for layers at canvas origin. Never put a background fill on body or #sp-canvas; use your background layer.\n- For a frame, include a visible rectangular div data-slot="photo" with a neutral placeholder fill, positioned/sized within the canvas. Compose a beautiful frame around this opening and do not put placeholder drawings of the user's photo in the permanent artwork. Provide empty text divs data-slot="title", data-slot="caption", and optionally data-slot="attribution". Their bounds and computed typography define editable live text. Do not hardcode sample title/caption/donor text elsewhere in artwork. Reserve enough room for 40-char titles and 180-char descriptions.\n- For an album cover, create a finished cover with striking full-surface artwork and empty data-slot="title" and data-slot="caption" divs for the album name and subtitle. Design all the actual illustration yourself. No fixed cover pattern or generic logo is required.\n- For a sticker, create the whole standalone illustration with a transparent exterior and detailed silhouette. No slots required. Any lettering in the sticker is part of your artwork.\n- Slot divs need explicit pixel x/y/width/height via CSS, readable color/font-size/font-family/font-weight/text-align/line-height. Keep slots unrotated and inside the canvas. For frame photo preserve the intended photo opening; front layer may overlap its edges. You decide the rest of the composition freely.`,
        input: [{ role: 'user', content: `Create this ${kind} artwork for a ${format} canvas: ${prompt.slice(0, 4000)}` }]
      })
    });
    if (!response.ok) throw new Error(`ChatGPT could not start the design (${response.status}). Check plan access and usage limits.`);
    let buffer = '', output = '', completed = false;
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
        if (!data || data === '[DONE]') continue;
        const event = JSON.parse(data);
        if (event.type === 'response.output_text.delta') {output += event.delta;if(output.length>360000)throw new Error('The generated artwork exceeded the output size limit.');}
        if (event.type === 'response.completed') completed = true;
        if (['response.failed', 'response.incomplete', 'error'].includes(event.type)) throw new Error(event.response?.error?.code || event.code || 'ChatGPT design was interrupted.');
      }
    }
    if (!completed) throw new Error('The design stream ended early. Please try again.');
    const cleaned = output.replace(/^```(?:json)?\s*|\s*```$/g, '');
    try { return {...validateArtwork(JSON.parse(cleaned),kind,size),format}; }
    catch (error) {
      // Preserve completed model output locally so a renderer/validation fix never needs another paid generation.
      this.store.data.artworkDraft={kind,format,size,raw:cleaned,error:error.message,createdAt:new Date().toISOString()};
      await this.store.save?.();
      throw new Error(`Artwork could not be prepared: ${error.message}`);
    }
  }
}
