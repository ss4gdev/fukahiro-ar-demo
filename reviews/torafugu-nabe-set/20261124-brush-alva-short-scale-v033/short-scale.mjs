import {MetricScale} from '../20261124-brush-alva-intervals-v027/displacement.mjs';

// Filtering and physical fit from the frozen v027 estimator.
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


// Test the additional 720 and 900 ms windows against the same samples the
// production estimator receives. It alone owns mapMeters and the place button.
class ShortWindows {
    constructor() {
        this.arcs = [];
        this.pairs = [];
        this.lastEnd = -Infinity;
    }
    fit(poses, motion, now) {
        if (poses.length < 2 || motion.length < 2) return null;
        const end = Math.min(poses.at(-1).time, motion.at(-1).time);
        if (end <= this.lastEnd || now - end > 150) return null;
        this.lastEnd = end;
        const arcEnd = end - 90;
        this.arcs = this.arcs.filter(arc => arcEnd - arc.end <= 2900);
        this.pairs = this.pairs.filter(pair => end - pair.time <= 550);
        const grid = samples(poses, motion, end, 1170);
        let best = null;
        for (const length of [25, 31]) {
            if (grid.length < length) continue;
            const window = grid.slice(-length);
            const fit = fitArc(window);
            if (!fit) continue;
            const duration = (length - 1) * stepMs;
            const arc = {...fit, duration, start: arcEnd - duration, end: arcEnd,
                from: window[0].from, to: window.at(-1).to};
            for (const first of this.arcs) {
                const gap = arc.start - first.end;
                if (gap < 310 || gap > 2000 || arc.from <= first.to) continue;
                const gain = (arc.gain + first.gain) / 2;
                if (Math.abs(arc.gain - first.gain) > .04 * Math.abs(gain)) continue;
                const quality = Math.min(arc.quality, first.quality);
                if (!best || quality > best.quality) {
                    best = {gain, quality, time: end, durationsMs: [first.duration, duration],
                        gapMs: Math.round(gap)};
                }
            }
            this.arcs.push(arc);
        }
        if (!best) return null;
        const confirmed = this.pairs.some(pair => end - pair.time >= 150 &&
            Math.abs(pair.gain - best.gain) <= .03 * Math.abs(best.gain));
        this.pairs.push(best);
        if (!confirmed) return null;
        return {metersPerMapUnit: Math.abs(best.gain), quality: best.quality,
            durationsMs: best.durationsMs, gapMs: best.gapMs};
    }
}

export class ComparedScale extends MetricScale {
    constructor(elapsed) {
        super();
        this.elapsed = elapsed;
        this.windows = new ShortWindows();
        this.comparison = {placementSource: 'v032', baseline: null, candidate: null,
            leadMs: null, differencePercent: null, invalidatedCandidates: 0, closedBy: null};
    }
    endObservation(reason) {
        this.comparison.closedBy ??= reason;
    }
    breakComparison() {
        const result = this.comparison;
        if (!result || result.closedBy) return;
        if (result.baseline) {
            this.endObservation('tracking-break');
            return;
        }
        if (result.candidate) result.invalidatedCandidates++;
        result.candidate = null;
        this.windows = new ShortWindows();
    }
    reset() {
        this.breakComparison();
        super.reset();
    }
    interrupt() {
        // The v032 estimator keeps a locked scale on a brief gap. Do not
        // pair a later experimental candidate with that pre-gap baseline.
        if (this.mapMeters) this.breakComparison();
        super.interrupt();
    }
    solve(now) {
        const baseline = super.solve(now);
        const result = this.comparison;
        if (result.closedBy) return baseline;
        if (baseline && !result.baseline) {
            result.baseline = {ms: this.elapsed(), metersPerMapUnit: baseline,
                method: this.diagnostics.lastAccepted?.method};
        }
        if (!result.candidate) {
            const candidate = this.windows.fit(this.poses, this.motion, now);
            if (candidate) result.candidate = {...candidate, ms: this.elapsed()};
        }
        if (result.baseline && result.candidate) {
            result.leadMs = result.baseline.ms - result.candidate.ms;
            result.differencePercent = 100 * (result.candidate.metersPerMapUnit /
                result.baseline.metersPerMapUnit - 1);
            this.endObservation('paired');
        }
        return baseline;
    }
}

export function comparisonText(trial) {
    const {baseline, candidate, differencePercent} = trial.scaleComparison;
    const seconds = ms => (ms / 1000).toFixed(2) + '秒';
    const ready = trial.events.readyMs;
    const rows = ['配置可能 ' + (ready == null ? '未到達' : seconds(ready)),
        '現行尺度 ' + (baseline ? seconds(baseline.ms) : '未確定'),
        '短い区間の候補 ' + (candidate ? seconds(candidate.ms) : '未確定')];
    if (differencePercent != null) rows.push('現行との倍率差 ' +
        (differencePercent > 0 ? '+' : '') + differencePercent.toFixed(1) + '%');
    return rows.join(' ／ ');
}
