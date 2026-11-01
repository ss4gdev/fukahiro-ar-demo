// No floor-y=0 fallback: a measured, stable hit on the user's chosen tabletop is required.
export class Placement {
  constructor(){this.reset();this.tracking=false;}
  reset(){this.placed=false;this.position=null;this.candidate=null;this.stableReference=null;this.stableSince=0;this.lastHitAt=0;this.yaw=0;this.baseYaw=0;}
  update(hits,normal,now){
    this.tracking=normal;
    if(!normal){this.candidate=null;this.stableSince=0;return;}
    if(this.placed)return;
    const h=hits.find(h=>h.position&&[h.position.x,h.position.y,h.position.z,h.distance].every(Number.isFinite)&&h.distance>=.12&&h.distance<=2.5);
    if(!h){this.candidate=null;this.stableSince=0;return;}
    const p=h.position,c=this.candidate&&this.stableReference;
    if(!c||Math.hypot(p.x-c.x,p.y-c.y,p.z-c.z)>.025){this.stableSince=now;this.stableReference={...p};}
    this.candidate={x:p.x,y:p.y,z:p.z};this.lastHitAt=now;
  }
  canPlace(now){return this.tracking&&!this.placed&&this.candidate!==null&&now-this.stableSince>=600&&now-this.lastHitAt<200;}
  place(now,yaw){if(!this.canPlace(now))return false;this.position={...this.candidate};this.baseYaw=yaw;this.yaw=0;this.placed=true;return true;}
  rotate(direction){if(this.placed&&this.tracking)this.yaw+=direction*Math.PI/12;}
  front(){if(this.placed&&this.tracking)this.yaw=0;}
}
