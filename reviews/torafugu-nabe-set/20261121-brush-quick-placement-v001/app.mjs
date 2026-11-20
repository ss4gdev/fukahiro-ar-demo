const $=id=>document.getElementById(id);
const baseline=new URLSearchParams(location.search).get('mode')==='center';
const mode=baseline?'中央1点・読み込み後に起動':'中央と周囲・並行起動';
const historyKey='nabe-brush-placement-timing-v1';
const state={phase:'welcome',tracking:'LIMITED',frames:0,placed:false,hit:null,samples:0,modelReady:false,errors:[],build:'20261121-brush-quick-placement-v001'};
let pc,config,projection,app,camera,anchor,model,asset,modelPromise,enginePromise,wakeLock;
let generation=0,running=false,starting=false,yaw=0,lastScan=0,lastHit=0,firstPoint=null,lastPose=null,measurement=null;
const finite3=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z);
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const now=()=>performance.now();
function message(s){if($('tracking').textContent!==s)$('tracking').textContent=s;}
function times(){
    if(!measurement)return {};
    const {start,stamp}=measurement;
    const between=(a,b)=>a==null||b==null?null:Math.max(0,Math.round(b-a));
    return {tapToCameraMs:between(start,stamp.camera),cameraToStableMs:between(stamp.camera,stamp.stable),cameraToReadyMs:between(stamp.camera,stamp.ready),
        tapToModelMs:between(start,stamp.model),tapToReadyMs:between(start,stamp.ready),tapToPlacedMs:between(start,stamp.placed)};
}
function diagnostic(){return {build:state.build,mode,phase:state.phase,frames:state.frames,tracking:state.tracking,placed:state.placed,modelReady:state.modelReady,hitCount:state.samples,errors:state.errors,times:times()};}
function formatTimes(t){
    const labels={tapToCameraMs:'開始 → カメラ初回描画',cameraToReadyMs:'カメラ → ここに置く',cameraToStableMs:'カメラ → 安定した印',tapToModelMs:'開始 → モデル準備',tapToReadyMs:'開始 → 配置可能',tapToPlacedMs:'開始 → 配置操作'};
    return Object.entries(labels).map(([key,label])=>label+'　'+(t[key]==null?'未到達':(t[key]/1000).toFixed(2)+'秒')).join('\n');
}
function history(){try{return JSON.parse(localStorage.getItem(historyKey)||'[]');}catch{return [];}}
function showHistory(){const entries=history();$('history').textContent=entries.length?entries.map(row=>row.date+'　'+row.mode+'\n'+formatTimes(row.times)).join('\n\n'):'まだ記録がありません。';}
function mark(key){
    if(!measurement||measurement.stamp[key]!=null)return;
    measurement.stamp[key]=now();
    if($('help').open)$('diagnostic').textContent=formatTimes(times());
}
function remember(){
    if(!measurement)return;
    const row={id:measurement.id,date:measurement.date,mode,times:times()};
    try{localStorage.setItem(historyKey,JSON.stringify([row,...history().filter(r=>r.id!==row.id)].slice(0,6)));}catch{}
    showHistory();
}
$('mode-name').textContent='今回の方式　'+mode;
$('compare-mode').href=baseline?'./':'?mode=center';
$('compare-mode').textContent=baseline?'中央と周囲で試す':'同じ8.81 MBで中央1点を試す';
$('record').ontoggle=showHistory;
function loadEngine(){
    if(enginePromise)return enginePromise;
    enginePromise=new Promise((resolve,reject)=>{
        if(window.XR8){resolve(window.XR8);return;}
        const script=document.createElement('script');script.src='../20261119-splatfacto-webar-v001/xr/xr.js';script.async=true;script.dataset.preloadChunks='slam';
        const timer=setTimeout(()=>reject(new Error('AR engine load timeout')),90000);
        window.addEventListener('xrloaded',()=>{clearTimeout(timer);resolve(window.XR8);},{once:true});
        script.onerror=()=>{clearTimeout(timer);reject(new Error('AR engine download failed'));};
        document.head.append(script);
    }).catch(e=>{enginePromise=null;throw e;});
    return enginePromise;
}
function resize(){
    const width=innerWidth,height=innerHeight,ratio=Math.min(devicePixelRatio||1,1.5);
    if($('feed').width!==Math.round(width*ratio))$('feed').width=Math.round(width*ratio);
    if($('feed').height!==Math.round(height*ratio))$('feed').height=Math.round(height*ratio);
    if(app){
        $('splat').style.width=width+'px';$('splat').style.height=height+'px';
        app.setCanvasResolution(pc.RESOLUTION_FIXED,Math.round(width*ratio),Math.round(height*ratio));
    }
}
async function prepareModel(){
    if(modelPromise)return modelPromise;
    modelPromise=(async()=>{
        [pc,config]=await Promise.all([import('../20261117-splatfacto-camera-color-v001/playcanvas.mjs'),fetch('./model-config.json').then(r=>{if(!r.ok)throw new Error('設定の読み込みに失敗しました');return r.json();})]);
        projection=new pc.Mat4();
        app=new pc.Application($('splat'),{graphicsDeviceOptions:{deviceTypes:['webgl2'],alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:true}});
        app.graphicsDevice.maxPixelRatio=Math.min(devicePixelRatio||1,1.5);
        app.setCanvasResolution(pc.RESOLUTION_AUTO);app.scene.gsplat.useTonemap=false;app.scene.gsplat.useFog=false;app.scene.gsplat.colorUpdateAngle=.1;app.scene.exposure=1;
        camera=new pc.Entity('Camera');camera.addComponent('camera',{clearColor:new pc.Color(0,0,0,0),nearClip:.01,farClip:100,gammaCorrection:pc.GAMMA_SRGB,toneMapping:pc.TONEMAP_NONE});
        camera.camera.calculateProjection=matrix=>matrix.copy(projection);app.root.addChild(camera);
        anchor=new pc.Entity('Table placement');app.root.addChild(anchor);anchor.enabled=false;
        model=new pc.Entity('Brush whole nabe');anchor.addChild(model);
        asset=new pc.Asset('Nabe original SH3','gsplat',{url:config.file});app.assets.add(asset);
        await new Promise((resolve,reject)=>{asset.once('load',resolve);asset.once('error',reject);app.assets.load(asset);});
        model.addComponent('gsplat',{asset,unified:false});
        const rotation=new pc.Mat4();rotation.data.set(config.rotationColumnMajor);
        model.setLocalRotation(new pc.Quat().setFromMat4(rotation));model.setLocalScale(config.scale,config.scale,config.scale);model.setLocalPosition(...config.translation);
        resize();app.autoRender=false;app.start();
        if(asset.resource.numSplats!==config.splats||(asset.resource.shBands??asset.resource.gsplatData?.shBands)!==config.shDegree)throw new Error('Unexpected splat content');
    })().catch(e=>{app?.destroy();app=null;anchor=null;camera=null;modelPromise=null;throw e;});return modelPromise;
}

function projectHit(p,pose){
    // Invert the tracked camera rotation, then use its actual projection including principal-point offset.
    const q=pose.rotation, x=p.x-pose.position.x,y=p.y-pose.position.y,z=p.z-pose.position.z;
    const tx=2*(-q.y*z+q.z*y),ty=2*(-q.z*x+q.x*z),tz=2*(-q.x*y+q.y*x);
    const vx=x+q.w*tx-q.y*tz+q.z*ty,vy=y+q.w*ty-q.z*tx+q.x*tz,vz=z+q.w*tz-q.x*ty+q.y*tx;
    const m=pose.intrinsics,w=m[3]*vx+m[7]*vy+m[11]*vz+m[15];
    if(!(w>0))return null;
    return {u:.5+.5*(m[0]*vx+m[4]*vy+m[8]*vz+m[12])/w,v:.5-.5*(m[1]*vx+m[5]*vy+m[9]*vz+m[13])/w};
}
function screenOffset(uv){return Math.hypot((uv.u-.5)*innerWidth,(uv.v-.5)*innerHeight)/Math.min(innerWidth,innerHeight);}
function bestHit(pose){
    const short=Math.min(innerWidth,innerHeight),dx=.09*short/innerWidth,dy=.09*short/innerHeight;
    const points=baseline?[[.5,.5]]:[[.5,.5],[.5-dx,.5],[.5+dx,.5],[.5,.5-dy],[.5,.5+dy]];
    let best=null,bestRank=Infinity;
    for(const [x,y] of points){
        for(const hit of window.XR8.XrController.hitTest(x,y,['FEATURE_POINT'])||[]){
            if(hit.type!=='FEATURE_POINT'||!finite3(hit.position)||!Number.isFinite(hit.distance)||hit.distance<.12||hit.distance>2.5||hit.position.y>pose.position.y-.03)continue;
            const uv=projectHit(hit.position,pose);
            if(!uv||!(screenOffset(uv)<=.20))continue;
            const repeats=firstPoint&&distance(hit.position,firstPoint)<.07&&Math.abs(hit.position.y-firstPoint.y)<.035;
            const rank=(firstPoint&&!repeats?1:0)+screenOffset(uv);
            if(rank<bestRank){bestRank=rank;best={position:{...hit.position},uv,type:hit.type};}
        }
        if(bestRank<.05)break;
    }
    return best;
}
function invalidateHit(){
    state.hit=null;firstPoint=null;state.samples=0;lastHit=0;
    const r=$('reticle');r.classList.remove('ready');r.style.left='50%';r.style.top='50%';
    $('place').disabled=true;$('place').textContent='机の位置を探しています';
}
function updateButton(){
    if(!running||state.placed)return;
    const stable=state.tracking==='NORMAL'&&state.samples>=3&&now()-lastHit<=450;
    $('reticle').classList.toggle('ready',stable);
    $('place').disabled=!(stable&&state.modelReady);
    $('place').textContent=stable?(state.modelReady?'ここに置く':'鍋セットを読み込んでいます'):'机の位置を探しています';
    if(stable){mark('stable');if(state.modelReady)mark('ready');message('印が机の上にあることを確認してください。');}
}
function applyPose(p){
    camera.setPosition(p.position.x,p.position.y,p.position.z);camera.setRotation(p.rotation.x,p.rotation.y,p.rotation.z,p.rotation.w);projection.data.set(p.intrinsics);
}
function update({processCpuResult}){
    if(!running)return;
    const r=processCpuResult?.reality;
    state.frames++;
    if(!r||r.trackingStatus!=='NORMAL'||!finite3(r.position)||!finite3(r.rotation)||!Number.isFinite(r.rotation.w)||r.intrinsics?.length!==16||!Array.from(r.intrinsics).every(Number.isFinite)){
        state.tracking='LIMITED';lastPose=null;invalidateHit();if(anchor)anchor.enabled=false;
        message('机の模様や印刷物を映し、スマートフォンをゆっくり左右に動かしてください。');return;
    }
    state.tracking='NORMAL';lastPose=r;if(state.modelReady)applyPose(r);
    if(anchor)anchor.enabled=state.placed;
    if(state.placed){message('スマートフォンを動かして、周りから見てください。');return;}
    if(now()-lastHit>450&&state.hit)invalidateHit();
    if(measurement.stamp.camera==null||now()-lastScan<140)return;
    lastScan=now();const hit=bestHit(r);
    if(!hit){invalidateHit();message('木目や印刷物が画面の中央付近に入るよう、机に向けてください。');return;}
    const repeated=firstPoint&&distance(hit.position,firstPoint)<.07&&Math.abs(hit.position.y-firstPoint.y)<.035;
    if(!repeated){firstPoint=hit.position;state.samples=0;}
    state.samples++;state.hit=hit;lastHit=now();
    $('reticle').style.left=(100*hit.uv.u)+'%';$('reticle').style.top=(100*hit.uv.v)+'%';
    updateButton();
}
function place(){
    if(!running||!state.modelReady||state.tracking!=='NORMAL'||state.samples<3||now()-lastHit>450||!lastPose)return;
    const p=state.hit.position;applyPose(lastPose);anchor.setPosition(p.x,p.y,p.z);
    const forward=camera.forward;yaw=Math.atan2(forward.x,forward.z)*180/Math.PI+180+config.rimYawOffsetDegrees;
    anchor.setEulerAngles(0,yaw,0);anchor.setLocalScale(1,1,1);anchor.enabled=true;
    state.placed=true;state.phase='placed';mark('placed');remember();
    $('reticle').hidden=true;$('place').hidden=true;$('adjust').hidden=false;$('scale').value=100;$('size-value').textContent='100%';
}
function reposition(){state.placed=false;state.phase='scanning';if(anchor)anchor.enabled=false;invalidateHit();$('reticle').hidden=false;$('place').hidden=false;$('adjust').hidden=true;}
function render(){
    if(!running)return;
    if(state.frames)mark('camera');
    if(state.modelReady&&state.placed){app.update(1/30);app.render();}
    $('splat').style.visibility=state.modelReady&&state.placed&&state.tracking==='NORMAL'?'visible':'hidden';
}
function pipeline(id){
    const guard=fn=>(...args)=>{if(id===generation)fn(...args);};
    return {name:'fukahiro-brush-table',onStart:guard(({canvasWidth,canvasHeight})=>{
        window.XR8.XrController.updateCameraProjectionMatrix({cam:{pixelRectWidth:canvasWidth,pixelRectHeight:canvasHeight,nearClipPlane:.01,farClipPlane:100},origin:{x:0,y:1.4,z:0},facing:{x:0,y:0,z:0,w:1}});
        starting=false;running=true;$('welcome').hidden=true;$('hud').hidden=false;document.body.classList.add('active');resize();reposition();
    }),onCanvasSizeChange:guard(({canvasWidth,canvasHeight})=>window.XR8.XrController.updateCameraProjectionMatrix({cam:{pixelRectWidth:canvasWidth,pixelRectHeight:canvasHeight,nearClipPlane:.01,farClipPlane:100}})),
    onUpdate:guard(update),onRender:guard(render),onCameraStatusChange:guard(({status})=>{if(status==='failed')fail(new Error('カメラを利用できません。Safariのカメラ許可を確認してください。'));}),onException:guard(fail)};
}
function stop(){
    ++generation;starting=false;running=false;remember();measurement=null;
    state.placed=false;state.phase='welcome';lastPose=null;invalidateHit();
    try{window.XR8?.stop();}catch{}if(anchor)anchor.enabled=false;wakeLock?.release().catch(()=>{});wakeLock=null;
    $('hud').hidden=true;$('welcome').hidden=false;document.body.classList.remove('active');$('start').disabled=false;$('load-status').textContent='カメラを終了しました。';
}
function fail(e){
    stop();state.phase='error';state.errors.push(String(e?.message||e));$('load-status').textContent='開始できませんでした。'+state.errors.at(-1);$('start').textContent='もう一度試す';
}
async function start(){
    if(starting||running)return;
    const id=++generation;starting=true;lastScan=0;state.frames=0;state.errors=[];state.tracking='LIMITED';state.phase='loading';state.modelReady=false;
    measurement={id:Date.now()+'-'+generation,date:new Date().toLocaleTimeString('ja-JP'),start:now(),stamp:{}};
    $('start').disabled=true;$('diagnostic').textContent='';$('copy').textContent='確認情報をコピー';$('splat').style.visibility='hidden';$('load-status').textContent='カメラと動きの利用を許可してください。';
    try{
        if(!window.isSecureContext)throw new Error('カメラを使うにはHTTPSで開いてください。');
        const motion=typeof window.DeviceMotionEvent?.requestPermission==='function'?DeviceMotionEvent.requestPermission():Promise.resolve('granted');
        const engine=loadEngine();
        const loading=prepareModel().then(()=>{if(id===generation){state.modelReady=true;mark('model');if(lastPose)applyPose(lastPose);updateButton();}});
        loading.catch(e=>{if(id===generation)fail(e);});
        const [permission,XR8]=await Promise.all([motion,engine,...(baseline?[loading]:[])]);
        if(id!==generation)return;
        if(permission!=='granted')throw new Error('Safariで動きの利用を許可してください。');
        resize();XR8.clearCameraPipelineModules();
        XR8.XrController.configure({disableWorldTracking:false,enableLighting:false,enableWorldPoints:false,scale:'absolute'});
        XR8.addCameraPipelineModules([XR8.GlTextureRenderer.pipelineModule(),XR8.XrController.pipelineModule(),pipeline(id)]);
        await XR8.run({canvas:$('feed'),webgl2:true,allowedDevices:XR8.XrConfig.device().MOBILE,cameraConfig:{direction:XR8.XrConfig.camera().BACK},glContextConfig:{alpha:false,antialias:false}});
        if(id===generation){try{const lock=await navigator.wakeLock?.request('screen');if(id===generation)wakeLock=lock;else await lock?.release();}catch{}}
    }catch(e){if(id===generation)fail(e);}
}
$('start').onclick=start;$('place').onclick=place;$('close').onclick=stop;$('reposition').onclick=reposition;
$('rotate-left').onclick=()=>{yaw-=15;anchor.setEulerAngles(0,yaw,0);};$('rotate-right').onclick=()=>{yaw+=15;anchor.setEulerAngles(0,yaw,0);};
$('scale').oninput=()=>{const v=Number($('scale').value)/100;anchor.setLocalScale(v,v,v);$('size-value').textContent=Math.round(v*100)+'%';};
$('restart').onclick=()=>{reposition();window.XR8?.XrController.recenter();};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(diagnostic(),null,2));$('copy').textContent='コピーしました';}catch{$('diagnostic').textContent=formatTimes(times());}};
$('help').ontoggle=()=>{if($('help').open)$('diagnostic').textContent=formatTimes(times());};
window.addEventListener('resize',resize);
window.addEventListener('pagehide',()=>{if(running||starting)stop();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(running||starting))stop();});
setInterval(()=>{if(running&&!state.placed&&state.hit&&now()-lastHit>450){invalidateHit();message('机に向けて、スマートフォンをゆっくり動かしてください。');}},200);
$('splat').addEventListener('webglcontextlost',()=>{if(running||starting)fail(new Error('立体表示が中断しました。ページを再読み込みしてください。'));});
window.webar={diagnostic,get camera(){return camera;},get app(){return app;},get anchor(){return anchor;},get model(){return model;},get asset(){return asset;},state};
