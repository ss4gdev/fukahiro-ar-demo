import {pc} from '../20261121-brush-alva-blippar-v007/model.mjs';

const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const offset=[[-4,-4],[0,-4],[4,-4],[-2,-2],[2,-2],[-4,0],[0,0],[4,0],[-2,2],[2,2],[-4,4],[0,4],[4,4]];
function light(image,x,y){
    if(x<0||y<0||x>=image.width-1||y>=image.height-1)return NaN;
    const i=Math.floor(x),j=Math.floor(y),u=x-i,v=y-j,k=4*(j*image.width+i),stride=4*image.width,p=image.data;
    // The green channel is a cheap, consistent intensity sample on the tracking frames.
    return (1-v)*((1-u)*p[k+1]+u*p[k+5])+v*((1-u)*p[k+stride+1]+u*p[k+stride+5]);
}
function project(p,k){
    if(p.z>=0)return null;
    return {x:k.cx-k.fx*p.x/p.z,y:k.cy+k.fy*p.y/p.z};
}
function median(numbers){
    numbers.sort((a,b)=>a-b);return numbers[numbers.length>>1];
}
function seed(image,k,camera,stage){
    const eye=camera.getPosition(),up=stage.up,anchor=stage.getPosition(),height=anchor.clone().sub(eye).dot(up);
    const world=camera.getWorldTransform(),view=world.clone().invert(),center=project(view.transformPoint(anchor),k);
    if(!center)return [];
    const refs=[];
    for(const row of [-1,0,1])for(const col of [-1.5,-.5,.5,1.5]){
        let best=null,energy=0;
        for(const dy of [-6,0,6])for(const dx of [-6,0,6]){
            const x=Math.round(center.x+col*image.width*.095)+dx,y=Math.round(center.y+row*image.height*.09)+dy;
            const values=offset.map(([a,b])=>light(image,x+a,y+b)),mean=values.reduce((a,b)=>a+b,0)/values.length;
            const contrast=values.map(v=>v-mean),sum=contrast.reduce((a,b)=>a+b*b,0);
            if(sum>energy&&sum>values.length*5**2){best={x,y,contrast,sum};energy=sum;}
        }
        if(!best)continue;
        const points=offset.map(([a,b])=>{
            const ray=world.transformVector(new pc.Vec3((best.x+a-k.cx)/k.fx,(k.cy-best.y-b)/k.fy,-1));
            const distance=height/ray.dot(up);
            if(!Number.isFinite(distance)||distance<=0||distance>3*eye.distance(anchor))return null;
            return eye.clone().add(ray.mulScalar(distance));
        });
        if(points.every(Boolean))refs.push({points,contrast:best.contrast,energy:best.sum});
    }
    return refs;
}
function matchPoint(ref,image,k,view){
    const pixels=ref.points.map(p=>project(view.transformPoint(p),k));
    if(pixels.some(p=>!p||p.x<17||p.y<17||p.x>image.width-18||p.y>image.height-18))return null;
    function score(dx,dy){
        let dot=0,sum=0,square=0;
        for(let i=0;i<pixels.length;i++){
            const p=pixels[i],v=light(image,p.x+dx,p.y+dy);
            sum+=v;square+=v*v;dot+=v*ref.contrast[i];
        }
        const energy=square-sum*sum/pixels.length;
        return energy>60?dot/Math.sqrt(energy*ref.energy):-1;
    }
    const choices=[];
    for(let dy=-12;dy<=12;dy+=2)for(let dx=-12;dx<=12;dx+=2)choices.push({dx,dy,s:score(dx,dy)});
    let best=choices.reduce((a,b)=>a.s>b.s?a:b);
    const coarse=best;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        const x=coarse.dx+dx,y=coarse.dy+dy,s=score(x,y);
        if(s>best.s)best={dx:x,dy:y,s};
    }
    if(best.s<.84||choices.some(v=>Math.hypot(v.dx-best.dx,v.dy-best.dy)>4&&v.s>best.s-.065))return null;
    return {...pixels[6],dx:best.dx,dy:best.dy};
}
function correction(refs,image,k,camera,center){
    const view=camera.getWorldTransform().clone().invert();
    const matches=refs.map(r=>matchPoint(r,image,k,view)).filter(Boolean);
    if(matches.length<4)return null;
    const dx=median(matches.map(r=>r.dx)),dy=median(matches.map(r=>r.dy));
    const good=matches.filter(r=>Math.hypot(r.dx-dx,r.dy-dy)<3.5);
    if(good.length<4||good.length<matches.length*.65)return null;
    const avg=field=>good.reduce((s,r)=>s+r[field],0)/good.length;
    const x=avg('x'),y=avg('y'),u=avg('dx'),v=avg('dy');
    let variance=0,cov=0;
    for(const r of good){variance+=(r.x-x)**2+(r.y-y)**2;cov+=(r.x-x)*(r.dx-u)+(r.y-y)*(r.dy-v);}
    const zoom=variance/good.length>26**2?clamp(cov/variance,-.025,.025):0;
    const target=project(center,k);if(!target)return null;
    const shiftX=u+zoom*(target.x-x),shiftY=v+zoom*(target.y-y);
    const d=-center.z;
    return camera.getRotation().transformVector(new pc.Vec3(-shiftX*d/k.fx+zoom*center.x,shiftY*d/k.fy+zoom*center.y,zoom*center.z));
}

// Only the display camera is filtered. The tracker, scale solver and table anchor
// continue to use the original poses and measurements.
export class SteadyView{
    reset(){this.position=null;this.refs=[];this.bias=new pc.Vec3();this.last=0;this.lastMatch=0;this.matches=0;}
    constructor(){this.reset();}
    apply(image,k,camera,stage,now){
        const raw=camera.getPosition().clone(),rotation=camera.getRotation().clone(),anchor=stage.getPosition();
        const depth=Math.max(1e-6,raw.distance(anchor));
        if(!this.position||now-this.last>220){
            this.position=raw;this.rotation=rotation;this.last=now;this.lastMatch=now;
            this.bias.set(0,0,0);this.refs=seed(image,k,camera,stage);return;
        }
        const dt=clamp((now-this.last)/1000,.006,.12);this.last=now;
        // Limit the delay for deliberate motion. Near rest, damp translation
        // and angle noise before the independent image-space alignment.
        const q=this.rotation,dot=Math.abs(q.x*rotation.x+q.y*rotation.y+q.z*rotation.z+q.w*rotation.w);
        const motion=raw.distance(this.position)/depth+2*Math.acos(Math.min(1,dot));
        const tau=.010+.078/(1+(motion/.018)**2);
        const gain=1-Math.exp(-dt/tau);
        this.position.lerp(this.position,raw,gain);this.rotation.slerp(this.rotation,rotation,gain);
        camera.setPosition(this.position);camera.setRotation(this.rotation);
        const center=camera.getWorldTransform().clone().invert().transformPoint(anchor);
        const target=correction(this.refs,image,k,camera,center);
        if(target){
            this.bias.lerp(this.bias,target,.92);this.lastMatch=now;this.matches++;
        }else{
            this.bias.mulScalar(Math.exp(-dt/.085));
        }
        camera.setPosition(this.position.clone().add(this.bias));
        if(!target&&now-this.lastMatch>380){
            this.refs=seed(image,k,camera,stage);this.lastMatch=now;
        }
    }
}

