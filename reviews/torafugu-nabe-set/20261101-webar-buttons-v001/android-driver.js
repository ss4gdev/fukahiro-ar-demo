import * as THREE from 'three';
import {checkAndroidSupport,openAndroidSession,tabletopHits} from './android-session.js?v=native-v007';
export function loadEngine(){return checkAndroidSupport(navigator.xr);}
export function startEngine(canvas,callbacks){
  const renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true});
  renderer.setClearColor(0x000000,0);renderer.setSize(innerWidth,innerHeight);
  renderer.xr.enabled=true;renderer.xr.setReferenceSpaceType('local');
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.01,20);
  let stopped=false,disposed=false,handle;
  const dispose=()=>{
    if(disposed)return;disposed=true;renderer.setAnimationLoop(null);renderer.dispose();
    document.body.classList.remove('native-ar');
  };
  const stop=()=>{stopped=true;handle?.stop();dispose();};
  const fail=error=>{if(stopped)return;stop();callbacks.error(error);};
  handle=openAndroidSession(navigator.xr,document.getElementById('overlay'),{
    start:async({session,space,source})=>{
      try{
        await renderer.xr.setSession(session);
        if(stopped){dispose();return;}
        renderer.xr.setReferenceSpace(space);
        document.body.classList.add('native-ar');
        callbacks.start({scene,camera,renderer});
        space.addEventListener('reset',()=>callbacks.reset?.());
        session.addEventListener('visibilitychange',()=>{if(session.visibilityState!=='visible')callbacks.pause();});
        renderer.setAnimationLoop((time,frame)=>{
          if(stopped||!frame)return;
          try{
            const pose=frame.getViewerPose(space);
            const normal=!!pose&&!pose.emulatedPosition&&session.visibilityState==='visible';
            let hits=[];
            if(normal){
              renderer.xr.updateCamera(camera);
              hits=tabletopHits(frame,source,space,pose.transform.position);
            }
            callbacks.update(hits,normal);
            callbacks.frame?.(performance.now());
            renderer.render(scene,camera);
          }catch(error){fail(error);}
        });
      }catch(error){fail(error);}
    },
    end:()=>{if(stopped)return;stopped=true;dispose();callbacks.end?.();},
    error:fail,
  });
  return stop;
}
