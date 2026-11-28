import {retainedContact} from '../20261124-brush-alva-placement-v022/placement.mjs';
import {verifyContact} from '../20261125-brush-alva-scale-contact-v034/contact.mjs';

// The source trial captures already corroborated, scale-free desk observations
// at most once per 150 ms. Keep the recent views for a short return movement.
export function rememberSurfaceSeed(seed,previous) {
    if (!previous || previous.segment !== seed.segment) return seed;
    const recent = [previous, ...(previous.earlier || [])];
    seed.earlier = recent
        .filter(other => seed.saved.observed - other.saved.observed <= 1400 &&
            seed.saved.up.dot(other.saved.up) >= .985)
        .slice(0,8)
        .map(({saved,ref,segment}) => ({saved,ref,segment}));
    return seed;
}

export function verifySurfaceHistory(seed,candidate,image,k,camera,vertical,meters,now) {
    const current = verifyContact(seed,candidate,image,k,camera,vertical,meters,now);
    // A conflicting observation invalidates this path. An earlier view can
    // help only if the current seed could not establish a fresh observation.
    if (current.reason !== 'viewpoint' && current.reason !== 'waiting-height') return current;

    let best = null, bestDistance = Infinity;
    for (const earlier of seed.earlier || []) {
        const saved = earlier.saved;
        if (earlier.segment !== seed.segment || now-saved.observed > 1400 ||
            saved.up.dot(vertical) < .985) continue;
        const separation = seed.saved.point.clone().sub(saved.point).dot(saved.up);
        if (Math.abs(separation)*meters > .015) continue;
        const contact = retainedContact({...saved,meters,matched:now},camera,meters,now);
        if (!contact || contact.depth*meters < .18 || contact.depth*meters > 1.6) continue;
        const offset = camera.getPosition().clone().sub(saved.eye);
        let distance = offset.length()*meters;
        if (!candidate?.visual) {
            // Re-fitting the height photometrically requires measurable lateral
            // parallax; nearly identical views cannot certify it.
            const pixels = k.fx*Math.hypot(camera.right.dot(offset),camera.up.dot(offset))/contact.depth;
            if (pixels < 5 || pixels > 110) continue;
            distance = Math.abs(pixels-12);
        }
        if (distance < bestDistance) {
            best = earlier;
            bestDistance = distance;
        }
    }
    if (!best) return current;
    const alternative = verifyContact(best,candidate,image,k,camera,vertical,meters,now);
    return alternative.plane ? {...alternative,usedEarlier:true} : current;
}
