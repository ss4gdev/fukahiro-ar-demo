import {pc} from '../20261121-brush-alva-blippar-v007/model.mjs';
import {rememberPlane} from '../20261124-brush-alva-placement-v022/placement.mjs';

// Use the same 5 x 5 reticle region and nine samples per patch as tabletopReference.
function intensity(image,x,y){
    const i=Math.floor(x),j=Math.floor(y);
    if(i<0||j<0||i+1>=image.width||j+1>=image.height)return NaN;
    const u=x-i,v=y-j,index=j*image.width+i,g=image.gray;
    return (1-v)*((1-u)*g[index]+u*g[index+1])+v*((1-u)*g[index+image.width]+u*g[index+image.width+1]);
}
function correlation(image,pixels,dx,dy,energy){
    let sum=0,squared=0,dot=0;
    for(const [x,y,weight] of pixels){
        const value=intensity(image,x+dx,y+dy);
        sum+=value;squared+=value*value;dot+=value*weight;
    }
    const variance=squared-sum*sum/pixels.length;
    return variance>100?dot/Math.sqrt(variance*energy):-1;
}
function projectPatch(patch,view,k,image){
    const ray=new pc.Vec3(),pixels=[];
    for(const {point,value} of patch.taps){
        view.transformPoint(point,ray);
        if(ray.z>=0)return null;
        pixels.push([k.cx-k.fx*ray.x/ray.z,k.cy+k.fy*ray.y/ray.z,value]);
    }
    const [u,v]=pixels[4],x=Math.round((u/image.width-.5)/.075),y=Math.round((v/image.height-.5)/.065);
    if(Math.abs(x)>2||Math.abs(y)>2)return null;
    const score=correlation(image,pixels,0,0,patch.energy);
    if(score<.76)return null;
    for(const [dx,dy] of [[-4,0],[4,0],[0,4],[0,-4]]){
        if(correlation(image,pixels,dx,dy,patch.energy)>score-.06)return null;
    }
    const taps=pixels.map(([u,v,w])=>[(u-k.cx)/k.fx,(k.cy-v)/k.fy,w]);
    return {x,y,e:patch.energy,taps,score};
}
const cell=g=>(g.y+2)*5+g.x+2;

export class GrainTracks {
    constructor(mode,stats){
        this.mode=mode;this.stats=stats;this.tracks=[];this.lastCheck=-Infinity;
    }
    fork(){
        const copy=new GrainTracks(this.mode,null);
        copy.tracks=this.tracks.slice();copy.lastCheck=this.lastCheck;
        return copy;
    }
    clear(){
        if(this.stats && !this.stats.finished)this.stats.tested+=this.tracks.length;
        this.tracks=[];this.lastCheck=-Infinity;
    }
    update(fresh,image,k,camera,up,now){
        const previous=this.tracks,view=camera.getWorldTransform().clone().invert();
        const cells=new Map();
        for(const track of previous){
            if(!up||up.dot(track.up)<.985||now-this.lastCheck>750||now-track.born>2000)continue;
            const group=projectPatch(track.patch,view,k,image);
            if(!group)continue;
            const key=cell(group),old=cells.get(key);
            if(!old||group.score>old.group.score)cells.set(key,{group,track});
        }
        const s=this.stats;
        if(s && !s.finished){
            s.tested+=previous.length;s.matched+=cells.size;
            if(previous.length)s.comparisons++;
        }
        this.lastCheck=now;
        if(this.mode==='standard'){this.tracks=[];return fresh;}
        this.tracks=Array.from(cells.values(),entry=>({...entry.track,cell:cell(entry.group)}));
        if(!cells.size)return fresh;
        const groups=Array.from(cells.values(),entry=>entry.group);
        for(const g of fresh.groups)if(!cells.has(cell(g)))groups.push(g);
        return {...fresh,groups};
    }
    // Only introduce new world points after the existing independent multi-view checks.
    seed(hit,camera,fresh,now){
        this.tracks=this.tracks.filter(t=>{
            const delta=t.patch.taps[4].point.clone().sub(hit.point);
            return t.up.dot(hit.up)>.985 && Math.abs(delta.dot(hit.up))<.015*hit.depth;
        });
        const occupied=new Set(this.tracks.map(t=>t.cell));
        const groups=fresh.groups.filter(g=>!occupied.has(cell(g)));
        if(!groups.length)return;
        // rememberPlane requires at least five patches; project the full set, then fill vacancies.
        const saved=rememberPlane(hit,camera,null,fresh,now);
        if(!saved)return;
        for(const patch of saved.patches){
            const key=cell(patch);
            if(!occupied.has(key))this.tracks.push({patch,cell:key,born:now,up:saved.up});
        }
    }
}
export function newGrainStats(mode){
    return {mode,tested:0,matched:0,comparisons:0,retentionPercent:null,firstSurfaceMs:null,
        lastSurfaceMs:null,lostMs:null,finished:false};
}
// A surface observation is fresh for 220 ms. Every uncovered interval after the first
// observation is charged exactly once, including the tail of an unsuccessful trial.
export function noteSurface(s,ms){
    if(!s||s.finished)return;
    if(s.firstSurfaceMs===null){s.firstSurfaceMs=ms;s.lostMs=0;}
    else s.lostMs+=Math.max(0,ms-s.lastSurfaceMs-220);
    s.lastSurfaceMs=ms;
}
export function finishGrain(s,ms){
    if(!s||s.finished)return;
    if(s.lastSurfaceMs!==null)s.lostMs+=Math.max(0,ms-s.lastSurfaceMs-220);
    if(s.tested)s.retentionPercent=Math.round(1000*s.matched/s.tested)/10;
    s.endMs=ms;s.finished=true;
}
