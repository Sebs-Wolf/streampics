import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {canvasFor,validateArtwork,renderArtwork,importArtwork,renderPhotoPng} from '../server/artwork.js';
import {photoSvg,stickerSvg,stickerNames} from '../public/render.js';
import {albumCover} from '../public/collection.js';
import {createApp} from '../server/index.js';
const fixtures=path.resolve('data/test-fixtures');await mkdir(fixtures,{recursive:true});
test('HTML artwork supports arbitrary original composition and rejects active/external content',()=>{
 const design=validateArtwork({name:'Nebula',html:'<div data-layer="background"><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h40v40Z"/></svg></div>',css:'.cloud{background:conic-gradient(red,blue);filter:blur(12px)}'},'sticker',canvasFor('sticker'));
 assert.equal(design.engine,'html-css');assert.ok(design.css.includes('conic-gradient'));
 for(const html of ['<script>alert(1)</script>','<iframe src="file:///secret"></iframe>','<img src="https://example.com/a.png">','<div onclick="steal()"></div>'])assert.throws(()=>validateArtwork({html,css:''},'sticker',canvasFor('sticker')),/self-contained/);
 assert.throws(()=>validateArtwork({html:'<div>'+'.'.repeat(180000)+'</div>',css:''},'sticker',canvasFor('sticker')),/too large/);
});
test('freeform CSS is rasterized into independent layers, editable slots, and reusable exports',async()=>{
 const directory=await mkdtemp(path.join(fixtures,'art-render-'));
 try{
  const source={name:'Test aurora',html:'<div data-layer="background" class="bg"><div class="orb"></div></div><div data-slot="photo"></div><div data-slot="title"></div><div data-layer="foreground"><div class="badge"></div></div>',css:'.bg{position:absolute;inset:0;background:linear-gradient(135deg,#141428,#263650)}.orb{position:absolute;width:130px;height:130px;border-radius:50%;background:radial-gradient(circle,#aabbff,#443366);top:0;right:0}[data-slot="photo"]{position:absolute;left:20px;top:30px;width:360px;height:320px;border-radius:12px}[data-slot="title"]{position:absolute;left:25px;top:385px;width:350px;height:65px;font:24px/30px Georgia;color:#f5e6ca;text-align:center}.badge{position:absolute;left:12px;top:12px;width:40px;height:40px;background:#ffaabb;border-radius:50%}'};
  const rendered=await renderArtwork({id:'test-art',...validateArtwork(source,'frame',canvasFor('frame'))},directory);
  assert.equal(rendered.slots.photo.width,360);assert.equal(rendered.slots.title.fontSize,24);
  const bg=Buffer.from(rendered.asset.split(',')[1],'base64'),front=Buffer.from(rendered.foreground.split(',')[1],'base64');
  const metadata=await sharp(bg).metadata();assert.equal(metadata.width,800);assert.equal(metadata.height,960);
  const frontPixel=await sharp(front).extract({left:400,top:400,width:1,height:1}).ensureAlpha().raw().toBuffer();assert.equal(frontPixel[3],0);
  const svg=photoSvg({id:'p',title:'Editable title',caption:'A story',image:'/photo.png',createdAt:new Date().toISOString(),template:'polaroid',designId:'test-art'},[rendered]);
  assert.ok(svg.includes('data:image/png;base64,'));assert.ok(svg.includes('Editable title'));assert.ok(svg.includes('width="360" height="320"'));
  const cover=albumCover({id:'a',title:'My live album title',designId:rendered.id},1,[rendered]);assert.ok(cover.includes('My live album title'));assert.ok(cover.includes('custom-cover'));
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('imported raster art preserves alpha and is normalized for stickers and album covers',async()=>{
 const directory=await mkdtemp(path.join(fixtures,'art-import-'));
 try{
  const buffer=await sharp({create:{width:100,height:100,channels:4,background:{r:255,g:50,b:100,alpha:.5}}}).png().toBuffer();
  const design=await importArtwork(buffer,{id:'imported',kind:'sticker',name:'A sticker'},directory);
  assert.equal(design.engine,'image-import');assert.equal(design.width,512);assert.equal((await sharp(Buffer.from(design.asset.split(',')[1],'base64')).metadata()).hasAlpha,true);
  await assert.rejects(importArtwork(Buffer.from('not an image'),{id:'bad',kind:'album'},directory));
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('image import and completed-artwork recovery work without a ChatGPT connection',async()=>{
 const directory=await mkdtemp(path.join(fixtures,'art-api-'));
 const runtime=await createApp({directory,obsOverride:{connected:false}}),server=runtime.app.listen(0,'127.0.0.1');
 await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const png=await sharp({create:{width:20,height:20,channels:4,background:'#ab55de'}}).png().toBuffer();
  const imported=await fetch(base+'/api/designs/import?kind=sticker&name=Original',{method:'POST',headers:{'Content-Type':'image/png','X-StreamPics-Client':'studio'},body:png});assert.equal(imported.status,201);assert.equal((await imported.json()).kind,'sticker');
  runtime.store.data.artworkDraft={kind:'album',format:'instant',raw:JSON.stringify({name:'Recovered cover',html:'<div data-layer="background" class="sky"></div><div data-slot="title"></div>',css:'.sky{position:absolute;inset:0;background:radial-gradient(circle,#ab55de,#162345)}[data-slot="title"]{position:absolute;left:30px;top:650px;width:540px;height:100px;font:36px/44px Georgia;color:white}'})};
  const result=await fetch(base+'/api/ai/design/recover',{method:'POST',headers:{'X-StreamPics-Client':'studio'}});assert.equal(result.status,201);assert.equal((await result.json()).name,'Recovered cover');
  assert.equal(runtime.store.data.artworkDraft,undefined);assert.equal(runtime.store.data.chatgpt,undefined);assert.equal(runtime.store.data.designs.length,2);
 }finally{runtime.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});}
});

test('modern bundled fonts render in PNG exports, and cover compositions use HTML instead of SVG',async()=>{
 const font=await readFile('public/fonts/space-grotesk.woff2');
 const svg='<svg class="photo-art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 120"><rect width="400" height="120" fill="black"/><text x="15" y="75" font-family="Space Grotesk, Arial" font-size="44" fill="white">StreamPics 42</text></svg>';
 const fontCss=`@font-face{font-family:"Space Grotesk";font-weight:100 900;src:url(data:font/woff2;base64,${font.toString('base64')}) format("woff2")}`;
 const modern=await renderPhotoPng(svg,{width:400,height:120,fontCss});
 const fallback=await renderPhotoPng(svg,{width:400,height:120});
 assert.equal((await sharp(modern).metadata()).width,400);assert.notDeepEqual(modern,fallback);
 for(const theme of ['midnight','sage','rose','sand']){
  const html=albumCover({id:'sample',title:'Chat <3',theme,mode:'binder',font:'outfit'},7);
  assert.ok(!html.includes('<svg'));assert.ok(html.includes('collector-cover'));assert.ok(html.includes('Chat &lt;3'));assert.ok(html.includes('Outfit, Arial'));
 }
 const cover=albumCover({id:'a',title:'Custom text',designId:'d'},1,[{id:'d',asset:'data:image/png;base64,AA==',width:600,height:800,slots:{title:{x:30,y:600,width:500,height:100,fontSize:40,fontFamily:'Sora'}}}]);
 assert.ok(!cover.includes('<svg'));assert.ok(cover.includes('cover-custom-label'));assert.ok(cover.includes('Custom text'));
});

test('empty album dedications stay empty on all cover styles and generated artwork',()=>{
 for(const subtitle of ['',undefined,'   ']){
  for(const theme of ['midnight','sage','rose','sand']){
   const html=albumCover({id:'blank',title:'No dedication',subtitle,theme});
   assert.ok(!html.includes('<p>'));assert.ok(!html.includes('You had to be there'));
  }
 }
 const html=albumCover({id:'a',title:'Title',subtitle:'',designId:'d'},1,[{id:'d',asset:'data:image/png;base64,AA==',width:600,height:800,slots:{caption:{x:10,y:650,width:500,height:60,fontSize:20}}}]);
 assert.ok(!html.includes('cover-custom-label'));
 assert.ok(albumCover({id:'text',title:'Title',subtitle:'Our own dedication'}).includes('Our own dedication'));
});

test('default emoji stickers use vector paths and remain renderable at large export sizes',async()=>{
 for(const key of Object.keys(stickerNames)){
  const svg=stickerSvg(key);assert.match(svg,/<(?:path|circle|ellipse|rect|polygon|polyline)\b/,key);assert.ok(!/<text|<image|<filter|feMorphology/.test(svg));
 }
 for(const key of ['star','flower','hype']){
  const png=await sharp(Buffer.from(stickerSvg(key)),{density:576}).resize(768,768).png().toBuffer();
  const info=await sharp(png).metadata();assert.equal(info.width,768);assert.equal(info.height,768);assert.equal(info.hasAlpha,true);
 }
});

test('distinct default cover families retain editable content and blank dedications',async()=>{
 const {coverStyles}=await import('../public/covers.js');
 const families=Object.entries(coverStyles).filter(([,d])=>d.family!=='orbital');assert.equal(families.length,6);
 for(const [theme] of families){
  const html=albumCover({id:'cover-test',theme,title:'Our <stream>',subtitle:'',font:'sora',mode:'binder'},12);
  assert.ok(html.includes(`style-${theme}`));assert.ok(html.includes('Our &lt;stream&gt;'));assert.ok(html.includes('--album-font:Sora'));
  assert.ok(!html.includes('<p>'));assert.ok(!html.includes('<svg'));assert.ok(html.includes('12'));
 }
});
