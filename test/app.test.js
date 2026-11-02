import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createApp} from '../server/index.js';
import {normalizeTwitchEvent,photoEdits,validateDesign} from '../server/designs.js';
import {ChatGPT} from '../server/chatgpt.js';
import {Store} from '../server/store.js';
import {photoSvg,photoSize} from '../public/render.js';
const fixtures=path.resolve('data/test-fixtures');
await mkdir(fixtures,{recursive:true});

test('gift sub notifications do not also produce subscription photos; anonymous Cheers remain anonymous',()=>{
  assert.equal(normalizeTwitchEvent('channel.subscribe',{is_gift:true}),null);
  assert.deepEqual(normalizeTwitchEvent('channel.cheer',{is_anonymous:true,user_name:'Private',bits:500,message:'Hi'}),{kind:'bits',viewer:'Anonymous',amount:500,unit:'Bits',message:'Hi'});
  assert.equal(normalizeTwitchEvent('channel.subscription.gift',{user_name:'Viewer',total:5}).amount,5);
});
test('untrusted designs and photo edits cannot introduce SVG, styles, or unbounded coordinates',()=>{
  const design=validateDesign({kind:'frame',background:'url(https://bad)',accent:'red;position:absolute',motif:'<script>',name:'A design'});
  assert.equal(design.background,'#ede8dd');assert.equal(design.motif,'stars');
  const edit=photoEdits({image:'https://bad',stickers:[{id:'s',kind:'star',x:999,y:-40,scale:100}]});
  assert.equal(edit.image,undefined);assert.equal(edit.stickers[0].x,100);assert.equal(edit.stickers[0].y,0);assert.equal(edit.stickers[0].scale,2);
  const svg=photoSvg({id:'p',createdAt:new Date().toISOString(),title:'<script>alert(1)</script>',caption:'"&',image:'/assets/scene-0.svg',stickers:[]});
  assert.ok(!svg.includes('<script>'));assert.ok(svg.includes('&lt;script&gt;'));
});
test('ChatGPT uses stable host identity, fresh PKCE, and rejects unknown or replayed callback state',async()=>{
  const directory=await mkdtemp(path.join(fixtures,'auth-'));
  try{
    const store=await new Store(directory).init(),auth=new ChatGPT(store,3000);
    const first=new URL(auth.start()),second=new URL(auth.start());
    assert.equal(first.searchParams.get('client_id'),'dynamic_agent_client');
    assert.equal(first.searchParams.get('ext_agent_host_id'),second.searchParams.get('ext_agent_host_id'));
    assert.notEqual(first.searchParams.get('state'),second.searchParams.get('state'));
    assert.notEqual(first.searchParams.get('code_challenge'),second.searchParams.get('code_challenge'));
    assert.equal(first.searchParams.get('redirect_uri'),'http://127.0.0.1:3000/auth/chatgpt/callback');
    await assert.rejects(auth.callback({state:'unknown'}),/expired/);
    const state=first.searchParams.get('state');await assert.rejects(auth.callback({state,error:'access_denied'}),/declined/);
    await assert.rejects(auth.callback({state}),/expired/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
test('AI designs require a completed stream and preserve Unicode across network chunks',async()=>{
  const account={access_token:'test-only',expires_at:Date.now()+3600000,scopes:['chatgpt.tokens.use.direct']};
  const auth=new ChatGPT({data:{chatgpt:account}},3000);
  auth.models=async()=>[{slug:'test-model',name:'Test model'}];
  const originalFetch=globalThis.fetch;
  const design=JSON.stringify({name:'Café stars',html:'<div data-layer="background" class="nebula"></div><div data-slot="photo"></div>',css:'.nebula{background:conic-gradient(#227799,#9933aa)}'});
  const bytes=new TextEncoder().encode(`data: ${JSON.stringify({type:'response.output_text.delta',delta:design})}\n\ndata: ${JSON.stringify({type:'response.completed'})}\n\n`);
  try{
    globalThis.fetch=async(_url,options)=>{
      const request=JSON.parse(options.body);assert.equal(request.store,false);assert.equal(request.stream,true);assert.equal(request.model,'test-model');
      return new Response(new ReadableStream({start(controller){for(const byte of bytes)controller.enqueue(Uint8Array.of(byte));controller.close();}}));
    };
    const result=await auth.design('frame','A warm starry café','test-model');assert.equal(result.name,'Café stars');
    globalThis.fetch=async()=>new Response(`data: ${JSON.stringify({type:'response.output_text.delta',delta:design})}\n\n`);
    await assert.rejects(auth.design('frame','A design','test-model'),/ended early/);
  }finally{globalThis.fetch=originalFetch;}
});
test('local app saves captures and edits, keeps attribution private in overlay, and reports real capture failures',async()=>{
  const directory=await mkdtemp(path.join(fixtures,'app-'));
  let fail=false;
  const obs={connected:true,scene:'Program',capture:async()=>{if(fail)throw new Error('OBS disconnected');return {buffer:Buffer.from('sample bytes'),scene:'Program'};}};
  const runtime=await createApp({directory,obsOverride:obs});
  const server=runtime.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=async(url,method='GET',body)=>{const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json','X-StreamPics-Client':'studio'},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};};
  try{
    const forbidden=await fetch(base+'/api/capture',{method:'POST'});assert.equal(forbidden.status,403);
    const origin=await fetch(base+'/api/state',{headers:{Origin:'https://example.com'}});assert.equal(origin.status,403);
    await call('/api/settings','PATCH',{font:'mono'});
    const captured=await call('/api/capture','POST');assert.equal(captured.data.font,'mono');assert.equal(captured.status,201);assert.ok(captured.data.image.endsWith('.png'));
    await call(`/api/photos/${captured.data.id}`,'PATCH',{title:'Our moment',caption:'We did it',font:'serif',template:'tcg',showAttribution:false});
    let library=(await call('/api/state')).data;assert.equal(library.photos[0].title,'Our moment');assert.equal(library.photos[0].template,'tcg');
    assert.equal(library.hostId,undefined);assert.equal(library.twitch?.access_token,undefined);
    const reloaded=await new Store(directory).init();assert.equal(reloaded.data.photos[0].title,'Our moment');assert.equal(reloaded.data.photos[0].font,'serif');assert.equal(reloaded.data.settings.font,'mono');
    runtime.store.data.photos[0].trigger={viewer:'PrivateViewer',amount:500,unit:'Bits'};
    const {url}= (await call('/api/overlay-url')).data;
    const overlay=(await call('/api/overlay'+new URL(url).search)).data;assert.equal(overlay.photo.trigger,null);
    const unauthed=await fetch(base+'/api/overlay?token=wrong');assert.equal(unauthed.status,403);
    fail=true;assert.equal((await call('/api/capture','POST')).status,400);
    library=(await call('/api/state')).data;assert.equal(library.photos.length,1);
    await call('/api/demo','POST');assert.equal((await call('/api/state')).data.photos.length,5);
    await call('/api/demo/clear','POST');assert.equal((await call('/api/state')).data.photos.length,1);
    const html=await fetch(base+'/');assert.equal(html.status,200);assert.ok((await html.text()).includes('StreamPics'));
    const firstAlbum=runtime.store.data.albums[0];
    const second=(await call('/api/albums','POST',{title:'Rare pulls',mode:'binder',theme:'arcade'})).data;
    assert.notEqual(firstAlbum.id,second.id);assert.equal(second.theme,'arcade');
    assert.equal((await call(`/api/albums/${second.id}`,'PATCH',{theme:'quest'})).data.theme,'quest');
    assert.equal((await call(`/api/albums/${second.id}`,'PATCH',{font:'impact'})).data.font,'impact');
    assert.equal((await call('/api/settings','PATCH',{font:'url(https://bad)'})).status,400);
    assert.equal((await call(`/api/photos/${captured.data.id}`,'PATCH',{font:'unknown'})).status,400);
    await call(`/api/photos/${captured.data.id}`,'PATCH',{albumId:second.id,format:'wide',finish:'holo',rarity:'legendary'});
    await call('/api/settings','PATCH',{activeAlbumId:second.id});
    const {url:shareUrl}=(await call(`/api/albums/${second.id}/share`,'POST')).data;
    const token=new URL(shareUrl).pathname.split('/').at(-1);
    const gallery=(await call(`/api/gallery/${token}`)).data;
    assert.equal(gallery.albums[0].font,'impact');assert.equal(gallery.photos[0].font,'serif');
    assert.equal(gallery.albums.length,1);assert.equal(gallery.albums[0].title,'Rare pulls');
    assert.equal(gallery.photos.length,1);assert.equal(gallery.photos[0].finish,'holo');
    assert.equal(gallery.photos[0].trigger,null);assert.equal(gallery.photos[0].scene,undefined);
    assert.equal(gallery.settings,undefined);assert.equal(gallery.albums[0].shareToken,undefined);
    assert.equal((await call(`/api/gallery/invalid`)).status,404);
    const viewer=await (await fetch(base+`/view/${token}`)).text();
    assert.ok(viewer.includes('viewer.js'));assert.ok(!viewer.includes('app.js'));assert.ok(!viewer.includes('editor'));
    assert.equal((await call(`/api/photos/${captured.data.id}`,'PATCH',{albumId:'missing'})).status,400);
  }finally{runtime.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
test('single-album migration retains original metadata, photos, and credentials across restarts',async()=>{
 const directory=await mkdtemp(path.join(fixtures,'migration-'));
 try{
  const legacy={album:{title:'Original collection',theme:'sage',mode:'scrapbook'},photos:[{id:'old-photo',title:'Keep me',image:'/old.png'}],settings:{template:'polaroid'},chatgpt:{client_id:'fake-registration',access_token:'test-only'},designs:[],events:[],seen:[]};
  await writeFile(path.join(directory,'library.json'),JSON.stringify(legacy));
  const migrated=await new Store(directory).init();assert.equal(migrated.data.albums.length,1);assert.equal(migrated.data.albums[0].title,'Original collection');
  assert.equal(migrated.data.photos[0].albumId,migrated.data.albums[0].id);assert.equal(migrated.data.photos[0].title,'Keep me');
  assert.equal(migrated.data.chatgpt.client_id,'fake-registration');
  const restarted=await new Store(directory).init();assert.equal(restarted.data.albums[0].id,migrated.data.albums[0].id);assert.equal(restarted.data.settings.activeAlbumId,migrated.data.albums[0].id);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('photo formats preserve exact card and full-frame ratios, and foil survives SVG export',()=>{
  assert.deepEqual(photoSize({template:'tcg',format:'wide'}),{width:630,height:880});
  assert.deepEqual(photoSize({template:'polaroid',format:'wide'}),{width:960,height:540});
  const photo={id:'one',title:'The clutch',createdAt:new Date().toISOString(),caption:'Our moment',image:'/assets/scene-0.svg',template:'tcg',finish:'prismatic',rarity:'legendary'};
  const svg=photoSvg(photo);assert.ok(svg.includes('viewBox="0 0 630 880"'));assert.ok(svg.includes('PRISMATIC FOIL'));assert.ok(svg.includes('MOMENT OF IMPACT'));
  const wide=photoSvg({...photo,template:'noir',format:'wide'});assert.ok(wide.includes('viewBox="0 0 960 540"'));assert.ok(wide.includes('preserveAspectRatio="xMidYMid meet"'));
});

test('font choices survive built-in and generated artwork rendering while original typography stays available',async()=>{
 const {customArtwork}=await import('../public/artwork.js');
 const {albumCover}=await import('../public/collection.js');
 const photo={id:'font-preview',title:'Our moment',caption:'Keep it',image:'/sample.png',createdAt:new Date().toISOString(),font:'mono'};
 for(const template of ['polaroid','tcg','noir'])assert.match(photoSvg({...photo,template}),/font-family="Courier New, monospace"/);
 assert.match(photoSvg({...photo,font:'template',template:'polaroid'}),/font-family="Georgia,serif"/);
 const design={id:'generated',width:400,height:480,slots:{title:{x:10,y:10,width:300,height:100,fontFamily:'Georgia',fontSize:20}}};
 assert.match(customArtwork(design,{title:'Hello'}),/font-family="Georgia"/);
 assert.match(customArtwork(design,{title:'Hello'},undefined,'slice','Courier New, monospace'),/font-family="Courier New, monospace"/);
 assert.match(albumCover({id:'a',title:'Album',font:'serif'}),/--album-font:Georgia, Times New Roman, serif/);
 assert.throws(()=>photoEdits({font:'__proto__'}),/supported font/);
});

test('foil reflections follow card orientation under a fixed light and stay subtle',async()=>{
 const {foilLighting}=await import('../public/foil.js');
 const initial=foilLighting(-5,-13);
 assert.deepEqual(foilLighting(-5,-13),initial);
 assert.notDeepEqual(foilLighting(-5,25),initial);
 assert.notDeepEqual(foilLighting(25,-13),initial);
 assert.ok(Math.abs(foilLighting(15,20).x-foilLighting(15,380).x)<1e-9);
 for(let pitch=-70;pitch<=70;pitch+=10)for(let yaw=-180;yaw<=180;yaw+=10){const light=foilLighting(pitch,yaw);assert.ok(light.opacity>=0&&light.opacity<=.30001);}
 assert.equal(foilLighting(0,180).opacity,0);
});

test('OBS countdown precedes capture, shutter follows capture, and failures clear the overlay',async()=>{
 const directory=await mkdtemp(path.join(fixtures,'countdown-'));
 let calls=0,fail=false,capturedAt=0;
 const obs={connected:true,scene:'Program',capture:async()=>{calls++;capturedAt=Date.now();if(fail)throw new Error('Lost OBS');return {buffer:Buffer.from('fixture'),scene:'Program'};}};
 const runtime=await createApp({directory,obsOverride:obs});
 const server=runtime.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 const call=async(route,method='GET',body)=>{const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json','X-StreamPics-Client':'studio'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 try{
  await call('/api/settings','PATCH',{captureCountdown:true,captureAnimation:true});
  const saved=await new Store(directory).init();assert.equal(saved.data.settings.captureCountdown,true);assert.equal(saved.data.settings.captureAnimation,true);
  const {url}=(await call('/api/overlay-url')).data,route='/api/overlay'+new URL(url).search;
  const pending=call('/api/capture','POST');
  await new Promise(resolve=>setTimeout(resolve,60));
  const before=(await call(route)).data;assert.equal(before.effect.phase,'countdown');assert.equal(before.photo,null);assert.equal(calls,0);
  assert.ok(before.effect.endsAt>before.serverTime+2500);
  const result=await pending;assert.equal(result.status,201);assert.ok(capturedAt>=before.effect.endsAt+300);
  const after=(await call(route)).data;assert.equal(after.effect.phase,'shutter');assert.equal(after.effect.shutter,true);assert.equal(after.photo.id,result.data.id);
  await call('/api/settings','PATCH',{captureCountdown:false,captureAnimation:false});
  fail=true;const failed=call('/api/capture','POST');await new Promise(resolve=>setTimeout(resolve,60));
  const immediate=(await call(route)).data;assert.ok(immediate.effect.endsAt<=immediate.serverTime);assert.equal(immediate.effect.shutter,false);
  assert.equal((await failed).status,400);assert.equal((await call(route)).data.effect,null);assert.equal(runtime.store.data.photos.length,1);
 }finally{runtime.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});
