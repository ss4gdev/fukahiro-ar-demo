import {pc} from './model.mjs';
const source='https://cdn.jsdelivr.net/gh/alanross/AlvaAR@7796af500ee92001ac2a9888363ff64d7a3bee75/dist/alva_ar.js';
const vec=(x,y,z)=>new pc.Vec3(x,y,z);
const finite=m=>m?.length===16&&m.every(Number.isFinite);
export function candidateFor(raw,camera){
    if(!finite(raw))return null;
    // Alva's cv::Mat plane packs columns. Its first axis is the fitted normal.
    const origin=vec(raw[12],-raw[13],-raw[14]);
    let up=vec(raw[0],-raw[1],-raw[2]).normalize();
    const eye=camera.getPosition(),dir=camera.forward,delta=origin.clone().sub(eye);
    if(delta.dot(up)>0)up.mulScalar(-1);
    // The first view is top-down. Some builds return a fixed sideways axis for a valid centroid.
    // Approximate the tabletop normal from the initial pose in that case, only while still looking down.
    if(up.z<.85){if(dir.z>-.90)return null;up=vec(0,0,1);}
    const incidence=dir.dot(up);
    if(incidence>-.45)return null;
    const depth=delta.dot(up)/incidence;
    if(!Number.isFinite(depth)||depth<.02||depth>500)return null;
    const point=eye.clone().add(dir.clone().mulScalar(depth));
    if(point.distance(origin)>.6*depth)return null;
    return {point,up,depth};
}
export function setTrackedCamera(raw,camera){
    // The Sophus camera array stores rotation rows, unlike the plane matrix.
    const m=new pc.Mat4();m.data.set(raw);
    const q=new pc.Quat().setFromMat4(m);
    camera.setRotation(-q.x,q.y,q.z,q.w);camera.setPosition(raw[12],-raw[13],-raw[14]);
}
export async function startAlva(api,scene,streamPromise){
    const video=document.getElementById('camera-feed');
    const runtime=import(source);
    runtime.catch(()=>{});
    let stream;
    api.cleanup(()=>{stream?.getTracks().forEach(t=>t.stop());video.pause();video.srcObject=null;});
    stream=await streamPromise;
    if(!api.live()){stream.getTracks().forEach(t=>t.stop());return;}
    video.srcObject=stream;await video.play();
    if(!api.live())return;
    const nextFrame=fn=>video.requestVideoFrameCallback?video.requestVideoFrameCallback(fn):requestAnimationFrame(fn);
    nextFrame(()=>{if(api.live())api.mark('camera');});
    const {AlvaAR}=await runtime;if(!api.live())return;
    const w=video.videoWidth,h=video.videoHeight,ratio=Math.min(1,640/Math.max(w,h));
    const capture=document.createElement('canvas');capture.width=Math.max(1,Math.round(w*ratio));capture.height=Math.max(1,Math.round(h*ratio));
    const ctx=capture.getContext('2d',{willReadFrequently:true,alpha:false});
    const alva=await AlvaAR.Initialize(capture.width,capture.height);
    if(!api.live())return;
    const {camera,stage,dish}=scene;
    scene.app.autoRender=false;
    let latest=null,since=0,scanAt=-Infinity,placed=false,previousVideoTime=-1,hadPose=false;
    function resize(){
        const rect=video.getBoundingClientRect(),s=Math.max(rect.width/capture.width,rect.height/capture.height);
        camera.camera.fov=2*Math.atan(rect.height/(2*alva.intrinsics.fy*s))*180/Math.PI;
    }
    const observer=new ResizeObserver(resize);observer.observe(video);api.cleanup(()=>observer.disconnect());resize();
    function forget(){latest=null;since=0;api.offer(null);}
    api.onPlace(()=>{
        if(!latest||since<2||performance.now()-scanAt>500)return false;
        const {point,up,depth}=latest;
        const x=camera.right.clone().sub(up.clone().mulScalar(camera.right.dot(up))).normalize();
        const z=new pc.Vec3().cross(x,up).normalize(),basis=new pc.Mat4();
        basis.data.set([x.x,x.y,x.z,0,up.x,up.y,up.z,0,z.x,z.y,z.z,0,0,0,0,1]);
        stage.setPosition(point);stage.setRotation(new pc.Quat().setFromMat4(basis));stage.rotateLocal(0,api.config().rimYawOffsetDegrees,0);
        // Monocular tracking has arbitrary units. Set display size once, then keep it fixed in the map.
        const box=video.getBoundingClientRect(),visibleHeight=2*depth*Math.tan(camera.camera.fov*Math.PI/360);
        const scale=.64*visibleHeight*Math.min(1,box.width/box.height)/.26;
        stage.setLocalScale(scale,scale,scale);dish.enabled=true;placed=true;return true;
    });
    api.say('天板を真上に近い角度から映し、向きを保って少し左右に動かしてください。');
    function frame(){
        if(!api.live())return;
        try{
            if(video.readyState<2||video.currentTime===previousVideoTime){nextFrame(frame);return;}
            previousVideoTime=video.currentTime;api.mark('camera');
            ctx.drawImage(video,0,0,capture.width,capture.height);
            const raw=alva.findCameraPose(ctx.getImageData(0,0,capture.width,capture.height));
            if(!finite(raw)){
                if(hadPose){placed=false;dish.enabled=false;forget();api.say('位置を見失いました。もう一度、机を上から映してください。');}
                hadPose=false;
            }else{
                hadPose=true;setTrackedCamera(raw,camera);
                if(!placed&&performance.now()-scanAt>160){
                    scanAt=performance.now();
                    const hit=candidateFor(alva.findPlane(120),camera);
                    if(hit){
                        const isStable=latest&&hit.point.distance(latest.point)<.065*hit.depth&&hit.up.dot(latest.up)>.95;
                        since=isStable?since+1:1;latest=hit;
                        api.offer(since>=2?hit:null);
                    }else forget();
                }
            }
            scene.app.render();
            if(placed&&dish.enabled&&dish.gsplat?.instance?.meshInstance?.instancingCount>0)api.mark('shown');
            nextFrame(frame);
        }catch(e){api.fail(e);}
    }
    nextFrame(frame);
}
