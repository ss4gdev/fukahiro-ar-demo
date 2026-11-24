import {rememberPlane, retainedContact, sameTexture} from '../20261124-brush-alva-placement-v022/placement.mjs';
import {locateSurface} from '../20261121-brush-alva-stable-v010/surface.mjs';

// The initial two-view observation is in map coordinates. Bind metres only
// once an independent scale and a fresh observation of the height agree.
export function storeUnscaled(hit,camera,ref,now) {
    const saved=rememberPlane(hit,camera,null,ref,now);
    return saved ? {saved,ref} : null;
}
export function verifyContact(seed,candidate,gray,k,camera,vertical,meters,now) {
    const saved=seed.saved;
    if(now-saved.observed>1400)return {reason:'expired',discard:true};
    if(!(meters>0) || !vertical)return {reason:'waiting-metric-or-up'};
    if(vertical.dot(saved.up)<.985)return {reason:'changed-normal',discard:true};
    const metricPlane={...saved,meters,matched:now,source:'pre-scale'};
    const contact=retainedContact(metricPlane,camera,meters,now);
    if(!contact || contact.depth*meters<.18 || contact.depth*meters>1.6)return {reason:'viewpoint'};
    const conflicts=hit=>hit.up.dot(saved.up)<.985 ||
        Math.abs(hit.point.clone().sub(saved.point).dot(saved.up))*meters>.015;
    if(candidate && conflicts(candidate))return {reason:'changed-height',discard:true};
    // A raw SDK hit alone cannot confirm the cached height.
    const measured=candidate?.visual ? candidate : locateSurface(seed.ref,gray,k,camera,vertical,meters);
    if(!measured)return {reason:'waiting-height'};
    if(conflicts(measured))return {reason:'changed-height',discard:true};
    if(!sameTexture(saved,gray,k,camera))return {reason:'changed-texture',discard:true};
    return {reason:'confirmed',plane:metricPlane};
}
