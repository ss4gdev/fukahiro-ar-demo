// The visual scale remains unknown here. Only ratios of camera displacement
// within one continuous Alva map are used to decide what gesture to show.
export function createReturnGuide(){
    let motion=null;
    return function guide(base,poses,arcs,now,cameraRight){
        if(!['surface','deskGrain','aimLeft','aimRight','aimNear','move','match'].includes(base))return base;
        const last=poses.at(-1),first=poses[0];
        if(!last || now-last.time>180 || !first)return base;
        if(motion && (first.time>motion.end || now-motion.end>3500))motion=null;
        if(!motion){
            // Record only an outbound motion still current when first observed.
            // The same old arc must not trigger another return instruction.
            const arc=arcs.find(a=>last.time-a.end<220 && last.time>=a.end);
            if(arc){
                const start=poses.find(p=>p.time>=arc.start);
                const end=poses.find(p=>p.time>=arc.end);
                if(start && end){
                    const d=end.p.map((v,i)=>v-start.p[i]);
                    const length2=d.reduce((v,x)=>v+x*x,0);
                    const lateral=d[0]*cameraRight.x+d[1]*cameraRight.y+d[2]*cameraRight.z;
                    if(length2>0 && lateral*lateral>=.55*length2)
                        motion={start:start.p,d,length2,end:end.time,peak:1,returning:false};
                }
            }
        }
        if(!motion)return base==='deskGrain'?'startSweep':base;
        const fraction=last.p.reduce((s,x,i)=>s+(x-motion.start[i])*motion.d[i],0)/motion.length2;
        motion.peak=Math.max(motion.peak,fraction);
        if(motion.peak-fraction>.22)motion.returning=true;
        if(motion.returning && fraction<.32)motion.done=true;
        if(motion.done)return base==='match'?'anotherSweep':base;
        // Keep an explicit target-location cue when the central area is unusable.
        if(['aimLeft','aimRight','aimNear'].includes(base))return base;
        return motion.returning?'returning':'returnSweep';
    };
}
export const sweepPrompts={
    aim:['置きたい木目を中央に映します','高さと向きを保ち、スマホを横へゆっくりひと往復。'],
    startSweep:['木目が見えました。横へひと往復','向きと高さを保ち、スマホ1台幅ほど横にずらして戻します。'],
    move:['机面を捉えました。横へひと往復','置きたい場所を映したまま、スマホ1台幅ほど横にずらして戻します。'],
    returnSweep:['横への動きを捉えました','近づけずに、来た方向へゆっくり戻してください。'],
    returning:['そのまま、元の位置へ','机との距離を保って戻してください。'],
    anotherSweep:['大きさを照合しています','同じ木目を映し、もう一度ゆっくり横へ往復してください。']
};
