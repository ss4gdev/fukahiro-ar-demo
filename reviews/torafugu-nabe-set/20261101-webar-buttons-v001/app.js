import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {Placement} from './placement.js';
import {loadEngine,startEngine} from './xr-driver.js';
const $=id=>document.getElementById(id);
const preview=new URLSearchParams(location.search).get('preview')==='1';
const placement=new Placement();
const anchor=new THREE.Group();anchor.name='tabletop-anchor';anchor.visible=false;
let model,world,stop,active=false,failed=false,frame=0,previewRenderer;
let smoothYaw=0,lastFrame=0,lastTrackingFrame=0,sessionStartedAt=0;
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
function setText(id,text){if($(id).textContent!==text)$(id).textContent=text;}
function ui(){
  const placed=placement.placed;
  $('place').hidden=placed;$('rotation').hidden=!placed;$('aim').hidden=placed;
  const ready=placement.canPlace(performance.now());
  $('place').disabled=!ready;$('aim').classList.toggle('ready',ready);
  setText('place',ready?'ここに置く':'置く場所を探しています');
  for(const id of ['left','front','right'])$(id).disabled=!placement.tracking;
  setText('mode',preview?'操作確認・カメラなし':placed?'ボタンで回す':'机に置く');
  setText('status',preview?'これは操作の確認画面です。ARではありません。':
    !placement.tracking?'机に向けて、スマホをゆっくり前後に動かしてください。':
    placed?'料理を置きました。下のボタンで回せます。':
    ready?'印の位置に置きます。「ここに置く」を押してください。':
    '机の模様がある場所に、中央の印を合わせてください。');
}
function animate(now){
  if(!active)return;
  if(!preview&&!world&&now-sessionStartedAt>60000){fail(Error('ARの開始に時間がかかっています。カメラの許可と通信を確認して、もう一度開いてください。'));return;}
  if(!preview&&now-lastTrackingFrame>700){placement.update([],false,now);anchor.visible=false;ui();}
  const target=placement.baseYaw+placement.yaw;
  smoothYaw+=reduced?target-smoothYaw:(target-smoothYaw)*(1-Math.exp(-Math.min(now-lastFrame,100)/95));
  lastFrame=now;anchor.rotation.y=smoothYaw;
  if(preview&&world)previewRenderer.render(world.scene,world.camera);
  frame=requestAnimationFrame(animate);
}
function populate({scene,camera,renderer}){
  world={scene,camera,renderer};
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NeutralToneMapping;renderer.toneMappingExposure=1;
  scene.add(new THREE.HemisphereLight(0xffffff,0xc4c1b8,2.4));
  const light=new THREE.DirectionalLight(0xffffff,2);light.position.set(1,3,2);scene.add(light);
  anchor.add(model);scene.add(anchor);
}
function stopSession(){
  active=false;cancelAnimationFrame(frame);
  if(stop){const cleanup=stop;stop=null;cleanup();}
}
function fail(error){
  if(failed)return;failed=true;stopSession();
  $('welcome').hidden=true;$('session').hidden=true;$('error').hidden=false;$('end').hidden=false;
  const msg=String(error?.message||error||'');
  setText('error-message',/permission|denied|NotAllowed/i.test(msg)?'カメラや動きの利用が許可されていません。SafariまたはChromeで許可して、もう一度開いてください。':
    /support|device|browser|WebGL/i.test(msg)?'この端末ではARを開始できませんでした。更新したSafariまたはChromeでお試しください。':msg.startsWith('AR')||/[ぁ-んァ-ン]/.test(msg)?msg:'ARを開始できませんでした。通信とカメラの許可を確認して、もう一度開いてください。');
}
function showSession(){
  active=true;failed=false;sessionStartedAt=performance.now();lastTrackingFrame=sessionStartedAt;
  $('welcome').hidden=true;$('session').hidden=false;$('end').hidden=false;document.body.classList.add('active');
  ui();lastFrame=performance.now();frame=requestAnimationFrame(animate);
}
function beginPreview(){
  const canvas=$('camera');previewRenderer=new THREE.WebGLRenderer({canvas,antialias:true});
  const scene=new THREE.Scene();scene.background=new THREE.Color('#e9e5db');
  const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.01,20);camera.position.set(.25,.32,.52);camera.lookAt(0,.06,0);
  const resize=()=>{previewRenderer.setPixelRatio(Math.min(devicePixelRatio,1.5));previewRenderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();};resize();window.addEventListener('resize',resize);
  populate({scene,camera,renderer:previewRenderer});
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(20,20),new THREE.MeshStandardMaterial({color:0xe9e5db,roughness:1}));plane.rotation.x=-Math.PI/2;plane.position.y=-.001;scene.add(plane);
  placement.tracking=true;placement.placed=true;placement.position={x:0,y:0,z:0};anchor.visible=true;
  $('replace').hidden=true;stop=()=>{window.removeEventListener('resize',resize);previewRenderer.dispose();};showSession();
}
$('start').addEventListener('click',async()=>{
  $('start').disabled=true;
  try{
    // iOS must receive this request synchronously from the user's tap, before any other await.
    if(typeof DeviceOrientationEvent!=='undefined'&&typeof DeviceOrientationEvent.requestPermission==='function'){
      const permission=await DeviceOrientationEvent.requestPermission();if(permission!=='granted')throw Error('permission denied');
    }
    showSession();
    stop=startEngine($('camera'),{
      start:populate,
      update:(hits,normal)=>{
        if(!active)return;lastTrackingFrame=performance.now();placement.update(hits,normal,lastTrackingFrame);
        anchor.visible=placement.placed&&normal;
        ui();
      },
      pause:()=>{placement.update([],false,performance.now());anchor.visible=false;ui();},
      error:fail,
    });
  }catch(e){fail(e);}
});
$('place').addEventListener('click',()=>{
  if(!world)return;
  const p=placement.candidate;
  const yaw=p?Math.atan2(world.camera.position.x-p.x,world.camera.position.z-p.z):0;
  if(placement.place(performance.now(),yaw)){
    anchor.position.set(placement.position.x,placement.position.y,placement.position.z);
    smoothYaw=yaw;anchor.rotation.y=yaw;anchor.visible=true;ui();
  }
});
$('left').addEventListener('click',()=>placement.rotate(-1));
$('right').addEventListener('click',()=>placement.rotate(1));
$('front').addEventListener('click',()=>placement.front());
$('replace').addEventListener('click',()=>{placement.reset();anchor.visible=false;ui();});
$('end').addEventListener('click',()=>{stopSession();location.href=location.pathname;});
$('retry').addEventListener('click',()=>location.reload());
addEventListener('pagehide',stopSession);
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&active&&!preview){stopSession();$('session').hidden=true;$('error').hidden=false;setText('error-message','カメラを停止しました。続けるときは「もう一度開く」を押してください。');}
});
$('camera').addEventListener('webglcontextlost',event=>{event.preventDefault();fail(Error('ARの表示が中断されました。「もう一度開く」を押してください。'));});
try{
  if(!preview&&(!isSecureContext||!navigator.mediaDevices?.getUserMedia))throw Error('ARにはHTTPSとカメラ対応のブラウザが必要です。スマホのSafariまたはChromeで確認URLを開いてください。');
  await Promise.all([
    new Promise((resolve,reject)=>new GLTFLoader().load('./model.glb',gltf=>{model=gltf.scene;resolve();},event=>{if(event.total)setText('loading',`料理のデータを読み込み中 ${Math.round(event.loaded/event.total*100)}%`);},()=>reject(Error('料理のデータを読み込めませんでした。通信を確認して、もう一度開いてください。')))),
    preview?Promise.resolve():loadEngine(),
  ]);
  if(preview)beginPreview();else{setText('loading','準備ができました。');setText('start','カメラを開いて始める');$('start').disabled=false;}
}catch(e){fail(e);}
// Read-only diagnostics for local QA; no camera pixels or user data are exposed.
export function snapshot(){return {preview,active,failed,placed:placement.placed,tracking:placement.tracking,yaw:placement.yaw,rotation:anchor.rotation.y,position:anchor.position.toArray(),scale:anchor.scale.toArray(),visible:anchor.visible,meshes:model?model.children.length:0,drawCalls:world?.renderer.info.render.calls};}
