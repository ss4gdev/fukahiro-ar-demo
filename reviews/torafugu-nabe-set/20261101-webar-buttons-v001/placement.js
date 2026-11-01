const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
const median=values=>{const a=[...values].sort((x,y)=>x-y),i=Math.floor(a.length/2);return a.length%2?a[i]:(a[i-1]+a[i])/2;};
const midpoint=points=>Object.fromEntries(['x','y','z'].map(axis=>[axis,median(points.map(p=>p[axis]))]));
const valid=h=>h.position&&[h.position.x,h.position.y,h.position.z,h.distance].every(Number.isFinite)&&h.distance>=.12&&h.distance<=2.5;
// Nearby rays are a fallback only when at least two agree; no invented floor plane.
export function selectHit(hits){
  const points=hits.filter(valid),center=points.find(h=>(h.ray??0)===0);
  if(center)return center.position;
  let best=[],ambiguous=false;
  for(const h of points){
    const cluster=points.filter(p=>dist(p.position,h.position)<=.03&&Math.abs(p.position.y-h.position.y)<=.015);
    if(new Set(cluster.map(p=>p.ray)).size<2)continue;
    if(cluster.length>best.length){best=cluster;ambiguous=false;}
    else if(cluster.length===best.length&&dist(midpoint(cluster.map(p=>p.position)),midpoint(best.map(p=>p.position)))>.03)ambiguous=true;
  }
  return best.length&&!ambiguous?midpoint(best.map(h=>h.position)):null;
}
export class Placement {
  constructor(){this.reset();}
  reset(){this.tracking=false;this.placed=false;this.position=null;this.candidate=null;this.samples=[];this.lastHitAt=-Infinity;this.lastSampleAt=-Infinity;this.freshFor=150;this.quality=false;this.yaw=0;this.baseYaw=0;}
  update(hits,normal,now){
    this.tracking=normal;
    if(!normal){this.samples=[];this.candidate=null;this.quality=false;this.lastHitAt=-Infinity;this.lastSampleAt=-Infinity;return;}
    if(this.placed)return;
    this.samples=this.samples.filter(s=>now-s.t<=600);
    const raw=selectHit(hits);
    if(!raw){if(now-this.lastHitAt>this.freshFor)this.quality=false;if(!this.samples.length)this.candidate=null;return;}
    if(now-this.lastSampleAt>=25){this.samples.push({p:{...raw},t:now});this.lastSampleAt=now;}
    const gaps=this.samples.slice(1).map((s,i)=>s.t-this.samples[i].t);
    this.freshFor=gaps.length?Math.min(350,Math.max(150,median(gaps)*1.8)):150;
    const mid=midpoint(this.samples.map(s=>s.p));
    const inliers=this.samples.filter(s=>dist(s.p,mid)<=.03&&Math.abs(s.p.y-mid.y)<=.015);
    this.candidate=midpoint(inliers.length?inliers.map(s=>s.p):[raw]);
    const currentAgrees=dist(raw,this.candidate)<=.035&&Math.abs(raw.y-this.candidate.y)<=.02;
    this.lastHitAt=now;
    // Require elapsed stable observations, not five frames within 400 ms (which deadlocked
    // below 10 FPS). Keep consensus, motion and height checks; never invent a placement.
    const drift=inliers.length>=3?dist(midpoint(inliers.slice(0,2).map(s=>s.p)),midpoint(inliers.slice(-2).map(s=>s.p))):Infinity;
    this.quality=currentAgrees&&inliers.length>=3&&inliers.length/this.samples.length>=.8&&inliers.at(-1).t-inliers[0].t>=180&&drift<=.025&&gaps.every(g=>g<=300);
  }
  canPlace(now){return this.tracking&&!this.placed&&!!this.candidate&&this.quality&&now-this.lastHitAt<=this.freshFor;}
  hasCandidate(now){return this.tracking&&!this.placed&&!!this.candidate&&now-this.lastHitAt<=this.freshFor;}
  place(now,yaw){if(!this.canPlace(now))return false;this.position={...this.candidate};this.baseYaw=yaw;this.yaw=0;this.placed=true;return true;}
  rotate(direction){if(this.placed&&this.tracking)this.yaw+=direction*Math.PI/12;}
  front(){if(this.placed&&this.tracking)this.yaw=0;}
}
