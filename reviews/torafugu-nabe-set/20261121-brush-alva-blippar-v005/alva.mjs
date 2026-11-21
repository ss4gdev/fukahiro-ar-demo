import {pc} from './model.mjs';
import {DeskCandidates,WorldVertical,intersectTable,patchTable,reference,sdkTable} from './table.mjs';
const finite=m=>m?.length===16&&m.every(Number.isFinite);
export function setTrackedCamera(raw,camera){
    const m=new pc.Mat4();m.data.set(raw);
    const q=new pc.Quat().setFromMat4(m);
    camera.setRotation(-q.x,q.y,q.z,q.w);camera.setPosition(raw[12],-raw[13],-raw[14]);
}
export async function startAlva(api,scene,streamPromise,runtime,tilt){
    const video=document.getElementById('camera-feed');
    let stream,frameToken;
    const useVideoFrame=!!video.requestVideoFrameCallback;
    const next=fn=>{frameToken=useVideoFrame?video.requestVideoFrameCallback(fn):requestAnimationFrame(fn);};
    api.cleanup(()=>{
        if(useVideoFrame)video.cancelVideoFrameCallback(frameToken);else cancelAnimationFrame(frameToken);
        stream?.getTracks().forEach(t=>t.stop());video.pause();video.srcObject=null;
    });
    stream=await streamPromise;
    if(!api.live()){stream.getTracks().forEach(t=>t.stop());return;}
    video.srcObject=stream;await video.play();if(!api.live())return;
    next(()=>{api.mark('camera');});
    const {AlvaAR}=await runtime;if(!api.live())return;
    const w=video.videoWidth,h=video.videoHeight,ratio=Math.min(1,640/Math.max(w,h));
    const capture=document.createElement('canvas');capture.width=Math.max(1,Math.round(w*ratio));capture.height=Math.max(1,Math.round(h*ratio));
    const ctx=capture.getContext('2d',{willReadFrequently:true,alpha:false});
    const alva=await AlvaAR.Initialize(capture.width,capture.height);
    if(!api.live())return;
    const {camera,stage,dish}=scene;scene.app.autoRender=false;
    const surface=new DeskCandidates(),gravity=new WorldVertical();
    let hit=null,scanAt=-Infinity,placed=false,previousTime=-1,hadPose=false;
    let needsClear=false,older=null,ref=null,refAt=0,scanStart=performance.now(),anchorUp=null,mismatchAt=null,yaw=0;
    const hint='置きたい場所を中央に映し、向きを保って左右に少し動かしてください。';
    function resize(){
        const rect=video.getBoundingClientRect(),s=Math.max(rect.width/capture.width,rect.height/capture.height);
        camera.camera.fov=2*Math.atan(rect.height/(2*alva.intrinsics.fy*s))*180/Math.PI;
    }
    const observer=new ResizeObserver(resize);observer.observe(video);api.cleanup(()=>observer.disconnect());resize();
    function clear(){
        placed=false;dish.enabled=false;hit=null;surface.reset();anchorUp=null;mismatchAt=null;ref=null;older=null;scanAt=-Infinity;scanStart=performance.now();api.offer(null);
    }
    api.controls({
        replace(){yaw=0;clear();api.say(hint);},
        rotate(angle){if(placed){stage.rotateLocal(0,angle,0);yaw+=angle;}},
        retry(){alva.reset();gravity.reset();hadPose=false;clear();api.say(hint);}
    });
    api.onPlace(()=>{
        const now=performance.now(),vertical=gravity.read(tilt.sample,screen.orientation?.angle??window.orientation??0,camera,now);
        hit=surface.current(vertical,now);
        if(!hit){api.offer(null);return false;}
        const current=intersectTable(hit.point,hit.up,camera);
        if(!current||current.point.distance(hit.point)>.13*hit.depth)return false;
        const {point,up,depth}=current;
        const x=camera.right.clone().sub(up.clone().mulScalar(camera.right.dot(up)));
        if(x.lengthSq()<.04)return false;
        x.normalize();
        const z=new pc.Vec3().cross(x,up).normalize(),basis=new pc.Mat4();
        basis.data.set([x.x,x.y,x.z,0,up.x,up.y,up.z,0,z.x,z.y,z.z,0,0,0,0,1]);
        stage.setPosition(point);stage.setRotation(new pc.Quat().setFromMat4(basis));stage.rotateLocal(0,api.config().rimYawOffsetDegrees+yaw,0);
        const box=video.getBoundingClientRect(),visibleHeight=2*depth*Math.tan(camera.camera.fov*Math.PI/360);
        const scale=.64*visibleHeight*Math.min(1,box.width/box.height)/.26;
        stage.setLocalScale(scale,scale,scale);dish.enabled=true;placed=true;anchorUp=up.clone();api.slow(false);return true;
    });
    api.say(hint);
    function frame(){
        if(!api.live())return;
        try{
            if(video.readyState<2||video.currentTime===previousTime){next(frame);return;}
            previousTime=video.currentTime;api.mark('camera');
            ctx.drawImage(video,0,0,capture.width,capture.height);
            const image=ctx.getImageData(0,0,capture.width,capture.height);
            const raw=alva.findCameraPose(image),now=performance.now();
            if(!finite(raw)){
                if(hadPose){gravity.reset();clear();api.say('位置を見失いました。'+hint);}
                hadPose=false;
            }else{
                hadPose=true;api.mark('pose');setTrackedCamera(raw,camera);
                const vertical=gravity.read(tilt.sample,screen.orientation?.angle??window.orientation??0,camera,now);
                if(placed&&vertical&&anchorUp.dot(vertical)<.91){
                    mismatchAt??=now;
                    if(now-mismatchAt>=160){clear();api.say('傾きが変わりました。机をもう一度中央に映してください。');}
                }else mismatchAt=null;
                if(!placed&&now-scanAt>=85){
                    scanAt=now;
                    let candidate=sdkTable(alva.findPlane(90),camera,vertical);
                    if(!candidate&&ref&&now-refAt>=85)candidate=patchTable(ref,image,camera,alva.intrinsics,vertical);
                    if(!candidate&&older)candidate=patchTable(older,image,camera,alva.intrinsics,vertical);
                    if(!ref||now-refAt>430){older=ref;ref=reference(image,camera,alva.intrinsics);refAt=now;}
                    if(candidate)api.mark('plane');
                    const hasNewSensor=tilt.sample&&now-tilt.sample.time<250;
                    if(hasNewSensor&&!vertical)surface.reset();
                    else surface.offer(candidate,vertical,now);
                    const nextHit=surface.current(vertical,now);
                    if(nextHit!==hit){hit=nextHit;api.offer(hit);}
                }
            }
            if(!placed&&!hit&&now-scanStart>6500){
                api.slow(true);
                api.say(hadPose?'机の縁や木目を中央に入れて、ゆっくり横へ移動してください。':'机の角を映して、端末を少し横へ移動してください。');
            }else api.slow(false);
            if(placed){scene.app.render();if(dish.gsplat?.instance?.meshInstance?.instancingCount>0)api.mark('shown');}
            else if(needsClear)scene.app.render();
            needsClear=placed;
            next(frame);
        }catch(error){api.fail(error);}
    }
    next(frame);
}
