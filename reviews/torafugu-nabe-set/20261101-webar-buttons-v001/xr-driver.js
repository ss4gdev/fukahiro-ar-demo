import * as THREE from 'three';
window.THREE=THREE;
export async function loadEngine(){
  if(window.XR8)return;
  await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('ARの準備が時間内に終わりませんでした。通信を確認して、もう一度開いてください。')),45000);
    window.addEventListener('xrloaded',()=>{clearTimeout(timer);resolve();},{once:true});
    const script=document.createElement('script');script.src='./vendor/engine/xr.js';script.dataset.preloadChunks='slam';
    script.onerror=()=>{clearTimeout(timer);reject(Error('ARのデータを読み込めませんでした。もう一度開いてください。'));};
    document.head.append(script);
  });
  await window.XR8.loadChunk('slam');
}
export function startEngine(canvas,callbacks){
  const XR8=window.XR8;
  XR8.XrController.configure({disableWorldTracking:false,scale:'absolute'});
  let latestStatus='LIMITED',lastSample=-Infinity;
  const resize=()=>{
    const ratio=Math.min(devicePixelRatio||1,1.5);
    canvas.width=Math.round(innerWidth*ratio);canvas.height=Math.round(innerHeight*ratio);
  };
  resize();window.addEventListener('resize',resize);visualViewport?.addEventListener('resize',resize);
  XR8.addCameraPipelineModules([
    XR8.GlTextureRenderer.pipelineModule(),XR8.Threejs.pipelineModule(),XR8.XrController.pipelineModule(),
    {
      name:'fukahiro-tabletop-controls',
      onStart:()=>{
        const scene=XR8.Threejs.xrScene();scene.camera.position.set(0,1,0);
        XR8.XrController.updateCameraProjectionMatrix({origin:scene.camera.position,facing:scene.camera.quaternion});
        callbacks.start(scene);
      },
      onUpdate:({processCpuResult})=>{
        latestStatus=processCpuResult?.reality?.trackingStatus||'LIMITED';
        const now=performance.now();
        if(latestStatus==='NORMAL'&&now-lastSample<50)return;
        lastSample=now;
        const target=document.getElementById('aim').getBoundingClientRect();
        const view=canvas.getBoundingClientRect();
        if(view.width<=0||view.height<=0){callbacks.update([],false);return;}
        const x=(target.left+target.width/2-view.left)/view.width,y=(target.top+target.height/2-view.top)/view.height;
        const hits=[];
        if(latestStatus==='NORMAL'&&target.width>0){
          // Five rays within the visible aim circle; at most 100 hit tests per second.
          const offsets=[[0,0],[-12,0],[12,0],[0,-12],[0,12]];
          offsets.forEach(([dx,dy],ray)=>{
            const results=XR8.XrController.hitTest(Math.max(0,Math.min(1,x+dx/view.width)),Math.max(0,Math.min(1,y+dy/view.height)),['FEATURE_POINT']);
            const hit=results.find(h=>h.position&&[h.position.x,h.position.y,h.position.z,h.distance].every(Number.isFinite)&&h.distance>=.12&&h.distance<=2.5);
            if(hit)hits.push({...hit,ray});
          });
        }
        callbacks.update(hits,latestStatus==='NORMAL');
      },
      onCameraStatusChange:({status})=>{if(status==='failed')callbacks.error(Error('カメラを使えません。SafariまたはChromeのカメラ許可を確認してください。'));},
      onException:error=>callbacks.error(error),
      onPaused:()=>callbacks.pause(),
    }
  ]);
  XR8.run({canvas,allowedDevices:XR8.XrConfig.device().MOBILE,cameraConfig:{direction:XR8.XrConfig.camera().BACK},sessionConfiguration:{defaultEnvironment:{disabled:true}}});
  return ()=>{window.removeEventListener('resize',resize);visualViewport?.removeEventListener('resize',resize);XR8.stop();XR8.clearCameraPipelineModules();};
}
