// Durations cue the user's hand. Only the existing tracker can enable placement.
export const slideMs=1500;
const restMs=850;
const cues={
    aim:['机を斜め上から映します','置きたい場所を中央に。レンズからその場所まで約40cmが目安です。'],
    lower:['カメラをもう少し下へ','机の面と奥の縁が見える向きに。水平から約45°下が目安です。'],
    lift:['カメラを少し起こします','机の奥の縁が入るよう、真上から斜め向きにします。'],
    find:['机の木目や縁を映します','向きを保ち、iPhoneを横へ1台分、1〜2秒でゆっくりずらします。'],
    right:['右へゆっくりずらします','カメラの向きはそのまま。約1.5秒でスマホ1台分だけ横へ。'],
    left:['左へゆっくり戻します','同じ向きのまま、約1.5秒でスマホ1台分だけ戻します。'],
    pause:['そこで一度止めます','そのまま同じ場所を映してください。'],
    reacquire:['置きたい場所をもう一度中央に','机の木目や縁も入れて、iPhoneを少し横へずらしてください。'],
    loading:['そのままお待ちください','表示データを読み込んでいます。'],
    check:['そのまま机を映してください','置く位置をもう一度確認しています。'],
    help:['机の別の場所でも試せます','木目や縁のある明るい場所を中央に映してください。下の「再試行」「3Dで見る」も選べます。'],
    ready:['止めて「ここに置く」をタップ','']
};
export function createGuide(){
    let slideStart=null,lastTable=-Infinity,lastPose=-Infinity,lastReady=-Infinity,tiltSince=0,tiltCue='';
    return (now,{pose,table,scale,asset,available,tilt})=>{
        if(pose)lastPose=now;
        if(table)lastTable=now;
        // The z component of device-up is independent of portrait/landscape roll
        // around the back camera's optical axis.
        let correction='';
        if(tilt&&now-tilt.time<600){
            const rad=Math.PI/180;
            const down=Math.asin(Math.cos(tilt.beta*rad)*Math.cos(tilt.gamma*rad))/rad;
            if(down<18)correction='lower';
            if(down>75)correction='lift';
        }
        if(correction!==tiltCue){tiltCue=correction;tiltSince=now;}
        let stage;
        if(available){lastReady=now;stage='ready';}
        else if(now-lastReady<650)stage='check';
        else if(tiltCue&&now-tiltSince>=450)stage=tiltCue;
        else if(scale)stage=table&&!asset?'loading':'reacquire';
        else if(now-lastTable>1000||now-lastPose>650)stage=lastTable===-Infinity?'find':'reacquire';
        else{
            slideStart??=now;
            const elapsed=now-slideStart;
            if(elapsed<slideMs)stage='right';
            else if(elapsed<slideMs+restMs)stage='pause';
            else if(elapsed<2*slideMs+restMs)stage='left';
            else if(elapsed<2*(slideMs+restMs))stage='pause';
            else stage='help';
        }
        if(!['right','left','pause','help'].includes(stage))slideStart=null;
        return stage;
    };
}
export function showGuide(stage){
    const [heading,detail]=cues[stage];
    const box=document.getElementById('instruction');
    if(box.dataset.stage===stage)return;
    box.dataset.stage=stage;
    box.hidden=false;
    document.getElementById('instruction-title').textContent=heading;
    document.getElementById('instruction-detail').textContent=detail;
}
