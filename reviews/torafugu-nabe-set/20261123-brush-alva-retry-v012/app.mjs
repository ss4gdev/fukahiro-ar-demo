import {pc,createScene,referenceMode} from '../20261121-brush-alva-metric-v011/trial-model.mjs';
import {beginTrial,mark,sample,finish,permission} from '../20261121-brush-alva-metric-v011/measurement.mjs';
import {WorldVertical,intersectTable,sdkTable,patchTable,reference} from '../20261121-brush-alva-blippar-v007/table.mjs';
import {grayscale,makeReference,locateSurface} from '../20261121-brush-alva-stable-v010/surface.mjs';
import {setTrackedCamera} from '../20261121-brush-alva-blippar-v007/alva.mjs';
import {MetricScale} from '../20261121-brush-alva-stable-v010/metric.mjs';
import {SteadyView} from '../20261121-brush-alva-stable-v010/steady.mjs';

const $=id=>document.getElementById(id),video=$('camera-feed');
const sdk='https://cdn.jsdelivr.net/gh/alanross/AlvaAR@7796af500ee92001ac2a9888363ff64d7a3bee75/dist/alva_ar.js';
const targetRim=.25,sourceRim=.250592466102044;
let session;
function say(msg){if($('status').textContent!==msg)$('status').textContent=msg;}
function waitingState(t){
    const now=performance.now();
    function windowStats(rows){
        const recent=rows.filter(r=>now-r.time<=5600);
        let gap=0;
        for(let i=1;i<recent.length;i++)gap=Math.max(gap,recent[i].time-recent[i-1].time);
        return {samples:recent.length,spanMs:recent.length?Math.round(recent.at(-1).time-recent[0].time):0,maxGapMs:Math.round(gap)};
    }
    return {modelLoaded:!!t.ready,currentTable:!!t.hit?.visual,scaleEstimated:t.metric.mapMeters>0,
        usableAccelerations:t.motionCount,visual:windowStats(t.metric.poses),motion:windowStats(t.metric.motion)};
}
function stop(msg=''){
    const t=session;if(!t)return;
    if(!t.placed)t.log.waitAtEnd=waitingState(t);
    session=null;finish(t,msg);
    for(const fn of t.cleanup.reverse())fn();
    video.pause();video.srcObject=null;
    $('paired-feed').hidden=true;
    $('ar').hidden=true;$('menu').hidden=false;$('notice').textContent=msg;$('start').disabled=false;
    document.body.classList.remove('active','alva-active');
}
function listen(t,name,fn){
    window.addEventListener(name,fn);t.cleanup.push(()=>window.removeEventListener(name,fn));
}
const angle=()=>Number(screen.orientation?.angle??window.orientation??0);
function sensors(t){
    listen(t,'deviceorientation',e=>{
        if(Number.isFinite(e.beta)&&Number.isFinite(e.gamma))t.tilt={time:performance.now(),beta:e.beta,gamma:e.gamma};
    });
    listen(t,'devicemotion',e=>{
        const a=e.acceleration;if(!a||![a.x,a.y,a.z].every(Number.isFinite))return;
        t.motionCount++;
        const s=angle()*Math.PI/180;
        const now=performance.now(),stamp=e.timeStamp;
        t.metric.acceleration(Number.isFinite(stamp)&&Math.abs(now-stamp)<300?stamp:now,[a.x*Math.cos(s)-a.y*Math.sin(s),a.x*Math.sin(s)+a.y*Math.cos(s),a.z]);
    });
}
function clearDesk(t){
    t.samples=[];t.refs=[];t.hit=null;t.placed=false;t.anchorDepth=0;t.lastPose=-Infinity;
    t.steady.reset();$('paired-feed').hidden=true;
    $('recovery').hidden=false;
    $('size-state').hidden=true;
    if(t.scene)t.scene.dish.enabled=false;
    $('adjust').hidden=true;$('target').hidden=false;$('place').hidden=false;
    setCanPlace(false);
}
function setCanPlace(ready){
    $('place').disabled=!ready;$('target').disabled=!ready;
    $('target').classList.toggle('search',!ready);
}
function usableContact(t,now){
    if(!t.hit?.visual||!t.ready||!(t.metric.mapMeters>0)||now-t.lastPose>220)return null;
    const camera=t.scene.camera,hit=intersectTable(t.hit.point,t.hit.up,camera);
    if(!hit)return null;
    const x=camera.right.clone().sub(hit.up.clone().mulScalar(camera.right.dot(hit.up)));
    return x.lengthSq()<.04?null:{hit,x:x.normalize()};
}
function place(t){
    if(t.placed)return;
    const contact=usableContact(t,performance.now());
    if(!contact){setCanPlace(false);return;}
    const {hit,x}=contact,{stage,dish}=t.scene;
    const z=new pc.Vec3().cross(x,hit.up).normalize(),m=new pc.Mat4(),u=hit.up;
    m.data.set([x.x,x.y,x.z,0,u.x,u.y,u.z,0,z.x,z.y,z.z,0,0,0,0,1]);
    stage.setPosition(hit.point);stage.setRotation(new pc.Quat().setFromMat4(m));
    stage.rotateLocal(0,t.config.rimYawOffsetDegrees,0);
    const scale=(targetRim/sourceRim)/t.metric.mapMeters;
    stage.setLocalScale(scale,scale,scale);t.placed=true;t.anchorDepth=hit.depth;
    $('size-state').hidden=false;$('size-state').dataset.metric='true';
    $('size-state').textContent='皿径25cmを目標に推定';
    $('recovery').hidden=true;
    mark(t,'placedMs');dish.enabled=true;$('place').hidden=true;$('target').hidden=true;$('adjust').hidden=false;
    say('机の上で周りからご覧ください。');
}
function observePlane(t,image,camera,k,vertical,now,alva,visualOnly=false){
    if(now-t.lastScan<95)return;
    t.lastScan=now;t.refs=t.refs.filter(ref=>now-ref.time<1150);
    t.samples=t.samples.filter(hit=>now-hit.time<850);
    let candidate=null;
    const gray=grayscale(image);
    if(vertical){
        for(const ref of t.refs){
            if(now-ref.time<140)continue;
            const found=locateSurface(ref.data,gray,k,camera,vertical,t.metric.mapMeters);
            if(found){candidate={...found,visual:true};break;}
        }
    }
    // A fitted map plane can bridge low contrast at the reticle. Only use a
    // measured normal and require observations from different camera positions.
    if(!candidate&&!visualOnly&&alva.findPlane){
        const raw=alva.findPlane(100);
        const fitted=sdkTable(raw,camera,null);
        if(fitted&&(!vertical||fitted.up.dot(vertical)>.94))candidate=intersectTable(fitted.point,vertical||fitted.up,camera);
        if(!candidate&&vertical&&raw?.length===16&&raw.every(Number.isFinite)){
            // Some builds provide a stable cluster center but an unreliable normal.
            // Accept its height only near the reticle, with distributed tracked points.
            const center=new pc.Vec3(raw[12],-raw[13],-raw[14]);
            const contact=intersectTable(center,vertical,camera);
            if(contact&&contact.point.distance(center)<.20*contact.depth){
                const points=alva.getFramePoints?.()||[],quadrants=new Set();
                for(const {x,y} of points){
                    const dx=(x-k.cx)/k.fx,dy=(y-k.cy)/k.fy;
                    if(Math.abs(dx)<.28&&Math.abs(dy)<.28)quadrants.add((dx>0?1:0)+(dy>0?2:0));
                }
                if(quadrants.size>=3)candidate=contact;
            }
        }
    }
    if(!candidate&&!vertical){
        for(const r of t.refs){
            if(!r.photo||now-r.time<140)continue;
            const fitted=patchTable(r.photo,image,camera,k,null);
            if(fitted?.wellSupported){candidate={...fitted,visual:true};break;}
        }
    }
    if(t.refs.length===0||now-t.refs.at(-1).time>260)t.refs.push({time:now,data:makeReference(gray,k,camera),photo:vertical?null:reference(image,camera,k)});
    t.hit=null;
    if(!candidate)return;
    const eye=camera.getPosition();
    const support=t.samples.filter(h=>eye.distance(h.eye)>.009*candidate.depth&&candidate.up.dot(h.up)>.985&&Math.abs(h.point.clone().sub(candidate.point).dot(candidate.up))<.035*candidate.depth);
    if(support.length&&now-support[0].time>=120){
        const checked=candidate.visual&&support.some(h=>h.visual&&now-h.time>=120);
        t.hit={...candidate,visual:!!checked};
    }
    t.samples.push({...candidate,time:now,eye:eye.clone()});
}
function frameLoop(t,alva,capture,ctx){
    const {camera,dish,app}=t.scene;const gravity=new WorldVertical();
    const paired=$('paired-feed'),background=paired.getContext('2d',{alpha:false});
    const snapshot=document.createElement('canvas');snapshot.width=video.videoWidth;snapshot.height=video.videoHeight;
    paired.width=snapshot.width;paired.height=snapshot.height;
    const feed=snapshot.getContext('2d',{alpha:false});
    let lastImage=-1,lastGood=null,lostSince=null,token;
    function schedule(){token=video.requestVideoFrameCallback?video.requestVideoFrameCallback(frame):requestAnimationFrame(frame);}
    t.cleanup.push(()=>video.cancelVideoFrameCallback?video.cancelVideoFrameCallback(token):cancelAnimationFrame(token));
    function forget(){
        t.metric.reset();gravity.reset();clearDesk(t);lastGood=null;
    }
    function frame(_,meta){
        if(session!==t)return;
        try{
            const now=performance.now();
            if(video.readyState<2||video.currentTime===lastImage){schedule();return;}
            lastImage=video.currentTime;
            if(Math.abs(video.videoWidth/video.videoHeight-capture.width/capture.height)>.035)throw Error('持つ向きが変わりました。カメラを開き直してください。');
            feed.drawImage(video,0,0,snapshot.width,snapshot.height);
            ctx.drawImage(snapshot,0,0,capture.width,capture.height);
            const image=ctx.getImageData(0,0,capture.width,capture.height),raw=alva.findCameraPose(image);
            if(raw?.length!==16||!raw.every(Number.isFinite)){
                t.hit=null;t.refs=[];t.samples=[];
                setCanPlace(false);
                lostSince??=now;
                // A single lost pose need not flash a live backdrop through the dish.
                // Briefly keep the complete last composite, then expose the live feed.
                if(t.placed&&t.wasDrawn&&now-lostSince<90){schedule();return;}
                dish.enabled=false;
                if(now-lostSince>550&&lastGood){forget();}
                if(!t.placed)$('target').classList.add('search');
                say('机の木目や縁を映して、iPhoneを少し左右に動かしてください。');
            }else{
                setTrackedCamera(raw,camera);
                const p=camera.getPosition(),q=camera.getRotation();
                if(lostSince!==null&&lastGood){
                    const limit=t.metric.mapMeters;
                    const delta=p.distance(lastGood.p);
                    const old=lastGood.q,agreement=Math.abs(q.x*old.x+q.y*old.y+q.z*old.z+q.w*old.w);
                    const refDepth=t.anchorDepth||lastGood.depth;
                    const nearby=limit?delta*limit<.12:refDepth>0&&delta<.12*refDepth;
                    if(now-lostSince>550||!nearby||agreement<.98)forget();
                    else if(t.placed)say('周りから鍋をご覧ください。');
                }
                lastGood={p:p.clone(),q:q.clone(),depth:t.hit?.depth||t.samples.at(-1)?.depth||0};lostSince=null;
                const stamp=meta?.captureTime;
                t.metric.pose(Number.isFinite(stamp)&&Math.abs(now-stamp)<300?stamp:now,[p.x,p.y,p.z],[q.x,q.y,q.z,q.w]);
                const up=gravity.read(t.tilt,angle(),camera,now);
                t.metric.solve(now);t.lastPose=now;
                if(t.placed){
                    dish.enabled=true;
                }
                else{
                    observePlane(t,image,camera,alva.intrinsics,up,now,alva);
                    const available=sample(t,now,!!usableContact(t,now));setCanPlace(available);
                    if(available)say('机面と尺度を推定できました。タップして置けます。');
                    else if(!t.hit?.visual)say('置きたい場所を中央に映し、少し横に動かしてください。');
                    else if(!t.metric.mapMeters)say('机面を確認しました。iPhoneの向きを保ち、横へ動かしてゆっくり折り返してください。');
                    else say('鍋を読み込んでいます。');
                }
                if(t.placed)t.steady.apply(image,alva.intrinsics,camera,t.scene.stage,now);
            }
            if(dish.enabled||t.wasDrawn)app.render();
            if(dish.enabled){background.drawImage(snapshot,0,0);paired.hidden=false;}
            else paired.hidden=true;
            t.wasDrawn=dish.enabled;schedule();
        }catch(e){stop(e.message);}
    }
    schedule();
}
async function start(){
    if(session)return;
    const t={metric:new MetricScale(),steady:new SteadyView(),cleanup:[],lastScan:-Infinity,motionCount:0};session=t;beginTrial(t);
    $('start').disabled=true;$('notice').textContent='';
    try{
        if(!navigator.mediaDevices?.getUserMedia)throw Error('HTTPSのSafariで開いてください。');
        const perms=[window.DeviceMotionEvent,window.DeviceOrientationEvent].map(E=>typeof E?.requestPermission==='function'?E.requestPermission():Promise.resolve('granted'));
        const permissions=Promise.all(perms).then(result=>{permission(t,'motionPermissionCallEndMs');return result;});
        const runtime=import(sdk);runtime.catch(()=>{});
        const stream=navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
        stream.then(s=>{permission(t,'cameraStreamMs');if(session===t)t.cleanup.push(()=>s.getTracks().forEach(track=>track.stop()));else s.getTracks().forEach(track=>track.stop());},()=>{});
        $('menu').hidden=true;$('ar').hidden=false;document.body.classList.add('active','alva-active');clearDesk(t);$('place').hidden=true;say('カメラを準備しています。');
        if(!(await permissions).every(p=>p==='granted'))throw Error('配置には動きの利用許可が必要です。Safariの設定を確認してください。');
        if(session!==t)return;
        sensors(t);
        const s=await stream;if(session!==t)return;video.srcObject=s;await video.play();if(session!==t)return;
        const cameraStarted=performance.now();
        const watchdog=setInterval(()=>{
            if(session!==t||t.placed)return;
            const now=performance.now();
            if(now-t.lastPose>220)setCanPlace(false);
            if(now-cameraStarted>=15000&&t.log.events.readyMs===undefined&&!t.log.waitAt15s){
                t.log.waitAt15s=waitingState(t);
                mark(t,'continuedSearchMs');
            }
        },200);
        t.cleanup.push(()=>clearInterval(watchdog));
        $('place').hidden=false;mark(t,'cameraPlayingMs');say('皿を置きたい場所を中央に映してください。');
        const scene=createScene($('application-canvas'));t.scene=scene;t.cleanup.push(()=>scene.dispose());scene.app.autoRender=false;
        scene.load().then(config=>{if(session===t){t.config=config;t.ready=true;mark(t,'assetReadyMs');}},e=>{if(session===t)stop(e.message);});
        const {AlvaAR}=await runtime;if(session!==t)return;
        const capture=document.createElement('canvas'),ratio=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight));
        capture.width=Math.round(video.videoWidth*ratio);capture.height=Math.round(video.videoHeight*ratio);
        const alva=await AlvaAR.Initialize(capture.width,capture.height);if(session!==t)return;
        const resize=()=>{
            const rect=video.getBoundingClientRect(),zoom=Math.max(rect.width/capture.width,rect.height/capture.height);
            scene.camera.camera.fov=2*Math.atan(rect.height/(2*alva.intrinsics.fy*zoom))*180/Math.PI;
        };
        const observer=new ResizeObserver(resize);observer.observe(video);t.cleanup.push(()=>observer.disconnect());resize();
        frameLoop(t,alva,capture,capture.getContext('2d',{willReadFrequently:true,alpha:false}));
    }catch(e){if(session===t)stop(e.name==='NotAllowedError'?'動きとカメラの利用を許可してください。':e.message);}
}
$('start').onclick=start;$('end').onclick=()=>stop();
if(referenceMode)$('subject').textContent='25cmの基準円盤を机に置く';
$('start').disabled=false;
$('place').onclick=()=>{if(session?.scene)place(session);};
$('target').onclick=()=>$('place').click();
$('replace').onclick=()=>{if(session)clearDesk(session);};
$('retry').onclick=()=>{stop('再試行');start();};
$('turn-left').onclick=()=>session?.scene?.stage.rotateLocal(0,-15,0);
$('turn-right').onclick=()=>session?.scene?.stage.rotateLocal(0,15,0);
window.addEventListener('pagehide',()=>stop());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&session?.scene)stop('カメラを終了しました。');});
