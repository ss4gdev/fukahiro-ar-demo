import {pc,createScene,referenceMode} from '../20261121-brush-alva-metric-v011/trial-model.mjs';
import {beginTrial,mark,sample,finish,permission,updateRecord} from '../20261121-brush-alva-metric-v011/measurement.mjs';
import {WorldVertical,intersectTable,sdkTable,patchTable,reference} from '../20261121-brush-alva-blippar-v007/table.mjs';
import {grayscale,locateSurface} from '../20261121-brush-alva-stable-v010/surface.mjs';
import {tabletopReference,waitStage,help} from '../20261123-brush-alva-table-v018/table-search.mjs';
import {SurfaceGuide,aimCues,frameCues,heightCues,heightCue,visibleCrop,centralFeatures} from '../20261123-brush-alva-height-v021/surface-guide.mjs';
import {setTrackedCamera} from '../20261121-brush-alva-blippar-v007/alva.mjs';
import {MetricScale} from './displacement.mjs';
import {createGuide,showGuide,slideMs} from '../20261123-brush-alva-guide-v015/guide.mjs';
import {SteadyView} from '../20261121-brush-alva-stable-v010/steady.mjs';
import {rememberPlane,retainedContact,sameTexture} from '../20261124-brush-alva-placement-v022/placement.mjs';

import {createGrainFrame} from '../20261124-brush-alva-grain-v024/grain.mjs';

import {createSweep,directions} from '../20261124-brush-alva-desk-v025/sweep.mjs';

const $=id=>document.getElementById(id),video=$('camera-feed');
const sdk='https://cdn.jsdelivr.net/gh/alanross/AlvaAR@7796af500ee92001ac2a9888363ff64d7a3bee75/dist/alva_ar.js';
const targetRim=.25,sourceRim=.250592466102044;
$('trace-info').hidden=!(referenceMode&&new URLSearchParams(location.search).get('review')==='1');
let session,lastAttempt;
function clockTime(t,kind,stamp,now){
    const stats=t.log.clocks[kind];
    if(!Number.isFinite(stamp)||Math.abs(now-stamp)>=300){stats.fallback++;return now;}
    const lag=now-stamp;
    stats.samples++;
    stats.meanArrivalLagMs+=(lag-stats.meanArrivalLagMs)/stats.samples;
    stats.minArrivalLagMs=Math.min(stats.minArrivalLagMs??lag,lag);
    stats.maxArrivalLagMs=Math.max(stats.maxArrivalLagMs??lag,lag);
    return stamp;
}
function projection(t){
    const {capture,intrinsics:k}=t.optics;
    const box=video.getBoundingClientRect(),canvas=$('application-canvas').getBoundingClientRect();
    const zoom=Math.max(box.width/capture.width,box.height/capture.height);
    const left=box.left+(box.width-capture.width*zoom)/2,top=box.top+(box.height-capture.height*zoom)/2;
    const matrix=t.scene.camera.camera.projectionMatrix.data;
    const checks=[[.5,.5],[.2,.5],[.8,.5],[.5,.2],[.5,.8]].map(([u,v])=>{
        const x=box.left+u*box.width,y=box.top+v*box.height;
        const rayX=((x-left)/zoom-k.cx)/k.fx,rayY=(k.cy-(y-top)/zoom)/k.fy;
        const renderX=canvas.left+(1+matrix[0]*rayX-matrix[8])*canvas.width/2;
        const renderY=canvas.top+(1-matrix[5]*rayY+matrix[9])*canvas.height/2;
        return Math.round(100*Math.hypot(x-renderX,y-renderY))/100;
    });
    return {frame:[video.videoWidth,video.videoHeight],tracking:[capture.width,capture.height],
        viewport:[box.width,box.height],cropPerSideCssPx:[box.left-left,box.top-top],
        intrinsics:{fx:k.fx,fy:k.fy,cx:k.cx,cy:k.cy},fxCss:k.fx*zoom,
        renderFovY:t.scene.camera.camera.fov,projectionErrorCssPx:checks};
}
const overlay=$('desk-overlay'),dots=[...overlay.querySelectorAll('.grain-point')],sideFeature=$('side-feature');
function positionMark(mark,point){
    if(!point){if(!mark.hidden)mark.hidden=true;return;}
    if(mark.hidden)mark.hidden=false;
    if(mark.style.left!==(point.u*100)+'%')mark.style.left=(point.u*100)+'%';
    if(mark.style.top!==(point.v*100)+'%')mark.style.top=(point.v*100)+'%';
}
function drawEvidence(t,stage,now){
    const visible=!t.placed&&!t.calibrating&&!['ready','frames','startup','loading','sensor'].includes(stage);
    overlay.hidden=!visible;
    if(!visible)return;
    const fresh=t.centralSample&&now-t.centralSample.time<=380&&now-t.lastPose<=220;
    const central=fresh?t.centralSample.points:[];
    dots.forEach((mark,i)=>positionMark(mark,central[i]));
    const feature=aimCues[stage]?.[2]&&t.surfaceGuide.current(now)===stage?t.surfaceGuide.feature:null;
    positionMark(sideFeature,feature);
    const log=t.log.surfaceSamples;
    if(central.length)log.firstVisibleCentralMs??=Math.round(now-t.began);
    if(feature)log.firstVisibleSideMs??=Math.round(now-t.began);
}
function say(msg){
    overlay.hidden=true;
    $('target').removeAttribute('data-arrow');
    $('instruction').hidden=true;delete $('instruction').dataset.stage;
    $('status').hidden=false;
    if($('status').textContent!==msg)$('status').textContent=msg;
}
function cue(t,stage,now){
    drawEvidence(t,stage,now);
    $('status').hidden=true;
    if($('instruction').dataset.stage!==stage){
        const counts=t.log.guidance;
        counts[stage]??={shown:0,firstMs:Math.round(now-t.began)};
        counts[stage].shown++;
        const prompt=directions[stage]||heightCues[stage]||aimCues[stage]||frameCues[stage]||help[stage];
        if(aimCues[stage]?.[2])$('target').dataset.arrow=aimCues[stage][2];
        else $('target').removeAttribute('data-arrow');
        if(prompt){
            const box=$('instruction');box.hidden=false;box.dataset.stage=stage;
            $('instruction-title').textContent=prompt[0];$('instruction-detail').textContent=prompt[1];
        }else showGuide(stage);
    }
}
function guideFrame(t,now,pose,available=false){
    let stage=t.guide(now,{pose,table:pose&&!!t.hit?.visual,scale:t.metric.mapMeters>0,
        asset:t.ready,available,tilt:t.tilt});
    const adjustTilt=stage==='lower'||stage==='lift';
    const center=t.centralSample;
    const supported=!!t.hit?.visual || (center && now-center.time<=380 && center.points.length>=2 && t.log.surfaceSamples.lastUsable>=8);
    const motionCue=t.sweep(now,{supported,pose:pose&&now-t.lastPose<=220,sensor:t.motionCount>0&&now-t.lastMotionAt<=600,
        tiltCorrection:adjustTilt,scale:t.metric.mapMeters>0});
    if(motionCue && !available){
        if(motionCue==='sweepRetry')captureSweep(t);
        cue(t,motionCue,now);return;
    }
    if(!available&&!adjustTilt&&now-t.lastTableSeen>650){
        const hint=pose?t.surfaceGuide.current(now):null;
        if(hint){cue(t,heightCue(now,t,hint)||hint,now);return;}
        if(!pose&&now-t.firstFrameAt>=1000&&now-t.frameTime<500&&now-t.lastPose>500){
            cue(t,'tracking',now);return;
        }
    }
    if(!available&&now-t.searchBegan>=5000){
        const why=waitStage(t,now);
        if(why==='scale'&&['right','left','pause'].includes(stage)){
            cue(t,(pose&&heightCue(now,t,stage))||stage,now);return;
        }
        stage=why;
    }
    cue(t,(pose&&!available&&heightCue(now,t,stage))||stage,now);
}
function waitingState(t){
    const now=performance.now();
    function windowStats(rows){
        const recent=rows.filter(r=>now-r.time<=5600);
        let gap=0;
        for(let i=1;i<recent.length;i++)gap=Math.max(gap,recent[i].time-recent[i-1].time);
        return {samples:recent.length,spanMs:recent.length?Math.round(recent.at(-1).time-recent[0].time):0,maxGapMs:Math.round(gap)};
    }
    return {waitingFor:waitStage(t,now),surfaceSamples:{...t.log.surfaceSamples},
        modelLoaded:!!t.ready,currentTable:!!t.hit?.visual,scaleEstimated:t.metric.mapMeters>0,
        usableAccelerations:t.motionCount,visual:windowStats(t.metric.poses),motion:windowStats(t.metric.motion)};
}
// The first five seconds can be replayed from the exported review on PC.
// Keep numeric samples from the current tracking segment only, in local storage.
function captureStartMotion(t){
    if(!t.recordStartMotion||t.log.firstFiveSeconds)return;
    const end=t.began+5000;
    const poses=t.metric.poses.filter(r=>r.time>=t.began&&r.time<=end);
    const motion=t.metric.motion.filter(r=>r.time>=t.began&&r.time<=end);
    const origin=poses[0]?.p;
    const relativeMs=r=>Math.round((r.time-t.began)*10)/10;
    const rounded=x=>Number(x.toFixed(6));
    t.log.firstFiveSeconds={intervalMs:[0,Math.min(5000,Math.round(performance.now()-t.began))],
        resets:t.log.trackingResets,
        pose:poses.map(r=>[relativeMs(r),...r.p.map((x,k)=>rounded(x-origin[k])),...r.q.map(rounded)]),
        acceleration:motion.map(r=>[relativeMs(r),...r.a.map(rounded)])};
    mark(t,'startMotionCapturedMs');
}
function captureSweep(t){
    if(!t.recordStartMotion || t.log.sweepMotion || !t.log.guidance.sweepRight) return;
    const since=t.began+t.log.guidance.sweepRight.firstMs;
    const positions=t.metric.poses.filter(r=>r.time>=since-300);
    const accelerations=t.metric.motion.filter(r=>r.time>=since-300);
    if(!positions.length || !accelerations.length) return;
    const origin=positions[0].p;
    const row=(time,values)=>[Math.round((time-t.began)*10)/10,...values.map(x=>Number(x.toFixed(6)))];
    t.log.sweepMotion={resets:t.log.trackingResets,
        pose:positions.map(r=>row(r.time,[...r.p.map((x,k)=>x-origin[k]),...r.q])),
        acceleration:accelerations.map(r=>row(r.time,r.a))};
}
function stop(msg=''){
    const t=session;if(!t)return;
    if(!t.calibrating){
        captureStartMotion(t);captureSweep(t);
        if(!t.placed)t.log.waitAtEnd=waitingState(t);
        if(t.optics)t.log.finalProjection=projection(t);
        finish(t,msg);
    }
    if(new URLSearchParams(location.search).get('review')==='1'){lastAttempt=t.log;$('save-attempt').hidden=false;}
    hidePlacement(t);
    session=null;
    for(const fn of t.cleanup.reverse())fn();
    video.pause();video.srcObject=null;
    if(t.scene){
        const canvas=$('application-canvas');
        canvas.replaceWith(canvas.cloneNode(false));
    }
    $('ar').hidden=true;$('menu').hidden=false;$('notice').textContent=msg;$('start').disabled=false;
    document.body.classList.remove('active','alva-active');
    $('optics-check').hidden=true;$('optics-open').hidden=true;
    $('tools').hidden=false;$('bottom').hidden=false;
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
        if(t.calibrating)return;
        const a=e.acceleration;if(!a||![a.x,a.y,a.z].every(Number.isFinite))return;
        t.motionCount++;
        const s=angle()*Math.PI/180;
        const now=performance.now(),stamp=e.timeStamp;
        t.lastMotionAt=now;
        t.metric.acceleration(clockTime(t,'motion',stamp,now),[a.x*Math.cos(s)-a.y*Math.sin(s),a.x*Math.sin(s)+a.y*Math.cos(s),a.z]);
    });
}
function hidePlacement(t){
    // The WebGL drawing buffer is preserved between camera frames. Remove
    // both composite layers immediately, even if no next camera frame arrives.
    $('viewport').removeAttribute('data-placement-frame');
    $('paired-feed').hidden=true;
    if(t.scene){
        t.scene.dish.enabled=false;
        if(t.wasDrawn)t.scene.app.render();
    }
    t.wasDrawn=false;
}
function clearDesk(t){
    t.savedPlane=null;
    t.centralSample=null;overlay.hidden=true;
    t.guide=createGuide();t.sweep=createSweep();
    t.surfaceGuide=new SurfaceGuide();$('target').removeAttribute('data-arrow');
    t.lastTableSeen=-Infinity;
    t.samples=[];t.refs=[];t.hit=null;t.placed=false;t.anchorDepth=0;t.lastPose=-Infinity;
    t.steady.reset();hidePlacement(t);
    $('recovery').hidden=false;
    $('size-state').hidden=true;
    $('adjust').hidden=true;$('target').hidden=false;$('place').hidden=false;
    setCanPlace(false);
}
function setCanPlace(ready){
    $('place').disabled=!ready;$('target').disabled=!ready;
    $('target').classList.toggle('search',!ready);
}
function usableContact(t,now){
    if(!t.ready||!(t.metric.mapMeters>0)||now-t.lastPose>220||now-t.lastScan>220)return null;
    const camera=t.scene.camera;
    const hit=t.hit?.visual?intersectTable(t.hit.point,t.hit.up,camera):
        retainedContact(t.savedPlane,camera,t.metric.mapMeters,now);
    if(!hit)return null;
    const x=camera.right.clone().sub(hit.up.clone().mulScalar(camera.right.dot(hit.up)));
    return x.lengthSq()<.04?null:{hit,x:x.normalize()};
}
function place(t){
    if(t.placed)return;
    const contact=usableContact(t,performance.now());
    if(!contact){setCanPlace(false);return;}
    const {hit,x}=contact,{stage,dish}=t.scene;
    t.log.placementContact=t.hit?.visual?'live':'rechecked';
    const z=new pc.Vec3().cross(x,hit.up).normalize(),m=new pc.Mat4(),u=hit.up;
    m.data.set([x.x,x.y,x.z,0,u.x,u.y,u.z,0,z.x,z.y,z.z,0,0,0,0,1]);
    stage.setPosition(hit.point);stage.setRotation(new pc.Quat().setFromMat4(m));
    stage.rotateLocal(0,t.config.rimYawOffsetDegrees,0);
    const scale=(targetRim/sourceRim)/t.metric.mapMeters;
    stage.setLocalScale(scale,scale,scale);t.placed=true;t.anchorDepth=hit.depth;
    $('size-state').hidden=false;$('size-state').dataset.metric='true';
    $('size-state').textContent='皿径25cmを目標に推定';
    $('recovery').hidden=true;
    captureSweep(t);mark(t,'placedMs');dish.enabled=true;$('place').hidden=true;$('target').hidden=true;$('adjust').hidden=false;
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
            if(found){candidate={...found,visual:true};if(ref.data.groups.length>ref.data.originalCount)t.log.surfaceSamples.extendedMatches++;break;}
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
    let currentRef=null;
    if(t.refs.length===0||now-t.refs.at(-1).time>260){
        const data=tabletopReference(gray,k,camera),stats=t.log.surfaceSamples;
        currentRef=data;
        t.centralSample=t.crop?{time:now,points:centralFeatures(data.groups,k,t.crop)}:null;
        stats.references++;stats.lastOriginal=data.originalCount;stats.lastUsable=data.groups.length;
        if(data.groups.length>data.originalCount)stats.extendedReferences++;
        if(data.groups.length<8&&now-t.lastTableSeen>650&&t.crop){
            const points=alva.getFramePoints?.()||[];
            stats.nearby={atMs:Math.round(now-t.began),tracked:points.length,
                scores:t.surfaceGuide.observe(now,points,t.crop,gray)};
        }else t.surfaceGuide.reset();
        t.refs.push({time:now,data,photo:vertical?null:reference(image,camera,k)});
    }
    t.hit=null;
    const meters=t.metric.mapMeters;
    if(t.savedPlane){
        const saved=t.savedPlane;
        if(!retainedContact(saved,camera,meters,now) || !sameTexture(saved,gray,k,camera)){
            t.savedPlane=null;
        }else saved.matched=now;
    }
    if(!candidate)return;
    const eye=camera.getPosition();
    const support=t.samples.filter(h=>eye.distance(h.eye)>.009*candidate.depth&&candidate.up.dot(h.up)>.985&&Math.abs(h.point.clone().sub(candidate.point).dot(candidate.up))<.035*candidate.depth);
    if(support.length&&now-support[0].time>=120){
        const checked=candidate.visual&&support.some(h=>h.visual&&now-h.time>=120);
        t.hit={...candidate,visual:!!checked};
        if(checked){
            t.lastTableSeen=now;t.surfaceGuide.reset();
            // A single-frame plane candidate can disagree with a table whose
            // texture is still tracked. Only a corroborated plane replaces it.
            const old=t.savedPlane;
            if(old && (old.up.dot(candidate.up)<.985 ||
                Math.abs(candidate.point.clone().sub(old.point).dot(old.up))*meters>.015))t.savedPlane=null;
            if(usableContact(t,now)){
                const next=rememberPlane(candidate,camera,meters,currentRef||tabletopReference(gray,k,camera),now);
                if(next)t.savedPlane=next;
            }
        }
    }
    t.samples.push({...candidate,time:now,eye:eye.clone()});
}
function frameLoop(t,alva,capture,ctx){
    const {camera,dish,app}=t.scene;const gravity=new WorldVertical();
    const paired=$('paired-feed'),background=paired.getContext('2d',{alpha:false});
    const snapshot=document.createElement('canvas');snapshot.width=video.videoWidth;snapshot.height=video.videoHeight;
    paired.width=snapshot.width;paired.height=snapshot.height;
    const feed=snapshot.getContext('2d',{alpha:false});
    const trackingFrame=createGrainFrame(capture.width,capture.height);
    let lastImage=-1,lastGood=null,lostSince=null,token;
    function schedule(){token=video.requestVideoFrameCallback?video.requestVideoFrameCallback(frame):requestAnimationFrame(frame);}
    t.cleanup.push(()=>video.cancelVideoFrameCallback?video.cancelVideoFrameCallback(token):cancelAnimationFrame(token));
    function forget(){
        t.log.trackingResets++;
        t.metric.reset();gravity.reset();clearDesk(t);lastGood=null;
    }
    function frame(_,meta){
        if(session!==t||t.calibrating)return;
        try{
            const now=performance.now();
            if(video.readyState<2||video.currentTime===lastImage){schedule();return;}
            lastImage=video.currentTime;
            t.frameTime=now;
            t.firstFrameAt??=now;
            if(Math.abs(video.videoWidth/video.videoHeight-capture.width/capture.height)>.035)throw Error('持つ向きが変わりました。カメラを開き直してください。');
            feed.drawImage(video,0,0,snapshot.width,snapshot.height);
            ctx.drawImage(snapshot,0,0,capture.width,capture.height);
            const cameraImage=ctx.getImageData(0,0,capture.width,capture.height);
            const image=trackingFrame(cameraImage);
            const raw=alva.findCameraPose(image);
            if(raw?.length!==16||!raw.every(Number.isFinite)){
                t.surfaceGuide.reset();t.centralSample=null;
                t.hit=null;t.savedPlane=null;t.refs=[];t.samples=[];
                setCanPlace(false);
                lostSince??=now;
                // A single lost pose need not flash a live backdrop through the dish.
                // Briefly keep the complete last composite, then expose the live feed.
                if(t.placed&&t.wasDrawn&&now-lostSince<90){schedule();return;}
                dish.enabled=false;
                if(now-lostSince>550&&lastGood){forget();}
                if(!t.placed)$('target').classList.add('search');
                if(t.placed)say('置いた場所が映る向きに、カメラを戻してください。');
                else guideFrame(t,now,false);
            }else{
                if(t.log.events.firstTrackedPoseMs===undefined)mark(t,'firstTrackedPoseMs');
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
                t.metric.pose(clockTime(t,'camera',stamp,now),[p.x,p.y,p.z],[q.x,q.y,q.z,q.w]);
                const up=gravity.read(t.tilt,angle(),camera,now);
                t.metric.solve(now);t.lastPose=now;
                if(t.placed){
                    dish.enabled=true;
                }
                else{
                    observePlane(t,image,camera,alva.intrinsics,up,now,alva);
                    const contact=usableContact(t,now);
                    // Scale can first become available between plane scans.
                    // Make the world-space reference as soon as the button lights.
                    if(contact && t.hit?.visual && !t.savedPlane && t.log.events.readyMs===undefined){
                        const data=tabletopReference(grayscale(image),alva.intrinsics,camera);
                        t.savedPlane=rememberPlane(contact.hit,camera,t.metric.mapMeters,data,now);
                    }
                    const available=sample(t,now,!!contact);setCanPlace(available);
                    if(available&&!t.hit?.visual)t.log.recheckedFrames=(t.log.recheckedFrames||0)+1;
                    guideFrame(t,now,true,available);
                }
                if(t.placed)t.steady.apply(cameraImage,alva.intrinsics,camera,t.scene.stage,now);
            }
            if(t.placed&&dish.enabled){
                app.render();
                if(!t.log.placedProjection)t.log.placedProjection=projection(t);
                background.drawImage(snapshot,0,0);paired.hidden=false;
                if(!t.wasDrawn)$('viewport').setAttribute('data-placement-frame','');
                t.wasDrawn=true;
            }else if(t.wasDrawn)hidePlacement(t);
            schedule();
        }catch(e){stop(e.message);}
    }
    schedule();
}
async function start(){
    if(session)return;
    const t={metric:new MetricScale(),steady:new SteadyView(),cleanup:[],lastScan:-Infinity,motionCount:0};session=t;beginTrial(t);
    t.searchBegan=t.began;t.log.surfaceSamples={references:0,extendedReferences:0,extendedMatches:0};
    $('save-attempt').hidden=true;
    t.recordStartMotion=referenceMode&&new URLSearchParams(location.search).get('review')==='1';
    const clockStats=()=>({samples:0,fallback:0,meanArrivalLagMs:0});
    t.log.clocks={camera:clockStats(),motion:clockStats()};
    t.log.trackingResets=0;t.log.scaleDiagnostics=t.metric.diagnostics;t.log.guidance={};
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
            if(session!==t||t.calibrating)return;
            const now=performance.now();
            if(now-t.began>=5000)captureStartMotion(t);
            if(t.placed)return;
            if(now-t.lastPose>220){
                t.savedPlane=null;
                setCanPlace(false);
                if($('instruction').dataset.stage==='ready'||now-t.searchBegan>=5000)guideFrame(t,now,false);
                else if(now-t.frameTime>550){
                    for(const mark of [...dots,sideFeature])positionMark(mark,null);
                }
            }
            if(now-t.began>=5000&&!t.log.waitAt5s&&t.log.events.readyMs===undefined){
                t.log.waitAt5s=waitingState(t);mark(t,'waitingSnapshotMs');
            }
            if(now-cameraStarted>=15000&&t.log.events.readyMs===undefined&&!t.log.waitAt15s){
                t.log.waitAt15s=waitingState(t);
                mark(t,'continuedSearchMs');
            }
        },200);
        t.cleanup.push(()=>clearInterval(watchdog));
        $('place').hidden=false;mark(t,'cameraPlayingMs');cue(t,'aim',performance.now());
        const scene=createScene($('application-canvas'));t.scene=scene;t.cleanup.push(()=>scene.dispose());scene.app.autoRender=false;
        scene.load().then(config=>{if(session===t){t.config=config;t.ready=true;mark(t,'assetReadyMs');}},e=>{if(session===t)stop(e.message);});
        const {AlvaAR}=await runtime;if(session!==t)return;
        const capture=document.createElement('canvas'),ratio=Math.min(1,640/Math.max(video.videoWidth,video.videoHeight));
        capture.width=Math.round(video.videoWidth*ratio);capture.height=Math.round(video.videoHeight*ratio);
        const alva=await AlvaAR.Initialize(capture.width,capture.height);if(session!==t)return;
        t.optics={capture,intrinsics:alva.intrinsics};
        const resize=()=>{
            const rect=video.getBoundingClientRect(),zoom=Math.max(rect.width/capture.width,rect.height/capture.height);
            t.crop=rect.width>0&&rect.height>0?visibleCrop(capture.width,capture.height,rect.width,rect.height):null;
            t.savedPlane=null;
            t.surfaceGuide.reset();t.centralSample=null;
            if(t.crop){
                const frame=$('desk-frame');
                frame.style.width=Math.min(96,38*capture.width/t.crop.w)+'%';
                frame.style.height=Math.min(90,33*capture.height/t.crop.h)+'%';
            }
            scene.camera.camera.fov=2*Math.atan(rect.height/(2*alva.intrinsics.fy*zoom))*180/Math.PI;
        };
        const observer=new ResizeObserver(resize);observer.observe(video);t.cleanup.push(()=>observer.disconnect());resize();
        $('optics-open').hidden=!referenceMode;
        frameLoop(t,alva,capture,capture.getContext('2d',{willReadFrequently:true,alpha:false}));
    }catch(e){if(session===t)stop(e.name==='NotAllowedError'?'動きとカメラの利用を許可してください。':e.message);}
}
$('start').onclick=start;$('end').onclick=()=>stop();
$('save-attempt').onclick=()=>{
    if(!lastAttempt)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify([lastAttempt],null,2)],{type:'application/json'}));
    const a=document.createElement('a');
    a.href=url;a.download='fukahiro-nabe-v026-'+lastAttempt.id.replace(/[:.]/g,'-')+'.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),8000);
};
$('instruction').style.setProperty('--slide-time',slideMs+'ms');
$('optics-open').onclick=()=>{
    const t=session;if(!t?.optics||t.calibrating)return;
    if(!t.placed)t.log.waitAtEnd=waitingState(t);
    t.log.finalProjection=projection(t);
    captureStartMotion(t);finish(t,'画角の測定へ');t.calibrating=true;overlay.hidden=true;
    $('bottom').hidden=true;$('tools').hidden=true;$('target').hidden=true;
    hidePlacement(t);
    $('freeze').hidden=false;$('optics-form').hidden=true;$('optics-form').reset();
    $('optics-help').textContent='机に定規を横向きに置き、背面レンズを真下に向け、iPhoneを机と平行にします。定規の目盛りが左右の白線に重なる高さで映像を固定してください。';
    $('optics-check').hidden=false;
};
$('freeze').onclick=()=>{
    const t=session;if(!t?.calibrating||video.readyState<2)return;
    const p=projection(t);
    if(Math.abs(video.videoWidth/video.videoHeight-p.tracking[0]/p.tracking[1])>.035){
        $('optics-help').textContent='AR開始時と同じ縦向きに戻してから固定してください。';return;
    }
    const still=$('paired-feed');still.width=video.videoWidth;still.height=video.videoHeight;
    still.getContext('2d').drawImage(video,0,0);still.hidden=false;
    t.rulerProjection=p;
    // Preserve guide positions while the keyboard changes the visible viewport.
    const box=video.getBoundingClientRect();
    Object.assign(still.style,{width:box.width+'px',height:box.height+'px'});
    $('optics-check').style.setProperty('--guide-y',box.height/2+'px');
    $('optics-check').style.setProperty('--guide-left',box.width*.2+'px');
    $('optics-check').style.setProperty('--guide-right',box.width*.8+'px');
    t.cleanup.push(()=>{still.style.width='100%';still.style.height='100%';
        for(const prop of ['--guide-y','--guide-left','--guide-right'])$('optics-check').style.removeProperty(prop);});
    $('freeze').hidden=true;$('optics-form').hidden=false;
    $('optics-help').textContent='固定した瞬間のレンズの高さと、白線が指す2つの目盛りの差を入力してください。';
};
$('optics-form').onsubmit=e=>{
    e.preventDefault();
    const t=session;if(!t?.rulerProjection)return;
    const lensHeightCm=$('lens-height').valueAsNumber,measuredSpanCm=$('ruler-span').valueAsNumber;
    if(!(lensHeightCm>0&&measuredSpanCm>0))return;
    const p=t.rulerProjection,guideFraction=.6;
    const predictedSpanCm=lensHeightCm*guideFraction*p.viewport[0]/p.fxCss;
    const rulerCheck={lensHeightCm,measuredSpanCm,guideFraction,predictedSpanCm,projection:p,
        measuredVisibleHorizontalFov:2*Math.atan(measuredSpanCm/(2*lensHeightCm*guideFraction))*180/Math.PI};
    updateRecord(t.log.id,{rulerCheck});
    t.log.rulerCheck=rulerCheck;
    stop('画角の測定を保存しました。');
};
$('optics-close').onclick=()=>stop('円盤の記録を保存しました。');
if(referenceMode)$('subject').textContent='25cmの基準円盤を机に置く';
$('start').disabled=false;
$('place').onclick=()=>{if(session?.scene)place(session);};
$('target').onclick=()=>$('place').click();
$('replace').onclick=()=>{
    if(!session?.placed)return;
    session.searchBegan=performance.now();
    clearDesk(session);
    cue(session,'aim',performance.now());
};
$('retry').onclick=()=>{stop('再試行');start();};
$('turn-left').onclick=()=>session?.scene?.stage.rotateLocal(0,-15,0);
$('turn-right').onclick=()=>session?.scene?.stage.rotateLocal(0,15,0);
window.addEventListener('pagehide',()=>stop());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&session?.scene)stop('カメラを終了しました。');});
