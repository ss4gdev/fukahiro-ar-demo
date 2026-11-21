import {pc} from './model.mjs';
import {deskGuide,deskHit,outlineDesk} from './calibration.mjs';
import {DeskCandidates,WorldVertical,plateScale,intersectTable,patchTable,reference,sdkTable} from './table.mjs';
const finite=m=>m?.length===16&&m.every(Number.isFinite);
const quatAgreement=(a,b)=>Math.abs(a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w);
function tableRotation(right,up){
    const x=right.clone().sub(up.clone().mulScalar(right.dot(up)));
    if(x.lengthSq()<.04)return null;
    x.normalize();
    const z=new pc.Vec3().cross(x,up).normalize(),basis=new pc.Mat4();
    basis.data.set([x.x,x.y,x.z,0,up.x,up.y,up.z,0,z.x,z.y,z.z,0,0,0,0,1]);
    return new pc.Quat().setFromMat4(basis);
}
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
    let lostAt=null,lastPoseAt=-Infinity,anchorDepth=0;
    const hint='置きたい場所を中央に映し、向きを保って左右に少し動かしてください。';
    let desk=null,trackingOrigin=null,travel=0;
    const guide=api.deskWidthMeters?deskGuide(api.deskWidthMeters,calibrated=>{
        desk=calibrated;api.calibrating(false);api.say('線が机の辺に合っていることを確認し、置きたい場所を中央に映してください。');
    }):null;
    if(guide)api.cleanup(()=>{guide.dispose();outlineDesk(null,camera,false);});
    function resize(){
        const rect=video.getBoundingClientRect(),s=Math.max(rect.width/capture.width,rect.height/capture.height);
        camera.camera.fov=2*Math.atan(rect.height/(2*alva.intrinsics.fy*s))*180/Math.PI;
    }
    const observer=new ResizeObserver(resize);observer.observe(video);api.cleanup(()=>observer.disconnect());resize();
    function clear(newMap=false){
        if(newMap){trackingOrigin=null;travel=0;}
        if(newMap&&guide){desk=null;guide.reset();api.calibrating(true);}
        placed=false;dish.enabled=false;hit=null;surface.reset();anchorUp=null;mismatchAt=null;ref=null;older=null;scanAt=-Infinity;scanStart=performance.now();api.offer(null);
    }
    api.controls({
        measureAgain(){if(guide){yaw=0;clear(true);}},
        replace(){yaw=0;clear();api.say(hint);},
        rotate(angle){if(placed){stage.rotateLocal(0,angle,0);yaw+=angle;}},
        retry(){alva.reset();gravity.reset();hadPose=false;lostAt=null;clear(true);api.say(hint);}
    });
    api.onPlace(()=>{
        const now=performance.now(),vertical=gravity.read(tilt.sample,screen.orientation?.angle??window.orientation??0,camera,now);
        if(lostAt!==null||now-lastPoseAt>350)return false;
        const selected=desk?deskHit(desk,camera):guide?null:surface.current(vertical,now);
        if(!selected)return false;
        const current=desk?selected:intersectTable(selected.point,selected.up,camera);
        if(!current||current.point.distance(selected.point)>.13*selected.depth)return false;
        const {point,up,depth}=current;
        const rotation=tableRotation(desk?desk.right:camera.right,up);
        if(!rotation)return false;
        stage.setPosition(point);stage.setRotation(rotation);stage.rotateLocal(0,api.config().rimYawOffsetDegrees+yaw,0);
        const heightInMap=camera.getPosition().clone().sub(point).dot(up);
        const scale=desk?desk.scale:plateScale(heightInMap,api.cameraHeightMeters);
        if(!Number.isFinite(scale)||scale<=0)return false;
        anchorDepth=depth;
        stage.setLocalScale(scale,scale,scale);dish.enabled=true;placed=true;anchorUp=up.clone();api.slow(false);return true;
    });
    api.say(hint);
    function frame(){
        if(!api.live())return;
        try{
            if(video.readyState<2||video.currentTime===previousTime){next(frame);return;}
            if(Math.abs(video.videoWidth/video.videoHeight-w/h)>.03)throw Error('カメラの縦横が変わりました。使う向きに持ってもう一度開始してください。');
            previousTime=video.currentTime;api.mark('camera');
            ctx.drawImage(video,0,0,capture.width,capture.height);
            const image=ctx.getImageData(0,0,capture.width,capture.height);
            const raw=alva.findCameraPose(image),now=performance.now();
            if(!finite(raw)){
                guide?.lost();
                if(hadPose){
                    if(lostAt===null&&!placed&&hit)api.offer(null);
                    lostAt??=now;
                    if(placed) dish.enabled=false;
                    if(now-lostAt>700){gravity.reset();clear(true);hadPose=false;}
                    api.say('机の位置を確認中です。置きたい場所を中央に映してください。');
                }
            }else{
                const previousEye=lostAt!==null?camera.getPosition().clone():null;
                const previousRotation=lostAt!==null?camera.getRotation().clone():null;
                setTrackedCamera(raw,camera);
                if(lostAt!==null){
                    const depth=placed?anchorDepth:(hit?.depth||desk?.width||(guide?Math.max(travel,1e-5):0));
                    const consistent=hadPose&&now-lostAt<=700&&depth>0&&previousEye.distance(camera.getPosition())<.18*depth&&quatAgreement(previousRotation,camera.getRotation())>.975;
                    if(!consistent){gravity.reset();clear(true);}
                    else if(placed){dish.enabled=true;api.say('少し横へ移動し、皿の位置を確認してください。');}
                    lostAt=null;
                }
                if(guide){trackingOrigin??=camera.getPosition().clone();travel=Math.max(travel,trackingOrigin.distance(camera.getPosition()));}
                lastPoseAt=now;hadPose=true;api.mark('pose');
                const vertical=gravity.read(tilt.sample,screen.orientation?.angle??window.orientation??0,camera,now);
                guide?.frame(capture,camera,alva.intrinsics,now,vertical);
                if(placed&&!desk&&vertical&&anchorUp.dot(vertical)<.91){
                    mismatchAt??=now;
                    if(now-mismatchAt>=650){clear();api.say('傾きが変わりました。机をもう一度中央に映してください。');}
                }else{
                    mismatchAt=null;
                    if(placed&&!desk&&vertical){
                        const corrected=anchorUp.clone().lerp(anchorUp,vertical,.18).normalize();
                        const rotation=tableRotation(stage.right,corrected);
                        if(rotation){stage.setRotation(rotation);anchorUp=corrected;}
                    }
                }
                if(!placed&&guide){
                    const candidate=desk?deskHit(desk,camera):null;
                    if(candidate)api.mark('plane');
                    if(candidate||hit){hit=candidate;api.offer(hit);}
                }else if(!placed&&now-scanAt>=85){
                    scanAt=now;
                    let candidate=sdkTable(alva.findPlane(90),camera,vertical);
                    if(!candidate&&ref&&now-refAt>=85)candidate=patchTable(ref,image,camera,alva.intrinsics,vertical);
                    if(!candidate&&older)candidate=patchTable(older,image,camera,alva.intrinsics,vertical);
                    if(!ref||now-refAt>430){older=ref;ref=reference(image,camera,alva.intrinsics);refAt=now;}
                    if(candidate)api.mark('plane');
                    const hasNewSensor=tilt.sample&&now-tilt.sample.time<250;
                    if(!hasNewSensor||vertical)surface.offer(candidate,vertical,now);
                    const nextHit=hasNewSensor&&!vertical?null:surface.current(vertical,now);
                    if(nextHit||nextHit!==hit){hit=nextHit;api.offer(hit);}
                }
            }
            if(!guide&&!placed&&!hit&&now-scanStart>6500){
                api.slow(true);
                api.say(hadPose?'机の縁や木目を中央に入れて、ゆっくり横へ移動してください。':'机の角を映して、端末を少し横へ移動してください。');
            }else api.slow(false);
            if(guide)outlineDesk(desk,camera,!!desk&&hadPose&&lostAt===null&&(!placed||!document.getElementById('rating').hidden));
            if(placed){scene.app.render();if(dish.enabled&&dish.gsplat?.instance?.meshInstance?.instancingCount>0)api.mark('shown');}
            else if(needsClear)scene.app.render();
            needsClear=placed;
            next(frame);
        }catch(error){api.fail(error);}
    }
    next(frame);
}
