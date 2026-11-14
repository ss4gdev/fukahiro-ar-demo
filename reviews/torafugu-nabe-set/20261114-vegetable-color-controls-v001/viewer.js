const $=id=>document.getElementById(id);
const basePath='../20261114-whole-color-three-v001/views/';
const key='fukahiro.nabe.vegetable-controls.v1';
const W=1152,H=1008;
const sliders=['green','orange','white'];
const defaults={base:'current',green:35,orange:30,white:45,index:0,elevation:65,points:[],radius:16};
const clamp=(n,lo=0,hi=1)=>Math.max(lo,Math.min(hi,n));
function sanitize(value){
    const s={...defaults,points:[]};
    if(!value || typeof value!=='object') return s;
    if(['current','lift','recipe'].includes(value.base)) s.base=value.base;
    for(const id of sliders) if(Number.isFinite(value[id])) s[id]=clamp(Math.round(value[id]),0,100);
    if(Number.isInteger(value.index)) s.index=clamp(value.index,0,11);
    if([35,65].includes(value.elevation)) s.elevation=value.elevation;
    if([8,16,26].includes(value.radius)) s.radius=value.radius;
    if(Array.isArray(value.points)) s.points=value.points.filter(p=>Array.isArray(p)&&p.length===4&&p.slice(0,3).every(x=>Number.isFinite(x)&&Math.abs(x)<=60)&&[8,16,26].includes(p[3])).slice(0,60);
    return s;
}
let saved;
try{saved=location.hash.startsWith('#v1=') ? JSON.parse(decodeURIComponent(location.hash.slice(4))) : JSON.parse(localStorage.getItem(key));}catch{}
const state=sanitize(saved);
let zoom=1,origin=[.5,.5],picking=false,serial=0,raf=0;
let cameras,view,weights,ready=false;
const ref=$('before').getContext('2d',{willReadFrequently:true});
const edited=$('after').getContext('2d',{willReadFrequently:true});
function scratch(){const c=document.createElement('canvas');c.width=W;c.height=H;return c.getContext('2d',{willReadFrequently:true});}
const read=scratch();
async function img(url){
    const im=new Image();im.src=url;await im.decode();
    if(im.naturalWidth!==W||im.naturalHeight!==H)throw Error('寸法が一致しません');
    return im;
}
function persist(){
    try{localStorage.setItem(key,JSON.stringify(state));}catch{}
    if(location.hash.startsWith('#v1=')) history.replaceState(null,'',link());
}
function link(){
    const url=new URL(location.href);url.hash='v1='+encodeURIComponent(JSON.stringify(state));return url.href;
}
function setControls(){
    $('base').value=state.base;$('elev').value=state.elevation+'°';$('radius').value=state.radius;
    $('angle').value=state.index*30+'°';
    for(const id of sliders){$(id).value=state[id];$(id+'Val').textContent=state[id]+'%';}
    $('points').textContent='選択 '+state.points.length+' か所';$('undo').disabled=!state.points.length;
    $('pick').setAttribute('aria-pressed',picking);$('pickStage').classList.toggle('picking',picking);
    $('legend').hidden=!$('overlay').checked;
    $('afterTitle').textContent=$('overlay').checked?'適用範囲':'調整後';
}
function project(point){
    const [x,y,z]=point.map((v,i)=>v-view.target[i]);
    const horizontal=view.sy*x+view.cy*y;
    return [view.cy*x-view.sy*y,view.ct*horizontal+view.st*z,-view.st*horizontal+view.ct*z];
}
function unproject(x,y,depth){
    const h=view.ct*y-view.st*depth;
    const z=view.st*y+view.ct*depth;
    const v=[view.cy*x+view.sy*h,-view.sy*x+view.cy*h,z];
    return v.map((n,i)=>Math.round((n+view.target[i])*1000)/1000);
}
function status(message){
    const count=state.points.length;
    $('status').textContent=message || ('高さ '+state.elevation+'°　／　向き '+state.index*30+'°'+(picking?'　右の画像でえのきの束をクリックしてください。':!count?'　えのきの白さは、位置を選ぶと反映されます。':''));
}
function classify(base,depth){
    const maps=[new Uint8Array(W*H),new Uint8Array(W*H),new Uint8Array(W*H)];
    for(let i=0,k=0;i<W*H;i++,k+=4){
        if(!depth[k])continue;
        const r=base[k]/255,g=base[k+1]/255,b=base[k+2]/255;
        const green=clamp((g-r-.008)/.085)*clamp((g-b-.04)/.12);
        const orange=clamp((r-g-.085)/.16)*clamp((g-b-.036)/.10)*clamp((r-g-.52*(g-b))/.09)*clamp((r-b-.16)/.16);
        maps[0][i]=Math.round(green*255); maps[1][i]=Math.round(orange*255);
        maps[2][i]=Math.round(255*(1-Math.max(green,orange))*clamp((.39-(Math.max(r,g,b)-Math.min(r,g,b)))/.19)*clamp((.5*r+.5*g-.11)/.24));
    }
    return maps;
}
function findEnoki(){
    const mask=new Uint8Array(W*H), unit=2*cameras.half/H;
    for(const p of state.points){
        const [cx,cy,cz]=project(p.slice(0,3));
        const radius=p[3]/cameras.mmPerUnit,span=radius/unit;
        const x0=W/2+cx/unit,y0=H/2-cy/unit;
        for(let y=Math.max(0,Math.floor(y0-span));y<Math.min(H,Math.ceil(y0+span));y++){
            for(let x=Math.max(0,Math.floor(x0-span));x<Math.min(W,Math.ceil(x0+span));x++){
                const i=y*W+x,code=view.depth[4*i];
                if(!code||!weights[2][i])continue;
                const dz=(code-1)*64/253-32-cz;
                const distance=Math.hypot((x+.5-x0)*unit,(y+.5-y0)*unit,dz)/radius;
                mask[i]=Math.max(mask[i],Math.round(clamp((1-distance)/.35)*weights[2][i]));
            }
        }
    }
    return mask;
}
function paint(){
    if(!ready)return;
    const a=new Uint8ClampedArray(view.pixels.data);
    const overlay=$('overlay').checked,g=state.green/100,o=state.orange/100,w=state.white/100;
    for(let i=0,k=0;i<W*H;i++,k+=4){
        const green=weights[0][i]/255,orange=weights[1][i]/255,enoki=view.enoki[i]/255;
        if(!green&&!orange&&!enoki)continue;
        const rgb=[a[k],a[k+1],a[k+2]];
        if(overlay){
            const amount=Math.max(green,orange,enoki)*.72;
            const ink=enoki>green&&enoki>orange?[172,75,222]:green>orange?[30,198,86]:[255,107,18];
            for(let c=0;c<3;c++)a[k+c]=rgb[c]+(ink[c]-rgb[c])*amount;
        }else{
            const y=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
            const saturation=1+green*g*.82+orange*o*.75;
            const whitening=w*enoki;
            // Lift midtones and neutralize yellow while keeping the source highlights and texture.
            const whiteY=y+.34*(255-y)*(.3+.7*y/255);
            for(let c=0;c<3;c++)a[k+c]=y+(rgb[c]-y)*saturation*(1-.88*whitening)+(whiteY-y)*whitening;
        }
    }
    edited.putImageData(new ImageData(a,W,H),0,0);
    $('frames').dataset.revision=String(++paintCount);
}
let paintCount=0;
function schedule(){cancelAnimationFrame(raf);raf=requestAnimationFrame(paint);}
async function loadView(){
    const ticket=++serial;
    ready=false;setControls();$('frames').setAttribute('aria-busy','true');status('視点を読み込み中…');
    const id='e'+state.elevation+'-'+String(state.index).padStart(2,'0');
    const layer=state.base;
    try{
        const [base,current,map]=await Promise.all([img(basePath+id+'-'+layer+'.webp'),layer==='current'?null:img(basePath+id+'-current.webp'),img('maps/'+id+'.png')]);
        if(ticket!==serial)return;
        ref.drawImage(base,0,0);const pixels=ref.getImageData(0,0,W,H);
        read.drawImage(map,0,0);const depth=read.getImageData(0,0,W,H).data;
        if(current)read.drawImage(current,0,0);
        weights=classify(current?read.getImageData(0,0,W,H).data:pixels.data,depth);
        const yaw=(-35+state.index*30)*Math.PI/180,tilt=(90-state.elevation)*Math.PI/180;
        view={pixels,depth,target:cameras.views[id],cy:Math.cos(yaw),sy:Math.sin(yaw),ct:Math.cos(tilt),st:Math.sin(tilt)};
        view.enoki=findEnoki();ready=true;paint();
        $('frames').dataset.view=id+'-'+layer;status();
    }catch{if(ticket===serial)status('画像を読み込めませんでした。基準色か高さを選び直してください。');}
    finally{if(ticket===serial)$('frames').setAttribute('aria-busy','false');}
}
function magnify(){
    $('frames').style.setProperty('--zoom',zoom);
    $('frames').style.setProperty('--origin',origin.map(v=>100*v+'%').join(' '));
    $('zoom').setAttribute('aria-pressed',zoom===2);
}
for(const id of sliders)$(id).oninput=()=>{state[id]=Number($(id).value);setControls();schedule();persist();};
$('overlay').onchange=()=>{setControls();schedule();};
$('radius').onchange=()=>{state.radius=Number($('radius').value);persist();};
$('pick').onclick=()=>{picking=!picking;setControls();status();};
$('undo').onclick=()=>{state.points.pop();if(ready)view.enoki=findEnoki();setControls();schedule();status();persist();};
$('zoom').onclick=()=>{zoom=zoom===1?2:1;origin=[.5,.5];magnify();};
function rotate(delta){state.index=(state.index+delta+12)%12;persist();loadView();}
$('prev').onclick=()=>rotate(-1);$('next').onclick=()=>rotate(1);
$('base').onchange=()=>{state.base=$('base').value;persist();loadView();};
$('elev').onchange=()=>{state.elevation=parseInt($('elev').value);persist();loadView();};
for(const stage of document.querySelectorAll('.stage'))stage.onclick=event=>{
    if(!ready)return;
    const rect=stage.getBoundingClientRect();
    const [u,v]=[(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height].map((n,i)=>origin[i]+(n-origin[i])/zoom);
    if(picking && stage.id==='pickStage'){
        if(state.points.length>=60){status('60か所まで指定できます。「1点戻す」で位置を修正してください。');return;}
        const x=clamp(Math.floor(u*W),0,W-1),y=clamp(Math.floor(v*H),0,H-1),i=y*W+x;
        const code=view.depth[4*i];
        if(!code||weights[2][i]<12){status('選べる範囲の外です。えのきの白い軸や傘の内側をクリックしてください。');return;}
        const unit=2*cameras.half/H;
        const p=unproject((x+.5-W/2)*unit,(H/2-y-.5)*unit,(code-1)*64/253-32);
        state.points.push([...p,state.radius]);view.enoki=findEnoki();setControls();schedule();persist();
        status('えのきを '+state.points.length+' か所指定しました。別の束を続けて選べます。');return;
    }
    if(zoom===2){origin=[u,v].map(n=>clamp((zoom*n-.5)/(zoom-1)));magnify();}
};
$('reset').onclick=()=>{
    Object.assign(state,{green:0,orange:0,white:0,points:[]});picking=false;$('overlay').checked=false;
    if(ready)view.enoki=findEnoki();setControls();schedule();persist();status();
};
$('share').onclick=async()=>{
    const url=link();$('shareText').hidden=true;
    try{await navigator.clipboard.writeText(url);$('saved').textContent='設定リンクをコピーしました。';}
    catch{$('shareText').value=url;$('shareText').hidden=false;$('shareText').select();$('saved').textContent='表示されたリンクをコピーしてください。';}
};
setControls();magnify();
try{const response=await fetch('cameras.json');if(!response.ok)throw Error();cameras=await response.json();await loadView();}
catch{status('位置情報を読み込めませんでした。ページを更新してください。');}
