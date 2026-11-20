import * as pc from '../20261117-splatfacto-camera-color-v001/playcanvas.mjs';

const $=id=>document.getElementById(id);
const state={phase:'welcome',placed:false,tracking:'LIMITED',reason:'INITIALIZING',frames:0,hit:null,lastFrame:0,errors:[],engine:'8thwall-binary-1.0.0',build:'20261120-brush-v001'};
let app,camera,anchor,model,asset,config,enginePromise,modelPromise,projection=new pc.Mat4(),yaw=0,running=false,starting=false,startGeneration=0,lastHit=0,hitSamples=0,lastMessage='',wakeLock;
const finite3=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k]));
function message(text){if(text!==lastMessage){$('tracking').textContent=text;lastMessage=text;}}
function diagnostic(){return {build:state.build,engine:state.engine,phase:state.phase,tracking:state.tracking,reason:state.reason,frames:state.frames,placed:state.placed,hitType:state.hit?.type||null,errors:state.errors,screen:[innerWidth,innerHeight],userAgent:navigator.userAgent};}
function errorText(error){return String(error?.message||error).slice(0,500);}
function fail(error){
    state.errors.push(errorText(error));state.phase='error';starting=false;running=false;
    try{window.XR8?.stop();}catch{}
    if(app)app.autoRender=false;
    if(model)anchor.enabled=false;
    document.body.classList.remove('active');$('hud').hidden=true;$('welcome').hidden=false;
    $('start').disabled=false;$('start').textContent='もう一度試す';
    $('load-status').textContent='開始できませんでした。Safariで開き、カメラと動きの利用を許可して再度お試しください。';
    if(/motion-denied/.test(errorText(error)))$('load-status').textContent='動きの利用が許可されていません。Safariの設定を確認して、ページを開き直してください。';
    console.error(error);releaseWake();
}
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
        config=await (await fetch('./model-config.json')).json();
        app=new pc.Application($('splat'),{graphicsDeviceOptions:{deviceTypes:['webgl2'],alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:true}});
        app.graphicsDevice.maxPixelRatio=Math.min(devicePixelRatio||1,1.5);
        app.setCanvasResolution(pc.RESOLUTION_AUTO);app.scene.gsplat.useTonemap=false;app.scene.gsplat.useFog=false;app.scene.gsplat.colorUpdateAngle=.1;app.scene.exposure=1;
        camera=new pc.Entity('Camera');camera.addComponent('camera',{clearColor:new pc.Color(0,0,0,0),nearClip:.01,farClip:100,gammaCorrection:pc.GAMMA_SRGB,toneMapping:pc.TONEMAP_NONE});
        camera.camera.calculateProjection=matrix=>matrix.copy(projection);app.root.addChild(camera);
        anchor=new pc.Entity('Table placement');app.root.addChild(anchor);anchor.enabled=false;
        model=new pc.Entity('Brush whole nabe');anchor.addChild(model);
        asset=new pc.Asset('Nabe original SH3','gsplat',{url:'./nabe-brush.ply'});app.assets.add(asset);
        await new Promise((resolve,reject)=>{asset.once('load',resolve);asset.once('error',reject);app.assets.load(asset);});
        model.addComponent('gsplat',{asset,unified:false});
        const rotation=new pc.Mat4();rotation.data.set(config.rotationColumnMajor);
        model.setLocalRotation(new pc.Quat().setFromMat4(rotation));model.setLocalScale(config.scale,config.scale,config.scale);model.setLocalPosition(...config.translation);
        resize();app.autoRender=false;app.start();
        if(asset.resource.numSplats!==158410||asset.resource.shBands!==3)throw new Error('Unexpected splat content');
    })().catch(e=>{modelPromise=null;throw e;});return modelPromise;
}
function invalidateHit(){state.hit=null;hitSamples=0;$('place').disabled=true;$('place').textContent='机の位置を探しています';$('reticle').classList.remove('ready');}
function setCandidate(hit){
    if(!finite3(hit?.position)||!Number.isFinite(hit.distance)||hit.distance<.12||hit.distance>2.5){invalidateHit();return;}
    const old=state.hit?.position;
    const stable=old&&Math.hypot(hit.position.x-old.x,hit.position.y-old.y,hit.position.z-old.z)<.07;
    hitSamples=stable?hitSamples+1:1;
    state.hit={type:hit.type,position:{...hit.position},distance:hit.distance};lastHit=performance.now();
    const ready=hitSamples>=3;$('place').disabled=!ready;$('reticle').classList.toggle('ready',ready);
    $('place').textContent=ready?'ここに置く':'机の位置を探しています';
    if(ready)message('印が机の上にあることを確認して、「ここに置く」。');
}
function update({processCpuResult}){
    if(!running)return;
    const r=processCpuResult?.reality;if(!r)return;
    state.frames++;state.lastFrame=performance.now();state.tracking=r.trackingStatus||'LIMITED';state.reason=r.trackingReason||'';
    if(!finite3(r.position)||!finite3(r.rotation)||!Number.isFinite(r.rotation.w)||r.intrinsics?.length!==16||!Array.from(r.intrinsics).every(Number.isFinite))return;
    camera.setPosition(r.position.x,r.position.y,r.position.z);camera.setRotation(r.rotation.x,r.rotation.y,r.rotation.z,r.rotation.w);projection.data.set(r.intrinsics);
    camera.camera.calculateProjection=matrix=>matrix.copy(projection);
    if(state.tracking!=='NORMAL'){
        invalidateHit();anchor.enabled=false;message('机を映し、左右にゆっくり動かしてください。');return;
    }
    anchor.enabled=state.placed;
    if(state.placed){message('スマートフォンを動かして、周りから見てください。');return;}
    if(performance.now()-lastHit<140)return;
    const hits=window.XR8.XrController.hitTest(.5,.5,['FEATURE_POINT']);
    const hit=hits.find(h=>h.type==='FEATURE_POINT'&&finite3(h.position)&&h.position.y<r.position.y-.03);
    setCandidate(hit);if(!state.hit)message('机の模様や、机に置いた紙を映してください。');
}
function place(){
    if(!running||state.tracking!=='NORMAL'||!state.hit||hitSamples<3||performance.now()-lastHit>700)return;
    anchor.setPosition(state.hit.position.x,state.hit.position.y,state.hit.position.z);
    // The user selects a point on a horizontal tabletop. It is not an inferred plane normal.
    const forward=camera.forward;yaw=Math.atan2(forward.x,forward.z)*180/Math.PI+180;
    anchor.setEulerAngles(0,yaw,0);anchor.setLocalScale(1,1,1);anchor.enabled=true;
    state.placed=true;state.phase='placed';$('reticle').hidden=true;$('place').hidden=true;$('adjust').hidden=false;$('scale').value=100;$('size-value').textContent='100%';
}
function reposition(){state.placed=false;state.phase='scanning';if(anchor)anchor.enabled=false;invalidateHit();$('reticle').hidden=false;$('place').hidden=false;$('adjust').hidden=true;}
function render(){if(!running||!app)return;app.update(1/30);app.render();}
function pipeline(){return {
    name:'fukahiro-brush-table',
    onStart:({canvasWidth,canvasHeight})=>{
        window.XR8.XrController.updateCameraProjectionMatrix({cam:{pixelRectWidth:canvasWidth,pixelRectHeight:canvasHeight,nearClipPlane:.01,farClipPlane:100},origin:{x:0,y:1.4,z:0},facing:{x:0,y:0,z:0,w:1}});
        state.phase='scanning';starting=false;running=true;$('load-status').textContent='';$('welcome').hidden=true;$('hud').hidden=false;document.body.classList.add('active');resize();reposition();
    },
    onCanvasSizeChange:({canvasWidth,canvasHeight})=>{window.XR8.XrController.updateCameraProjectionMatrix({cam:{pixelRectWidth:canvasWidth,pixelRectHeight:canvasHeight,nearClipPlane:.01,farClipPlane:100}});},
    onUpdate:update,onRender:render,
    onCameraStatusChange:({status})=>{state.cameraStatus=status;if(status==='failed')fail(new Error('Camera permission or camera stream failed'));},
    onException:fail,
};}
async function wake(){try{wakeLock=await navigator.wakeLock?.request('screen');}catch{}}
function releaseWake(){wakeLock?.release().catch(()=>{});wakeLock=null;}
async function start(){
    if(starting||running)return;
    const generation=++startGeneration;starting=true;$('start').disabled=true;state.phase='loading';$('load-status').textContent='表示を準備しています。初回は少し時間がかかります。';
    try{
        if(!window.isSecureContext)throw new Error('Secure context required');
        // Request motion inside the user gesture, before asynchronous model downloads.
        const motion=typeof window.DeviceMotionEvent?.requestPermission==='function'?DeviceMotionEvent.requestPermission():Promise.resolve('granted');
        if(await motion!=='granted')throw new Error('motion-denied');
        const [XR8]=await Promise.all([loadEngine(),prepareModel()]);
        if(generation!==startGeneration)return;
        resize();XR8.clearCameraPipelineModules();
        XR8.XrController.configure({disableWorldTracking:false,enableLighting:false,enableWorldPoints:false,scale:'absolute'});
        XR8.addCameraPipelineModules([XR8.GlTextureRenderer.pipelineModule(),XR8.XrController.pipelineModule(),pipeline()]);
        $('load-status').textContent='カメラの利用を許可してください。';
        XR8.run({canvas:$('feed'),webgl2:true,allowedDevices:XR8.XrConfig.device().MOBILE,cameraConfig:{direction:XR8.XrConfig.camera().BACK},glContextConfig:{alpha:false,antialias:false}});
        wake();
    }catch(e){if(generation===startGeneration)fail(e);}
}
function stop(){
    ++startGeneration;starting=false;running=false;state.placed=false;state.phase='welcome';
    try{window.XR8?.stop();}catch{}if(anchor)anchor.enabled=false;releaseWake();
    $('hud').hidden=true;$('welcome').hidden=false;document.body.classList.remove('active');$('start').disabled=false;$('start').textContent='カメラで机に置く';$('load-status').textContent='カメラを終了しました。';
}
$('start').onclick=start;$('place').onclick=place;$('close').onclick=stop;$('reposition').onclick=reposition;
$('rotate-left').onclick=()=>{yaw-=15;anchor.setEulerAngles(0,yaw,0);};$('rotate-right').onclick=()=>{yaw+=15;anchor.setEulerAngles(0,yaw,0);};
$('scale').oninput=()=>{const v=Number($('scale').value)/100;anchor.setLocalScale(v,v,v);$('size-value').textContent=Math.round(v*100)+'%';};
$('restart').onclick=()=>{reposition();window.XR8?.XrController.recenter();};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(JSON.stringify(diagnostic(),null,2));$('copy').textContent='コピーしました';}catch{$('diagnostic').textContent=JSON.stringify(diagnostic());}};
$('help').ontoggle=()=>{if($('help').open)$('diagnostic').textContent=`確認番号 ${state.build} / ${state.tracking} / ${state.frames} フレーム`;};
window.addEventListener('resize',resize);window.addEventListener('pagehide',stop);
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(running||starting))stop();});
setInterval(()=>{if(running&&state.lastFrame&&performance.now()-state.lastFrame>2000){invalidateHit();anchor.enabled=false;message('追跡が止まっています。机を映して動かすか、追跡をやり直してください。');}},1000);
$('splat').addEventListener('webglcontextlost',()=>fail(new Error('3D context lost')));
window.webar={diagnostic,get app(){return app;},get camera(){return camera;},get anchor(){return anchor;},get model(){return model;},get asset(){return asset;},get state(){return state;}};
