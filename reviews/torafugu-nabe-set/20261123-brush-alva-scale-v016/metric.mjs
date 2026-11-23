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
function regress(rows,minVariation=.13){
    const means=key=>[0,1,2].map(i=>rows.reduce((s,row)=>s+row[key][i],0)/rows.length);
    const mv=means('visual'),ma=means('inertial');
    let vv=0,aa=0,va=0;
    for(const row of rows){
        const v=row.visual.map((x,i)=>x-mv[i]),a=row.inertial.map((x,i)=>x-ma[i]);
        vv+=dot(v,v);aa+=dot(a,a);va+=dot(v,a);
    }
    if(aa<rows.length*minVariation**2||vv<=1e-12)return null;
    return {gain:va/vv,quality:va*va/(vv*aa)};
}

// A single slide has two useful portions: starting and slowing down.
// Each portion can have almost constant acceleration, so centering it on
// its own mean (the legacy fit) can discard most of this signal.
function motionPortion(rows){
    const mean=[0,0,0];
    let aa=0,vv=0,av=0;
    for(const {visual,inertial} of rows){
        aa+=dot(inertial,inertial);vv+=dot(visual,visual);av+=dot(inertial,visual);
        for(let k=0;k<3;k++)mean[k]+=inertial[k]/rows.length;
    }
    if(vv<=1e-12||Math.hypot(...mean)<.05)return null;
    const quality=av*av/(vv*aa);
    return quality>=.975?{mean,gain:av/vv,quality}:null;
}
function slideFit(rows,steps){
    // Use only the latest uninterrupted sequence; missing poses must not look
    // like a change of velocity. Each row spans +/- steps motion samples.
    let start=rows.length-1;
    while(start>0&&rows[start].index-rows[start-1].index===3)start--;
    const run=rows.slice(Math.max(0,start,rows.length-32));
    const length=4;
    if(run.length<2*length+Math.floor(2*steps/3))return null;
    const portions=run.slice(length-1).map((_,i)=>motionPortion(run.slice(i,i+length)));
    let best=null;
    for(let j=0;j<portions.length;j++){
        const end=portions[j];if(!end)continue;
        for(let i=0;i+length<=j;i++){
            const begin=portions[i];
            if(!begin||run[j].index-run[i+length-1].index<=2*steps)continue;
            if(dot(begin.mean,end.mean)>-.5*Math.hypot(...begin.mean)*Math.hypot(...end.mean))continue;
            const gain=(begin.gain+end.gain)/2;
            if(!gain||Math.abs(begin.gain-end.gain)>.06*Math.abs(gain))continue;
            const first=run[i],last=run[j+length-1];
            const travel=Math.abs(gain)*Math.hypot(...last.p.map((x,k)=>x-first.p[k]));
            if(travel<.018)continue;
            // Test all intervening rows, including coasting. A timing mismatch
            // or sensor bias can otherwise make two short peaks look convincing.
            const sequence=run.slice(i,j+length);
            let signal=0,error=0;
            for(const row of sequence){
                signal+=dot(row.inertial,row.inertial);
                const diff=row.inertial.map((x,k)=>x-gain*row.visual[k]);
                error+=dot(diff,diff);
            }
            const quality=1-error/signal;
            if(quality>=.975&&(!best||quality>best.quality))best={gain,quality,travel};
        }
    }
    return best;
}
// One row compares two estimates of the same change of velocity. Integrating
// acceleration with a triangular kernel matches the visual second difference.
function curvatureRows(grid,steps,detail){
    const rows=[],halfSeconds=.03*steps;
    for(let i=steps;i+steps<grid.length;i+=3){
        const window=grid.slice(i-steps,i+steps+1);
        if(window.some(p=>!p)){if(detail)detail.gapWindows++;continue;}
        if(window.some(p=>Math.abs(dot(p.q,grid[i].q))<.997)){if(detail)detail.rotationWindows++;continue;}
        const visual=grid[i].p.map((v,k)=>(window[0].p[k]+window.at(-1).p[k]-2*v)/(halfSeconds*halfSeconds));
        const inertial=[0,0,0];
        for(let j=1;j<2*steps;j++){
            const weight=(steps-Math.abs(j-steps))/(steps*steps);
            for(let k=0;k<3;k++)inertial[k]+=window[j].a[k]*weight;
        }
        rows.push({visual,inertial,index:i,p:grid[i].p});
    }
    return rows;
}
function gentleScale(rows,steps){
    // Require two independent, time-ordered measurements with no shared
    // sensor samples. A constant acceleration or velocity alone has no scale.
    if(rows.length<16||rows.some((r,i)=>i&&r.index-rows[i-1].index!==3))return null;
    const middle=(rows[0].index+rows.at(-1).index)/2;
    const full=regress(rows,.045);
    if(!full||full.quality<.965)return null;
    const tolerance=.04*Math.abs(full.gain);
    // The user may begin the slide before or after the middle of the buffer.
    const corroborated=[middle,middle-6,middle+6].some(pivot=>{
        const early=rows.filter(r=>r.index<pivot-steps),late=rows.filter(r=>r.index>pivot+steps);
        if(Math.min(early.length,late.length)<5)return false;
        const a=regress(early,.035),b=regress(late,.035);
        return a&&b&&Math.min(a.quality,b.quality)>=.965&&Math.abs(a.gain-full.gain)<=tolerance
            &&Math.abs(b.gain-full.gain)<=tolerance&&Math.abs(a.gain-b.gain)<=tolerance;
    });
    if(!corroborated)return null;
    const first=rows[0].p;
    const travel=Math.abs(full.gain)*Math.max(...rows.map(r=>Math.hypot(...r.p.map((x,k)=>x-first[k]))));
    return travel>=.025?full:null;
}
export class MetricScale {
    constructor(){
        this.diagnostics={attempts:0,outcomes:{},last:[],lastAccepted:null};
        this.reset();
    }
    reset(){this.poses=[];this.motion=[];this.mapMeters=null;this.lastTry=-Infinity;this.previousSlide=null;this.previousGentle=null;}
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
        const log=this.diagnostics;
        log.last=[];
        log.attempts++;
        const count=reason=>{log.outcomes[reason]=(log.outcomes[reason]||0)+1;};
        if(this.poses.length<18||this.motion.length<22){
            count('insufficient-samples');
            log.last.push({reason:'insufficient-samples',poses:this.poses.length,motion:this.motion.length});
            return null;
        }
        // Camera buffers and Safari motion events need not have the same delay.
        // Evaluate a bounded offset and require consistent motion in two intervals.
        let best=null,slide=null,gentle=null;
        for(const offset of [0,-60,60,-120,120]){
            const detail={offsetMs:offset};
            const fit=this.fit(now,offset,detail);
            count(detail.reason);
            log.last.push(detail);
            if(fit&&(!best||fit.quality>best.quality))best={...fit,offset};
            if(detail.slide&&(!slide||detail.slide.quality>slide.quality))slide={...detail.slide,offset};
            if(detail.gentle&&(!gentle||detail.gentle.quality>gentle.quality))gentle={...detail.gentle,offset};
        }
        const previous=this.previousSlide;
        if(!best&&slide&&previous&&now-previous.time<=600&&Math.abs(slide.offset-previous.offset)<=60
            &&Math.abs(slide.gain-previous.gain)<=.04*Math.abs(slide.gain))best={...slide,method:'single-slide'};
        this.previousSlide=slide?{...slide,time:now}:null;
        const last=this.previousGentle;
        if(!best&&gentle&&last&&gentle.end-last.end>=150&&now-last.time<=600
            &&Math.abs(gentle.offset-last.offset)<=60&&Math.abs(gentle.gain-last.gain)<=.03*Math.abs(gentle.gain)){
            best={...gentle,method:'gentle-two-baselines'};
        }
        this.previousGentle=gentle?{...gentle,time:now}:null;
        this.mapMeters=best?Math.abs(best.gain):null;
        if(best)log.lastAccepted={method:best.method||'legacy',offsetMs:best.offset,quality:best.quality,metersPerMapUnit:this.mapMeters};
        return this.mapMeters;
    }
    fit(now,offset,detail={}){
        const reject=reason=>{detail.reason=reason;return null;};
        const at=t=>sampleAt(this.poses,t,155,(a,b,f)=>({
            p:mix(a.p,b.p,f),q:mix(a.q,dot(a.q,b.q)<0?b.q.map(x=>-x):b.q,f)
        }));
        const end=Math.min(this.poses.at(-1).time,this.motion.at(-1).time-offset);
        const start=Math.max(end-4800,this.poses[0].time+1,this.motion[0].time-offset+1);
        detail.overlapMs=Math.round(end-start);
        if(now-end>350)return reject('stale-input');
        if(end-start<1500)return reject('short-overlap');
        const dt=30,steps=8,grid=[];
        for(let t=start;t<=end;t+=dt){
            const pose=at(t),acc=sampleAt(this.motion,t+offset,110,(a,b,f)=>mix(a.a,b.a,f));
            if(!pose||!acc){grid.push(null);continue;}
            const len=Math.hypot(...pose.q),q=pose.q.map(n=>n/len);
            grid.push({p:pose.p,q,a:rotate(q,acc)});
        }
        detail.gapWindows=0;detail.rotationWindows=0;
        const rows=curvatureRows(grid,steps,detail);
        detail.rows=rows.length;
        detail.slide=slideFit(rows,steps);
        if(end-start<1950)return reject('short-overlap');
        if(rows.length<15)return reject('too-few-usable-windows');
        const mid=(rows[0].index+rows.at(-1).index)/2;
        // Keep the two fits' sensor windows disjoint.
        const left=rows.filter(row=>row.index<mid-steps),right=rows.filter(row=>row.index>mid+steps);
        if(Math.min(left.length,right.length)<5)return reject('short-independent-halves');
        const a=regress(left),b=regress(right),scale=regress(rows);
        // Some motion providers report specific force with opposite polarity.
        // Both independent windows must agree on the signed gain before taking its length.
        if(!a||!b||!scale){
            const short=gentleScale(rows,steps);
            if(short){
                const longSteps=12,wideRows=curvatureRows(grid,longSteps);
                const long=wideRows.length>=15&&wideRows.every((r,i)=>!i||r.index-wideRows[i-1].index===3)&&regress(wideRows,.045);
                if(long&&long.quality>=.965&&Math.abs(long.gain-short.gain)<=.025*Math.abs(short.gain)){
                    detail.gentle={gain:(short.gain+long.gain)/2,quality:Math.min(short.quality,long.quality),end};
                }
            }
            return reject('low-motion-variation');
        }
        detail.quality=[scale.quality,a.quality,b.quality];
        detail.gains=[scale.gain,a.gain,b.gain];
        if(scale.quality<.86||Math.min(a.quality,b.quality)<.79)return reject('poor-motion-match');
        if(Math.sign(a.gain)!==Math.sign(scale.gain)||Math.sign(b.gain)!==Math.sign(scale.gain)||Math.abs(a.gain-b.gain)>.16*Math.abs(scale.gain))return reject('inconsistent-scale');
        detail.reason='accepted';
        return scale;
    }
}
