import {mountCollection} from './collection.js';
const root=document.querySelector('#main');
try{
 const token=location.pathname.split('/').at(-1),response=await fetch(`/api/gallery/${encodeURIComponent(token)}`);
 if(!response.ok)throw new Error('This collection is unavailable.');
 const data=await response.json();mountCollection(root,data,{shared:true});
}catch{root.innerHTML='<div class="collection-empty"><h1>Collection unavailable.</h1><p>Ask the streamer for a current collection link.</p></div>';}
