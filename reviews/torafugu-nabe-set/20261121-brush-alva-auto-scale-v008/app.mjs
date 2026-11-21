import {pc,createScene} from '../20261121-brush-alva-blippar-v007/model.mjs';
import {WorldVertical,intersectTable} from '../20261121-brush-alva-blippar-v007/table.mjs';
import {grayscale,makeReference,locateSurface} from './surface.mjs';
import {setTrackedCamera} from '../20261121-brush-alva-blippar-v007/alva.mjs';
import {MetricScale} from './metric.mjs';

const $=id=>document.getElementById(id),video=$('camera-feed');
const sdk='https://cdn.jsdelivr.net/gh/alanross/AlvaAR@7796af500ee92001ac2a9888363ff64d7a3bee75/dist/alva_ar.js';
const targetRim=.25,sourceRim=.250592466102044;
let session;
function say(msg){if($('status').textContent!==msg)$('status').textContent=msg;}
function stop(msg=''){
    const t=session;if(!t)return;
    session=null;
    for(const fn of t.cleanup.reverse())fn();
    video.pause();video.srcObject=null;
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
        const s=angle()*Math.PI/180;
        t.metric.acceleration(performance.now(),[a.x*Math.cos(s)-a.y*Math.sin(s),a.x*Math.sin(s)+a.y*Math.cos(s),a.z]);
    });
}
function clearDesk(t){
    t.samples=[];t.refs=[];t.hit=null;t.placed=false;
    if(t.scene)t.scene.dish.enabled=false;
    $('adjust').hidden=true;$('target').hidden=false;$('place').hidden=false;
    $('target').classList.add('search');$('place').disabled=t.pending;
    $('place').textContent=t.pending?'配置を受付済み':'ここに置く';
}
function place(t){
    const {camera,stage,dish}=t.scene;
    if(!t.ready||!t.hit||!t.metric.mapMeters||!t.pending)return;
    const hit=intersectTable(t.hit.point,t.hit.up,camera);if(!hit)return;
    const x=camera.right.clone().sub(hit.up.clone().mulScalar(camera.right.dot(hit.up)));
    if(x.lengthSq()<.04)return;
    x.normalize();
    const z=new pc.Vec3().cross(x,hit.up).normalize(),m=new pc.Mat4(),u=hit.up;
    m.data.set([x.x,x.y,x.z,0,u.x,u.y,u.z,0,z.x,z.y,z.z,0,0,0,0,1]);
    stage.setPosition(hit.point);stage.setRotation(new pc.Quat().setFromMat4(m));
    stage.rotateLocal(0,t.config.rimYawOffsetDegrees,0);
    const scale=(targetRim/sourceRim)/t.metric.mapMeters;
    stage.setLocalScale(scale,scale,scale);t.placed=true;t.pending=false;t.anchorDepth=hit.depth;
    dish.enabled=true;$('place').hidden=true;$('target').hidden=true;$('adjust').hidden=false;
    say('周りから鍋をご覧ください。');
}
function observePlane(t,image,camera,k,vertical,now){
    if(now-t.lastScan<95)return;
    t.lastScan=now;t.refs=t.refs.filter(ref=>now-ref.time<1150);
    t.samples=t.samples.filter(hit=>now-hit.time<850);
    let candidate=null;
    const gray=grayscale(image);
    if(vertical&&t.metric.mapMeters){
        for(const ref of t.refs){
            if(now-ref.time<140)continue;
            const found=locateSurface(ref.data,gray,k,camera,vertical,t.metric.mapMeters);
            if(found){candidate=found;break;}
        }
    }
    if(t.refs.length===0||now-t.refs.at(-1).time>260)t.refs.push({time:now,data:makeReference(gray,k,camera)});
    t.hit=null;
    if(!candidate)return;
    const support=t.samples.filter(h=>candidate.up.dot(h.up)>.985&&Math.abs(h.point.clone().sub(candidate.point).dot(candidate.up))<.035*candidate.depth);
    if(support.length&&now-support[0].time>=120)t.hit=candidate;
    t.samples.push({...candidate,time:now});
}
function frameLoop(t,alva,capture,ctx){
    const {camera,dish,app}=t.scene;const gravity=new WorldVertical();
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
            ctx.drawImage(video,0,0,capture.width,capture.height);
            const image=ctx.getImageData(0,0,capture.width,capture.height),raw=alva.findCameraPose(image);
            if(raw?.length!==16||!raw.every(Number.isFinite)){
                t.hit=null;t.refs=[];t.samples=[];dish.enabled=false;
                lostSince??=now;
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
                    if(now-lostSince>550||!limit||delta*limit>.12||agreement<.98)forget();
                    else if(t.placed)say('周りから鍋をご覧ください。');
                }
                lastGood={p:p.clone(),q:q.clone()};lostSince=null;
                const stamp=meta?.captureTime;
                t.metric.pose(Number.isFinite(stamp)&&Math.abs(now-stamp)<300?stamp:now,[p.x,p.y,p.z],[q.x,q.y,q.z,q.w]);
                const up=gravity.read(t.tilt,angle(),camera,now);
                if(t.placed){dish.enabled=true;}
                else{
                    const meters=t.metric.solve(now);
                    observePlane(t,image,camera,alva.intrinsics,up,now);
                    if(!up)t.hit=null;
                    $('target').classList.toggle('search',!(t.hit&&meters));
                    if(!t.tilt||!t.metric.motion.length)say('動きの情報を待っています。Safariでカメラと動きへのアクセスを許可してください。');
                    else if(!meters)say('置きたい場所を中央に映したまま、iPhoneをゆっくり左右に往復させてください。');
                    else if(!t.hit)say('置きたい場所の木目や縁を中央に映し、少し横に動かしてください。');
                    else if(!t.ready)say('机を見つけました。鍋を読み込んでいます。');
                    else say('ここに置けます。');
                    place(t);
                }
            }
            if(dish.enabled||t.wasDrawn)app.render();
            t.wasDrawn=dish.enabled;schedule();
        }catch(e){stop(e.message);}
    }
    schedule();
}
async function start(){
    if(session)return;
    const t={metric:new MetricScale(),cleanup:[],pending:false,lastScan:-Infinity};session=t;
    $('start').disabled=true;$('notice').textContent='';
    try{
        if(!navigator.mediaDevices?.getUserMedia)throw Error('HTTPSのSafariで開いてください。');
        const perms=[window.DeviceMotionEvent,window.DeviceOrientationEvent].map(E=>typeof E?.requestPermission==='function'?E.requestPermission():Promise.resolve('granted'));
        const permissions=Promise.all(perms);
        const runtime=import(sdk);runtime.catch(()=>{});
        const stream=navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});
        stream.then(s=>{if(session===t)t.cleanup.push(()=>s.getTracks().forEach(track=>track.stop()));else s.getTracks().forEach(track=>track.stop());},()=>{});
        $('menu').hidden=true;$('ar').hidden=false;document.body.classList.add('active','alva-active');clearDesk(t);$('place').hidden=true;say('カメラを準備しています。');
        if(!(await permissions).every(p=>p==='granted'))throw Error('配置には動きの利用許可が必要です。Safariの設定を確認してください。');
        if(session!==t)return;
        sensors(t);
        const s=await stream;if(session!==t)return;video.srcObject=s;await video.play();if(session!==t)return;
        $('place').hidden=false;say('皿を置きたい場所を中央に映してください。');
        const scene=createScene($('application-canvas'));t.scene=scene;t.cleanup.push(()=>scene.dispose());scene.app.autoRender=false;
        scene.load().then(config=>{if(session===t){t.config=config;t.ready=true;}},e=>{if(session===t)stop(e.message);});
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
$('place').onclick=()=>{if(session&&!session.placed){session.pending=true;$('place').disabled=true;$('place').textContent='配置を受付済み';}};
$('target').onclick=()=>$('place').click();
$('replace').onclick=()=>{if(session)clearDesk(session);};
$('turn-left').onclick=()=>session?.scene?.stage.rotateLocal(0,-15,0);
$('turn-right').onclick=()=>session?.scene?.stage.rotateLocal(0,15,0);
window.addEventListener('pagehide',()=>stop());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&session?.scene)stop('カメラを終了しました。');});
