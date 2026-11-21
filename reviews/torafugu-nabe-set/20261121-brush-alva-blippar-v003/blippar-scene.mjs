import {createScene,pc} from './model.mjs';

const bridge=window.tableBridge;
async function launch(){
    const sdk=window.WEBARSDK;
    if(typeof sdk?.InitPlayCanvas!=='function'){
        bridge.error('INITIALIZATION_FAILED');
        return;
    }
    const scene=createScene(document.getElementById('application-canvas'));
    const {app,camera,stage,dish}=scene;
    window.pc=Object.assign({},pc,{app});
    stage.enabled=false;
    let placed=false,ready=false,cameraLive=false,frameToken,quality='',stableSince=null;
    let poseBeforeReset=null;
    function cameraFrame(){
        if(!bridge.live())return;
        const v=Array.from(document.querySelectorAll('video')).find(el=>el.readyState>=2&&el.videoWidth&&el.currentTime>0);
        if(v){cameraLive=true;bridge.camera();}
        else frameToken=requestAnimationFrame(cameraFrame);
    }
    frameToken=requestAnimationFrame(cameraFrame);
    bridge.onDispose(()=>{
        cancelAnimationFrame(frameToken);
        try{sdk.StopTracking?.(false);}catch{}
        for(const v of document.querySelectorAll('video'))v.srcObject?.getTracks?.().forEach(t=>t.stop());
        scene.dispose();
    });
    function invalidate(){
        ready=false;placed=false;stableSince=null;dish.enabled=false;bridge.lost();
    }
    function resetState(){
        const pose=sdk.GetCurrentPose?.();
        poseBeforeReset=pose?Array.from(pose):null;
        stage.enabled=false;quality='';invalidate();
    }
    if(typeof sdk.PerformReset==='function')bridge.onReset(()=>{resetState();sdk.PerformReset();});
    sdk.SetResetButtonCallback?.(()=>{if(bridge.live()){resetState();bridge.resetObserved();}});
    function hasPlacement(){
        if(quality==='LOST'||!stage.enabled||!sdk.GetTrackingStatus()?.isTracking)return false;
        const pose=sdk.GetCurrentPose();
        if(pose?.length!==16||!pose.every(Number.isFinite)||Math.abs(pose[15])<0.0001)return false;
        if(poseBeforeReset&&pose.every((n,i)=>n===poseBeforeReset[i]))return false;
        poseBeforeReset=null;
        return true;
    }
    bridge.onPlace(()=>{
        if(!ready||!hasPlacement()){invalidate();return false;}
        placed=true;dish.enabled=true;return true;
    });
    scene.load().then(cfg=>{if(bridge.live()&&cfg)bridge.model(cfg);},()=>bridge.error('MODEL_LOAD_FAILED'));
    // The SDK owns stage.enabled. Its first-stage event need not be repeated on relocalisation.
    sdk.SetStageReadyCallback(()=>{if(bridge.live())poseBeforeReset=null;});
    sdk.SetTrackingQualityChangeCallback?.(value=>{
        if(!bridge.live())return;
        quality=String(value).toUpperCase();
        if(quality==='LOST')invalidate();
    });
    sdk.SetTrackingStartedCallback?.(()=>{if(!cameraLive)bridge.step('permission');});
    app.on('frameend',()=>{
        if(!bridge.live())return;
        if(!hasPlacement()){
            stableSince=null;
            if(ready||placed)invalidate();
            return;
        }
        const now=performance.now();
        stableSince??=now;
        if(!ready&&now-stableSince>=200){ready=true;bridge.surface();}
        if(placed&&dish.enabled&&dish.gsplat?.instance?.meshInstance?.instancingCount>0)bridge.shown();
    });
    bridge.step('init');
    // Some builds make the public API available before the renderer is ready to accept it.
    while(bridge.live()&&!ready){
        const attached=sdk.InitPlayCanvas('application-canvas',camera,stage);
        if(attached&&typeof attached.then==='function'){
            await attached;
            if(bridge.live()&&!cameraLive&&!ready)bridge.step('permission');
            return;
        }
        await new Promise(done=>setTimeout(done,400));
    }
}
if(bridge?.live())launch().catch(()=>bridge.error('INITIALIZATION_FAILED'));
