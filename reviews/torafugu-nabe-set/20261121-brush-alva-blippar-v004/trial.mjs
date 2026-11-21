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
    running=null;
    try{const rows=[{mode:t.mode,when:new Date().toLocaleTimeString('ja-JP'),drift:t.drift,...t.times},...entries()].slice(0,6);localStorage.setItem(ledgerKey,JSON.stringify(rows));}catch{}
    for(const dispose of t.cleanup.reverse())try{dispose();}catch{}
    for(const v of document.querySelectorAll('video')){v.srcObject?.getTracks?.().forEach(track=>track.stop());}
    el('ar').hidden=true;el('menu').hidden=false;document.body.classList.remove('active','alva-active');el('notice').textContent=message;
    el('records').open=true;history();
    el('menu').scrollIntoView({block:'start'});
    if(reload){try{sessionStorage.setItem('fukahiro.table.return',message||'今回の配置時間を記録しました。');}catch{}location.reload();}
}
async function start(mode){
    if(running)return;
    let key=el('key').value.trim();
    if(mode==='blippar'&&!key){el('notice').textContent='Blipparの鍋セット試験には、この公開先で使えるキーが必要です。';el('key').focus();return;}
    const t={mode,times:{start:performance.now()},cleanup:[],hit:null,config:null,placed:false};running=t;
    const live=()=>running===t;
    const mark=k=>{if(live()&&t.times[k]===undefined)t.times[k]=performance.now();};
    function say(message){if(live()&&el('status').textContent!==message)el('status').textContent=message;}
    function eligible(){
        if(mode==='alva'&&!t.placed){el('adjust').hidden=true;el('rate-toggle').hidden=true;}
        const show=!!t.hit&&!!(mode==='alva'?t.metadata:t.config)&&!t.placed;
        el('place').hidden=!show;el('target').hidden=!show||mode!=='alva';
        if(show){mark('ready');say(mode==='alva'?'中央の輪か「ここに置く」をタップしてください。':'置ける場所を検出しました。');}
        else if(t.hit&&!t.config)say('置ける場所が見つかりました。鍋を読み込んでいます。');
        else if(!t.hit&&!t.placed&&t.times.ready!==undefined)say('机を映し、端末をゆっくり動かしてください。');
    }
    const fail=e=>{if(!live())return;const reason=e?.name==='NotAllowedError'?'カメラまたは動きの利用を許可してから、もう一度お試しください。':(e?.message||'起動できませんでした。');finish(reason);};
    const model=config=>{if(live()&&config){t.config=config;mark('model');eligible();if(t.placed&&mode==='alva')say('少し横へ移動し、皿の位置を確認してください。');}};
    const api={model,live,mark,say,fail,config:()=>t.config||t.metadata,cleanup:fn=>{if(live())t.cleanup.push(fn);else fn();},offer:hit=>{if(!live())return;t.hit=hit;if(!hit){t.placed=false;el('rating').hidden=true;}eligible();},controls:actions=>t.actions=actions,slow:show=>{if(live())el('alva-retry').hidden=!show;},onPlace:fn=>t.place=fn};
    document.body.classList.add('active');document.body.classList.toggle('alva-active',mode==='alva');for(const id of ['adjust','alva-retry','rate-toggle'])el(id).hidden=true;el('rate-toggle').setAttribute('aria-expanded','false');el('menu').hidden=true;el('ar').hidden=false;el('method').textContent=names[mode];el('rating').hidden=true;el('key').value='';el('place').hidden=true;el('target').hidden=true;
    say('カメラと鍋セットを準備しています。');
    try{
        let streamPromise,runtime;
        const tilt={sample:null};
        if(mode==='alva'){
            if(!navigator.mediaDevices?.getUserMedia)throw Error('SafariでHTTPSの確認ページを開いてください。');
            runtime=import('https://cdn.jsdelivr.net/gh/alanross/AlvaAR@7796af500ee92001ac2a9888363ff64d7a3bee75/dist/alva_ar.js');runtime.catch(()=>{});
            const readTilt=e=>{if(Number.isFinite(e.beta)&&Number.isFinite(e.gamma))tilt.sample={beta:e.beta,gamma:e.gamma,time:performance.now()};};
            const subscribe=()=>{if(live()){window.addEventListener('deviceorientation',readTilt);api.cleanup(()=>window.removeEventListener('deviceorientation',readTilt));}};
            if(typeof window.DeviceOrientationEvent?.requestPermission==='function')window.DeviceOrientationEvent.requestPermission().then(v=>{if(v==='granted')subscribe();}).catch(()=>{});else subscribe();
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
el('place').onclick=()=>{
    const t=running;if(!t||!t.hit||!(t.config||t.metadata)||!t.place?.())return;
    t.placed=true;const alva=t.mode==='alva';el('adjust').hidden=!alva;el('rate-toggle').hidden=!alva;el('rate-toggle').setAttribute('aria-expanded','false');el('rating').hidden=alva;el('target').hidden=true;el('place').hidden=true;el('status').textContent=t.config?'少し横へ移動し、皿の位置を確認してください。':'置く位置を決めました。鍋を読み込んでいます。';
};
el('target').onclick=()=>el('place').click();
el('replace').onclick=()=>running?.actions?.replace();
el('alva-retry').onclick=()=>running?.actions?.retry();
el('turn-left').onclick=()=>running?.actions?.rotate(-15);
el('turn-right').onclick=()=>running?.actions?.rotate(15);
el('rate-toggle').onclick=()=>{el('rating').hidden=!el('rating').hidden;el('rate-toggle').setAttribute('aria-expanded',String(!el('rating').hidden));};
for(const [id,label] of [['stays','同じ位置'],['shifts','ずれた']])el(id).onclick=()=>{if(running){running.drift=label;el('status').textContent='横からの位置を「'+label+'」で記録しました。';}};
el('end').onclick=()=>finish('',running?.mode==='alva');
for(const mode of Object.keys(names))el(mode).onclick=()=>start(mode);
window.addEventListener('pagehide',()=>finish());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running?.times.camera!==undefined)finish('カメラを停止しました。',running.mode==='alva');});
history();try{const msg=sessionStorage.getItem('fukahiro.table.return');if(msg){el('notice').textContent=msg;el('records').open=true;sessionStorage.removeItem('fukahiro.table.return');}}catch{}
