// Rebuild the compatibility URLs used by previously saved sample photos.
// The original PNG artwork and generation prompts are included in public/assets.
import {readFile,writeFile} from 'node:fs/promises';
const files=['stream-reaction.png','stream-adventure.png','stream-competitive.png'];
for(const [index,file] of files.entries()){
 const bytes=await readFile(new URL(`../public/assets/${file}`,import.meta.url));
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><image href="data:image/png;base64,${bytes.toString('base64')}" width="1920" height="1080" preserveAspectRatio="xMidYMid slice"/></svg>`;
 await writeFile(new URL(`../public/assets/scene-${index}.svg`,import.meta.url),svg);
}
