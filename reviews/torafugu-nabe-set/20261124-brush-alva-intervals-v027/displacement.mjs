import {MetricScale as CurvatureScale} from '../20261123-brush-alva-scale-v016/metric.mjs';

const stepMs = 30;
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

function interpolate(series, time, maxGap, cursor, quaternion = false) {
    while (cursor.i+1 < series.length && series[cursor.i+1].time < time) cursor.i++;
    const a=series[cursor.i], b=series[cursor.i+1];
    if (!b || time<a.time || time>b.time || b.time-a.time>maxGap || b.time<=a.time) return null;
    const w=(time-a.time)/(b.time-a.time);
    const mix=(v,u,sign=1)=>v.map((x,i)=>x+w*(sign*u[i]-x));
    if (!quaternion) return mix(a.a,b.a);
    const sign=a.q.reduce((sum,x,i)=>sum+x*b.q[i],0)<0?-1:1;
    const q=mix(a.q,b.q,sign);
    const norm=Math.hypot(...q);
    return norm>.99?{p:mix(a.p,b.p),q:q.map(x=>x/norm)}:null;
}
function cross(a,b) {
    return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
}
function samples(poses,motion,end,historyMs=3450) {
    const start=Math.max(end-historyMs,poses[0].time,motion[0].time);
    const count=Math.floor((end-start)/stepMs);
    const cp={i:0},cm={i:0},grid=[];
    for (let i=count;i>=0;i--) {
        const t=end-i*stepMs;
        const pose=interpolate(poses,t,110,cp,true), a=interpolate(motion,t,80,cm);
        if (!pose || !a) { grid.length=0; continue; }
        const axis=pose.q.slice(0,3), u=cross(axis,a), v=cross(axis,u);
        const world=a.map((x,k)=>x+2*(pose.q[3]*u[k]+v[k]));
        grid.push({p:pose.p,q:pose.q,a:world,
            from:Math.min(poses[cp.i].time,motion[cm.i].time),
            to:Math.max(poses[cp.i+1].time,motion[cm.i+1].time)});
    }
    // Apply the same symmetric filter to both streams. It attenuates frame-to-
    // frame translation jitter without shifting one stream relative to the other.
    const smooth=[];
    for(let i=3;i<grid.length-3;i++) {
        const row={p:[0,0,0],a:[0,0,0],q:grid[i].q,from:grid[i-3].from,to:grid[i+3].to};
        for(let j=-3;j<=3;j++) {
            const weight=(4-Math.abs(j))/16;
            for(let k=0;k<3;k++) {
                row.p[k]+=weight*grid[i+j].p[k];
                row.a[k]+=weight*grid[i+j].a[k];
            }
        }
        smooth.push(row);
    }
    return smooth;
}

// Remove unknown initial velocity and a constant accelerometer bias in each
// interval. Only the remaining independently observed curvature determines scale.
function fitArc(grid) {
    const last=grid.length-1, first=grid[0];
    const path=[[0,0,0]], velocity=[0,0,0], dt=stepMs/1000;
    for (let i=1;i<=last;i++) {
        const row=grid[i], prior=grid[i-1];
        if (Math.abs(row.q.reduce((s,x,k)=>s+x*first.q[k],0))<.997) return null;
        const position=velocity.map((v,k)=>path[i-1][k]+dt*v+dt*dt*(2*prior.a[k]+row.a[k])/6);
        for (let k=0;k<3;k++) velocity[k]+=dt*(prior.a[k]+row.a[k])/2;
        path.push(position);
    }
    const optical=[],inertial=[], optBias=[0,0,0], imuBias=[0,0,0];
    let norm=0;
    for (let i=1;i<last;i++) {
        const u=i/last, basis=u*(1-u);
        const op=grid[i].p.map((x,k)=>x-first.p[k]-u*(grid[last].p[k]-first.p[k]));
        const im=path[i].map((x,k)=>x-u*path[last][k]);
        optical.push(op); inertial.push(im); norm+=basis*basis;
        for(let k=0;k<3;k++){optBias[k]+=basis*op[k]; imuBias[k]+=basis*im[k];}
    }
    let vv=0,aa=0,va=0;
    for (let i=0;i<optical.length;i++) {
        const u=(i+1)/last, w=u*(1-u)/norm;
        const op=optical[i].map((x,k)=>x-w*optBias[k]);
        const im=inertial[i].map((x,k)=>x-w*imuBias[k]);
        vv+=dot(op,op); aa+=dot(im,im); va+=dot(op,im);
    }
    if (aa/optical.length<.0015**2 || vv<1e-10) return null;
    const gain=va/vv, quality=va*va/(aa*vv);
    const travel=Math.abs(gain)*Math.max(...grid.map(r=>Math.hypot(...r.p.map((x,k)=>x-first.p[k]))));
    return quality>=.97 && travel>=.018 ? {gain,quality} : null;
}

class AdjacentArcScale extends CurvatureScale {
    reset() { super.reset(); this.lastArc=null; }
    solve(now) {
        if(this.mapMeters)return this.mapMeters;
        const due=now-this.lastTry>=240;
        const original=super.solve(now);
        if(!due || this.poses.length<35 || this.motion.length<40) return original;
        const end=Math.min(this.poses.at(-1).time,this.motion.at(-1).time);
        if(now-end>150) {this.lastArc=null; return original;}
        const grid=samples(this.poses,this.motion,end);
        if(original) {
            const check=grid.length>=37 ? fitArc(grid) : null;
            if(!check || Math.abs(Math.abs(check.gain)-original)<=.045*original)return original;
            // A well-resolved position path contradicts the curvature-only scale.
            this.mapMeters=null;
            this.diagnostics.lastAccepted=null;
            this.diagnostics.displacementConflicts=(this.diagnostics.displacementConflicts||0)+1;
        }
        let best=null;
        for(const length of [53,45,37]) {
            if(grid.length<2*length+1) continue;
            const a=fitArc(grid.slice(-2*length-1,-length-1)), b=fitArc(grid.slice(-length));
            if(!a || !b) continue;
            const gain=(a.gain+b.gain)/2;
            if(Math.abs(a.gain-b.gain)>.04*Math.abs(gain)) continue;
            const quality=Math.min(a.quality,b.quality);
            if(!best || best.quality<quality) best={gain,quality,end,intervalMs:(length-1)*stepMs};
        }
        const prev=this.lastArc; this.lastArc=best;
        if(!best || !prev || end-prev.end<150 || end-prev.end>550 ||
            Math.abs(prev.gain-best.gain)>.03*Math.abs(best.gain)) return null;
        this.mapMeters=Math.abs(best.gain);
        this.diagnostics.lastAccepted={method:'two-displacement-arcs',metersPerMapUnit:this.mapMeters,
            quality:best.quality,intervalMs:best.intervalMs,offsetMs:0};
        return this.mapMeters;
    }
}

export class MetricScale extends AdjacentArcScale {
    reset() {
        super.reset();
        this.arcs=[];
        this.pairs=[];
        this.lastSampleEnd=-Infinity;
        this.diagnostics.lastAccepted=null;
    }
    interrupt() {
        // Before lock, no evidence (including that in the older estimator)
        // may cross a discontinuity in either stream or a lost camera pose.
        if(this.mapMeters || !this.poses.length && !this.arcs.length) return;
        this.reset();
        this.diagnostics.intervalBreaks=(this.diagnostics.intervalBreaks||0)+1;
    }
    pose(time,p,q) {
        if(time-this.poses.at(-1)?.time>110) this.interrupt();
        super.pose(time,p,q);
    }
    acceleration(time,a) {
        if(time-this.motion.at(-1)?.time>80) this.interrupt();
        super.acceleration(time,a);
    }
    solve(now) {
        const original=super.solve(now);
        if(original || this.poses.length<2 || this.motion.length<2) return original;
        const end=Math.min(this.poses.at(-1).time,this.motion.at(-1).time);
        if(end<=this.lastSampleEnd || now-end>150) return null;
        this.lastSampleEnd=end;
        // The smoothing kernel reaches 90 ms on each side. The extra gap
        // also keeps the two intervals from sharing interpolation inputs.
        const arcEnd=end-90;
        this.arcs=this.arcs.filter(a=>arcEnd-a.end<=3560);
        this.pairs=this.pairs.filter(p=>end-p.time<=550);
        const grid=samples(this.poses,this.motion,end,1770);
        let best=null;
        for(const length of [37,45,53]) {
            if(grid.length<length) continue;
            const fit=fitArc(grid.slice(-length));
            if(!fit) continue;
            const arc={...fit,start:arcEnd-(length-1)*stepMs,end:arcEnd,from:grid.at(-length).from,to:grid.at(-1).to};
            this.diagnostics.fittedWindows=(this.diagnostics.fittedWindows||0)+1;
            for(const old of this.arcs) {
                const gap=arc.start-old.end;
                if(gap<310 || gap>2000 || arc.from<=old.to) continue;
                const gain=(old.gain+arc.gain)/2;
                if(Math.abs(old.gain-arc.gain)>.04*Math.abs(gain)) continue;
                const quality=Math.min(old.quality,arc.quality);
                if(!best || quality>best.quality) best={gain,quality,time:end,first:old,second:arc};
            }
            this.arcs.push(arc);
        }
        if(!best) return null;
        this.diagnostics.pairedFrames=(this.diagnostics.pairedFrames||0)+1;
        const repeat=this.pairs.some(p=>end-p.time>=150 && Math.abs(p.gain-best.gain)<=.03*Math.abs(best.gain));
        this.pairs.push(best);
        if(!repeat) return null;
        this.mapMeters=Math.abs(best.gain);
        this.diagnostics.lastAccepted={method:'remembered-displacement-arcs',metersPerMapUnit:this.mapMeters,
            quality:best.quality,gapMs:Math.round(best.second.start-best.first.end),
            durationsMs:[best.first,best.second].map(a=>Math.round(a.end-a.start)),offsetMs:0};
        return this.mapMeters;
    }
}

