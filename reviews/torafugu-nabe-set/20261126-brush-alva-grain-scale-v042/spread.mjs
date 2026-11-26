import {GrainTracks} from '../20261126-brush-alva-grain-tracks-v041/grain-tracks.mjs';

// On the 5 × 5 grid, centre-line cells support the count but do not vote
// for either adjacent quadrant. A single row or diagonal cannot pass.
export function coversTable(tracks) {
    if (tracks.length < 5) return false;
    const quadrants = new Set();
    for (const {cell} of tracks) {
        const x = cell % 5 - 2;
        const y = Math.floor(cell / 5) - 2;
        if (x && y) quadrants.add((x > 0 ? 1 : 0) + (y > 0 ? 2 : 0));
    }
    return quadrants.size >= 3;
}

export class SpreadTracks extends GrainTracks {
    fork() {
        const copy = new SpreadTracks(this.mode, null);
        copy.tracks = this.tracks.slice();
        copy.lastCheck = this.lastCheck;
        return copy;
    }

    update(fresh, image, k, camera, up, now) {
        const candidate = super.update(fresh, image, k, camera, up, now);
        if (candidate === fresh) return fresh;
        if (coversTable(this.tracks)) {
            if (this.stats && !this.stats.finished) this.stats.spreadAccepted++;
            return candidate;
        }
        if (this.stats && !this.stats.finished) this.stats.spreadFallback++;
        this.tracks = [];
        return fresh;
    }
}
