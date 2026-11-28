// Refine a tabletop height already proposed from images. Each reference uses
// the intensities recorded in its own image, before persistent grain is added.
function eligibleViews(refs, now, view, k, depth) {
    const views=[];
    for(const ref of refs) {
        if (!ref.raw || ref.raw.groups.length < 8 || now-ref.time < 60 || now-ref.time > 1100) continue;
        const m=view.clone().mul(ref.raw.world).data;
        const x=k.fx*m[12]/depth, y=k.fy*m[13]/depth;
        const parallax=Math.hypot(x,y);
        if (parallax < 15 || parallax > 120) continue;
        views.push({raw:ref.raw,m,x,y,parallax});
    }
    views.sort((a,b)=>b.parallax-a.parallax);
    const first=views[0];
    if(!first)return null;
    const second=views.find(v=>Math.hypot(v.x-first.x,v.y-first.y)>=8);
    return second?[first,second]:null;
}

function makeScorer({raw,m}, image, k, n) {
    const [tx,ty,tz]=m.subarray(12,15);
    const planeOffset=n.x*tx+n.y*ty+n.z*tz;
    const groups=raw.groups.map(group=>({
        x:group.x,y:group.y,energy:group.e,
        taps:group.taps.map(([x,y,weight])=>{
            const rx=m[0]*x+m[4]*y-m[8],ry=m[1]*x+m[5]*y-m[9],rz=m[2]*x+m[6]*y-m[10];
            return [rx,ry,rz,n.x*rx+n.y*ry+n.z*rz,weight];
        })
    }));
    const {width,height,gray}=image;
    return depth=>{
        const plane=-depth*n.z-planeOffset;
        let sum=0,good=0,coverage=0;
        for(const group of groups) {
            let intensity=0,energy=0,cross=0;
            for(const [rx,ry,rz,normal,weight] of group.taps) {
                const distance=plane/normal, z=-(tz+distance*rz);
                if(!(distance>0 && z>0)){energy=NaN;break;}
                const u=k.cx+k.fx*(tx+distance*rx)/z,v=k.cy-k.fy*(ty+distance*ry)/z;
                if(!(u>=0 && v>=0 && u<width-1 && v<height-1)){energy=NaN;break;}
                const col=Math.floor(u),row=Math.floor(v),p=row*width+col,dx=u-col,dy=v-row;
                const value=(1-dy)*((1-dx)*gray[p]+dx*gray[p+1])+dy*((1-dx)*gray[p+width]+dx*gray[p+width+1]);
                intensity+=value;energy+=value*value;cross+=value*weight;
            }
            const variance=energy-intensity*intensity/group.taps.length;
            if(!(variance>75))continue;
            const correlation=cross/Math.sqrt(variance*group.energy);
            if(correlation>.72) {
                good++;sum+=correlation;
                if(group.x<0)coverage|=1;
                if(group.x>0)coverage|=2;
                if(group.y<0)coverage|=4;
                if(group.y>0)coverage|=8;
            }
        }
        return coverage===15 && good>=Math.max(7,groups.length*.5)?sum/groups.length:0;
    };
}

export function refineTableDepth(refs, gray, k, camera, vertical, priorHit, now) {
    if(!vertical || !priorHit || !Number.isFinite(priorHit.depth) || priorHit.depth<=0 ||
        priorHit.up.dot(vertical)<.985)return null;
    const view=camera.getWorldTransform().clone().invert(), normal=view.transformVector(vertical);
    if(normal.z<.18)return null;
    const views=eligibleViews(refs,now,view,k,priorHit.depth);
    if(!views)return null;
    const score=views.map(v=>makeScorer(v,gray,k,normal));
    const samples=[];
    function evaluate(ratio) {
        const depth=priorHit.depth*ratio;
        const a=score[0](depth),b=score[1](depth);
        const value=Math.min(a,b)*.6+(a+b)*.2;
        const sample={ratio,a,b,value};
        samples.push(sample);
        return sample;
    }
    // Centre on a real observation; also search away from it to detect repeated
    // grain patterns. An optimum at the boundary is too uncertain to use.
    let best=evaluate(1);
    for(const offset of [-.30,-.20,-.15,-.12,-.09,-.06,-.03,.03,.06,.09,.12,.15,.20,.30]) {
        const sample=evaluate(1+offset);
        if(sample.value>best.value)best=sample;
    }
    if(Math.abs(best.ratio-1)>.205 || best.value<.48)return null;
    const coarse=best.ratio;
    for(const offset of [-.02,-.01,.01,.02]) {
        const sample=evaluate(coarse+offset);
        if(sample.value>best.value)best=sample;
    }
    const aBest=samples.reduce((a,b)=>a.a>b.a?a:b),bBest=samples.reduce((a,b)=>a.b>b.b?a:b);
    if(Math.min(best.a,best.b)<.48 || Math.abs(aBest.ratio-bBest.ratio)>.035 ||
        samples.some(s=>Math.abs(s.ratio-best.ratio)>.055 && s.value>best.value-.045))return null;
    const depth=priorHit.depth*best.ratio;
    return {point:camera.getPosition().clone().add(camera.forward.clone().mulScalar(depth)),
        up:vertical.clone(),depth,visual:true,multiview:true,referenceCount:2,
        parallaxPx:views.map(v=>v.parallax/best.ratio),score:best.value};
}

// Limit re-use to the photographed neighbourhood, even before metric scale
// exists. Camera translation changes the intersection, never the table height.
export function projectObservedPlane(plane,camera,now,intersect) {
    if(!plane || now-plane.matched>240 || now-plane.observed>2000 ||
        camera.forward.dot(plane.forward)<.976)return null;
    const hit=intersect(plane.point,plane.up,camera);
    if(!hit || camera.getPosition().distance(plane.eye)>.19*hit.depth ||
        hit.point.distance(plane.point)>.20*hit.depth)return null;
    return hit;
}
