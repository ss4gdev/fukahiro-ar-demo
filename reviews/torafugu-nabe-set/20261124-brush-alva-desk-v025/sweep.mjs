// These stages pace a single hand movement. Only the tracker can enable placement.
export const directions = {
    sweepRight: ['スマホを右へ', '高さと向きを保って、スマホの幅くらい横へずらします。'],
    sweepStop: ['そこでひと休み', 'カメラを机に向けたまま、一度止めます。'],
    sweepBack: ['左へ戻します', '同じ高さで、元の位置へ戻します。'],
    sweepFinish: ['尺度を照合中', 'そのまま少しお待ちください。'],
    sweepRetry: ['25cmの尺度を確認できませんでした', '「再試行」でやり直すか、「3Dで見る」を選べます。']
};

export function createSweep() {
    let began = null, lastSupport = -Infinity;
    return (now, {supported, pose, sensor, tiltCorrection, scale}) => {
        if (scale || !pose || !sensor || tiltCorrection) {
            began = null;
            lastSupport = -Infinity;
            return null;
        }
        if (supported) {
            began ??= now;
            lastSupport = now;
        }
        if (began === null) return null;
        // A momentary missed plane used to replace the motion cue mid-sweep.
        if (now - lastSupport > 1250) {
            began = null;
            return null;
        }
        const elapsed = now - began;
        if (elapsed < 1400) return 'sweepRight';
        if (elapsed < 1850) return 'sweepStop';
        if (elapsed < 3250) return 'sweepBack';
        if (elapsed < 4200) return 'sweepFinish';
        return 'sweepRetry';
    };
}
