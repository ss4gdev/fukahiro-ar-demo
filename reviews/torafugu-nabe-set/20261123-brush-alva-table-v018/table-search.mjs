import {makeReference} from '../20261121-brush-alva-stable-v010/surface.mjs';

// A sparse grain can fall between the nine regular probe locations in a cell.
// Keep the same 5x5 cells around the reticle and the same intensity threshold.
export function tabletopReference(image,k,camera){
    const ref=makeReference(image,k,camera);
    ref.originalCount=ref.groups.length;
    if(ref.originalCount>=8)return ref;
    const {gray,width,height}=image;
    const extra=[];
    const halfX=Math.floor(width*.075/2),halfY=Math.floor(height*.065/2);
    for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++){
        if(ref.groups.some(g=>g.x===x&&g.y===y))continue;
        const cx=Math.round(width*(.5+x*.075)),cy=Math.round(height*(.5+y*.065));
        let peak=900,best=null;
        for(let v=cy-halfY+3;v<=cy+halfY-3;v+=4)for(let u=cx-halfX+3;u<=cx+halfX-3;u+=4){
            let sum=0,square=0;
            for(let dy=-3;dy<=3;dy+=3)for(let dx=-3;dx<=3;dx+=3){
                const value=gray[(v+dy)*width+u+dx];
                sum+=value;square+=value*value;
            }
            const e=square-sum*sum/9;
            if(e>peak){peak=e;best={u,v,mean:sum/9};}
        }
        if(!best)continue;
        const taps=[];
        for(let dy=-3;dy<=3;dy+=3)for(let dx=-3;dx<=3;dx+=3){
            const u=best.u+dx,v=best.v+dy;
            taps.push([(u-k.cx)/k.fx,(k.cy-v)/k.fy,gray[v*width+u]-best.mean]);
        }
        extra.push({x,y,e:peak,taps});
    }
    const groups=ref.groups.concat(extra);
    // An isolated table edge is insufficient support for an interior contact.
    const quadrants=new Set(groups.filter(g=>g.x&&g.y).map(g=>(g.x>0?1:0)+(g.y>0?2:0)));
    if(groups.length>=8&&quadrants.size>=3&&groups.filter(g=>Math.abs(g.x)<=1&&Math.abs(g.y)<=1).length>=2)ref.groups=groups;
    return ref;
}

export function waitStage(t,now){
    if(!t.optics)return 'startup';
    if(now-(t.frameTime??-Infinity)>800)return 'frames';
    if(now-t.lastPose>500)return 'tracking';
    if(now-t.lastTableSeen>650)return 'surface';
    if(!(t.metric.mapMeters>0)){
        if(!t.motionCount||now-t.lastMotionAt>1000)return 'sensor';
        return 'scale';
    }
    return t.ready?'contact':'loading';
}
export const help={
    startup:['カメラと追跡を準備中','利用許可が表示されたら許可してください。'],
    frames:['カメラ映像の更新待ち','映像が動かなければ「再試行」でカメラを開き直してください。'],
    tracking:['カメラの動きを追跡中','置く場所を中央にしたまま、机の縁や周囲が少し入るように構え、ゆっくり横へずらしてください。'],
    surface:['置く場所の机面を確認中','中央の丸を、木目や濃淡が見える天板の内側へ。照明の映り込みは避けてください。'],
    sensor:['動きセンサーの受信待ち','「再試行」で動きの利用を許可してください。'],
    scale:['25cmの尺度を確認中','向きを保ち、横へスマホ1台分を1〜2秒で動かし、一度止めます。'],
    contact:['配置位置を再確認中','先ほど映した机の面を中央に保ってください。'],
    loading:['表示データを読み込み中','机を画面に入れたままお待ちください。']
};
