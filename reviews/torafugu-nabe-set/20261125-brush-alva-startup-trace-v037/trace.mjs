// Keep the ordered estimator inputs for this attempt in RAM. Serialization
// happens after AR ends. Times use milliseconds since the AR button press.
export function createTrace(start) {
    const rows = [];
    const data = {format: 1, rows, endReason: null};
    let origin;
    function append(now, kind, sampleTime, values = []) {
        if (data.endReason) return;
        if (now-start >= 60000 || rows.length >= 12000) {
            finish('limit', now);
            return;
        }
        rows.push([kind, now-start, sampleTime-start, ...values]);
    }
    function finish(reason, now) {
        if (data.endReason) return;
        data.endReason = reason;
        data.endMs = now-start;
    }
    return {
        data, finish,
        acceleration(now, time, a) { append(now, 'a', time, a); },
        pose(now, time, p, q) {
            if (data.endReason) return;
            origin ??= p.slice();
            append(now, 'p', time, [...p.map((v, i) => v-origin[i]), ...q]);
        },
        interrupt(now) { append(now, 'interrupt', now); },
        reset(now) { append(now, 'reset', now); origin = null; }
    };
}
