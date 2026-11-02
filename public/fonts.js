// Shared, offline font choices for previews, the gallery, and exported images.
export const fonts = {
  template: {name:'Original design font',family:''},
  space: {name:'Space Grotesk · Modern geometric',family:'Space Grotesk, Arial, sans-serif',file:'space-grotesk.woff2'},
  outfit: {name:'Outfit · Soft geometric',family:'Outfit, Arial, sans-serif',file:'outfit.woff2'},
  sora: {name:'Sora · Contemporary',family:'Sora, Arial, sans-serif',file:'sora.woff2'},
  jetbrains: {name:'JetBrains Mono · Modern terminal',family:'JetBrains Mono, monospace',file:'jetbrains-mono.woff2'},
  sans: {name:'Clean · Arial',family:'Arial, Helvetica, sans-serif'},
  serif: {name:'Classic · Georgia',family:'Georgia, Times New Roman, serif'},
  mono: {name:'Terminal · Courier New',family:'Courier New, monospace'},
  impact: {name:'Arcade · Impact',family:'Impact, Arial Black, sans-serif'},
  rounded: {name:'Friendly · Trebuchet',family:'Trebuchet MS, Arial, sans-serif'},
  handwritten: {name:'Handwritten · Segoe Print',family:'Segoe Print, Comic Sans MS, cursive'}
};
export const fontFamily = key => Object.hasOwn(fonts,key) ? fonts[key].family : '';
export function fontEdits(input){
 if(!Object.hasOwn(input,'font'))return {};
 if(typeof input.font!=='string'||!Object.hasOwn(fonts,input.font))throw new Error('Choose a supported font.');
 return {font:input.font};
}
