import {pc} from './model.mjs';
const sdkUrl='https://webar-sdk.blippar.com/releases/2.1.0/webar-sdk-2.1.0.min.js';
export async function startBlippar(api,scene,key){
    const {camera,stage,dish,app}=scene;
    document.getElementById('ar').style.background='transparent';
    document.getElementById('camera-feed').hidden=true;
    window.pc=Object.assign({},pc,{app});
    window.WEBAR_SDK_CONFIG={'webar-mode':'surface-tracking','rendering-engine':'playcanvas','auto-init':'true','auto-start':'true','static-camera':'true','show-guide-view':'true','render-scene-on-desktop':'false','show-qr-card-on-desktop':'false'};
    const script=document.createElement('script'),url=new URL(sdkUrl);
    url.searchParams.set('license-key',key);script.src=url;script.referrerPolicy='strict-origin';
    let sdk,ready=false,placed=false,cameraStarted=false;
    api.cleanup(()=>{try{sdk?.StopTracking?.(false);}catch{} for(const v of document.querySelectorAll('video'))v.srcObject?.getTracks?.().forEach(t=>t.stop());});
    api.onPlace(()=>{if(!ready)return false;placed=true;dish.enabled=true;return true;});
    const checkVideo=()=>{
        if(!api.live())return;
        const video=Array.from(document.querySelectorAll('video')).find(v=>v!==document.getElementById('camera-feed')&&v.readyState>=2&&v.videoWidth&&v.currentTime>0);
        if(video){cameraStarted=true;api.mark('camera');}else requestAnimationFrame(checkVideo);
    };requestAnimationFrame(checkVideo);
    api.say('Blipparの起動を待っています。カメラと動きの利用を許可してください。');
    await new Promise((ok,no)=>{
        const t=setTimeout(()=>no(Error('Blipparを起動できません。接続と試用キーの対象ドメインを確認してください。')),25000);
        script.onload=()=>{clearTimeout(t);ok();};script.onerror=()=>{clearTimeout(t);no(Error('Blipparを取得できません。接続と試用キーを確認してください。'));};document.head.append(script);
    });
    if(!api.live())return;
    for(let attempt=0;api.live()&&typeof window.WEBARSDK?.InitPlayCanvas!=='function'&&attempt<80;attempt++)await new Promise(done=>setTimeout(done,100));
    if(!api.live())return;
    sdk=window.WEBARSDK;
    if(typeof sdk?.InitPlayCanvas!=='function')throw Error('Blippar SDKの準備ができません。試用キーの登録先を確認してください。');
    function found(){
        if(!api.live())return;
        ready=true;if(!placed)api.offer({});else dish.enabled=true;
    }
    sdk.SetStageReadyCallback(found);
    sdk.SetTrackingQualityChangeCallback?.(quality=>{
        if(!api.live())return;
        if(String(quality).toUpperCase()==='LOST'){ready=false;placed=false;dish.enabled=false;api.offer(null);api.say('位置を見失いました。机に向けてもう一度確認してください。');}
    });
    app.on('frameend',()=>{if(api.live()&&placed&&dish.enabled&&stage.enabled&&dish.gsplat?.instance?.meshInstance?.instancingCount>0)api.mark('shown');});
    // The script exposes its functions before the asynchronous domain/config check creates the engine.
    async function attach(){
        for(let attempt=0;api.live()&&!ready&&attempt<25;attempt++){
            const initialized=sdk.InitPlayCanvas('application-canvas',camera,stage);
            if(initialized&&typeof initialized.then==='function'){await initialized;return;}
            await new Promise(done=>setTimeout(done,400));
        }
    }
    attach().catch(api.fail);
    const help=setTimeout(()=>{if(api.live()&&!ready&&!cameraStarted)api.say('起動を待っています。カメラの許可と、キーが ss4gdev.github.io 用かを確認してください。終了して再試行できます。');},25000);
    api.cleanup(()=>clearTimeout(help));
}
