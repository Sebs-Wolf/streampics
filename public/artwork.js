import {escape as e} from './render.js';
export function artworkText(value,slot){
 if(!slot||!value)return '';
 const size=Number(slot.fontSize)||18,line=Number(slot.lineHeight)||size*1.25,max=Math.max(1,Math.floor(slot.height/line));
 const capacity=Math.max(5,Math.floor(slot.width/(size*.55))),rows=[''];
 for(const word of String(value).split(/\s+/)){if((rows.at(-1)+' '+word).length>capacity&&rows.at(-1)){if(rows.length===max){rows[max-1]+='…';break;}rows.push('');}rows[rows.length-1]+=(rows.at(-1)?' ':'')+word;}
 const center=slot.align==='center',end=['right','end'].includes(slot.align),x=slot.x+(center?slot.width/2:end?slot.width:0);
 return rows.map((row,i)=>`<text x="${x}" y="${slot.y+size+i*line}" fill="${e(slot.color||'#fff')}" font-family="${e(slot.fontFamily||'Arial')}" font-size="${size}" font-weight="${e(slot.fontWeight||'400')}" font-style="${e(slot.fontStyle||'normal')}" text-anchor="${center?'middle':end?'end':'start'}">${e(row)}</text>`).join('');
}
export function customArtwork(design,values={},photoImage,fit='slice',font=''){
 const w=design.width,h=design.height,slot=design.slots?.photo,id=`art${String(design.id).replace(/[^a-z0-9]/gi,'')}`;
 const image=(asset)=>asset?`<image href="${e(asset)}" width="${w}" height="${h}" preserveAspectRatio="none"/>`:'';
 return `${image(design.asset)}${slot&&photoImage?`<defs><clipPath id="${id}"><rect x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${slot.height}" rx="${slot.radius||0}"/></clipPath></defs><image href="${e(photoImage)}" x="${slot.x}" y="${slot.y}" width="${slot.width}" height="${slot.height}" preserveAspectRatio="xMidYMid ${fit}" clip-path="url(#${id})"/>`:''}${photoImage?image(design.foreground):''}${Object.entries(values).map(([key,value])=>artworkText(value,design.slots?.[key]?{...design.slots[key],...(font?{fontFamily:font}:{})}:null)).join('')}`;
}
