'use strict';
const byId=id=>document.getElementById(id);
const tiers=[...document.querySelectorAll('[data-tier]')],views=[...document.querySelectorAll('[data-view]')];
const ar=byId('ar'),prepare=byId('prepare'),statusLine=byId('status');
let tier,view='oblique',loading,objectURL;
function showView(next){
 view=next;
 for(const button of views)button.setAttribute('aria-pressed',String(button.dataset.view===view));
 byId('picture').src=(tier==='high'?'':tier+'-')+view+'.png';
 byId('picture').alt=MODELS[tier].label+'・'+views.find(b=>b.dataset.view===view).textContent;
}
function select(next){
 if(!Object.hasOwn(MODELS,next))next='20mb';
 if(next===tier)return;
 if(loading)loading.abort();loading=null;
 if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;
 tier=next;const model=MODELS[tier];
 for(const button of tiers)button.setAttribute('aria-pressed',String(button.dataset.tier===tier));
 ar.href=model.usdz+'#allowsContentScaling=0';ar.removeAttribute('download');ar.hidden=Boolean(model.raw);
 prepare.hidden=!model.raw;prepare.disabled=false;prepare.textContent='iPhone用のARを準備';
 byId('usdz').href=model.usdz;
 const glb=byId('glb');glb.hidden=!model.glb;if(model.glb)glb.href=model.glb;else glb.removeAttribute('href');
 byId('size').textContent=model.label+' · USDZ '+model.size+(model.glbSize?' ／ GLB '+model.glbSize:'');
 statusLine.textContent='';showView(view);
}
tiers.forEach(b=>b.addEventListener('click',()=>{
 location.hash=b.dataset.tier;select(b.dataset.tier);
}));
views.forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));
window.addEventListener('hashchange',()=>select(location.hash.slice(1)));
select(location.hash.slice(1));
prepare.addEventListener('click',async()=>{
 const model=MODELS[tier];if(!model.raw||loading)return;
 const current=new AbortController();loading=current;
 prepare.disabled=true;prepare.textContent='読み込み中…';statusLine.textContent='USDZを読み込んでいます。';
 try{
  const response=await fetch(model.raw,{signal:current.signal,credentials:'omit',integrity:model.integrity});
  if(!response.ok)throw Error('USDZ download');
  const file=await response.blob();
  if(file.size!==model.bytes)throw Error('Incomplete model');
  if(current.signal.aborted)return;
  const blob=new Blob([file],{type:'model/vnd.usdz+zip'});
  objectURL=URL.createObjectURL(blob);
  ar.href=objectURL+'#allowsContentScaling=0';ar.setAttribute('download',model.filename);ar.hidden=false;
  prepare.hidden=true;statusLine.textContent='準備できました。「iPhoneでARを見る」をタップしてください。';
 }catch(error){
  if(current.signal.aborted)return;
  prepare.disabled=false;prepare.textContent='もう一度ARを準備';
  statusLine.textContent='読み込めませんでした。「USDZを保存」からも開けます。';
 }finally{if(loading===current)loading=null;}
});
