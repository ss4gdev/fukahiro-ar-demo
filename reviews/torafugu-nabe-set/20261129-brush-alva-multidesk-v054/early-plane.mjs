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

// Estimate the observed residual translation of each patch at the current
// depth. A small common error in camera orientation can shift every patch;
// the variation of parallax from the far side to the near side of the desk
// supplies an independent constraint on depth.
function depthCorrection({raw,m},image,k,n,depth) {
    const {width,height,gray}=image,tx=m[12],ty=m[13],tz=m[14],samples=[];
    const offset=n.x*tx+n.y*ty+n.z*tz;
    function pixel(x,y,d){
        const rx=m[0]*x+m[4]*y-m[8],ry=m[1]*x+m[5]*y-m[9],rz=m[2]*x+m[6]*y-m[10];
        const length=(-d*n.z-offset)/(n.x*rx+n.y*ry+n.z*rz),z=-(tz+length*rz);
        return [k.cx+k.fx*(tx+length*rx)/z,k.cy-k.fy*(ty+length*ry)/z];
    }
    for(const g of raw.groups){
        const taps=g.taps.map(([x,y,w])=>[...pixel(x,y,depth),w]);
        if(!taps.every(([u,v])=>u>=5 && v>=5 && u<width-6 && v<height-6))continue;
        const coords=taps.map(([u,v,w])=>{
            const x=Math.floor(u),y=Math.floor(v);
            return [y*width+x,u-x,v-y,w];
        });
        function similarity(dx,dy){
            let sum=0,sq=0,cross=0;
            for(const [j,fx,fy,w] of coords){
                const i=j+dx+dy*width;
                const c=(1-fy)*((1-fx)*gray[i]+fx*gray[i+1])+fy*((1-fx)*gray[i+width]+fx*gray[i+width+1]);
                sum+=c;sq+=c*c;cross+=c*w;
            }
            const e=sq-sum*sum/coords.length;
            return e>40?cross/Math.sqrt(e*g.e):-1;
        }
        let peak=-1,dx=0,dy=0;
        for(let y=-3;y<=3;y++)for(let x=-3;x<=3;x++){
            const q=similarity(x,y);
            if(q>peak){dx=x;dy=y;peak=q;}
        }
        if(Math.abs(dx)===3||Math.abs(dy)===3||peak<.84)continue;
        const left=similarity(dx-1,dy),right=similarity(dx+1,dy),top=similarity(dx,dy-1),bottom=similarity(dx,dy+1);
        const curvX=2*peak-left-right,curvY=2*peak-top-bottom;
        if(Math.min(curvX,curvY)<.045)continue;
        const [u,v]=taps[4], [x,y]=g.taps[4], [nextU,nextV]=pixel(x,y,depth*1.01);
        samples.push({a:(nextU-u)*100,b:(nextV-v)*100,u:(u-k.cx)/k.fx,v:(v-k.cy)/k.fy,
            x:dx+.5*(right-left)/curvX,y:dy+.5*(bottom-top)/curvY,cell:g.y});
    }
    if(samples.length<10||!samples.some(s=>s.cell===2)||!samples.some(s=>s.cell===-2))return null;
    const means={a:0,b:0,u:0,v:0,x:0,y:0};
    for(const s of samples)for(const key of Object.keys(means))means[key]+=s[key]/samples.length;
    // Remove the mean pixel shift and fit the residual roll alongside inverse
    // depth. Use pixel coordinates for both roll columns (u,v are normalized).
    let aa=0,ab=0,bb=0,ay=0,by=0,ss=0;
    for(const s of samples){
        const a=s.a-means.a,b=s.b-means.b,ru=-(s.v-means.v)*k.fx,rv=(s.u-means.u)*k.fy;
        const dx=s.x-means.x,dy=s.y-means.y;
        aa+=a*a+b*b;ab+=a*ru+b*rv;bb+=ru*ru+rv*rv;
        ay+=a*dx+b*dy;by+=ru*dx+rv*dy;ss+=dx*dx+dy*dy;
    }
    if(bb<=0)return null;
    const information=aa-ab*ab/bb;
    if(information<samples.length*9)return null;
    const change=(ay-ab*by/bb)/information,roll=(by-change*ab)/bb;
    const error=Math.sqrt(Math.max(0,ss-change*ay-roll*by)/Math.max(1,2*samples.length-4));
    if(error>.85 || Math.abs(roll)>.013 || Math.abs(change)>.12 ||
        Math.hypot(means.x-change*means.a,means.y-change*means.b)>4.5)return null;
    return {change,error:Math.max(.18,error)/Math.sqrt(information)};
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
    let depth=priorHit.depth*best.ratio;
    const corrections=views.map(v=>depthCorrection(v,gray,k,normal,depth));
    if(corrections.every(Boolean)){
        const [a,b]=corrections;
        // Conflicting independent depth slopes cannot certify a surface. Very
        // noisy slopes contribute no correction to the direct image estimate.
        if(Math.abs(a.change-b.change)>Math.max(.045,3*Math.hypot(a.error,b.error)))return null;
        if(Math.max(a.error,b.error)<.025){
            const wa=1/(a.error*a.error),wb=1/(b.error*b.error);
            depth*=1+(wa*a.change+wb*b.change)/(wa+wb);
        }
    }
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
