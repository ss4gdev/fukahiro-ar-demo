// Evaluate the same level surface across two views. A single feature behind
// the table must not be able to determine the depth of the plate.
const sample=(img,x,y)=>{
    if(x<0||y<0||x>=img.width-1||y>=img.height-1)return NaN;
    const i=Math.floor(x),j=Math.floor(y),u=x-i,v=y-j,k=j*img.width+i,w=img.width,p=img.gray;
    return (1-v)*((1-u)*p[k]+u*p[k+1])+v*((1-u)*p[k+w]+u*p[k+w+1]);
};
export function grayscale(image){
    const gray=new Uint8Array(image.width*image.height);
    for(let i=0;i<gray.length;i++)gray[i]=(image.data[4*i]+2*image.data[4*i+1]+image.data[4*i+2])>>2;
    return {width:image.width,height:image.height,gray};
}
const offsets=[[-3,-3],[0,-3],[3,-3],[-3,0],[0,0],[3,0],[-3,3],[0,3],[3,3]];
export function makeReference(img,k,camera){
    const groups=[];
    for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++){
        let best=null,strength=0;
        for(const dy of [-6,0,6])for(const dx of [-6,0,6]){
            const u=Math.round(img.width*(.5+x*.075))+dx,v=Math.round(img.height*(.5+y*.065))+dy;
            const taps=offsets.map(([ox,oy])=>[(u+ox-k.cx)/k.fx,(k.cy-v-oy)/k.fy,sample(img,u+ox,v+oy)]);
            const avg=taps.reduce((n,t)=>n+t[2],0)/9;
            taps.forEach(t=>t[2]-=avg);
            const e=taps.reduce((n,t)=>n+t[2]*t[2],0);
            if(e>strength){strength=e;best={taps,e,x,y};}
        }
        if(strength>9*10**2)groups.push(best);
    }
    return {world:camera.getWorldTransform().clone(),groups};
}
export function locateSurface(ref,img,k,camera,vertical,meters){
    const view=camera.getWorldTransform().clone().invert(),rel=view.clone().mul(ref.world).data;
    const n=view.transformVector(vertical),t=[rel[12],rel[13],rel[14]],lateral=Math.hypot(t[0],t[1]);
    if(n.z<.18||lateral<1e-7||ref.groups.length<8)return null;
    const baselinePixels=k.fx*lateral;
    const dotOrigin=n.x*t[0]+n.y*t[1]+n.z*t[2];
    const groups=ref.groups.map(g=>({...g,taps:g.taps.map(([x,y,value])=>{
        const rx=rel[0]*x+rel[4]*y-rel[8],ry=rel[1]*x+rel[5]*y-rel[9],rz=rel[2]*x+rel[6]*y-rel[10];
        return {rx,ry,rz,inv:1/(n.x*rx+n.y*ry+n.z*rz),value};
    })}));
    const score=disparity=>{
        const depth=baselinePixels/disparity,d=-depth*n.z-dotOrigin,good=[];
        for(const group of groups){
            let sum=0,sq=0,xy=0;
            for(const tap of group.taps){
                const f=d*tap.inv,z=-(t[2]+f*tap.rz);
                if(f<=0||z<=0){sq=NaN;break;}
                const g=sample(img,k.cx+k.fx*(t[0]+f*tap.rx)/z,k.cy-k.fy*(t[1]+f*tap.ry)/z);
                sum+=g;sq+=g*g;xy+=g*tap.value;
            }
            const corr=xy/Math.sqrt((sq-sum*sum/9)*group.e);
            if(corr>.72)good.push({group,corr});
        }
        if(good.length<7||good.length<groups.length*.50||!['x','y'].every(axis=>good.some(v=>v.group[axis]>0)&&good.some(v=>v.group[axis]<0)))return 0;
        return good.reduce((s,v)=>s+v.corr,0)/groups.length;
    };
    // Parallax is measured in pixels even when map units have no metric scale yet.
    const lo=meters?Math.max(5,baselinePixels*meters/1.6):5;
    const hi=meters?Math.min(110,baselinePixels*meters/.18):85;
    if(hi-lo<3)return null;
    const step=1,scores=[];
    for(let u=lo;u<=hi;u+=step)scores.push({u,value:score(u)});
    const best=scores.reduce((a,b)=>a.value>b.value?a:b);
    if(best.value<.48||best.u===scores[0].u||best.u===scores.at(-1).u||scores.some(s=>Math.abs(s.u-best.u)>3&&s.value>best.value-.10))return null;
    let peak=best;
    for(const d of [-.5,.5]){const u=best.u+d*step,value=score(u);if(value>peak.value)peak={u,value};}
    const depth=baselinePixels/peak.u,point=camera.getPosition().clone().add(camera.forward.clone().mulScalar(depth));
    return {point,depth,up:vertical.clone()};
}
