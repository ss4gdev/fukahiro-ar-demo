import {pc} from './model.mjs';

const vec=(x,y,z)=>new pc.Vec3(x,y,z);
export function intersectTable(center,up,camera){
    const eye=camera.getPosition(), forward=camera.forward;
    const incidence=-up.dot(forward);
    if(incidence<.18)return null;
    const depth=eye.clone().sub(center).dot(up)/incidence;
    if(!Number.isFinite(depth)||depth<=0||center.distance(eye.clone().add(forward.clone().mulScalar(depth)))>depth*.4)return null;
    return {point:eye.clone().add(forward.clone().mulScalar(depth)),up,depth};
}

// A sensor observation is in the phone's natural orientation. Express vertical in camera/map coordinates.
export function measuredUp(beta,gamma,screenAngle,rotation){
    const rad=Math.PI/180,b=beta*rad,g=gamma*rad,s=screenAngle*rad;
    const x=-Math.cos(b)*Math.sin(g),y=Math.sin(b);
    return rotation.transformVector(vec(x*Math.cos(s)-y*Math.sin(s),x*Math.sin(s)+y*Math.cos(s),Math.cos(b)*Math.cos(g))).normalize();
}

// Track vertical in the map, using each sensor event only once with a nearby camera pose.
export class WorldVertical {
    reset(){this.last=null;this.up=null;this.sampleTime=-Infinity;}
    constructor(){this.reset();}
    read(sample,screenAngle,camera,now){
        if(!sample||now-sample.time>250)return now-this.sampleTime<650?this.up:null;
        if(sample.time===this.sampleTime)return this.up;
        const up=measuredUp(sample.beta,sample.gamma,screenAngle,camera.getRotation());
        const agrees=this.last&&sample.time-this.sampleTime<450&&this.last.dot(up)>.978;
        this.up=agrees?this.last.clone().add(up).normalize():null;
        this.last=up;this.sampleTime=sample.time;
        return this.up;
    }
}

export class DeskCandidates {
    reset(){this.previous=null;this.hit=null;this.seen=-Infinity;}
    constructor(){this.reset();}
    offer(candidate,vertical,now){
        if(!candidate){
            if(now-this.seen>320)this.reset();
            return this.hit;
        }
        const previous=now-this.seen<=320?this.previous:null;
        const agrees=previous&&candidate.up.dot(previous.up)>.97&&candidate.point.distance(previous.point)<.12*candidate.depth;
        const quick=!previous&&vertical&&candidate.wellSupported;
        this.hit=agrees||quick?{...candidate,up:vertical||candidate.up.clone().add(previous.up).normalize()}:null;
        this.previous=candidate;this.seen=now;
        return this.hit;
    }
    current(vertical,now){
        if(now-this.seen>320||(vertical&&this.hit&&this.hit.up.dot(vertical)<.97))this.reset();
        return this.hit;
    }
}

function luminance(pixels,width,x,y){
    const i=4*(y*width+x);
    return (pixels[i]+2*pixels[i+1]+pixels[i+2])*.25;
}
const offsets=[-4,-2,0,2,4];
function patch(pixels,width,x,y){
    const samples=[];
    for(const j of offsets)for(const i of offsets)samples.push(luminance(pixels,width,x+i,y+j));
    const mean=samples.reduce((sum,value)=>sum+value,0)/samples.length;
    for(let i=0;i<samples.length;i++)samples[i]-=mean;
    return samples;
}
export function reference(image,camera,k){
    const {width:w,height:h,data}=image,points=[];
    // Take textured patches on both sides of the reticle and near/far across the tabletop.
    for(let iy=-2;iy<=2;iy++)for(let ix=-2;ix<=2;ix++){
        let best=null,bestEnergy=0;
        for(const j of [-5,0,5])for(const i of [-5,0,5]){
            const x=Math.round(w*(.5+.082*ix))+i,y=Math.round(h*(.5+.077*iy))+j;
            if(x<5||y<5||x>=w-5||y>=h-5)continue;
            const samples=patch(data,w,x,y),energy=samples.reduce((sum,v)=>sum+v*v,0);
            if(energy>bestEnergy){bestEnergy=energy;best={ray:vec((x-k.cx)/k.fx,(k.cy-y)/k.fy,-1),samples,energy};}
        }
        if(bestEnergy>25*16)points.push(best);
    }
    return {world:camera.getWorldTransform().clone(),points};
}
function correlation(data,w,x,y,ref){
    let sum=0,sq=0,dot=0,n=0;
    for(const dy of offsets)for(const dx of offsets){
        const v=luminance(data,w,x+dx,y+dy);
        sum+=v;sq+=v*v;dot+=v*ref.samples[n++];
    }
    const norm=sq-sum*sum/n;
    return norm>100?dot/Math.sqrt(norm*ref.energy):0;
}
function match(ref,image,relative,t,k){
    const r=relative.transformVector(ref.ray),{width:w,height:h,data}=image;
    const samples=[];
    let best=null,lastX=-1,lastY=-1;
    for(let i=1;i<=80;i++){
        // Inverse depth in units of the measured translation. Sample about one pixel of parallax per step.
        const u=i/k.fx,denom=-r.z-t.z*u;
        if(denom<=0)continue;
        const x=Math.round(k.cx+k.fx*(r.x+t.x*u)/denom),y=Math.round(k.cy-k.fy*(r.y+t.y*u)/denom);
        if(x<5||x>=w-5||y<5||y>=h-5||(x===lastX&&y===lastY))continue;
        lastX=x;lastY=y;
        const s={x,y,u,score:correlation(data,w,x,y,ref)};samples.push(s);
        if(!best||s.score>best.score)best=s;
    }
    if(!best||best.score<.82||best.u*k.fx<3||best===samples.at(-1))return null;
    if(samples.some(s=>Math.hypot(s.x-best.x,s.y-best.y)>2.5&&s.score>best.score-.065))return null;
    return {x:ref.ray.x,y:ref.ray.y,u:best.u};
}
// In a pinhole camera a plane has affine inverse depth. Fit it to independent parallax observations.
export function fitPlane(matches,fx){
    let best=null;
    for(let i=0;i<matches.length;i++)for(let j=i+1;j<matches.length;j++)for(let l=j+1;l<matches.length;l++){
        const p=matches[i],q=matches[j],r=matches[l],dx=q.x-p.x,dy=q.y-p.y,ex=r.x-p.x,ey=r.y-p.y;
        const det=dx*ey-dy*ex;
        if(Math.abs(det)<.003)continue;
        const a=((q.u-p.u)*ey-(r.u-p.u)*dy)/det,b=(dx*(r.u-p.u)-ex*(q.u-p.u))/det,c=p.u-a*p.x-b*p.y;
        if(c<=0)continue;
        const inliers=matches.filter(v=>Math.abs(a*v.x+b*v.y+c-v.u)<1.55/fx);
        if(inliers.length<6||inliers.length<matches.length*.55)continue;
        // Require supporting texture around the target, not a single edge to one side.
        if(!['x','y'].every(axis=>inliers.some(v=>v[axis]<-.025)&&inliers.some(v=>v[axis]>.025)))continue;
        const loss=inliers.reduce((s,v)=>s+Math.abs(a*v.x+b*v.y+c-v.u),0);
        if(!best||inliers.length>best.count||(inliers.length===best.count&&loss<best.loss))best={a,b,c,count:inliers.length,loss};
    }
    return best;
}
export function patchTable(ref,image,camera,k,vertical){
    const relative=new pc.Mat4().mul2(camera.getWorldTransform().clone().invert(),ref.world);
    const delta=relative.getTranslation(),baseline=delta.length();
    if(baseline<1e-6||Math.hypot(delta.x,delta.y)<.45*baseline)return null;
    const t=delta.mulScalar(1/baseline);
    const matches=ref.points.map(pt=>match(pt,image,relative,t,k)).filter(Boolean);
    if(vertical){
        // A level table has just one unknown (height) when gravity is available.
        const up=ref.world.clone().invert().transformVector(vertical);
        const votes=matches.map(p=>({p,f:up.z-up.x*p.x-up.y*p.y})).filter(v=>v.f>.16);
        if(votes.length>=4){
            const slopes=votes.map(v=>v.p.u/v.f).sort((a,b)=>a-b),scale=slopes[Math.floor(slopes.length/2)];
            const good=votes.filter(v=>Math.abs(v.p.u-scale*v.f)*k.fx<1.3);
            if(up.z>.18&&good.length>=4&&good.length>=votes.length*.7&&scale*up.z*k.fx>=4&&
                ['x','y'].every(axis=>good.some(v=>v.p[axis]<-.02)&&good.some(v=>v.p[axis]>.02))){
                const center=ref.world.transformPoint(vec(0,0,-baseline/(scale*up.z)));
                const hit=intersectTable(center,vertical,camera);
                if(hit){hit.wellSupported=true;return hit;}
            }
        }
    }
    const plane=fitPlane(matches,k.fx);if(!plane)return null;
    const up=ref.world.transformVector(vec(-plane.a,-plane.b,plane.c)).normalize();
    if(vertical&&up.dot(vertical)<.84)return null;
    const center=ref.world.transformPoint(vec(0,0,-baseline/plane.c));
    const hit=intersectTable(center,vertical||up,camera);
    // With broad support in two views the fit already has repeated image evidence.
    if(hit)hit.wellSupported=plane.count>=10&&plane.c*k.fx>=8&&plane.loss*k.fx/plane.count<.8;
    return hit;
}

export function sdkTable(raw,camera,vertical){
    if(raw?.length!==16||!raw.every(Number.isFinite))return null;
    const center=vec(raw[12],-raw[13],-raw[14]);
    const normal=vec(raw[0],-raw[1],-raw[2]).normalize();
    if(camera.getPosition().clone().sub(center).dot(normal)<0)normal.mulScalar(-1);
    // Without gravity only accept the fitted normal. A placeholder rotation supplies no orientation.
    const placeholder=Math.abs(raw[0]-1)<1e-6&&Math.abs(raw[5]-1)<1e-6&&Math.abs(raw[10]-1)<1e-6;
    if(!vertical&&placeholder)return null;
    if(vertical&&!placeholder&&normal.dot(vertical)<.8)return null;
    return intersectTable(center,vertical||normal,camera);
}
