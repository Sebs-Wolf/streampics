import {collectibleFrame} from './frames.js';
import {fontFamily} from './fonts.js';
import {escape as e,stickerSvg,motifSvg} from './render.js';
import {customArtwork} from './artwork.js';
export function photoSize(photo,designs=[]){const design=designs.find(d=>d.id===photo.designId&&d.kind==='frame');if(design?.asset)return {width:design.width,height:design.height};return photo.template==='tcg'?{width:630,height:880}:photo.format==='wide'?{width:960,height:540}:{width:400,height:480};}
function wrap(text,width=42,max=3){const words=String(text||'').split(/\s+/),out=[''];for(const word of words){if((out.at(-1)+' '+word).length>width&&out.at(-1)){if(out.length===max){out[max-1]+='…';break;}out.push('');}out[out.length-1]+=(out.at(-1)?' ':'')+word;}return out;}
export function photoSvg(photo,designs=[],imageOverride){
 const {width:w,height:h}=photoSize(photo,designs),card=photo.template==='tcg',wide=!card&&photo.format==='wide';
 const design=designs.find(d=>d.id===photo.designId),id=`p${String(photo.id).replace(/[^a-z0-9]/gi,'')}${card?'c':wide?'w':'s'}`;
 const color=design?.accent||(photo.rarity==='legendary'?'#f3bc62':photo.rarity==='epic'?'#b99cff':'#8ad8e0'),ink=design?.ink||'#e9eefa';
 const isHolo=['holo','prismatic'].includes(photo.finish),prism=photo.finish==='prismatic';
 const attribution=photo.showAttribution&&photo.trigger?`${photo.trigger.viewer} · ${photo.trigger.amount} ${photo.trigger.unit}`:'';
 const meta=attribution||(photo.demo?'SAMPLE / FICTIONAL STREAM':new Date(photo.createdAt).toLocaleDateString('en',{month:'short',day:'numeric',year:'numeric'}));
 const image=e(imageOverride||photo.image),title=e(photo.title||'Untitled moment'),caption=photo.caption||'';
 const font=fontFamily(photo.font);
 const svgText=(text,x,y,size=14,fill=ink,extra='')=>`<text x="${x}" y="${y}" font-family="${e(font||'Arial,sans-serif')}" font-size="${size}" fill="${fill}" ${extra}>${e(text)}</text>`;
 let art=card?{x:33,y:131,w:564,h:354}:wide?{x:0,y:0,w:960,h:540}:{x:18,y:18,w:364,h:364};
 let content='';
 if(design?.asset){
  content=customArtwork(design,{title:photo.title,caption:photo.caption,attribution,power:photo.power??100},imageOverride||photo.image,wide?'meet':'slice',font);
 }else if(!design&&['postcard','ticket'].includes(photo.template)){
  ({content,art}=collectibleFrame({photo,wide,image,id,title,caption,meta,svgText,font}));
 }else if(card){
  content=`<rect x="3" y="3" width="624" height="874" rx="29" fill="#10131e" stroke="${color}" stroke-width="6"/><rect x="14" y="14" width="602" height="852" rx="21" fill="url(#${id}metal)" stroke="#ffffff40" stroke-width="2"/><path d="M27 112V45L45 27H585L603 45V112 M27 503V835L45 853H585L603 835V503" fill="none" stroke="${color}" stroke-width="2" opacity=".7"/>
  ${svgText('STREAM MOMENT',36,54,13,color,'letter-spacing="4"')}${svgText('SP / 01',590,54,12,color,'text-anchor="end" letter-spacing="2"')}
  <text x="35" y="96" fill="#f3f4fb" font-family="${e(font||'Arial,sans-serif')}" font-size="27" font-weight="700" ${String(photo.title).length>30?'textLength="440" lengthAdjust="spacingAndGlyphs"':''}>${title}</text>${svgText(photo.power??100,586,97,25,color,'text-anchor="end" font-weight="700"')}
  <rect x="29" y="126" width="572" height="365" rx="9" fill="#000" stroke="${color}" stroke-width="3"/>
  <image href="${image}" x="${art.x}" y="${art.y}" width="${art.w}" height="${art.h}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id}crop)"/>
  ${isHolo?`<rect x="33" y="131" width="564" height="354" fill="url(#${id}foil)" opacity="${prism ? .10 : .06}" style="mix-blend-mode:screen"/>`:''}
  <path d="M37 504H593L578 541H52Z" fill="#101827" stroke="${color}"/>${svgText((photo.rarity||'rare').toUpperCase()+'  /  '+(isHolo?photo.finish.toUpperCase()+' FOIL':'FIRST EDITION'),315,528,14,color,'text-anchor="middle" letter-spacing="3"')}
  ${svgText('✦  MOMENT OF IMPACT',39,584,19,color,'font-weight="700"')}${svgText('∞',585,584,25,color,'text-anchor="end"')}
  <rect x="33" y="605" width="564" height="123" rx="7" fill="#0b1020" stroke="#ffffff1d"/>
  ${wrap(caption||'A moment worth keeping. A story only this community could tell.',56,4).map((line,i)=>svgText(line,49,636+i*23,17,'#c4c9dc')).join('')}
  <path d="M38 751H592" stroke="${color}" opacity=".6"/>${svgText(attribution?'CAPTURED BY THE COMMUNITY':'COLLECTED LIVE',38,781,12,color,'letter-spacing="2"')}${svgText(meta,38,805,13,'#c3c8db')}
  ${svgText('STREAM PICS',38,840,12,'#8c94af','letter-spacing="3"')}${svgText('◆  '+String(photo.id).slice(0,6).toUpperCase()+' / SP',592,840,12,color,'text-anchor="end"')}`;
 }else if(wide){
  content=`<rect width="960" height="540" rx="8" fill="#10131c"/><image href="${image}" width="960" height="540" preserveAspectRatio="xMidYMid meet" clip-path="url(#${id}crop)"/><rect width="960" height="540" rx="8" fill="url(#${id}shade)"/><rect x="16" y="16" width="928" height="508" rx="4" stroke="${design?.accent||'#ffffff66'}" fill="none"/>${svgText('STREAM PICS  /  ORIGINAL FRAME',34,43,11,'#ffffffcc','letter-spacing="3"')}${svgText(photo.title||'Untitled moment',34,447,28,'#ffffff','font-weight="700"')}${svgText(caption.slice(0,110),34,479,15,'#d6dbea')}${svgText(meta,34,508,11,'#b1bbcf')}`;
 }else{
  const dark=['noir','film'].includes(photo.template),bg=design?.background||(dark?'#151923':'#f4f2e9'),text=design?.ink||(dark?'#edf0fa':'#252b36');
  content=`<rect x="1" y="1" width="398" height="478" rx="3" fill="${bg}" stroke="${dark?'#ffffff2a':'#00000020'}"/><image href="${image}" x="18" y="18" width="364" height="364" preserveAspectRatio="xMidYMid slice" clip-path="url(#${id}crop)"/>${photo.template==='film'?Array.from({length:10},(_,i)=>`<rect x="${24+i*37}" y="386" width="19" height="6" rx="1" fill="#8e97b2"/>`).join(''):''}<text x="200" y="414" text-anchor="middle" fill="${text}" font-family="${e(font||(photo.template==='polaroid'?'Georgia,serif':'Arial,sans-serif'))}" font-size="${String(photo.title).length>30?14:19}" ${String(photo.title).length>45?'textLength="354" lengthAdjust="spacingAndGlyphs"':''}>${title}</text>${svgText(caption.slice(0,55),200,439,10,text,'text-anchor="middle" opacity=".7"')}${svgText(meta,200,464,8,text,'text-anchor="middle" opacity=".6"')}${design?`<g transform="translate(355 378) scale(.4)">${motifSvg(design.motif,color,text)}</g>`:''}`;
 }
 return `<svg class="photo-art" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${title}"><defs><clipPath id="${id}crop"><rect x="${art.x}" y="${art.y}" width="${art.w}" height="${art.h}" rx="${card?5:photo.template==='postcard'&&!design?10:0}"/></clipPath><linearGradient id="${id}metal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#30364b"/><stop offset=".35" stop-color="#111626"/><stop offset=".65" stop-color="#24283d"/><stop offset="1" stop-color="#080d18"/></linearGradient><linearGradient id="${id}foil" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#68f8e8"/><stop offset=".2" stop-color="#8386ff"/><stop offset=".4" stop-color="#f888d8"/><stop offset=".6" stop-color="#ffdd85"/><stop offset=".8" stop-color="#7bffd8"/><stop offset="1" stop-color="#8ba3ff"/></linearGradient><linearGradient id="${id}shade" x1="0" y1="0" x2="0" y2="1"><stop offset=".45" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#090d1a" stop-opacity=".93"/></linearGradient></defs>${content}${isHolo&&card?`<rect x="14" y="14" width="602" height="852" rx="21" fill="url(#${id}foil)" opacity=".025"/>${Array.from({length:36},(_,i)=>`<circle cx="${25+(i*137)%580}" cy="${25+(i*197)%820}" r="${i%3+1}" fill="#fff" opacity=".14"/>`).join('')}`:''}${(photo.stickers||[]).map(s=>`<g class="photo-sticker" data-sticker-id="${e(s.id)}" transform="translate(${s.x*w/100} ${s.y*h/100}) rotate(${s.rotation}) scale(${s.scale*(card?1.5:wide?1.3:1)})">${stickerSvg(s.kind,designs).replace(/<svg[^>]*>|<\/svg>/g,'')}</g>`).join('')}</svg>`;
}
