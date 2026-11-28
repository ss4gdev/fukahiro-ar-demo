// Fit observed camera positions to twice-integrated, gravity-free acceleration
// at the original camera times. The parent estimator still handles other motion.
const zero=()=>[0,0,0];
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const length=a=>Math.hypot(...a);
const dist=(a,b)=>Math.hypot(...a.map((x,k)=>x-b[k]));

function world(q,v){
    const [x,y,z,w]=q,[a,b,c]=v,tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);
    return [a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];
}

// Each row records exactly which raw IMU readings contributed. Local
// increments are independent of all prior rows' positions and velocities.
function increments(poses,motion,offset){
    let cursor=0;
    const rows=[{...poses[0]}];
    for(let i=1;i<poses.length;i++){
        const prior=poses[i-1],pose=poses[i],start=prior.time+offset,end=pose.time+offset;
        const dt=end-start,sign=dot(prior.q,pose.q)<0?-1:1;
        if(dt<=0 || dt>100 || Math.abs(dot(prior.q,pose.q))<.998)return null;
        while(cursor+1<motion.length && motion[cursor+1].time<=start)cursor++;
        if(motion[cursor].time>start)return null;
        const first=cursor, dv=zero(),dx=zero();
        let left=start;
        while(left<end){
            const ma=motion[cursor],mb=motion[cursor+1];
            if(!mb || mb.time<=ma.time || mb.time-ma.time>65)return null;
            const right=Math.min(mb.time,end);
            const acceleration=t=>{
                const u=(t-ma.time)/(mb.time-ma.time),w=(t-start)/dt;
                const q=prior.q.map((v,k)=>v+w*(sign*pose.q[k]-v));
                const norm=length(q);
                return world(q.map(v=>v/norm),ma.a.map((v,k)=>v+u*(mb.a[k]-v)));
            };
            const a=acceleration(left),b=acceleration(right),step=(right-left)/1000;
            for(let k=0;k<3;k++){
                dx[k]+=dv[k]*step+step*step*(2*a[k]+b[k])/6;
                dv[k]+=step*(a[k]+b[k])/2;
            }
            left=right;
            if(left===mb.time && left<end)cursor++;
        }
        rows.push({...pose,dv,dx,imuFrom:first,imuTo:cursor+1});
    }
    return rows;
}

// Fit away unknown initial position and velocity. On the combined path
// also remove a quadratic term, which absorbs constant accelerometer bias.
function fit(rows,begin,end,removeBias){
    if(end-begin<7)return null;
    const duration=(rows[end].time-rows[begin].time)/1000,n=end-begin+1;
    const x=zero(),v=zero(),data=[],basis=[[],[],[]];
    let travel=0;
    for(let i=begin;i<=end;i++){
        const row=rows[i],u=(row.time-rows[begin].time)/(1000*duration);
        if(i>begin){
            const dt=(row.time-rows[i-1].time)/1000;
            for(let k=0;k<3;k++){x[k]+=dt*v[k]+row.dx[k];v[k]+=row.dv[k];}
        }
        travel=Math.max(travel,dist(row.p,rows[begin].p));
        data.push([...row.p,...x]);
        basis[0].push(1);basis[1].push(u);basis[2].push(u*u);
    }
    const terms=removeBias?3:2;
    for(let j=0;j<terms;j++){
        const b=basis[j];
        for(let k=0;k<j;k++){
            const c=dot(b,basis[k]);
            for(let i=0;i<n;i++)b[i]-=c*basis[k][i];
        }
        const norm=length(b);
        if(norm<1e-6)return null;
        for(let i=0;i<n;i++)b[i]/=norm;
        const coefficients=[0,0,0,0,0,0];
        for(let i=0;i<n;i++)for(let k=0;k<6;k++)coefficients[k]+=b[i]*data[i][k];
        for(let i=0;i<n;i++)for(let k=0;k<6;k++)data[i][k]-=b[i]*coefficients[k];
    }
    let pp=0,aa=0,pa=0;
    for(const d of data)for(let k=0;k<3;k++){pp+=d[k]*d[k];aa+=d[k+3]*d[k+3];pa+=d[k]*d[k+3];}
    if(pp<=1e-10 || aa/n<.0015**2)return null;
    const gain=pa/pp,quality=pa*pa/(pp*aa);
    if(!Number.isFinite(gain)||Math.abs(gain)*travel<.018)return null;
    return {gain,quality,mean:v.map(a=>a/duration)};
}

function pair(rows,split){
    const last=rows.length-1;
    let start=split+1;
    while(start+1<last && rows[start+1].imuFrom<=rows[split].imuTo)start++;
    if(start>=last || rows[start+1].imuFrom<=rows[split].imuTo)return null;
    const first=fit(rows,0,split,false),second=fit(rows,start,last,false);
    if(!first||!second||Math.min(first.quality,second.quality)<.985)return null;
    const excitation=dist(first.mean,second.mean);
    if(Math.min(length(first.mean),length(second.mean))<.12 || excitation<.32 ||
        excitation<.65*Math.max(length(first.mean),length(second.mean)))return null;
    const whole=fit(rows,0,last,true);
    if(!whole || whole.quality<.985)return null;
    const gains=[first.gain,second.gain,whole.gain];
    if(Math.max(...gains)-Math.min(...gains)>.035*Math.abs(whole.gain))return null;
    for(let i=1;i<=last;i++){
        if(dist(rows[i-1].p,rows[i].p)*Math.abs(whole.gain)>.015+1.5*(rows[i].time-rows[i-1].time)/1000)return null;
    }
    return {gain:whole.gain,quality:Math.min(first.quality,second.quality,whole.quality),
        split,secondStart:start,range:[rows[0].time,rows[last].time]};
}

function candidate(poses,motion){
    if(poses.length<17||motion.length<20)return null;
    const latest=motion.at(-1).time;
    // Reserve IMU samples for both sides of the independent clock check.
    const usable=poses.filter(p=>p.time+35<=latest && p.time>=latest-1350 && p.time-35>=motion[0].time);
    if(usable.length<17 || usable.at(-1).time-usable[0].time<700 ||
        usable.some(p=>Math.abs(dot(p.q,usable[0].q))<.997))return null;
    const rows=increments(usable,motion,0);
    if(!rows)return null;
    const last=rows.length-1;
    // Split by elapsed time; camera frame rates vary across phones.
    const middle=(rows[0].time+rows[last].time)/2;
    const split=rows.findIndex(r=>r.time>=middle);
    if(split<8)return null;
    // A change in acceleration can occur off-centre in the user's gesture.
    // Keep both disjoint clips long enough for at least eight observations.
    let winner=null;
    for(const shift of [0,-.1,.1,-.18,.18]){
        const pivot=split+Math.round(last*shift);
        if(pivot<7 || pivot>last-8)continue;
        const match=pair(rows,pivot);
        if(match && (!winner || match.quality>winner.quality))winner=match;
    }
    if(!winner)return null;
    // A material timing error produces an apparently plausible scale when
    // the hand accelerates. Check the curvature fit with shifted clocks.
    for(const offset of [-35,35]){
        const shifted=increments(usable,motion,offset);
        const fitShift=shifted && fit(shifted,0,last,true);
        if(!fitShift || fitShift.quality>winner.quality+.010 ||
            Math.abs(fitShift.gain/winner.gain-1)>.11)return null;
    }
    return winner;
}

export function withFastScale(Parent){
    return class FastScale extends Parent {
        reset(){super.reset();this.fastPrevious=[];this.fastTime=-Infinity;}
        solve(now){
            const legacy=super.solve(now);
            if(legacy || this.adaptiveLock || this.windowLock)return legacy;
            const end=Math.min(this.poses.at(-1)?.time??-Infinity,this.motion.at(-1)?.time??-Infinity);
            if(now-end>150 || end-this.fastTime<45)return legacy;
            this.fastTime=end;
            const found=candidate(this.poses,this.motion);
            if(!found)return legacy;
            this.fastPrevious=this.fastPrevious.filter(o=>end-o.time<=500);
            const confirmed=this.fastPrevious.some(old=>end-old.time>=150 && found.range[1]-old.range[1]>=150 &&
                Math.abs(old.gain-found.gain)<=.02*Math.abs(found.gain));
            this.fastPrevious.push({...found,time:end});
            if(!confirmed)return legacy;
            this.mapMeters=Math.abs(found.gain);
            this.diagnostics.lastAccepted={method:'independent-raw-displacement',quality:found.quality,
                metersPerMapUnit:this.mapMeters,offsetMs:0};
            return this.mapMeters;
        }
    };
}
