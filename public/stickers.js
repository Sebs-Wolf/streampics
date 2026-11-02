import {emojiArtwork} from './emoji-art.js';
// Vector emoji with a white die-cut outline. IDs stay stable for saved photos.
export const stickerNames = {
 gg:'Good game',heart:'Chat love',pog:'Pog moment',hype:'Hype',rip:'RIP',lag:'Meltdown',
 star:'Star player',sparkle:'Lightning',clutch:'Clutch!',loot:'Rare drop',trophy:'First place',combo:'Big impact',clip:'Clip it!',
 live:'Live',raid:'Raid incoming',brb:'Coffee break',moon:'After hours',checkpoint:'Checkpoint',flower:'Daisy'
};
export const stickerGroups = {
 Reactions:['gg','heart','pog','hype','rip','lag'],
 Highlights:['star','sparkle','clutch','loot','trophy','combo','clip'],
 'Stream life':['live','raid','brb','moon','checkpoint','flower']
};
export const stickerEmojis = {
 gg:'🎮',heart:'❤️',pog:'😮',hype:'🔥',rip:'💀',lag:'🫠',
 star:'🌟',sparkle:'⚡',clutch:'🏆',loot:'💎',trophy:'🥇',combo:'💥',clip:'🎬',
 live:'🔴',raid:'🚀',brb:'☕',moon:'🌙',checkpoint:'🚩',flower:'🌼'
};
export function defaultStickerSvg(kind){
 if(!Object.hasOwn(emojiArtwork,kind))return null;
 const {outline,art}=emojiArtwork[kind];
 return `<g transform="translate(-36 -36) scale(2)">${outline}${art}</g>`;
}
