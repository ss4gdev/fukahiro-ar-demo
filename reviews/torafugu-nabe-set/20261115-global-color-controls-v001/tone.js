// The published coverage pass uses four samples per output pixel.
const palette=[[240,241,237],[171,176,171],[56,161,196],[242,125,66]];
const mixes=[];
for(let a=0;a<=4;a++)for(let b=0;b<=4-a;b++)for(let c=0;c<=4-a-b;c++){
    const counts=[a,b,c,4-a-b-c];
    const color=[0,1,2].map(channel=>counts.reduce((sum,n,i)=>sum+n*palette[i][channel]/4,0));
    mixes.push({color,food:(counts[2]+counts[3])/4,object:1-a/4});
}
export function coverage(mask){
    const food=new Uint8Array(mask.length/4),object=new Uint8Array(food.length),cache=new Map();
    for(let i=0,k=0;i<food.length;i++,k+=4){
        const r=mask[k],g=mask[k+1],b=mask[k+2],key=r*65536+g*256+b;
        let mix=cache.get(key);
        if(!mix){
            let best=Infinity;
            for(const m of mixes){
                const distance=(m.color[0]-r)**2+(m.color[1]-g)**2+(m.color[2]-b)**2;
                if(distance<best){mix=m;best=distance;}
            }
            if(best>3)throw Error('Unknown material coverage value');
            cache.set(key,mix);
        }
        food[i]=Math.round(255*mix.food);object[i]=Math.round(255*mix.object);
    }
    return {food,object};
}
const linear=Float64Array.from({length:256},(_,i)=>{
    const s=i/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;
});
const encoded=Uint8Array.from({length:65536},(_,i)=>{
    const v=i/65535;return Math.round(255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055));
});
function limit(chroma,luma){
    if(chroma>1e-12)return (1-luma)/chroma;
    if(chroma< -1e-12)return -luma/chroma;
    return 1;
}
function byte(v){return encoded[Math.max(0,Math.min(65535,Math.round(v*65535)))];}
export function grade(source,mask,{ev,sat,protect}){
    const out=new Uint8ClampedArray(source);
    if(ev===0 && sat===100)return out;
    const gain=2**ev,strength=protect/100,saturation=sat/100;
    for(let i=0,k=0;i<mask.length;i++,k+=4){
        if(!mask[i])continue;
        const r=linear[source[k]],g=linear[source[k+1]],b=linear[source[k+2]];
        const y=.2126*r+.7152*g+.0722*b;
        if(y<=1e-12)continue;
        // At full protection this is the curve from the approved color recipe.
        const exposed=gain*y, protectedY=exposed/(1+(gain-1)*y);
        const target=Math.min(1,exposed+(protectedY-exposed)*strength);
        const ratio=target/y, dr=(r-y)*ratio,dg=(g-y)*ratio,db=(b-y)*ratio;
        const gamut=Math.min(limit(dr,target),limit(dg,target),limit(db,target));
        const chroma=Math.min(gamut,Math.min(1,gamut)*saturation);
        const weight=mask[i]/255;
        out[k]=source[k]+weight*(byte(target+chroma*dr)-source[k]);
        out[k+1]=source[k+1]+weight*(byte(target+chroma*dg)-source[k+1]);
        out[k+2]=source[k+2]+weight*(byte(target+chroma*db)-source[k+2]);
    }
    return out;
}
