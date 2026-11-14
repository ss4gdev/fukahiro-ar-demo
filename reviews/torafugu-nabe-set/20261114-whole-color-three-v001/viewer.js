'use strict';
const one = selector => document.querySelector(selector);
const state = {index:0, elevation:35, zoom:1, x:0.5, y:0.5};
const layers = ['current','lift','recipe'];
const names = ['現状','ふぐの影を浅くした案','iPhone採用色に寄せた案'];
const panels = one('#panels');
let loading = 0;
let lastDrawn = '';

function mark(group, selected) {
    for (const button of document.querySelectorAll('[data-'+group+']')) {
        button.setAttribute('aria-pressed', String(button.dataset[group] === String(selected)));
    }
}
function magnify() {
    panels.style.setProperty('--zoom', state.zoom);
    panels.style.setProperty('--origin', (state.x*100)+'% '+(state.y*100)+'%');
    mark('zoom', state.zoom);
}
async function render() {
    const ticket = ++loading;
    const id = 'e'+state.elevation+'-'+String(state.index).padStart(2,'0');
    const status = one('#position');
    mark('elevation', state.elevation);
    one('#angle').value = (state.index*30)+'°';
    panels.setAttribute('aria-busy','true');
    status.textContent = '視点を読み込み中…';
    try {
        const images = await Promise.all(layers.map(async (layer,index)=>{
            const image = new Image(1152,1008);
            image.alt = names[index]+'の鍋セット全体';
            image.src = 'views/'+id+'-'+layer+'.webp';
            await image.decode();
            return image;
        }));
        if (ticket !== loading) return;
        layers.forEach((layer,index)=>one('#'+layer).replaceChildren(images[index]));
        status.textContent = '高さ '+state.elevation+'°　／　向き '+state.index*30+'°　（'+(state.index+1)+' / 12）';
        panels.dataset.view = id;
        lastDrawn = id;
    } catch {
        if (ticket !== loading) return;
        status.textContent = '画像を読み込めませんでした。もう一度同じ視点を選んでください。';
    } finally {
        if (ticket===loading) panels.setAttribute('aria-busy','false');
    }
}
function turn(steps) {
    state.index=(state.index+steps+12)%12;
    render();
}
one('#prev').onclick = ()=>turn(-1);
one('#next').onclick = ()=>turn(1);
for(const button of document.querySelectorAll('[data-elevation]')) button.onclick=()=>{
    state.elevation=Number(button.dataset.elevation);
    render();
};
for(const button of document.querySelectorAll('[data-zoom]')) button.onclick=()=>{
    state.zoom=Number(button.dataset.zoom);
    state.x=state.y=0.5;
    magnify();
};
for (const frame of document.querySelectorAll('.frame')) {
    let start=null;
    frame.onpointerdown = event=>{
        if (event.button!==0) return;
        start={x:event.clientX,y:event.clientY,id:event.pointerId};
        frame.setPointerCapture(event.pointerId);
    };
    frame.onpointercancel=()=>{start=null;};
    frame.onpointerup = event=>{
        if (!start || event.pointerId!==start.id) return;
        const dx=event.clientX-start.x, dy=event.clientY-start.y;
        start=null;
        if (Math.abs(dx)>32 && Math.abs(dx)>Math.abs(dy)) {
            turn((dx<0?1:-1)*Math.min(6,Math.max(1,Math.round(Math.abs(dx)/80))));
        } else if (state.zoom>1 && Math.abs(dx)<8 && Math.abs(dy)<8 && lastDrawn) {
            const rect=frame.getBoundingClientRect();
            const u=(event.clientX-rect.left)/rect.width;
            const v=(event.clientY-rect.top)/rect.height;
            const targetX=state.x+(u-state.x)/state.zoom;
            const targetY=state.y+(v-state.y)/state.zoom;
            const anchor=value=>Math.max(0,Math.min(1,(state.zoom*value-.5)/(state.zoom-1)));
            state.x=anchor(targetX);
            state.y=anchor(targetY);
            magnify();
        }
    };
}
document.addEventListener('keydown',event=>{
    if(event.altKey || event.metaKey || event.ctrlKey) return;
    if(event.key==='ArrowLeft' || event.key==='ArrowRight'){
        event.preventDefault();turn(event.key==='ArrowLeft'?-1:1);
    }
});
magnify();
render();
