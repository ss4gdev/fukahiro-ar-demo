import {pc} from '../20261121-brush-alva-blippar-v007/model.mjs';
import {locateSurface} from '../20261121-brush-alva-stable-v010/surface.mjs';

// Limit the search to the visible tabletop around the reticle. Keep at most
// one textured corner per cell so a laptop outline cannot dominate the fit.
export function nearbyReference(image,k,camera,crop){
    if(!crop)return null;
    const {gray,width,height}=image;
    const groups=[];
    for(const y of [-3,-1,1,3])for(const x of [-5,-3,-1,1,3,5]){
        const cx=crop.x+crop.w*(.5+x*.065),cy=crop.y+crop.h*(.5+y*.065);
        const x0=Math.max(4,Math.ceil(cx-.054*crop.w)),x1=Math.min(width-5,cx+.054*crop.w);
        const y0=Math.max(4,Math.ceil(cy-.046*crop.h)),y1=Math.min(height-5,cy+.046*crop.h);
        let peak=0,bestU,bestV;
        for(let v=y0;v<=y1;v+=4)for(let u=x0;u<=x1;u+=4){
            let xx=0,xy=0,yy=0;
            for(let dy=-2;dy<=2;dy+=2)for(let dx=-2;dx<=2;dx+=2){
                const i=(v+dy)*width+u+dx;
                const gx=gray[i+1]-gray[i-1],gy=gray[i+width]-gray[i-width];
                xx+=gx*gx;xy+=gx*gy;yy+=gy*gy;
            }
            const trace=xx+yy,det=xx*yy-xy*xy;
            if(!trace || det<.045*trace*trace)continue;
            const score=det/trace;
            if(score>peak){peak=score;bestU=u;bestV=v;}
        }
        if(!peak)continue;
        const taps=[];
        let sum=0;
        for(const dy of [-3,0,3])for(const dx of [-3,0,3]){
            const u=bestU+dx,v=bestV+dy,value=gray[v*width+u];
            taps.push([(u-k.cx)/k.fx,(k.cy-v)/k.fy,value]);sum+=value;
        }
        let e=0;
        for(const tap of taps){tap[2]-=sum/9;e+=tap[2]*tap[2];}
        if(e>900)groups.push({x,y,e,taps,inner:Math.abs(x)===1&&Math.abs(y)===1});
    }
    if(!distributed(groups))return null;
    return {world:camera.getWorldTransform().clone(),groups,crop};
}

function distributed(groups){
    const inner=groups.filter(g=>g.inner);
    const outer=groups.filter(g=>!g.inner);
    const quadrants=new Set(outer.map(g=>(g.x>0?1:0)+(g.y>0?2:0)));
    return inner.length>=2 && outer.length>=6 && quadrants.size>=3;
}

// Verify which patches actually agree at the inferred height. A cluster
// that matches well only outside the reticle cannot establish its depth.
export function locateNearby(ref,image,k,camera,up,meters){
    const hit=locateSurface(ref,image,k,camera,up,meters);
    if(!hit)return null;
    const eye=ref.world.getTranslation();
    const height=up.dot(hit.point.clone().sub(eye));
    const view=camera.getWorldTransform().clone().invert(),ray=new pc.Vec3();
    const {gray,width}=image,crop=ref.crop;
    const matched=ref.groups.filter(group=>{
        let sum=0,squared=0,dot=0;
        for(const [x,y,intensity] of group.taps){
            ref.world.transformVector(ray.set(x,y,-1),ray);
            const distance=height/up.dot(ray);
            if(!(distance>0&&Number.isFinite(distance)))return false;
            view.transformPoint(ray.mulScalar(distance).add(eye),ray);
            if(ray.z>=0)return false;
            const u=k.cx-k.fx*ray.x/ray.z,v=k.cy+k.fy*ray.y/ray.z;
            if(u<crop.x||v<crop.y||u>=crop.x+crop.w-1||v>=crop.y+crop.h-1)return false;
            const ix=Math.floor(u),iy=Math.floor(v),a=u-ix,b=v-iy,i=iy*width+ix;
            const value=(1-b)*((1-a)*gray[i]+a*gray[i+1])+b*((1-a)*gray[i+width]+a*gray[i+width+1]);
            sum+=value;squared+=value*value;dot+=value*intensity;
        }
        const variance=squared-sum*sum/group.taps.length;
        return variance>100 && dot>.72*Math.sqrt(variance*group.e);
    });
    if(!distributed(matched) || matched.filter(g=>g.inner).length<.6*ref.groups.filter(g=>g.inner).length)return null;
    return hit;
}
