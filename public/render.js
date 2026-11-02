import {defaultStickerSvg} from './stickers.js';
export {stickerNames,stickerGroups} from './stickers.js';
export const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const frameNames = {polaroid:'Instant classic',tcg:'Collector card',film:'Film strip',postcard:'CRT replay',ticket:'Loot receipt',noir:'After hours'};

export const palette = {sage:['#698476','#dce4d8'],rose:['#b57c7d','#efdcda'],midnight:['#35495b','#d6e0e7'],sand:['#ae8e59','#e9dfc8']};
export function motifSvg(kind,accent='#e7b851',ink='#536e60') {
  if (['flower','flowers'].includes(kind)) return `<g fill="#f7edca" stroke="${ink}" stroke-width="2">${[0,60,120,180,240,300].map(a=>`<ellipse cx="0" cy="-19" rx="11" ry="18" transform="rotate(${a})"/>`).join('')}<circle r="12" fill="${accent}"/></g>`;
  if (['heart','hearts'].includes(kind)) return `<path d="M0 28C-65-9-25-48 0-20C25-48 65-9 0 28Z" fill="${accent}" stroke="white" stroke-width="4"/>`;
  if (kind==='moon') return `<path d="M15-30A33 33 0 1 0 28 23A30 30 0 0 1 15-30" fill="${accent}" stroke="white" stroke-width="3"/>`;
  if (['sparkle','sparkles'].includes(kind)) return `<path d="M0-37L9-9L35 0L9 9L0 37L-9 9L-35 0L-9-9Z" fill="${accent}" stroke="white" stroke-width="4"/><path d="M27-33v14m-7-7h14" stroke="${ink}" stroke-width="3"/>`;
  if (kind==='none') return '';
  if (['gg','live'].includes(kind)) return `<rect x="-42" y="-23" width="84" height="46" rx="12" fill="${accent}" stroke="white" stroke-width="4"/><text text-anchor="middle" y="8" font-family="sans-serif" font-size="25" font-weight="bold" fill="${ink}">${kind==='gg'?'GG!':'♡ LIVE'}</text>`;
  return `<path d="M0-36L11-12L37-10L18 9L23 35L0 22L-23 35L-18 9L-37-10L-11-12Z" fill="${accent}" stroke="white" stroke-width="4"/>`;
}
export function stickerSvg(kind,designs=[]) {
  const design = designs.find(d=>d.id===kind&&d.kind==='sticker');
  if(design?.asset)return `<svg viewBox="-48 -48 96 96" xmlns="http://www.w3.org/2000/svg"><image href="${escape(design.asset)}" x="-45" y="-45" width="90" height="90" preserveAspectRatio="xMidYMid meet"/></svg>`;
  return `<svg viewBox="-48 -48 96 96" xmlns="http://www.w3.org/2000/svg">${design?motifSvg(design.motif,design.accent,design.ink):(defaultStickerSvg(kind)??motifSvg(kind))}${design?.label?`<text text-anchor="middle" y="4" font-size="10" font-family="sans-serif" fill="${design.ink}">${escape(design.label)}</text>`:''}</svg>`;
}
export {photoSvg,photoSize} from './photo.js';
