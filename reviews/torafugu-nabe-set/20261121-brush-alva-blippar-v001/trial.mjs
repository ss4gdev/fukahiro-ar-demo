const el=id=>document.getElementById(id);
const names={alva:'AlvaAR',blippar:'Blippar'};
const ledgerKey='fukahiro.table.trials.v1';
let running=null;
function entries(){try{return JSON.parse(localStorage.getItem(ledgerKey)||'[]');}catch{return [];}}
function seconds(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&b>=a?((b-a)/1000).toFixed(1)+'秒':'未計測';}
function history(){
    const rows=entries();
    el('history').textContent=rows.length?rows.map(r=>names[r.mode]+' · '+r.when+'\n開始から配置可能 '+seconds(r.start,r.ready)+' ／ カメラ表示から配置可能 '+seconds(r.camera,r.ready)+' ／ 開始から鍋表示 '+seconds(r.start,r.shown)+' ／ 横からの位置 '+(r.drift||'未評価')).join('\n\n'):'まだ記録がありません。';
}
function finish(message='',reload=false){
    const t=running;if(!t)return;
    running=null;
    try{const rows=[{mode:t.mode,when:new Date().toLocaleTimeString('ja-JP'),drift:t.drift,...t.times},...entries()].slice(0,6);localStorage.setItem(ledgerKey,JSON.stringify(rows));}catch{}
    for(const dispose of t.cleanup.reverse())try{dispose();}catch{}
    for(const v of document.querySelectorAll('video')){v.srcObject?.getTracks?.().forEach(track=>track.stop());}
    el('ar').hidden=true;el('menu').hidden=false;document.body.classList.remove('active');el('notice').textContent=message;
    el('records').open=true;history();
    if(reload){try{sessionStorage.setItem('fukahiro.table.return',message||'今回の配置時間を記録しました。');}catch{}location.reload();}
}
async function start(mode){
    if(running)return;
    const key=el('key').value.trim();
    if(mode==='blippar'&&!key){el('notice').textContent='Blipparの鍋セット試験には、この公開先で使えるキーが必要です。';el('key').focus();return;}
    const t={mode,times:{start:performance.now()},cleanup:[],hit:null,config:null,placed:false};running=t;
    const live=()=>running===t;
    const mark=k=>{if(live()&&t.times[k]===undefined)t.times[k]=performance.now();};
    function say(message){if(live())el('status').textContent=message;}
    function eligible(){
        const show=!!t.hit&&!!t.config&&!t.placed;
        el('place').hidden=!show;el('target').hidden=!show||mode!=='alva';
        if(show){mark('ready');say(mode==='alva'?'中央の輪が皿の中心です。':'置ける場所を検出しました。');}
        else if(t.hit&&!t.config)say('置ける場所が見つかりました。鍋を読み込んでいます。');
        else if(!t.hit&&!t.placed&&t.times.ready!==undefined)say('机を映し、端末をゆっくり動かしてください。');
    }
    const fail=e=>{if(!live())return;const reason=e?.name==='NotAllowedError'?'カメラまたは動きの利用を許可してから、もう一度お試しください。':(e?.message||'起動できませんでした。');finish(reason,mode==='blippar');};
    const api={live,mark,say,fail,config:()=>t.config,cleanup:fn=>{if(live())t.cleanup.push(fn);else fn();},offer:hit=>{if(!live())return;t.hit=hit;if(!hit){t.placed=false;el('rating').hidden=true;}eligible();},onPlace:fn=>t.place=fn};
    document.body.classList.add('active');el('menu').hidden=true;el('ar').hidden=false;el('method').textContent=names[mode];el('rating').hidden=true;el('key').value='';el('place').hidden=true;el('target').hidden=true;
    say('カメラと鍋セットを準備しています。');
    try{
        let streamPromise,permission;
        if(mode==='alva'){
            if(!navigator.mediaDevices?.getUserMedia)throw Error('SafariでHTTPSの確認ページを開いてください。');
            streamPromise=navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
            streamPromise.then(stream=>api.cleanup(()=>stream.getTracks().forEach(track=>track.stop())),fail);
        }else if(typeof window.DeviceMotionEvent?.requestPermission==='function'){
            permission=window.DeviceMotionEvent.requestPermission();permission.catch(fail);
        }
        const [{createScene},engine]=await Promise.all([import('./model.mjs'),mode==='alva'?import('./alva.mjs'):import('./blippar.mjs')]);
        if(!live())return;
        const scene=createScene(el('application-canvas'));api.cleanup(()=>scene.dispose());
        scene.load().then(config=>{if(live()){t.config=config;mark('model');eligible();}},fail);
        if(mode==='alva')await engine.startAlva(api,scene,streamPromise);
        else{if(permission&&await permission!=='granted')throw Error('Safariで動きの利用を許可してください。');if(live())await engine.startBlippar(api,scene,key);}
    }catch(e){fail(e);}
}
el('place').onclick=()=>{
    const t=running;if(!t||!t.hit||!t.config||!t.place?.())return;
    t.placed=true;el('rating').hidden=false;el('target').hidden=true;el('place').hidden=true;el('status').textContent='少し横へ移動し、皿が机の同じ場所に留まるか見てください。';
};
for(const [id,label] of [['stays','同じ位置'],['shifts','ずれた']])el(id).onclick=()=>{if(running){running.drift=label;el('status').textContent='横からの位置を「'+label+'」で記録しました。';}};
el('end').onclick=()=>finish('',true);
for(const mode of Object.keys(names))el(mode).onclick=()=>start(mode);
window.addEventListener('pagehide',()=>finish());
document.addEventListener('visibilitychange',()=>{if(document.hidden&&running?.times.camera!==undefined)finish('カメラを停止しました。',running.mode==='blippar');});
history();try{const msg=sessionStorage.getItem('fukahiro.table.return');if(msg){el('notice').textContent=msg;el('records').open=true;sessionStorage.removeItem('fukahiro.table.return');}}catch{}
