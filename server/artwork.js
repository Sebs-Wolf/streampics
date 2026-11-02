import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const designCanvases={instant:{width:400,height:480},wide:{width:960,height:540},tcg:{width:630,height:880},album:{width:600,height:800},sticker:{width:512,height:512}};
export function canvasFor(kind,format='instant'){return designCanvases[kind==='frame'?(format in designCanvases&&['instant','wide','tcg'].includes(format)?format:'instant'):kind];}
export function validateArtwork(input,kind,size){
 if(!input||typeof input.html!=='string'||!input.html.trim()||typeof input.css!=='string')throw new Error('The design must include HTML and CSS artwork.');
 if(Buffer.byteLength(input.html+input.css,'utf8')>180000)throw new Error('The design is too large. Keep HTML and CSS under 180 KB.');
 const forbidden=/<\s*(script|iframe|frame|object|embed|link|meta|base|form|input|button|video|audio)\b|\bon\w+\s*=|javascript\s*:|@import|\b(?:src|href)\s*=\s*["']?\s*(?:https?|file|ftp)\s*:|url\(\s*["']?\s*(?:https?|file|ftp)\s*:/i;
 if(forbidden.test(input.html+'\n'+input.css))throw new Error('Artwork must be self-contained HTML/CSS, without scripts, forms, or external resources.');
 if((input.html.match(/</g)||[]).length>4000)throw new Error('The design has too many elements.');
 return {kind,engine:'html-css',name:String(input.name||'Original artwork').slice(0,60),description:String(input.description||'').slice(0,180),html:input.html,css:input.css,width:size.width,height:size.height};
}
let executablePromise;
async function executable(){
 if(!executablePromise)executablePromise=(async()=>{
  const candidates=[process.env.STREAMPICS_BROWSER,'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe','C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe','C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe','/usr/bin/chromium','/usr/bin/google-chrome'].filter(Boolean);
  for(const candidate of candidates){try{await access(candidate);return candidate;}catch{}}
  throw new Error('HTML artwork needs Chrome or Edge installed. Set STREAMPICS_BROWSER to its executable path.');
 })().catch(error=>{executablePromise=null;throw error;});
 return executablePromise;
}
const policy="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; script-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
export async function renderArtwork(design,directory){
 const browser=await chromium.launch({executablePath:await executable(),headless:true,chromiumSandbox:true,timeout:20000});
 let context;
 try{
  context=await browser.newContext({viewport:{width:design.width,height:design.height},deviceScaleFactor:2,javaScriptEnabled:false,offline:true,serviceWorkers:'block',acceptDownloads:false});
  await context.route('**/*',route=>route.abort());
  const page=await context.newPage();page.setDefaultTimeout(6000);
  await page.setContent(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${policy}"><style>${design.css}</style><style>html,body{margin:0!important;width:${design.width}px!important;height:${design.height}px!important;overflow:hidden!important;background:transparent}*,*::before,*::after{box-sizing:border-box;animation:none!important;transition:none!important;caret-color:transparent!important}#sp-canvas{position:relative;width:${design.width}px;height:${design.height}px;isolation:isolate;overflow:hidden}</style></head><body><div id="sp-canvas">${design.html}</div></body></html>`,{waitUntil:'load',timeout:6000});
  const slots=await page.evaluate(()=>{
   const out={};
   for(const name of ['photo','title','caption','attribution']){
    const node=document.querySelector(`[data-slot="${name}"]`);if(!node)continue;
    const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
    out[name]={x:rect.x,y:rect.y,width:rect.width,height:rect.height,radius:parseFloat(style.borderRadius)||0,fontSize:parseFloat(style.fontSize)||18,color:style.color,fontFamily:style.fontFamily,fontWeight:style.fontWeight,fontStyle:style.fontStyle,align:style.textAlign,lineHeight:parseFloat(style.lineHeight)||parseFloat(style.fontSize)*1.25};
   }
   return out;
  });
  if(design.kind==='frame'&&!slots.photo)throw new Error('The design did not include an editable photo slot. Try generating again.');
  if(['frame','album'].includes(design.kind)&&!slots.title)throw new Error('The design did not include an editable title slot. Try generating again.');
  for(const slot of Object.values(slots))if(slot.width<1||slot.height<1||slot.x<0||slot.y<0||slot.x+slot.width>design.width+1||slot.y+slot.height>design.height+1)throw new Error('The design placed editable content outside its canvas. Try generating again.');
  await page.evaluate(content=>{const style=document.createElement('style');style.textContent=content;document.head.append(style);},'[data-slot]{visibility:hidden!important}');
  const folder=path.join(directory,'designs');await mkdir(folder,{recursive:true});
  const preview=await page.screenshot({omitBackground:true,timeout:6000});
  await writeFile(path.join(folder,`${design.id}.png`),preview);
  let foreground,background=preview;
  if(design.kind==='frame'){
   // The model separates over-photo ornamentation from the background layer.
   await page.evaluate(content=>{const style=document.createElement('style');style.textContent=content;document.head.append(style);},'[data-layer="foreground"]{visibility:hidden!important}');
   background=await page.screenshot({omitBackground:true,timeout:6000});
   await writeFile(path.join(folder,`${design.id}-back.png`),background);
   await page.evaluate(content=>{const style=document.createElement('style');style.textContent=content;document.head.append(style);},'[data-layer="foreground"]{visibility:visible!important}[data-layer="background"]{visibility:hidden!important}body,html,#sp-canvas{background:transparent!important}');
   foreground=await page.screenshot({omitBackground:true,timeout:6000});
   await writeFile(path.join(folder,`${design.id}-front.png`),foreground);
  }
  const asset=buffer=>`data:image/png;base64,${buffer.toString('base64')}`;
  return {...design,slots,asset:asset(background),foreground:foreground?asset(foreground):undefined,preview:`/design-assets/${design.id}.png`};
 }finally{await context?.close().catch(()=>{});await browser.close();}
}
export async function importArtwork(buffer,{kind,name,id,format='instant'},directory){
 if(!['album','frame','sticker'].includes(kind))throw new Error('Choose an album, frame, or sticker.');
 const image=sharp(buffer,{limitInputPixels:16777216,animated:false});
 const info=await image.metadata();if(!['png','jpeg','webp'].includes(info.format))throw new Error('Import a PNG, JPEG, or WebP image.');
 const size=canvasFor(kind,format);
 const png=await image.rotate().resize(size.width,size.height,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer();
 const folder=path.join(directory,'designs');await mkdir(folder,{recursive:true});await writeFile(path.join(folder,`${id}.png`),png);
 const slots=kind==='frame'?{
  photo:{x:size.width*.055,y:size.height*.06,width:size.width*.89,height:size.height*.68,radius:8},
  title:{x:size.width*.07,y:size.height*.78,width:size.width*.86,height:size.height*.08,fontSize:size.width*.046,color:'#ffffff',fontFamily:'Arial',fontWeight:'600',align:'center'},
  caption:{x:size.width*.07,y:size.height*.87,width:size.width*.86,height:size.height*.06,fontSize:size.width*.028,color:'#d6dcea',fontFamily:'Arial',align:'center'}
 }:kind==='album'?{title:{x:48,y:520,width:504,height:145,fontSize:48,color:'#ffffff',fontFamily:'Arial',fontWeight:'700',align:'left'},caption:{x:48,y:680,width:504,height:60,fontSize:20,color:'#e2e4ee',fontFamily:'Arial',align:'left'}}:{};
 return {id,kind,format,name:String(name||'Imported artwork').slice(0,60),engine:'image-import',description:'Imported image artwork',width:size.width,height:size.height,asset:`data:image/png;base64,${png.toString('base64')}`,preview:`/design-assets/${id}.png`,slots};
}

// Export SVG photo artwork as a document so locally bundled web fonts are honored.
export async function renderPhotoPng(svg,{width,height,fontCss=''}){
 const browser=await chromium.launch({executablePath:await executable(),headless:true,chromiumSandbox:true,timeout:20000});
 let context;
 try{
  context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,javaScriptEnabled:false,offline:true,serviceWorkers:'block',acceptDownloads:false});
  await context.route('**/*',route=>route.abort());
  const page=await context.newPage();
  await page.setContent(`<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'"><style>${fontCss}html,body{margin:0;width:${width}px;height:${height}px;overflow:hidden}svg.photo-art{display:block;width:100%;height:100%}</style></head><body>${svg}</body></html>`,{waitUntil:'load',timeout:10000});
  await page.evaluate(async()=>{await document.fonts.ready;});
  return await page.screenshot({omitBackground:true,timeout:10000});
 }finally{await context?.close().catch(()=>{});await browser.close();}
}
