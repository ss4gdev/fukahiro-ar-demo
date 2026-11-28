// Twice-integrate the measured gravity-free acceleration at each exposure.
// Differences from a chord remove an unknown translation and initial velocity.
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const norm=a=>Math.hypot(...a);
const delta=(a,b)=>a.map((v,k)=>v-b[k]);
const qdot=(a,b)=>dot(a,b)+a[3]*b[3];
function rotate(q,v){
    const [x,y,z,w]=q,[a,b,c]=v;
    const tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);
    return [a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];
}
function trajectory(poses,imu,lag){
    let j=0;
    const v=[0,0,0],x=[0,0,0],rows=[{...poses[0],x:x.slice()}];
    for(let i=1;i<poses.length;i++){
        const prev=poses[i-1],p=poses[i],lo=prev.time+lag,hi=p.time+lag;
        const same=qdot(prev.q,p.q);
        if(hi-lo>110||hi<=lo||Math.abs(same)<.999)return null;
        while(j+1<imu.length && imu[j+1].time<=lo)j++;
        let t=lo;
        while(t<hi){
            const a=imu[j],b=imu[j+1];
            if(!b || a.time>t || b.time-a.time>65||b.time<=a.time)return null;
            const end=Math.min(b.time,hi);
            const sample=time=>{
                const u=(time-a.time)/(b.time-a.time),w=(time-lo)/(hi-lo),sign=same<0?-1:1;
                const q=prev.q.map((val,k)=>val+(sign*p.q[k]-val)*w);
                const len=norm(q);
                return rotate(q.map(val=>val/len),a.a.map((val,k)=>val+(b.a[k]-val)*u));
            };
            const g=sample(t),h=sample(end),dt=(end-t)/1000;
            for(let k=0;k<3;k++){
                x[k]+=v[k]*dt+dt*dt*(2*g[k]+h[k])/6;
                v[k]+=(g[k]+h[k])*dt/2;
            }
            t=end;
            if(t===b.time && t<hi)j++;
        }
        rows.push({...p,x:x.slice()});
    }
    return rows;
}

// Fit a scale in the presence of unknown position and linear velocity.
// A separate calculation also estimates a constant acceleration error.
function fit(rows,from,to){
    const n=to-from;
    if(n<6)return null;
    const t0=rows[from].time,dt=(rows[to-1].time-t0)/1000;
    let meanU=0;
    const mp=[0,0,0],mx=[0,0,0];
    for(let i=from;i<to;i++){
        const r=rows[i]; meanU+=(r.time-t0)/1000/n;
        for(let k=0;k<3;k++){mp[k]+=r.p[k]/n;mx[k]+=r.x[k]/n;}
    }
    let uu=0,uq=0,meanQ=0;
    const vp=[0,0,0],vx=[0,0,0];
    for(let i=from;i<to;i++){
        const r=rows[i],u=(r.time-t0)/1000-meanU,q=u*u*.5;
        uu+=u*u; uq+=u*q; meanQ+=q/n;
        for(let k=0;k<3;k++){vp[k]+=u*(r.p[k]-mp[k]);vx[k]+=u*(r.x[k]-mx[k]);}
    }
    if(!uu)return null;
    let pp=0,xx=0,px=0,qq=0;
    const qp=[0,0,0],qx=[0,0,0];
    for(let i=from;i<to;i++){
        const r=rows[i],u=(r.time-t0)/1000-meanU,q=.5*u*u-meanQ-u*uq/uu;
        for(let k=0;k<3;k++){
            const p=r.p[k]-mp[k]-u*vp[k]/uu, x=r.x[k]-mx[k]-u*vx[k]/uu;
            pp+=p*p;xx+=x*x;px+=p*x;
            qp[k]+=q*p;qx[k]+=q*x;
        }
        qq+=q*q;
    }
    if(!pp || !xx || !qq)return null;
    const s=px/pp;
    const variableP=pp-dot(qp,qp)/qq,variableX=xx-dot(qx,qx)/qq,variablePX=px-dot(qp,qx)/qq;
    return {s,time:dt,signal:Math.sqrt(xx/n),error:Math.sqrt(Math.max(0,xx-px*s)/n),
        strength:norm(qx)/qq,a:qx.map(z=>z/qq),quality:px*px/(pp*xx),free:variablePX/variableP,
        freeSignal:Math.sqrt(Math.max(0,variableX)/n),
        freeQuality:variablePX*variablePX/(variableP*variableX),
        bias:qx.map((z,k)=>(z-s*qp[k])/qq)};
}
function observedGain(poses,imu) {
    const rows=trajectory(poses,imu,0);
    if(!rows)return null;
    const n=rows.length,spatial=fit(rows,0,n);
    if(!spatial || spatial.quality<.92 || spatial.signal<.003)return null;
    // Along an almost straight slide the two perpendicular visual axes consist
    // mainly of triangulation noise. Establish the slide axis from measured
    // acceleration, after checking that the original full 3D fit is coherent.
    const motion=imu.filter(r=>r.time>=poses[0].time && r.time<=poses.at(-1).time);
    if(!motion.length)return null;
    const peak=motion.reduce((best,r)=>dot(r.a,r.a)>dot(best.a,best.a)?r:best);
    const direction=rotate(poses[0].q,peak.a);
    const magnitude=norm(direction);
    if(magnitude<.24)return null;
    const axis=direction.map(v=>v/magnitude);
    const axial=rows.map(r=>({...r,p:[dot(r.p,axis),0,0],x:[dot(r.x,axis),0,0]}));
    const full=fit(axial,0,n);
    if(!full||full.quality<.994 || full.freeQuality<.80 || full.freeSignal<.0007 ||
        Math.abs(full.s/spatial.s-1)>.035 || Math.abs(full.free/full.s-1)>.20)return null;
    const cut=Math.floor(n/3);
    const left=fit(axial,0,n-cut),right=fit(axial,cut,n);
    if(!left||!right || norm(delta(left.a,right.a))<.19 || Math.min(left.quality,right.quality)<.90 ||
        Math.max(Math.abs(left.s/full.s-1),Math.abs(right.s/full.s-1))>.16)return null;
    return {s:full.s,full,axis,rows:axial};
}
function candidate(poses,imu){
    const end=Math.min(poses.at(-1)?.time??0,imu.at(-1)?.time-35);
    // Start after the most recent gap. No IMU integration spans missing data.
    let imuStart=imu[0]?.time;
    for(let i=imu.length-1;i>0 && imu[i].time>end-1420;i--){
        if(imu[i].time-imu[i-1].time>65){imuStart=imu[i].time;break;}
    }
    const start=Math.max(end-1350,imuStart+35);
    const p=poses.filter(r=>r.time>=start && r.time<=end);
    if(p.length<14||p.at(-1).time-p[0].time<540 || p.some(r=>Math.abs(qdot(r.q,p[0].q))<.997))return null;
    // A new visual map can have a noisy first pose. Compare estimates when
    // one exposure at either endpoint is left out of the full trajectory.
    const found=observedGain(p,imu);
    if(!found)return null;
    const rows=found.rows,n=rows.length;
    const a=fit(rows,1,n),b=fit(rows,0,n-1),s=found.s;
    if(Math.max(Math.abs(a.s/found.full.s-1),Math.abs(b.s/found.full.s-1))>.025)return null;
    const offsets=[];
    for(const lag of [-35,35]){
        const shifted=trajectory(p,imu,lag);
        const g=shifted && fit(shifted.map(r=>({...r,p:[dot(r.p,found.axis),0,0],x:[dot(r.x,found.axis),0,0]})),0,n);
        if(!g || g.quality>found.full.quality+.004 ||
            1-g.quality<.3*(1-found.full.quality) && g.quality>found.full.quality+.00005)return null;
        offsets.push(g);
    }
    if(offsets.some(g=>Math.abs(g.s/s-1)>.095)){
        // Source-frame and motion-event clocks can be a few frames apart.
        // When clock sensitivity is large, only combine the bias-free and
        // uncorrected estimates if they move in opposite directions with lag.
        // Cancel the measured first derivative in lag (units m/map unit).
        const [left,right]=offsets;
        const rawSlope=right.s-left.s,biasSlope=right.free-left.free;
        if(rawSlope*biasSlope>=0)return null;
        const w=biasSlope/(biasSlope-rawSlope);
        if(w<.20||w>.8)return null;
        const combine=g=>w*g.s+(1-w)*g.free;
        const gain=combine(found.full);
        const phases=[left,found.full,right];
        if(phases.some(g=>g.quality<.99 || g.freeQuality<.91 || g.freeSignal<.0012 ||
            Math.abs(combine(g)/gain-1)>.016) || Math.abs(gain/s-1)>.045)return null;
        return {gain,quality:found.full.quality,end:p.at(-1).time};
    }
    return {gain:s,quality:found.full.quality,end:p.at(-1).time};
}
export function withEarlyMetric(Parent){
    return class EarlyMetric extends Parent {
        reset(){super.reset();this.earlyChecks=[];this.earlyLast=-Infinity;}
        solve(now){
            const keep=super.solve(now);
            if(keep||this.windowLock||this.adaptiveLock)return keep;
            if(this.motion.length<16 || this.poses.length<14)return keep;
            const t=Math.min(this.poses.at(-1).time,this.motion.at(-1).time);
            if(now-t>150 || t-this.earlyLast<28)return keep;
            this.earlyLast=t;
            const g=candidate(this.poses,this.motion);
            if(!g)return keep;
            this.earlyChecks=this.earlyChecks.filter(x=>g.end-x.end<350);
            const corroborated=this.earlyChecks.some(x=>g.end-x.end>=100 && Math.abs(x.gain/g.gain-1)<.02);
            this.earlyChecks.push(g);
            if(!corroborated)return keep;
            this.mapMeters=Math.abs(g.gain);
            this.diagnostics.lastAccepted={method:'split-trajectory-curvature',quality:g.quality,metersPerMapUnit:this.mapMeters,offsetMs:0};
            return this.mapMeters;
        }
    };
}
