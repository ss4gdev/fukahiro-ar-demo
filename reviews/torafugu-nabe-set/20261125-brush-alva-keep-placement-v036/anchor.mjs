import {grayscale} from '../20261121-brush-alva-stable-v010/surface.mjs';
import {tabletopReference} from '../20261123-brush-alva-table-v018/table-search.mjs';
import {rememberPlane,sameTexture} from '../20261124-brush-alva-placement-v022/placement.mjs';

// The dish transform remains in its original map. These references only decide
// whether the current camera can draw it there again. They never move the dish.
export class PlacedAnchor {
    constructor(meters,seed){
        this.meters=meters;
        this.references=seed?[seed]:[];
        this.lastSample=-Infinity;
        this.loss=null;
    }
    remember(image,k,camera,stage,now){
        if(this.loss || now-this.lastSample<450)return;
        this.lastSample=now;
        const hit={point:stage.getPosition(),up:stage.up};
        const eye=camera.getPosition(),last=this.references.at(-1);
        if(last && last.eye.distance(eye)*this.meters<.035 && last.forward.dot(camera.forward)>.99)return;
        // Only sample when the centre ray is near the dish on the verified table.
        const normalDot=hit.up.dot(camera.forward);
        if(normalDot>=-.12)return;
        const depth=hit.point.clone().sub(eye).dot(hit.up)/normalDot;
        if(depth<=0 || camera.forward.clone().mulScalar(depth).add(eye).distance(hit.point)*this.meters>.16)return;
        const gray=grayscale(image);
        const ref=rememberPlane(hit,camera,this.meters,tabletopReference(gray,k,camera),now);
        if(!ref)return;
        if(this.references.length===5)this.references.splice(1,1);
        this.references.push(ref);
    }
    interrupt(now,reason){
        if(this.loss){
            if(reason!=='missing-pose')this.loss.verify=true;
            return false;
        }
        this.loss={since:now,verify:reason!=='missing-pose',lastCheck:-Infinity,firstMatch:null,reference:null};
        return true;
    }
    missing(){
        if(this.loss){this.loss.firstMatch=null;this.loss.reference=null;}
    }
    recover(image,k,camera,lastGood,now){
        const loss=this.loss;
        if(!loss)return 'tracking';
        const q=camera.getRotation(),old=lastGood?.q;
        const close=old && camera.getPosition().distance(lastGood.p)*this.meters<.035 &&
            Math.abs(q.x*old.x+q.y*old.y+q.z*old.z+q.w*old.w)>.998;
        if(!loss.verify && close && now-lastGood.time<=180){
            this.loss=null;
            return 'brief';
        }
        loss.verify=true;
        if(now-loss.lastCheck<80)return null;
        if(now-loss.lastCheck>300){loss.reference=null;loss.firstMatch=null;}
        loss.lastCheck=now;
        const gray=grayscale(image);
        const match=this.references.find(ref=>sameTexture(ref,gray,k,camera));
        if(!match || match!==loss.reference){
            loss.reference=match;loss.firstMatch=match?now:null;
            return null;
        }
        if(now-loss.firstMatch<100)return null;
        this.loss=null;
        return 'wood-match';
    }
}
