import {coverStyles} from '../public/covers.js';
import {fontEdits} from '../public/fonts.js';
export const templates = ['polaroid', 'tcg', 'film', 'postcard', 'ticket', 'noir'];
export const themes = Object.keys(coverStyles);
const text = (value, max = 120) => typeof value === 'string' ? value.slice(0, max) : '';
export function validateDesign(input) {
  if (!input || !['frame', 'album', 'sticker'].includes(input.kind)) throw new Error('Choose a frame, album, or sticker.');
  const color = (v, fallback) => /^#[0-9a-f]{6}$/i.test(v || '') ? v : fallback;
  return {
    kind: input.kind, name: text(input.name, 40) || 'Untitled design',
    background: color(input.background, '#ede8dd'), accent: color(input.accent, '#738470'),
    ink: color(input.ink, '#25372c'), motif: ['stars', 'hearts', 'flowers', 'sparkles', 'moon', 'none'].includes(input.motif) ? input.motif : 'stars',
    template: templates.includes(input.template) ? input.template : 'polaroid',
    label: text(input.label, 24), description: text(input.description, 160)
  };
}
export function photoEdits(input) {
  const result = fontEdits(input);
  if ('albumId' in input) result.albumId = text(input.albumId, 50);
  if ('format' in input) { if (!['square','wide'].includes(input.format)) throw new Error('Unknown photo aspect ratio.'); result.format = input.format; }
  if ('finish' in input) { if (!['matte','holo','prismatic'].includes(input.finish)) throw new Error('Unknown card finish.'); result.finish = input.finish; }
  if ('rarity' in input) result.rarity = ['common','rare','epic','legendary'].includes(input.rarity) ? input.rarity : 'rare';
  if ('power' in input) result.power = Math.max(0,Math.min(999,parseInt(input.power)||0));
  if ('cropX' in input) result.cropX = Math.max(0,Math.min(100,Number(input.cropX)||0));
  if ('title' in input) result.title = text(input.title, 80);
  if ('caption' in input) result.caption = text(input.caption, 220);
  if ('template' in input) { if (!templates.includes(input.template)) throw new Error('Unknown frame.'); result.template = input.template; }
  if ('showAttribution' in input) result.showAttribution = input.showAttribution === true;
  if ('designId' in input) result.designId = text(input.designId, 50);
  if ('stickers' in input) {
    if (!Array.isArray(input.stickers) || input.stickers.length > 20) throw new Error('Use up to 20 stickers per photo.');
    result.stickers = input.stickers.map(s => ({
      id: text(s.id, 50), kind: text(s.kind, 50),
      x: Math.max(0, Math.min(100, Number(s.x) || 0)), y: Math.max(0, Math.min(100, Number(s.y) || 0)),
      rotation: Math.max(-180, Math.min(180, Number(s.rotation) || 0)),
      scale: Math.max(0.5, Math.min(2, Number(s.scale) || 1))
    }));
  }
  return result;
}
export function normalizeTwitchEvent(type, event) {
  const viewer = event.is_anonymous ? 'Anonymous' : event.user_name || event.user_login || 'Anonymous';
  if (type === 'channel.cheer') return { kind: 'bits', viewer, amount: event.bits, unit: 'Bits', message: event.message || '' };
  if (type === 'channel.subscribe' && !event.is_gift) return { kind: 'sub', viewer, amount: 1, unit: `Tier ${Number(event.tier) / 1000 || 1} sub`, message: '' };
  if (type === 'channel.subscription.gift') return { kind: 'gift', viewer, amount: event.total, unit: 'gift subs', message: '' };
  if (type === 'channel.subscription.message') return { kind: 'resub', viewer, amount: event.cumulative_months, unit: 'months subscribed', message: event.message?.text || '' };
  return null;
}
