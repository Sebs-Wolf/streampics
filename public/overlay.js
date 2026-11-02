import {photoSvg} from './render.js';
const token=new URLSearchParams(location.search).get('token');
const moment=document.querySelector('#moment'),countdown=document.querySelector('#countdown'),number=document.querySelector('#countdown-number'),shutter=document.querySelector('#shutter');
let last,initialized=false,timer,revealTimer,effectKey='',deadline=0,clockOffset=0,lastDigit='';
function hideMoment(){clearTimeout(timer);clearTimeout(revealTimer);moment.classList.remove('visible');}
function showPhoto(photo,designs){
  moment.innerHTML=photoSvg(photo,designs);moment.classList.add('visible');
  clearTimeout(timer);timer=setTimeout(()=>moment.classList.remove('visible'),9500);
}
function tick(){
  const remaining=deadline-(Date.now()+clockOffset),digit=remaining>0?String(Math.min(3,Math.ceil(remaining/1000))):'';
  countdown.classList.toggle('visible',Boolean(digit));
  if(digit!==lastDigit){number.textContent=digit;lastDigit=digit;if(digit)number.animate([{opacity:0,transform:'scale(.85)'},{opacity:1,transform:'scale(1)'}],{duration:180,easing:'ease-out'});}
}
async function poll(){
  try{
    const response=await fetch(`/api/overlay?token=${encodeURIComponent(token)}`);if(!response.ok)return;
    const {photo,designs,effect,serverTime}=await response.json();
    clockOffset=(serverTime||Date.now())-Date.now();
    const key=effect?`${effect.id}:${effect.phase}`:'';
    if(key!==effectKey){
      effectKey=key;deadline=effect?.phase==='countdown'?effect.endsAt:0;tick();
      shutter.classList.remove('taking-photo');
      if(effect?.phase==='countdown')hideMoment();
      if(effect?.phase==='shutter'&&effect.shutter){
        shutter.classList.add('taking-photo');
      }
    }
    if(!initialized){last=photo?.id;initialized=true;return;}
    if(!photo||photo.id===last)return;
    last=photo.id;
    // Refreshing a source never replays old photos or a completed countdown.
    if(Date.now()+clockOffset-Date.parse(photo.createdAt)>20000)return;
    hideMoment();
    const wait=effect?.phase==='shutter'&&effect.shutter?Math.max(0,effect.endsAt-(Date.now()+clockOffset)):0;
    revealTimer=setTimeout(()=>showPhoto(photo,designs),wait);
  }catch{/* Stay transparent while the local companion is offline. */}
  finally{setTimeout(poll,150);}
}
setInterval(tick,50);
await poll();
