import {pc} from '../20261121-brush-alva-blippar-v007/model.mjs';
import {intersectTable} from '../20261121-brush-alva-blippar-v007/table.mjs';

const holdMs=5000;

// Save the photographed patches on the already verified plane in map coordinates.
export function rememberPlane(hit,camera,meters,reference,now){
    const eye=camera.getPosition().clone(),world=camera.getWorldTransform();
    const offset=hit.point.clone().sub(eye).dot(hit.up);
    const patches=[];
    for(const group of reference.groups){
        const taps=[];
        for(const [x,y,value] of group.taps){
            const ray=world.transformVector(new pc.Vec3(x,y,-1));
            const distance=offset/hit.up.dot(ray);
            if(!(distance>0 && Number.isFinite(distance)))break;
            taps.push({point:ray.mulScalar(distance).add(eye),value});
        }
        if(taps.length===group.taps.length)patches.push({x:group.x,y:group.y,taps,energy:group.e});
    }
    if(patches.length<5)return null;
    return {point:hit.point.clone(),up:hit.up.clone(),eye,forward:camera.forward.clone(),
        meters,patches,observed:now,matched:now};
}

export function retainedContact(saved,camera,meters,now){
    if(!saved || meters!==saved.meters || now-saved.observed>holdMs || now-saved.matched>220)return null;
    if(camera.getPosition().distance(saved.eye)*meters>.05 || camera.forward.dot(saved.forward)<.989)return null;
    const hit=intersectTable(saved.point,saved.up,camera);
    if(!hit || hit.point.distance(saved.point)*meters>.025)return null;
    return hit;
}

function intensity(image,x,y){
    const i=Math.floor(x),j=Math.floor(y);
    if(i<0||j<0||i+1>=image.width||j+1>=image.height)return NaN;
    const u=x-i,v=y-j,p=j*image.width+i,w=image.width,g=image.gray;
    return (1-v)*((1-u)*g[p]+u*g[p+1])+v*((1-u)*g[p+w]+u*g[p+w+1]);
}

export function sameTexture(saved,image,k,camera){
    const view=camera.getWorldTransform().clone().invert(),pixel=new pc.Vec3();
    let count=0;const quadrants=new Set();
    for(const patch of saved.patches){
        let sum=0,squared=0,dot=0;
        for(const tap of patch.taps){
            view.transformPoint(tap.point,pixel);
            if(pixel.z>=0){squared=NaN;break;}
            const value=intensity(image,k.cx-k.fx*pixel.x/pixel.z,k.cy+k.fy*pixel.y/pixel.z);
            sum+=value;squared+=value*value;dot+=value*tap.value;
        }
        const variance=squared-sum*sum/patch.taps.length;
        if(variance>100 && dot/Math.sqrt(variance*patch.energy)>.72){
            count++;
            if(patch.x && patch.y)quadrants.add((patch.x>0?1:0)+(patch.y>0?2:0));
        }
    }
    return count>=Math.max(5,saved.patches.length*.50) && quadrants.size>=2;
}
