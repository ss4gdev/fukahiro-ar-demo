import { shopProductUrl, shopCatalogUrl } from './config.js';
import { initializeDemoCart } from './cart-ui.js';
const viewer=document.querySelector('#viewer');
const status=document.querySelector('#viewer-status');
const launch=document.querySelector('#ar-launch');
const support=document.querySelector('#ar-support');
const controls=[...document.querySelectorAll('.viewer-controls button')];
const params=new URLSearchParams(location.search);
let valid=false;
function fail(){ status.hidden=false;status.textContent='3Dを読み込めませんでした。再読み込みしてください。'; launch.disabled=true; controls.forEach(b=>b.disabled=true); }
function loaded(){
  if(!valid)return;
  status.textContent='';status.hidden=true;
  launch.disabled=false;controls.forEach(b=>b.disabled=false);
}
viewer.addEventListener('load',loaded);
viewer.addEventListener('error',fail);
document.querySelector('#model-viewer-module').addEventListener('error',fail);
try{
  const response=await fetch('products.json');if(!response.ok)throw new Error('data');
  const products=await response.json();
  const p=products.find(p=>p.id===params.get('item'));
  if(!p)throw new Error('unknown');
  valid=true;
  document.title=`${p.name}｜深廣 3D・AR`;
  document.querySelector('#ar-title').textContent=p.name;
  document.querySelector('#selected-price').textContent=p.price+'（税込み）';
  document.querySelector('#selected-image').src=p.image;document.querySelector('#selected-image').alt=p.name;
  const returnUrl=params.get('from')==='catalog'?`index.html#item-${p.id}`:params.get('from')==='detail'?shopProductUrl(p.id):shopCatalogUrl(p.id);
  if(params.get('from')==='catalog')document.querySelector('#header-return').textContent='← 商品一覧へ';
  document.querySelector('#header-return').href=returnUrl;
  document.querySelector('#shop-return').href=p.shopUrl;
  initializeDemoCart(products,p);
  if(viewer.loaded)loaded();
}catch(error){
  document.querySelector('#ar-title').textContent='商品が見つかりません';
  document.querySelector('.viewer-card').hidden=true;
  document.querySelector('.selected-product').hidden=true;
  document.querySelector('#cart-purchase').hidden=true;
  support.textContent='';
}
function zoom(factor){const orbit=viewer.getCameraOrbit(); viewer.cameraOrbit=`${orbit.theta}rad ${orbit.phi}rad ${Math.max(.02,Math.min(1,orbit.radius*factor))}m`;}
function rotate(angle){const orbit=viewer.getCameraOrbit(); viewer.cameraOrbit=`${orbit.theta+angle}rad ${orbit.phi}rad ${orbit.radius}m`;}
document.querySelector('#rotate-left').addEventListener('click',()=>rotate(-Math.PI/6));
document.querySelector('#rotate-right').addEventListener('click',()=>rotate(Math.PI/6));
document.querySelector('#zoom-in').addEventListener('click',()=>zoom(.8));
document.querySelector('#zoom-out').addEventListener('click',()=>zoom(1.25));
document.querySelector('#reset-view').addEventListener('click',()=>viewer.cameraOrbit='35deg 65deg 105%');
launch.addEventListener('click',async()=>{
  if(!viewer.canActivateAR){document.querySelector('#ar-help').showModal();return;}
  try{await viewer.activateAR();}catch(error){document.querySelector('#ar-help').showModal();}
});
viewer.addEventListener('ar-status',event=>{if(event.detail.status==='failed'){support.hidden=false;support.textContent='ARを開始できませんでした。';}});
