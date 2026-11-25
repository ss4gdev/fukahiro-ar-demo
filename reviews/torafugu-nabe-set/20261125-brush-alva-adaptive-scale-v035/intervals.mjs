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
function fitArc(grid, rejected, checkDrift=false) {
    function reject(reason) { if(rejected)rejected(reason); return null; }
    const last=grid.length-1, first=grid[0];
    const path=[[0,0,0]], velocity=[0,0,0], dt=stepMs/1000;
    for (let i=1;i<=last;i++) {
        const row=grid[i], prior=grid[i-1];
        if (Math.abs(row.q.reduce((s,x,k)=>s+x*first.q[k],0))<.997) return reject('rotation');
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
    let vv=0,aa=0,va=0,driftNorm=0;
    const visualDrift=[0,0,0],sensorDrift=[0,0,0];
    for (let i=0;i<optical.length;i++) {
        const u=(i+1)/last, w=u*(1-u)/norm;
        const op=optical[i].map((x,k)=>x-w*optBias[k]);
        const im=inertial[i].map((x,k)=>x-w*imuBias[k]);
        vv+=dot(op,op); aa+=dot(im,im); va+=dot(op,im);
        if(checkDrift){
            const cubic=u*(1-u)*(2*u-1);
            driftNorm+=cubic*cubic;
            for(let k=0;k<3;k++){visualDrift[k]+=cubic*op[k];sensorDrift[k]+=cubic*im[k];}
        }
    }
    if (aa/optical.length<.0015**2 || vv<1e-10) return reject('low-variation');
    const gain=va/vv, quality=va*va/(aa*vv);
    const travel=Math.abs(gain)*Math.max(...grid.map(r=>Math.hypot(...r.p.map((x,k)=>x-first.p[k]))));
    if(!(quality>=.97))return reject('weak-agreement');
    if(!(travel>=.018))return reject('small-travel');
    let driftGain=null;
    if(checkDrift){
        // A linear acceleration bias integrates to a cubic displacement.
        // Remove that component in both sensors and require the remaining
        // motion to independently support the original signed scale.
        const v=vv-dot(visualDrift,visualDrift)/driftNorm;
        const a=aa-dot(sensorDrift,sensorDrift)/driftNorm;
        const c=va-dot(visualDrift,sensorDrift)/driftNorm;
        if(v>1e-10 && a/optical.length>=.0015**2 && c*c>=.98*v*a &&
            Math.abs(c/v-gain)<=.02*Math.abs(gain))driftGain=c/v;
    }
    return {gain,quality,driftGain};
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

// For a pair spanning a longer pause, check the camera path between the
// measured windows in metres using the candidate gain.
function continuousBridge(poses,pair) {
    const start=pair.first.to, stop=pair.second.from;
    if(!poses.length || poses[0].time>start || poses.at(-1).time<stop)return false;
    for(let i=1;i<poses.length;i++) {
        const a=poses[i-1], b=poses[i];
        if(b.time<start)continue;
        if(a.time>stop)break;
        const dt=b.time-a.time;
        const distance=Math.hypot(b.p[0]-a.p[0],b.p[1]-a.p[1],b.p[2]-a.p[2])*Math.abs(pair.gain);
        const rotation=Math.abs(a.q.reduce((sum,v,k)=>sum+v*b.q[k],0));
        if(dt<=0 || dt>110 || distance>.015+1.5*dt/1000 || rotation<.966)return false;
    }
    return true;
}
// Pick starts near a pause or turn in the observed camera path. Normalise
// speed by recent speed so the selection does not assume metres per map unit.
function motionLengths(grid) {
    const last=grid.length-1;
    if(last<30)return [];
    const speeds=[];
    let peak=0;
    for(let i=2;i<=last-2;i++){
        const v=grid[i+2].p.map((x,k)=>x-grid[i-2].p[k]);
        speeds[i]=Math.hypot(...v);
        peak=Math.max(peak,speeds[i]);
    }
    if(!peak)return [];
    const turns=[];
    let change=null;
    for(let i=Math.max(4,last-62);i<=last-26;i++){
        // A hand can speed up or brake without reaching zero velocity.
        // Select the strongest local change of acceleration as a second boundary.
        const jerk=k=>Math.hypot(...grid[k+2].a.map((v,j)=>v-grid[k-2].a[j]));
        const magnitude=jerk(i);
        if(magnitude>.15 && magnitude>=jerk(i-1) && magnitude>jerk(i+1) &&
            (!change || change.magnitude<magnitude))change={length:last-i+1,magnitude};
        const ratio=speeds[i]/peak;
        if(ratio>.45 || speeds[i]>speeds[i-1] || speeds[i]>=speeds[i+1])continue;
        // A sustained flat path is not a second motion. Require a departure.
        if(Math.max(...speeds.slice(i+1,i+9))<peak*.35)continue;
        turns.push({length:last-i+1,ratio});
    }
    const lengths=turns.sort((a,b)=>a.ratio-b.ratio).slice(0,2).map(t=>t.length);
    if(change)lengths.push(change.length);
    return lengths;
}

export class MetricScale extends AdjacentArcScale {
    constructor(extended, elapsed) {
        super();
        this.extended = extended;
        this.elapsed = elapsed;
        this.timing = {reasons: {}, windowRejects:{}, expiredWindows:0, transitions: [], firstUsableMs: null, firstPairMs: null, lock: null};
        this.motionTiming={boundaries:0,accepted:0,driftRejected:0,firstAcceptedMs:null,firstPairMs:null,lock:null};
    }
    note(reason, detail) {
        const log = this.timing;
        const ms = this.elapsed();
        const row = log.reasons[reason] ??= {firstMs: ms, lastMs: ms, frames: 0};
        row.lastMs = ms;
        row.frames++;
        if (this.lastReason !== reason && log.transitions.length < 160)
            log.transitions.push({ms, reason, ...detail});
        this.lastReason = reason;
    }
    reset() {
        super.reset();
        this.motionArcs=[];
        this.motionPairs=[];
        this.adaptiveLock=null;
        this.longPairs=[];
        this.arcs=[];
        this.pairs=[];
        this.lastSampleEnd=-Infinity;
        this.diagnostics.lastAccepted=null;
    }
    interrupt(reason='lost-pose') {
        // Before lock, no evidence (including that in the older estimator)
        // may cross a discontinuity in either stream or a lost camera pose.
        if(this.mapMeters || !this.poses.length && !this.arcs.length) return;
        this.note(reason, {discardedWindows:this.arcs.length});
        const locked=this.adaptiveLock;
        this.reset();
        this.adaptiveLock=locked;
        this.diagnostics.intervalBreaks=(this.diagnostics.intervalBreaks||0)+1;
    }
    pose(time,p,q) {
        if(time-this.poses.at(-1)?.time>110) this.interrupt('pose-gap');
        super.pose(time,p,q);
    }
    acceleration(time,a) {
        if(time-this.motion.at(-1)?.time>80) this.interrupt('motion-gap');
        super.acceleration(time,a);
    }
    solve(now) {
        const original=super.solve(now);
        if(original) {
            this.timing.lock ??= {ms:this.elapsed(), ...this.diagnostics.lastAccepted};
            return original;
        }
        if(this.poses.length<2 || this.motion.length<2) return null;
        const end=Math.min(this.poses.at(-1).time,this.motion.at(-1).time);
        if(end<=this.lastSampleEnd || now-end>150) return null;
        this.lastSampleEnd=end;
        // The smoothing kernel reaches 90 ms on each side. The extra gap
        // also keeps the two intervals from sharing interpolation inputs.
        const arcEnd=end-90;
        const maxGap = this.extended ? 4000 : 2000;
        const beforePrune=this.arcs.length;
        this.arcs=this.arcs.filter(a=>arcEnd-a.end<=maxGap+1560);
        this.timing.expiredWindows+=beforePrune-this.arcs.length;
        this.longPairs=this.longPairs.filter(p=>end-p.time<=550);
        this.pairs=this.pairs.filter(p=>end-p.time<=550);
        const grid=samples(this.poses,this.motion,end,2160);
        const fixedFits=new Map();
        if(!this.adaptiveLock)this.findMotionScale(grid,end,arcEnd,fixedFits);
        let best=null, extendedBest=null;
        let fitted=false, disjoint=false, eligible=false, lastGap=null;
        for(const length of [37,45,53]) {
            if(grid.length<length) continue;
            let failed;
            const cached=fixedFits.get(length);
            const fit=cached ? cached.fit : fitArc(grid.slice(-length),reason=>{failed=reason;});
            if(!fit){
                const reason=cached?.failed||failed;
                const row=this.timing.windowRejects[reason]??={count:0,firstMs:this.elapsed(),lastMs:null};
                row.count++;row.lastMs=this.elapsed();
                continue;
            }
            const arc={...fit,start:arcEnd-(length-1)*stepMs,end:arcEnd,from:grid.at(-length).from,to:grid.at(-1).to};
            fitted=true;
            this.timing.firstUsableMs ??= this.elapsed();
            this.diagnostics.fittedWindows=(this.diagnostics.fittedWindows||0)+1;
            for(const old of this.arcs) {
                const gap=arc.start-old.end;
                if(gap<310 || arc.from<=old.to) continue;
                disjoint=true; lastGap=gap;
                if(gap>maxGap) continue;
                eligible=true;
                const gain=(old.gain+arc.gain)/2;
                if(Math.abs(old.gain-arc.gain)>.04*Math.abs(gain)) continue;
                const quality=Math.min(old.quality,arc.quality);
                const pair={gain,quality,time:end,first:old,second:arc};
                if(gap<=2000) {
                    if(!best || quality>best.quality) best=pair;
                } else if(!extendedBest || quality>extendedBest.quality) extendedBest=pair;
            }
            this.arcs.push(arc);
        }
        if(extendedBest && !continuousBridge(this.poses,extendedBest)){
            extendedBest=null;
            if(!best){this.note('pose-jump-between-windows');return null;}
        }
        if(!best && !extendedBest) {
            const reason = !fitted ? 'no-usable-window' : !disjoint ? 'waiting-independent-window' :
                !eligible ? 'interval-too-old' : 'scale-disagreement';
            this.note(reason, lastGap==null ? {} : {gapMs:Math.round(lastGap)});
            return null;
        }
        this.timing.firstPairMs ??= this.elapsed();
        this.diagnostics.pairedFrames=(this.diagnostics.pairedFrames||0)+1;
        const confirm=(pair,history)=>{
            if(!pair)return false;
            const repeated=history.some(p=>end-p.time>=150 && Math.abs(p.gain-pair.gain)<=.03*Math.abs(pair.gain));
            history.push(pair);
            return repeated;
        };
        const standardReady=confirm(best,this.pairs);
        const extendedReady=confirm(extendedBest,this.longPairs);
        if(!standardReady && !extendedReady) {
            this.note('waiting-repeat');
            return null;
        }
        if(!standardReady) best=extendedBest;
        this.mapMeters=Math.abs(best.gain);
        this.diagnostics.lastAccepted={method:standardReady?'remembered-displacement-arcs':'extended-displacement-arcs',metersPerMapUnit:this.mapMeters,
            quality:best.quality,gapMs:Math.round(best.second.start-best.first.end),
            durationsMs:[best.first,best.second].map(a=>Math.round(a.end-a.start)),offsetMs:0};
        this.timing.lock ??= {ms:this.elapsed(), ...this.diagnostics.lastAccepted};
        return this.mapMeters;
    }

    findMotionScale(grid,end,arcEnd,fixedFits) {
        const durations=motionLengths(grid);
        const stats=this.motionTiming;
        stats.boundaries+=new Set(durations).size;
        this.motionArcs=this.motionArcs.filter(a=>arcEnd-a.end<=5560);
        this.motionPairs=this.motionPairs.filter(p=>end-p.time<=550);
        let best=null;
        for(const length of new Set([...durations,37,45,53])){
            if(length>grid.length)continue;
            const adaptive=durations.includes(length);
            const rows=grid.slice(-length);
            let failed;
            const fit=fitArc(rows,reason=>{failed=reason;},true);
            fixedFits.set(length,{fit,failed});
            if(!fit?.driftGain){
                if(adaptive && fit)stats.driftRejected++;
                continue;
            }
            if(adaptive){stats.accepted++;stats.firstAcceptedMs??=this.elapsed();}
            const arc={gain:fit.driftGain,quality:fit.quality,adaptive,start:arcEnd-(length-1)*stepMs,end:arcEnd,from:rows[0].from,to:rows.at(-1).to};
            const compare=old=>{
                const gap=arc.start-old.end;
                if(gap<310 || gap>4000 || arc.from<=old.to)return;
                const gain=(old.gain+arc.gain)/2;
                if(Math.abs(old.gain-arc.gain)>.04*Math.abs(gain))return;
                const quality=Math.min(old.quality,arc.quality);
                if(best && quality<=best.quality)return;
                const pair={gain,quality,time:end,first:old,second:arc};
                if(continuousBridge(this.poses,pair))best=pair;
            };
            for(const old of this.motionArcs)if(adaptive || old.adaptive)compare(old);
            this.motionArcs.push(arc);
        }
        if(!best)return;
        stats.firstPairMs??=this.elapsed();
        const repeated=this.motionPairs.some(p=>end-p.time>=150 &&
            Math.abs(p.gain-best.gain)<=.03*Math.abs(best.gain));
        this.motionPairs.push(best);
        if(repeated)this.adaptiveLock={ms:this.elapsed(),method:'motion-boundary-arcs',
            metersPerMapUnit:Math.abs(best.gain),quality:best.quality,
            gapMs:Math.round(best.second.start-best.first.end),
            durationsMs:[best.first,best.second].map(a=>Math.round(a.end-a.start))};
        if(this.adaptiveLock)stats.lock??=this.adaptiveLock;
    }
}

