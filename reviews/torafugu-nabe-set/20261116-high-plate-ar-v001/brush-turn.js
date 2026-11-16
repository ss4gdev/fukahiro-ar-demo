'use strict';
const get = id => document.getElementById(id);
const variants = Array.from(document.querySelectorAll('[data-variant]'));
const heights = Array.from(document.querySelectorAll('[data-height]'));
const dish = get('dish');
const slider = get('angle');
let tier='37', height=25, index=13, zoom=false, sequence=0;
function stem() {return 'e'+height+'-a'+String(index*15).padStart(3,'0');}
function refresh(){
  const key=stem(),ticket=++sequence;
  const url='brush-'+tier+'/'+key+'.webp';
  const next=new Image();
  get('notice').textContent='';get('photo').setAttribute('aria-busy','true');
  next.onload=()=>{
    if(ticket!==sequence)return;
    dish.src=url;
    const [x,y]=anchors[key];
    dish.style.transformOrigin=(100*x)+'% '+(100*y)+'%';
    dish.style.transform=zoom?'scale(2.5)':'none';
    dish.alt=(tier==='37'?'37.39 MB':'19.64 MB')+'版の鍋セット・'+height+'度・向き'+(index*15)+'度';
    get('angle-label').textContent=(height===25?'斜め':'上から')+height+'°・向き'+index*15+'°';
    get('mode').textContent=zoom?'ふぐの切り身・2.5倍':'全体';
    get('photo').setAttribute('aria-busy','false');
  };
  next.onerror=()=>{if(ticket===sequence){get('photo').setAttribute('aria-busy','false');get('notice').textContent='画像を読み込めませんでした。角度を変えてから戻してください。';}};
  next.src=url;
  variants.forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.variant===tier)));
  heights.forEach(b=>b.setAttribute('aria-pressed',String(Number(b.dataset.height)===height)));
  slider.value=index;
  get('zoom').setAttribute('aria-pressed',String(zoom));get('zoom').textContent=zoom?'全体に戻す':'切り身を拡大';
}
function move(step){index=(index+step+24)%24;refresh();}
variants.forEach(b=>b.onclick=()=>{tier=b.dataset.variant;refresh();});
heights.forEach(b=>b.onclick=()=>{height=Number(b.dataset.height);refresh();});
get('left').onclick=()=>move(-1);get('right').onclick=()=>move(1);
slider.oninput=()=>{index=Number(slider.value);refresh();};
get('zoom').onclick=()=>{zoom=!zoom;if(zoom){index=13;height=25;}refresh();};
let finger=null;
const photo=get('photo');
photo.onpointerdown=e=>{if(!e.isPrimary||e.button!==0)return;finger={id:e.pointerId,x:e.clientX};photo.setPointerCapture(e.pointerId);};
photo.onpointermove=e=>{if(!finger||e.pointerId!==finger.id)return;const steps=Math.trunc((e.clientX-finger.x)/25);if(steps){finger.x+=steps*25;move(steps);}};
photo.onpointerup=photo.onpointercancel=()=>{finger=null;};
refresh();
