const q=new URLSearchParams(location.search);
const referenceMode=q.get('asset')==='reference';
const key='fukahiro-nabe-desk-trials-v011';
const isReview=q.get('review')==='1';
const round=ms=>Math.round(ms);
const elapsed=t=>round(performance.now()-t.began);
const history=()=>{try{return JSON.parse(localStorage.getItem(key)||'[]');}catch{return [];}};
function persist(row){
    try{
        const rows=history(),i=rows.findIndex(r=>r.id===row.id);
        if(i<0)rows.push(row);else rows[i]=row;
        localStorage.setItem(key,JSON.stringify(rows.slice(-100)));
        return true;
    }catch{return false;}
}
function recordMilestone(t,name){
    const stats=t.log.historyStorage;
    if(stats?.mode!=='immediate' || t.log.endMs!=null)return;
    const beforeReady=t.log.events.readyMs==null || name==='readyMs';
    const start=performance.now();
    const saved=persist(t.log);
    if(!saved)stats.failedWrites++;
    if(beforeReady){
        if(saved)stats.preReadyWrites++;
        stats.preReadyStorageMs+=performance.now()-start;
    }
}
export function savePlacement(t){
    if(t.log.historyStorage?.mode!=='buffered' || t.savedPlacement || t.log.endMs!=null)return;
    t.savedPlacement=persist(t.log);
    if(!t.savedPlacement)t.log.historyStorage.failedWrites++;
}
export function beginTrial(t,mode){
    if(isReview){
        let badge=document.getElementById('measure-ready');
        if(!badge){
            badge=document.createElement('span');badge.id='measure-ready';
            badge.style.cssText='background:#183a31;color:white;padding:3px 8px;border-radius:6px;font-size:13px';
            document.getElementById('tools').prepend(badge);
        }
        badge.textContent='計測中';
    }
    t.began=performance.now();
    t.log={id:new Date().toISOString(),version:document.body.dataset.version,
        asset:referenceMode?'25cm基準円盤':'Brush PLY',desk:q.get('desk')||'未指定',load:q.get('load')||'未指定',
        browser:navigator.userAgent,events:{},reason:'計測中'};
    t.log.historyStorage={mode,preReadyWrites:0,preReadyStorageMs:0,failedWrites:0};
    t.log.trackingFramesBeforeReady={frames:0,gapsOver110ms:0,longestGapMs:0};
    recordMilestone(t,'start');
}
export function mark(t,name){
    if(t.log.events[name]!==undefined)return;
    if(name==='cameraPlayingMs'){
        const video=document.getElementById('camera-feed'),track=video.srcObject?.getVideoTracks()[0];
        const cfg=track?.getSettings?.()||{};
        t.log.camera={frame:[video.videoWidth,video.videoHeight],width:cfg.width,height:cfg.height,
            zoom:cfg.zoom,facingMode:cfg.facingMode,fieldOfView:cfg.fieldOfView};
    }
    t.log.events[name]=elapsed(t);
    recordMilestone(t,name);
}
export function permission(t,name){
    mark(t,name);
}
export function sample(t,now,available=!!(t.ready&&t.hit?.visual&&Number.isFinite(t.metric.mapMeters)&&t.metric.mapMeters>0)){
    if(t.hit?.visual)mark(t,'tableMs');
    if(t.metric.mapMeters>0)mark(t,'scaleMs');
    if(available&&t.log.events.readyMs===undefined){
        t.log.mapMeters=t.metric.mapMeters;t.log.planeDistanceMeters=t.hit.depth*t.metric.mapMeters;
        t.log.renderFovY=t.scene.camera.camera.fov;mark(t,'readyMs');
    }
    if(isReview){
        const badge=document.getElementById('measure-ready');
        badge.textContent=available?'机面・尺度・モデル準備完了':'計測中';
    }
    return available;
}
export function finish(t,msg){
    t.log.reason=msg||'終了';t.log.endMs=elapsed(t);
    t.log.plyTransfers=performance.getEntriesByType('resource')
        .filter(r=>r.name.includes('.compressed.ply')&&r.startTime>=t.began)
        .map(r=>({bytes:r.transferSize,decoded:r.decodedBodySize}));
    if(!persist(t.log))t.log.historyStorage.failedWrites++;
    window.dispatchEvent(new Event('trial-finished'));
}
export function lastRecord(){return history().at(-1);}
export function updateRecord(id,values){
    const row=history().find(r=>r.id===id);
    if(row){Object.assign(row,values);persist(row);}
}
export {history};

