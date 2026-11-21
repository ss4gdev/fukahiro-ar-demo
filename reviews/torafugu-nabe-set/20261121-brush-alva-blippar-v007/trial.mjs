const el=id=>document.getElementById(id);
const names={alva:'AlvaAR',blippar:'Blippar'};
const ledgerKey='fukahiro.table.trials.v1';
let running=null;
function entries(){try{return JSON.parse(localStorage.getItem(ledgerKey)||'[]');}catch{return [];}}
function seconds(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?((b-a)/1000).toFixed(1)+'秒':'未計測';}
function history(){
    const rows=entries();
    el('history').textContent=rows.length?rows.map(r=>names[r.mode]+' · '+r.when+'\n開始から配置可能 '+seconds(r.start,r.ready)+' ／ カメラ表示から配置可能 '+seconds(r.camera,r.ready)+(r.mode==='alva'?' ／ カメラ表示から机の初検出 '+seconds(r.camera,r.plane):'')+' ／ 開始から鍋表示 '+seconds(r.start,r.shown)+' ／ 横からの位置 '+(r.drift||'未評価')).join('\n\n'):'まだ記録がありません。';
}
function finish(message='',reload=false){
    const t=running;if(!t)return;
    running=null;lastTap=null;touchStart=null;
    try{const rows=[{mode:t.mode,when:new Date().toLocaleTimeString('ja-JP'),drift:t.drift,...t.times},...entries()].slice(0,6);localStorage.setItem(ledgerKey,JSON.stringify(rows));}catch{}
    for(const dispose of t.cleanup.reverse())try{dispose();}catch{}
    for(const v of document.querySelectorAll('video')){v.srcObject?.getTracks?.().forEach(track=>track.stop());}
    el('desk-guide').hidden=true;el('ar').hidden=true;el('menu').hidden=false;document.body.classList.remove('active','alva-active','calibrating');el('notice').textContent=message;
    el('records').open=true;history();
    el('menu').scrollIntoView({block:'start'});
    if(reload){try{sessionStorage.setItem('fukahiro.table.return',message||'今回の配置時間を記録しました。');}catch{}location.reload();}
}
async function start(mode,measuring=false){
    if(running)return;
    let key=el('key').value.trim();
    if(mode==='blippar'&&!key){el('notice').textContent='Blipparの鍋セット試験には、この公開先で使えるキーが必要です。';el('key').focus();return;}
    const height=el('camera-height');
    const width=el('desk-width');
    if(measuring&&!width.reportValidity())return;
    if(mode==='alva'&&!measuring&&(!height.value||!height.checkValidity())){height.closest('details').open=true;height.focus();height.reportValidity();return;}
    const t={mode,heightMeters:height.valueAsNumber/100,pending:false,times:{start:performance.now()},cleanup:[],hit:null,config:null,placed:false};running=t;
    const live=()=>running===t;
    const mark=k=>{if(live()&&t.times[k]===undefined){t.times[k]=performance.now();if(k==='camera'&&mode==='alva')eligible();}};
    function say(message){if(mode==='alva'&&t.pending)message=measuring?'配置を受け付けました。測った机の内側を中央に映してください。':'配置を受け付けました。置きたい場所を中央に映したまま、少し横に動かしてください。';
        if(live()&&el('status').textContent!==message)el('status').textContent=message;}
    function eligible(){
        if(measuring&&!t.placed&&el('desk-repeat').nextElementSibling!==el('place'))el('place').before(el('desk-repeat'));
        if(mode==='alva'&&!t.placed){el('adjust').hidden=true;el('rate-toggle').hidden=true;}
        const show=!!t.hit&&!!(mode==='alva'?t.metadata:t.config)&&!t.placed;
        const alva=mode==='alva',place=el('place');
        place.hidden=alva?t.placed||t.times.camera===undefined:!show;
        place.dataset.ready=String(show);place.dataset.pending=String(t.pending);
        place.textContent=t.pending?'配置を受付済み':'ここに置く';
        el('cancel-placement').hidden=!alva||!t.pending;
        if(t.pending)el('alva-retry').hidden=true;
        el('target').hidden=!show||!alva||t.pending;
        if(show)mark('ready');
        if(show&&t.pending&&placeDish(t))return;
        if(show){say(mode==='alva'?'中央の輪か「ここに置く」をタップしてください。':'置ける場所を検出しました。');}
        else if(t.hit&&!t.config)say('置ける場所が見つかりました。鍋を読み込んでいます。');
        else if(!t.hit&&!t.placed&&t.times.ready!==undefined)say('机を映し、端末をゆっくり動かしてください。');
    }
    t.refreshPlacement=()=>{eligible();if(t.pending)say();else if(!t.hit)say('置きたい場所を中央に映して「ここに置く」を押してください。');};
    const fail=e=>{if(!live())return;const reason=e?.name==='NotAllowedError'?'カメラまたは動きの利用を許可してから、もう一度お試しください。':(e?.message||'起動できませんでした。');finish(reason);};
    const model=config=>{if(live()&&config){t.config=config;mark('model');eligible();if(t.placed&&mode==='alva')say('少し横へ移動し、皿の位置を確認してください。');}};
    el('desk-repeat').hidden=!measuring;
    document.body.classList.toggle('calibrating',measuring);
    const api={deskWidthMeters:measuring?width.valueAsNumber/100:null,calibrating:active=>{if(live())document.body.classList.toggle('calibrating',active);},cameraHeightMeters:t.heightMeters,model,live,mark,say,fail,config:()=>t.config||t.metadata,cleanup:fn=>{if(live())t.cleanup.push(fn);else fn();},offer:hit=>{if(!live())return;t.hit=hit;if(!hit){t.placed=false;el('rating').hidden=true;}eligible();},controls:actions=>t.actions=actions,slow:show=>{if(live())el('alva-retry').hidden=!show||t.pending;},onPlace:fn=>t.place=fn};
    document.body.classList.add('active');document.body.classList.toggle('alva-active',mode==='alva');for(const id of ['adjust','alva-retry','rate-toggle','cancel-placement'])el(id).hidden=true;el('rate-toggle').setAttribute('aria-expanded','false');el('menu').hidden=true;el('ar').hidden=false;el('method').textContent=names[mode];el('rating').hidden=true;el('key').value='';el('place').hidden=true;el('target').hidden=true;
    if(measuring){el('desk-guide').hidden=false;el('desk-still').hidden=true;el('desk-freeze').disabled=true;el('desk-freeze').textContent='1枚目を止める';el('desk-undo').hidden=true;el('desk-again').hidden=true;el('desk-step').textContent='カメラと机の追跡を準備しています。';}
    say('カメラと鍋セットを準備しています。');
    try{
        let streamPromise,runtime;
        const tilt={sample:null};
        if(mode==='alva'){
            if(!navigator.mediaDevices?.getUserMedia)throw Error('SafariでHTTPSの確認ページを開いてください。');
            runtime=import('https://cdn.jsdelivr.net/gh/alanross/AlvaAR@7796af500ee92001ac2a9888363ff64d7a3bee75/dist/alva_ar.js');runtime.catch(()=>{});
            const readTilt=e=>{if(Number.isFinite(e.beta)&&Number.isFinite(e.gamma))tilt.sample={beta:e.beta,gamma:e.gamma,time:performance.now()};};
            const subscribe=()=>{if(live()){window.addEventListener('deviceorientation',readTilt);api.cleanup(()=>window.removeEventListener('deviceorientation',readTilt));}};
            if(!measuring){
                if(typeof window.DeviceOrientationEvent?.requestPermission==='function')window.DeviceOrientationEvent.requestPermission().then(v=>{if(v==='granted')subscribe();}).catch(()=>{});
                else subscribe();
            }
            streamPromise=navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
            streamPromise.then(stream=>api.cleanup(()=>stream.getTracks().forEach(track=>track.stop())),fail);
        }else{
            const early=setTimeout(()=>fail(Error('起動の準備が完了しませんでした。動きの利用を許可してもう一度お試しください。')),45000);
            api.cleanup(()=>clearTimeout(early));
            if(typeof window.DeviceMotionEvent?.requestPermission==='function'){
                say('動きの利用を許可してください。');
                if(await window.DeviceMotionEvent.requestPermission()!=='granted')throw Error('Safariで動きの利用を許可してください。');
            }
            if(!live())return;
            const {startBlippar}=await import('./blippar.mjs');
            if(!live())return;
            clearTimeout(early);startBlippar(api,key);key='';return;
        }
        const [{createScene},{startAlva}]=await Promise.all([import('./model.mjs'),import('./alva.mjs')]);
        if(!live())return;
        const scene=createScene(el('application-canvas'));api.cleanup(()=>scene.dispose());
        scene.load(metadata=>{if(live()){t.metadata=metadata;eligible();}}).then(model,fail);
        await startAlva(api,scene,streamPromise,runtime,tilt);
    }catch(e){fail(e);}
}
function placeDish(t){
    if(!t.hit||t.placed||!(t.config||t.metadata)||!t.place?.())return false;
    t.pending=false;el('cancel-placement').hidden=true;
    t.placed=true;el('rating').append(el('desk-repeat'));const alva=t.mode==='alva';el('adjust').hidden=!alva;el('rate-toggle').hidden=!alva;el('rate-toggle').setAttribute('aria-expanded','false');el('rating').hidden=alva;el('target').hidden=true;el('place').hidden=true;el('status').textContent=t.config?'少し横へ移動し、皿の位置を確認してください。':'置く位置を決めました。鍋を読み込んでいます。';
    return true;
}
el('place').onclick=()=>{
    const t=running;if(!t)return;
    if(t.pending)return;
    if(placeDish(t)||t.mode!=='alva')return;
    t.pending=true;t.refreshPlacement();
};
// Safari can smart-zoom a fixed control. On a second close tap consume only its
// default gesture; preserve one activation per tap on the same button.
let lastTap=null,touchStart=null;
const ar=el('ar');
ar.addEventListener('touchstart',e=>{
    if(running?.mode!=='alva'||e.touches.length!==1){touchStart=null;lastTap=null;return;}
    const finger=e.touches[0];touchStart={x:finger.clientX,y:finger.clientY,id:finger.identifier};
},{passive:true});
ar.addEventListener('touchcancel',()=>{touchStart=null;lastTap=null;},{passive:true});
ar.addEventListener('touchend',e=>{
    const start=touchStart;touchStart=null;
    if(!start||e.touches.length||running?.mode!=='alva')return;
    const finger=e.changedTouches[0],now=performance.now();
    if(!finger||finger.identifier!==start.id||Math.hypot(finger.clientX-start.x,finger.clientY-start.y)>14){lastTap=null;return;}
    const button=e.target.closest('button');
    if(lastTap&&lastTap.session===running&&now-lastTap.time<380&&Math.hypot(start.x-lastTap.x,start.y-lastTap.y)<32&&e.cancelable){
        e.preventDefault();
        if(button&&button===lastTap.button&&button.contains(document.elementFromPoint(finger.clientX,finger.clientY)))button.click();
    }
    lastTap={...start,time:now,button,session:running};
},{passive:false});
ar.addEventListener('dblclick',e=>{if(running?.mode==='alva')e.preventDefault();});
el('target').onclick=()=>el('place').click();
el('replace').onclick=()=>running?.actions?.replace();
el('desk-repeat').onclick=()=>{if(running){running.pending=false;running.actions?.measureAgain();}};
el('cancel-placement').onclick=()=>{if(running?.pending){running.pending=false;running.refreshPlacement();}};
el('alva-retry').onclick=()=>{if(running){running.pending=false;running.actions?.retry();}};
el('turn-left').onclick=()=>running?.actions?.rotate(-15);
el('turn-right').onclick=()=>running?.actions?.rotate(15);
el('rate-toggle').onclick=()=>{el('rating').hidden=!el('rating').hidden;el('rate-toggle').setAttribute('aria-expanded',String(!el('rating').hidden));};
for(const [id,label] of [['stays','同じ位置'],['shifts','ずれた']])el(id).onclick=()=>{if(running){running.drift=label;el('status').textContent='横からの位置を「'+label+'」で記録しました。';}};
el('end').onclick=()=>finish('',running?.mode==='alva');
el('measure-desk').onclick=()=>start('alva',true);
for(const mode of Object.keys(names))el(mode).onclick=()=>start(mode);
window.addEventListener('pagehide',()=>finish());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running?.times.camera!==undefined)finish('カメラを停止しました。',running.mode==='alva');});
history();try{const msg=sessionStorage.getItem('fukahiro.table.return');if(msg){el('notice').textContent=msg;el('records').open=true;sessionStorage.removeItem('fukahiro.table.return');}}catch{}
