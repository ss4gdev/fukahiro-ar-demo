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
    let placed=false,ready=false,cameraLive=false,frameToken;
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
    bridge.onPlace(()=>{if(!ready)return false;placed=true;dish.enabled=true;return true;});
    scene.load().then(cfg=>{if(bridge.live()&&cfg)bridge.model(cfg);},()=>bridge.error('MODEL_LOAD_FAILED'));
    sdk.SetStageReadyCallback(()=>{
        if(!bridge.live())return;
        ready=true;bridge.surface();if(placed)dish.enabled=true;
    });
    sdk.SetTrackingQualityChangeCallback?.(quality=>{
        if(bridge.live()&&String(quality).toUpperCase()==='LOST'){
            ready=false;placed=false;dish.enabled=false;bridge.lost();
        }
    });
    sdk.SetTrackingStartedCallback?.(()=>{if(!cameraLive)bridge.step('permission');});
    app.on('frameend',()=>{
        if(bridge.live()&&placed&&dish.enabled&&stage.enabled&&dish.gsplat?.instance?.meshInstance?.instancingCount>0)bridge.shown();
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
