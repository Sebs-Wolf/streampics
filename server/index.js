import {fonts,fontEdits} from '../public/fonts.js';
import {photoSvg,photoSize} from '../public/render.js';
import 'dotenv/config';
import express from 'express';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import { Store } from './store.js';
import { templates, themes, photoEdits } from './designs.js';
import { ObsConnection } from './obs.js';
import { Twitch } from './twitch.js';
import { ChatGPT } from './chatgpt.js';
import { renderArtwork, importArtwork, validateArtwork, canvasFor,renderPhotoPng } from './artwork.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 3000);
export async function createApp({ directory = path.join(root, 'data'), obsOverride } = {}) {
  const store = await new Store(directory).init();
  const clients = new Set();
  const broadcast = (type = 'change', data = {}) => {
    for (const response of clients) response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const obs = obsOverride || new ObsConnection(() => broadcast());
  const chatgpt = new ChatGPT(store, port);
  let captureTail = Promise.resolve(), queueSize = 0, aiBusy = false, captureEffect = null;
  async function capture(trigger = null, albumId = store.data.settings.activeAlbumId) {
    if (queueSize >= 12) throw new Error('Capture queue is full. Please wait a moment.');
    queueSize++;
    const operation = captureTail.then(async () => {
      if(!obs.connected) throw new Error('Connect OBS before capturing a live moment.');
      const effectId=randomUUID(),countdown=store.data.settings.captureCountdown===true,shutter=store.data.settings.captureAnimation!==false;
      captureEffect={id:effectId,phase:'countdown',endsAt:Date.now()+(countdown?3000:0),shutter};
      try {
      // Clear the browser-source countdown before requesting the program screenshot.
      await delay((countdown?3000:0)+350);
      const { buffer, scene } = await obs.capture();
      captureEffect={id:effectId,phase:'shutter',endsAt:Date.now()+850,shutter};
      const id = randomUUID();
      await writeFile(path.join(directory, 'images', `${id}.png`), buffer);
      const photo = { id, image: `/images/${id}.png`, createdAt: new Date().toISOString(),
        title: 'A moment to keep', caption: '', template: store.data.settings.template,
        albumId, font:store.data.settings.font||'template', format:store.data.settings.format||'square', finish:store.data.settings.finish||'matte', rarity:'rare',power:100,
        stickers: [], designId: store.data.settings.designId || '', showAttribution: store.data.settings.showAttribution, trigger, scene };
      store.data.photos.push(photo); await store.save();
      await store.record({ status: 'captured', message: trigger ? `${trigger.viewer} · ${trigger.amount} ${trigger.unit}` : 'A moment captured by you', photoId: id });
      broadcast('capture', { photo }); return photo;
      } catch(error) {captureEffect=null;throw error;}
    }).finally(() => { queueSize--; });
    captureTail = operation.catch(() => {}); return operation;
  }
  const twitch = new Twitch(store, async event => {
    const settings = store.data.settings;
    if (event.kind === 'bits' ? (!settings.bitsEnabled || event.amount < settings.minBits) : !settings.subsEnabled) return;
    try { await capture(event); }
    catch (error) { await store.record({ status: 'failed', message: `Could not capture ${event.viewer}'s moment: ${error.message}`, trigger: event }); broadcast(); }
  }, () => broadcast());
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(req.hostname)) return res.status(403).json({error:'Local access only.'});
    if (req.headers.origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(req.headers.origin)) return res.status(403).json({error:'Unexpected origin.'});
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-streampics-client'] !== 'studio' && req.headers['x-keepsake-client'] !== 'studio') return res.status(403).json({error:'Open StreamPics Creator Studio to make changes.'});
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'self'");
    next();
  });
  app.post('/api/designs/import',express.raw({type:['image/png','image/jpeg','image/webp'],limit:'12mb'}),async(req,res)=>{
    if(!Buffer.isBuffer(req.body)||!req.body.length)throw new Error('Choose a PNG, JPEG, or WebP image.');
    const design=await importArtwork(req.body,{id:randomUUID(),kind:req.query.kind,name:req.query.name,format:req.query.format},directory);
    store.data.designs.push(design);await store.save();broadcast();res.status(201).json(design);
  });
  app.use(express.json({limit:'64kb'}));
  app.use('/api', (_req,res,next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/api/state', (_req,res) => res.json({
    photos:store.data.photos, album:store.data.album, albums:store.data.albums.map(({shareToken,...album})=>album), designs:store.data.designs,
    events:store.data.events, settings:store.data.settings, obs:{connected:obs.connected,scene:obs.scene},
    twitch:twitch.status(), chatgpt:chatgpt.status(), queueSize, artworkRecovery:!!store.data.artworkDraft
  }));
  app.get('/api/events', (req,res) => {
    res.set({'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', Connection:'keep-alive'});
    res.flushHeaders(); res.write(': connected\n\n'); clients.add(res);
    const timer = setInterval(() => res.write(': heartbeat\n\n'), 20000); timer.unref();
    req.on('close', () => {clearInterval(timer);clients.delete(res);});
  });
  app.post('/api/obs/connect', async (req,res) => {
    await obs.connect(req.body.url || process.env.OBS_URL || 'ws://127.0.0.1:4455', req.body.password || process.env.OBS_PASSWORD || '');
    res.json({connected:true,scene:obs.scene});
  });
  app.post('/api/capture', async (req,res) => {
    const albumId=req.body?.albumId||store.data.settings.activeAlbumId;
    if(!store.data.albums.some(a=>a.id===albumId)) throw new Error('Choose a destination album.');
    res.status(201).json(await capture(null,albumId));
  });
  app.post('/api/albums',async(req,res)=>{
    if(typeof req.body.title!=='string'||!req.body.title.trim()) throw new Error('Give your album a name.');
    const album={...fontEdits(req.body),id:randomUUID(),title:req.body.title.trim().slice(0,60),subtitle:typeof req.body.subtitle==='string'?req.body.subtitle.slice(0,100):'',theme:themes.includes(req.body.theme)?req.body.theme:'midnight',mode:req.body.mode==='binder'?'binder':'scrapbook',createdAt:new Date().toISOString()};
    store.data.albums.push(album);await store.save();broadcast();res.status(201).json(album);
  });
  app.patch('/api/albums/:id',async(req,res)=>{
    const album=store.data.albums.find(a=>a.id===req.params.id);if(!album)return res.status(404).json({error:'Album not found.'});
    Object.assign(album,fontEdits(req.body));
    for(const [key,max] of [['title',60],['subtitle',100],['designId',50]])if(typeof req.body[key]==='string')album[key]=req.body[key].slice(0,max);
    if(themes.includes(req.body.theme))album.theme=req.body.theme;
    if(['scrapbook','binder'].includes(req.body.mode))album.mode=req.body.mode;
    await store.save();broadcast();const {shareToken,...safe}=album;res.json(safe);
  });
  app.post('/api/albums/:id/share',async(req,res)=>{
    const album=store.data.albums.find(a=>a.id===req.params.id);if(!album)return res.status(404).json({error:'Album not found.'});
    if(!album.shareToken){album.shareToken=randomBytes(24).toString('hex');await store.save();}
    res.json({url:`http://localhost:${port}/view/${album.shareToken}`});
  });
  app.get('/api/gallery/:token',(req,res)=>{
    const album=store.data.albums.find(a=>a.shareToken===req.params.token);if(!album)return res.status(404).json({error:'This collection is not available.'});
    const {shareToken,...safeAlbum}=album;
    const photos=store.data.photos.filter(p=>p.albumId===album.id).map(p=>{
      const {trigger,scene,...safe}=p;return {...safe,trigger:p.showAttribution?trigger:null};
    });
    const ids=new Set([album.designId,...photos.map(p=>p.designId),...photos.flatMap(p=>(p.stickers||[]).map(s=>s.kind))]);
    res.json({albums:[safeAlbum],photos,designs:store.data.designs.filter(d=>ids.has(d.id))});
  });
  let exportingPhoto=false;
  app.post('/api/photos/:id/export',async(req,res)=>{
    if(exportingPhoto)return res.status(409).json({error:'A photo is already being exported. Please wait.'});
    const saved=store.data.photos.find(p=>p.id===req.params.id);if(!saved)return res.status(404).json({error:'Photo not found.'});
    const photo={...saved,...photoEdits(req.body)};
    const source=saved.image.startsWith('/images/')?path.join(directory,'images',path.basename(saved.image)):path.join(root,'public','assets',path.basename(saved.image));
    const buffer=await readFile(source),mime=saved.image.endsWith('.svg')?'image/svg+xml':'image/png';
    const svg=photoSvg(photo,store.data.designs,`data:${mime};base64,${buffer.toString('base64')}`);
    const font=fonts[photo.font],fontCss=font?.file?`@font-face{font-family:"${font.family.split(',')[0]}";font-weight:100 900;src:url(data:font/woff2;base64,${(await readFile(path.join(root,'public','fonts',font.file))).toString('base64')}) format("woff2")}`:'';
    const size=photoSize(photo,store.data.designs),width=photo.template==='tcg'?1260:photo.format==='wide'?1920:1200,height=Math.min(4096,Math.round(width*size.height/size.width));
    exportingPhoto=true;
    try{const png=await renderPhotoPng(svg,{width,height,fontCss});res.type('png').send(png);}finally{exportingPhoto=false;}
  });
  app.patch('/api/photos/:id', async (req,res) => {
    const photo = store.data.photos.find(p => p.id === req.params.id);
    if (!photo) return res.status(404).json({error:'Photo not found.'});
    const edits=photoEdits(req.body);
    if(edits.albumId&&!store.data.albums.some(a=>a.id===edits.albumId))throw new Error('Choose an existing album.');
    Object.assign(photo, edits); await store.save(); broadcast(); res.json(photo);
  });
  app.patch('/api/album', async (req,res) => {
    const { title, subtitle, theme, mode, designId } = req.body;
    Object.assign(store.data.album,fontEdits(req.body));
    if (typeof title === 'string') store.data.album.title = title.slice(0,60);
    if (typeof subtitle === 'string') store.data.album.subtitle = subtitle.slice(0,100);
    if (themes.includes(theme)) store.data.album.theme = theme;
    if (['scrapbook','binder'].includes(mode)) store.data.album.mode = mode;
    if (typeof designId === 'string') store.data.album.designId = designId.slice(0,50);
    await store.save(); broadcast(); res.json(store.data.album);
  });
  app.patch('/api/settings', async (req,res) => {
    const body = req.body, settings = store.data.settings;
    Object.assign(settings,fontEdits(body));
    if (templates.includes(body.template)) settings.template = body.template;
    if(['square','wide'].includes(body.format))settings.format=body.format;
    if(['matte','holo','prismatic'].includes(body.finish))settings.finish=body.finish;
    if(body.activeAlbumId){if(!store.data.albums.some(a=>a.id===body.activeAlbumId))throw new Error('Unknown album.');settings.activeAlbumId=body.activeAlbumId;}
    if ('designId' in body) {
      if (body.designId && !store.data.designs.some(d=>d.id===body.designId&&d.kind==='frame')) throw new Error('Unknown frame design.');
      settings.designId = body.designId || '';
    }
    for (const key of ['bitsEnabled','subsEnabled','showAttribution','captureCountdown','captureAnimation']) if (typeof body[key] === 'boolean') settings[key] = body[key];
    if ('minBits' in body) { if (!Number.isInteger(body.minBits) || body.minBits < 1 || body.minBits > 1000000) throw new Error('Minimum Bits must be between 1 and 1,000,000.'); settings.minBits = body.minBits; }
    await store.save(); broadcast(); res.json(settings);
  });
  app.post('/api/demo', async (_req,res) => {
    // Explicit sample content. Never fall back to a sample after failed live capture.
    const titles = ['Chat, did you see that?', 'One more adventure', 'One for the highlight reel', 'Same time tomorrow?'];
    for (let i=0;i<4;i++) {
      const id = randomUUID();
      store.data.photos.push({id, image:`/assets/${['stream-reaction.png','stream-adventure.png','stream-competitive.png'][i%3]}`,createdAt:new Date().toISOString(),title:titles[i],
        caption:i===2?'A little chaos. A lot of heart.':'The moments between the big moments.',
        albumId:store.data.settings.activeAlbumId, format:i===1?'wide':'square',finish:i===2?'holo':'matte',rarity:i===2?'legendary':'rare',power:250,
        template: ['polaroid','film','tcg','polaroid'][i], demo:true, stickers:i===0?[{id:randomUUID(),kind:'flower',x:87,y:87,rotation:12,scale:1}]:[],
        showAttribution:i===2, trigger:i===2?{kind:'bits',viewer:'cozyviewer',amount:500,unit:'Bits'}:null});
    }
    await store.save(); broadcast(); res.status(201).json({ok:true});
  });
  app.post('/api/demo/clear', async (_req,res) => { store.data.photos = store.data.photos.filter(p => !p.demo); await store.save(); broadcast(); res.json({ok:true}); });
  app.post('/api/auth/:provider', (req,res) => {
    if (!['chatgpt','twitch'].includes(req.params.provider)) return res.sendStatus(404);
    res.json({url:req.params.provider==='twitch'?twitch.start():chatgpt.start()});
  });
  for (const [name, provider] of [['twitch',twitch],['chatgpt',chatgpt]]) {
    app.get(`/auth/${name}/callback`, async (req,res) => {
      await provider.callback(req.query); broadcast(); res.redirect(`http://localhost:${port}/?connected=${name}`);
    });
    app.post(`/api/${name}/disconnect`, async (_req,res) => {
      if (name==='twitch') twitch.disconnect();
      delete store.data[name]; await store.save(); broadcast(); res.json({ok:true});
    });
  }
  app.get('/api/ai/models', async (_req,res) => res.json(await chatgpt.models()));
  app.post('/api/ai/design', async (req,res) => {
    if (!['frame','album','sticker'].includes(req.body.kind) || typeof req.body.prompt !== 'string' || !req.body.prompt.trim()) throw new Error('Choose a design type and describe your idea.');
    if (aiBusy) return res.status(409).json({error:'A design is already being created. Please wait.'});
    aiBusy = true;
    try {
      const generated = {id:randomUUID(), ...await chatgpt.design(req.body.kind,req.body.prompt,req.body.model,req.body.format||'instant')};
      store.data.artworkDraft={kind:generated.kind,format:generated.format,raw:JSON.stringify(generated),createdAt:new Date().toISOString()};
      await store.save();
      const design = await renderArtwork(generated,directory);
      delete store.data.artworkDraft;
      store.data.designs.push(design); await store.save(); broadcast(); res.status(201).json(design);
    } finally { aiBusy = false; }
  });
  app.post('/api/ai/design/recover',async(_req,res)=>{
    const draft=store.data.artworkDraft;if(!draft)throw new Error('There is no saved artwork to prepare.');
    if(aiBusy)return res.status(409).json({error:'An artwork operation is already running.'});
    aiBusy=true;
    try{
      const generated={id:randomUUID(),...validateArtwork(JSON.parse(draft.raw),draft.kind,canvasFor(draft.kind,draft.format)),format:draft.format};
      const design=await renderArtwork(generated,directory);
      delete store.data.artworkDraft;store.data.designs.push(design);await store.save();broadcast();res.status(201).json(design);
    }finally{aiBusy=false;}
  });
  app.get('/api/overlay-url', async (_req,res) => {
    if (!store.data.overlayToken) {store.data.overlayToken=randomBytes(24).toString('hex');await store.save();}
    res.json({url:`http://localhost:${port}/overlay.html?token=${store.data.overlayToken}`});
  });
  app.get('/api/overlay', (req,res) => {
    if (!store.data.overlayToken || req.query.token !== store.data.overlayToken) return res.sendStatus(403);
    const photo = store.data.photos.filter(p=>!p.demo).at(-1);
    const effect=captureEffect&&(captureEffect.phase==='countdown'||captureEffect.endsAt>Date.now())?captureEffect:null;
    if (!photo) return res.json({photo:null,effect,serverTime:Date.now()});
    const {trigger,showAttribution,...safe} = photo;
    res.json({photo:{...safe,showAttribution,trigger:showAttribution?trigger:null},designs:store.data.designs,effect,serverTime:Date.now()});
  });
  app.use('/images', express.static(path.join(directory,'images')));
  app.use('/design-assets', express.static(path.join(directory,'designs')));
  app.get('/view/:token',(_req,res)=>res.sendFile(path.join(root,'public','viewer.html')));
  for(const route of ['/studio','/designs','/connections'])app.get(route,(_req,res)=>res.sendFile(path.join(root,'public','index.html')));
  app.use(express.static(path.join(root,'public')));
  app.use((error,req,res,_next) => {
    if (req.path.startsWith('/auth/')) return res.status(400).type('text').send(`Connection failed: ${error.message}\nReturn to StreamPics and try again.`);
    res.status(error.status || 400).json({error:error.message || 'Something went wrong.'});
  });
  return {app,store,obs,twitch,close:()=>{twitch.disconnect();obs.client?.disconnect();for(const client of clients)client.end();}};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = await createApp();
  const server = runtime.app.listen(port,'127.0.0.1',() => console.log(`StreamPics: http://localhost:${port}`));
  if (process.env.OBS_PASSWORD) runtime.obs.connect(process.env.OBS_URL || 'ws://127.0.0.1:4455',process.env.OBS_PASSWORD).catch(()=>console.log('OBS is not connected. Connect it from Studio.'));
  if (runtime.store.data.twitch?.access_token) runtime.twitch.connect().catch(()=>console.log('Reconnect Twitch from Studio.'));
  for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{runtime.close();server.close(()=>process.exit(0));});
}
