export const prompts={
    deskGrain:['木目は見えています。机面を探しています','置きたい木目を枠に入れたまま、スマホを少し横へずらしてください。'],
    move:['机面を捉えました。大きさを確認中','画面の向きを保ち、スマホ全体を横にずらしてください。'],
    turn:['机面を捉えました。向きを保ってください','手首の向きを保ち、スマホ全体を横へ動かしてください。'],
    match:['動きを一度捉えました','同じ木目を映したまま、もう少し横へ動かしてください。']
};

export function recentTurn(poses) {
    const last=poses.at(-1);
    if(!last)return false;
    for(let i=poses.length-2;i>=0 && last.time-poses[i].time<=800;i--){
        const q=poses[i].q;
        if(Math.abs(q.reduce((sum,x,k)=>sum+x*last.q[k],0))<.997)return true;
    }
    return false;
}

// This decision drives text only. The contact and scale checks control the tap.
export function placementCue({available,waiting,tiltCue,side,grain,arc,turn}){
    if(available)return 'ready';
    if(['startup','frames','tracking','sensor','loading'].includes(waiting))return waiting;
    if(tiltCue==='lift'||tiltCue==='lower')return tiltCue;
    if(waiting==='surface'){
        if(side && side!=='noDetail')return side;
        return grain?'deskGrain':side||'surface';
    }
    if(waiting==='scale')return arc?'match':turn?'turn':'move';
    return 'contact';
}
