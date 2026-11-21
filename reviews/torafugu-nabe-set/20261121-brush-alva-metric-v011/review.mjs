import {history,updateRecord} from './measurement.mjs';
const $=id=>document.getElementById(id);
const options=['未確認','合格','不合格'],views=['正面','斜め','横'];
for(const view of views){
    const label=document.createElement('label'),select=document.createElement('select');
    label.append(view+'のツヤ・色 ');select.id=view;
    for(const x of options)select.add(new Option(x,x));
    label.append(select);$('views').append(label);
}
const fields=['conditions','prompt','diameter','drift',...views];
function links(){
    const q=new URLSearchParams(['desk','asset','load'].map(k=>[k,$(k).value]));q.set('review','1');
    $('original').href='./baseline.html?'+q;$('candidate').href='./index.html?'+q;
}
for(const k of ['desk','asset','load'])$(k).onchange=links;
links();
function labels(r){
    return [r.version,r.desk==='plain'?'無地':r.desk==='pattern'?'模様あり':'机未指定',r.asset,r.load,new Date(r.id).toLocaleTimeString()].join(' / ');
}
function display(){
    const r=history().find(x=>x.id===$('trials').value);
    $('observations').hidden=!r;$('download').disabled=!r;$('verdict').textContent='';
    if(!r){$('timing').textContent='まだ測定していません。';return;}
    const e=r.events,sec=n=>Number.isFinite(n)?(n/1000).toFixed(2)+'秒':'未到達';
    const prompt=r.prompt!==''&&Number.isFinite(Number(r.prompt))?Number(r.prompt):null;
    const net=Number.isFinite(e.readyMs)&&prompt!==null&&prompt>=0&&1000*prompt<=e.readyMs?e.readyMs-1000*prompt:null;
    const ply=r.plyTransfers?.[0];
    $('timing').textContent=['ボタンから配置可能まで '+sec(e.readyMs),'カメラ映像 '+sec(e.cameraPlayingMs)+' ／ モデル準備 '+sec(e.assetReadyMs),'机面 '+sec(e.tableMs)+' ／ 尺度 '+sec(e.scaleMs),'許可待ち '+(prompt===null?'未測定':prompt+'秒')+' ／ 許可待ちを除く '+(net===null?'未測定':sec(net)),ply?'PLYのネットワーク転送 '+ply.bytes.toLocaleString()+' B':'',r.reason].filter(Boolean).join('\n');
    for(const k of fields)$(k).value=r[k]??(views.includes(k)?'未確認':'');
    const result=(val,cond)=>val==null||val===''?'未測定':cond?'範囲内':'範囲外';
    const appearance=r.asset==='Brush PLY'?(views.some(k=>r[k]==='不合格')?'不合格':views.every(k=>r[k]==='合格')?'合格':'未確認'):'基準円盤';
    $('verdict').textContent='見た目 '+appearance+' ／ 外幅 '+result(r.diameter,+r.diameter>=23.75&&+r.diameter<=26.25)+' ／ 30cm移動後 '+result(r.drift,+r.drift<=2)+' ／ 配置の速さ（許可待ち除外） '+result(net,net<=5000);
}
function refresh(){const rows=history().reverse();$('trials').replaceChildren(...rows.map(r=>new Option(labels(r),r.id)));display();}
$('observations').onsubmit=e=>{e.preventDefault();updateRecord($('trials').value,Object.fromEntries(fields.map(k=>[k,$(k).value])));display();};
$('trials').onchange=display;window.addEventListener('pageshow',refresh);
$('download').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(history(),null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='fukahiro-nabe-iphone-trials.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),8000);};
refresh();

