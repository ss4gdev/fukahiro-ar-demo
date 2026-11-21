// Compare visual curvature in map units with gravity-free acceleration in m/s².
// Symmetric differences cancel unknown starting position and velocity. Centering
// each regression also cancels a constant accelerometer bias during a short scan.
const dot=(a,b)=>a.reduce((s,n,i)=>s+n*b[i],0);
const mix=(a,b,t)=>a.map((n,i)=>n+(b[i]-n)*t);
function sampleAt(series,time,limit,read){
    const index=series.findIndex(s=>s.time>=time);
    if(index<=0)return null;
    const a=series[index-1],b=series[index],dt=b.time-a.time;
    return dt>0&&dt<=limit?read(a,b,(time-a.time)/dt):null;
}
function rotate(q,v){
    const [x,y,z,w]=q,[a,b,c]=v,tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);
    return [a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];
}
function regress(rows){
    const means=key=>[0,1,2].map(i=>rows.reduce((s,row)=>s+row[key][i],0)/rows.length);
    const mv=means('visual'),ma=means('inertial');
    let vv=0,aa=0,va=0;
    for(const row of rows){
        const v=row.visual.map((x,i)=>x-mv[i]),a=row.inertial.map((x,i)=>x-ma[i]);
        vv+=dot(v,v);aa+=dot(a,a);va+=dot(v,a);
    }
    if(aa<rows.length*.16**2||vv<=1e-12||va*va<.90*vv*aa)return null;
    return va/vv;
}
export class MetricScale {
    constructor(){this.reset();}
    reset(){this.poses=[];this.motion=[];this.mapMeters=null;this.lastTry=-Infinity;}
    append(series,row){
        if(series.length&&row.time<=series.at(-1).time)return;
        series.push(row);
        while(series.length&&row.time-series[0].time>5600)series.shift();
    }
    pose(time,p,q){this.append(this.poses,{time,p,q});}
    acceleration(time,a){this.append(this.motion,{time,a});}
    solve(now){
        if(this.mapMeters||now-this.lastTry<240)return this.mapMeters;
        this.lastTry=now;
        if(this.poses.length<18||this.motion.length<22)return null;
        const at=t=>sampleAt(this.poses,t,155,(a,b,f)=>({
            p:mix(a.p,b.p,f),q:mix(a.q,dot(a.q,b.q)<0?b.q.map(x=>-x):b.q,f)
        }));
        const end=Math.min(this.poses.at(-1).time,this.motion.at(-1).time);
        const start=Math.max(end-4000,this.poses[0].time+1,this.motion[0].time+1);
        if(now-end>350||end-start<1950)return null;
        const dt=30,steps=8,rows=[],grid=[];
        for(let t=start;t<=end;t+=dt){
            const pose=at(t),acc=sampleAt(this.motion,t,100,(a,b,f)=>mix(a.a,b.a,f));
            if(!pose||!acc){grid.push(null);continue;}
            const len=Math.hypot(...pose.q),q=pose.q.map(n=>n/len);
            grid.push({p:pose.p,q,a:rotate(q,acc)});
        }
        for(let i=steps;i+steps<grid.length;i+=3){
            const window=grid.slice(i-steps,i+steps+1);
            if(window.some(p=>!p||Math.abs(dot(p.q,grid[i].q))<.997))continue;
            const half=dt*steps/1000,visual=grid[i].p.map((v,k)=>(window[0].p[k]+window.at(-1).p[k]-2*v)/(half*half));
            const inertial=[0,0,0];
            for(let j=1;j<2*steps;j++){
                const weight=(steps-Math.abs(j-steps))/(steps*steps);
                for(let k=0;k<3;k++)inertial[k]+=window[j].a[k]*weight;
            }
            rows.push({visual,inertial,index:i});
        }
        if(rows.length<15)return null;
        const mid=(rows[0].index+rows.at(-1).index)/2;
        // Keep the two fits' sensor windows disjoint.
        const left=rows.filter(row=>row.index<mid-steps),right=rows.filter(row=>row.index>mid+steps);
        if(Math.min(left.length,right.length)<5)return null;
        const a=regress(left),b=regress(right),scale=regress(rows);
        // Some motion providers report specific force with opposite polarity.
        // Both independent windows must agree on the signed gain before taking its length.
        if(!a||!b||!scale||Math.sign(a)!==Math.sign(scale)||Math.sign(b)!==Math.sign(scale)||Math.abs(a-b)>.15*Math.abs(scale))return null;
        this.mapMeters=Math.abs(scale);
        return this.mapMeters;
    }
}
