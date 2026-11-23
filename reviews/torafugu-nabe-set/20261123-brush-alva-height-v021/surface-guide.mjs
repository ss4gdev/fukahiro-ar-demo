// Positions refer to the visible, centered object-fit:cover crop of the rear
// camera. Stay near the reticle and below the horizon. Points suggest where
// to aim; the plane solver still has to verify the surface at the reticle.
const regions=[
    {id:'aimLeft',x:.22,y:.54},{id:'aimRight',x:.78,y:.54},{id:'aimNear',x:.50,y:.71}
];
export const aimCues={
    aimLeft:['左の黄色い印に、中央の丸を合わせます','印が天板の上にあることを確かめてください。','←'],
    aimRight:['右の黄色い印に、中央の丸を合わせます','印が天板の上にあることを確かめてください。','→'],
    aimNear:['手前の黄色い印に、中央の丸を合わせます','印が天板の上にあることを確かめてください。','↓'],
    noDetail:['白い枠に机の模様を入れます','木目が小さすぎるときは少し近づけます。ぼやけたら少し離してください。','']
};
export const frameCues={
    aim:['白い枠に、置きたい場所を映します','机を斜め上から。木目が見分けられる高さで構えます。'],
    find:['白い枠に天板の模様を入れます','木目の分かれ目や小さな色むらが目安です。向きを保ち、ゆっくり横へずらします。'],
    tracking:['置きたい所の木目を白い枠に入れます','机の奥の縁も画面に入れ、iPhoneを少し横へずらします。'],
    surface:['白い枠の中で机面を確認中','水色の小さな丸は、カメラが拾った模様の候補です。'],
    reacquire:['置きたい場所を白い枠へ','机の上の模様が映るように構え、ゆっくり横へずらします。'],
    right:['大きさを確認中 · 右へゆっくり','同じ木目を枠内に映したまま、iPhoneを横へ1台分ずらします。'],
    left:['大きさを確認中 · 左へゆっくり','同じ木目を枠内に映したまま、iPhoneを元の位置へ戻します。'],
    pause:['そこで一度止めます','同じ場所を枠内に映したまま、次の案内を待ちます。'],
    scale:['大きさを確認中','同じ木目を枠内に映したまま、横へ1台分を1〜2秒で動かし、一度止めます。']
};

export const heightCues={
    grainVisible:['模様が見えています。この高さで','構えた向きを保って少し横へずらすと、机の面を確認できます。'],
    levelSweep:['この高さで、横にひと往復','大きさを確認中です。横へスマホ1台分ゆっくりずらし、一度止めて戻します。']
};
// This brief grace period only changes the prompt. A current surface hit is
// still required by usableContact() before the placement button can activate.
export function heightCue(now,t,stage){
    if(t.metric.mapMeters>0||now-t.lastPose>220||['lower','lift','ready','sensor','frames','loading'].includes(stage))return null;
    if(now-t.lastTableSeen<=1500 && t.motionCount>0 && now-t.lastMotionAt<=1000)return 'levelSweep';
    if(['find','surface','noDetail','reacquire'].includes(stage)&&t.centralSample?.points.length
        &&now-t.centralSample.time<=380)return 'grainVisible';
    return null;
}
export function visibleCrop(width,height,viewWidth,viewHeight){
    const scale=Math.max(viewWidth/width,viewHeight/height);
    const w=viewWidth/scale,h=viewHeight/scale;
    return {x:(width-w)/2,y:(height-h)/2,w,h};
}
function findCorner(image,left,top,width,height){
    const {gray,width:stride}=image;
    for(let y=Math.ceil(top)+3;y<top+height-3;y+=4)for(let x=Math.ceil(left)+3;x<left+width-3;x+=4){
        let xx=0,xy=0,yy=0,light=0;
        for(let dy=-2;dy<=2;dy+=2)for(let dx=-2;dx<=2;dx+=2){
            const i=(y+dy)*stride+x+dx;
            const gx=gray[i+1]-gray[i-1],gy=gray[i+stride]-gray[i-stride];
            xx+=gx*gx;yy+=gy*gy;xy+=gx*gy;light+=gray[i];
        }
        // Variation along both axes, not only along a straight edge.
        const sum=xx+yy,det=xx*yy-xy*xy;
        if(light>9*12&&light<9*242&&sum>0&&det/sum>1100&&det>.045*sum*sum)return {x,y};
    }
    return null;
}
function nearbyDetail(points,crop,image){
    const scores=regions.map(({id,x,y})=>{
        const cells=new Set(),w=.32,h=.18;
        for(const p of points){
            const col=Math.floor((((p.x-crop.x)/crop.w-x)/w+.5)*3);
            const row=Math.floor((((p.y-crop.y)/crop.h-y)/h+.5)*3);
            if(col>=0&&col<3&&row>=0&&row<3)cells.add(row*3+col);
        }
        const stepX=crop.w*w/3,stepY=crop.h*h/3;
        let textured=0,feature=null,bestDistance=Infinity;
        for(let row=0;row<3;row++)for(let col=0;col<3;col++){
            const left=crop.x+crop.w*(x-w/2)+col*stepX,top=crop.y+crop.h*(y-h/2)+row*stepY;
            const corner=findCorner(image,left,top,stepX,stepY);
            if(!corner)continue;
            textured++;
            const u=(corner.x-crop.x)/crop.w,v=(corner.y-crop.y)/crop.h;
            const distance=(u-x)**2+(v-y)**2;
            if(distance<bestDistance){bestDistance=distance;feature={u,v};}
        }
        // Sparse map points can cover just one cell even when the camera
        // clearly shows detail throughout the rest of this region.
        return {id,feature,score:textured+(textured>=5&&cells.size>0?1:0)};
    }).sort((a,b)=>b.score-a.score);
    const [best,next]=scores;
    return {feature:best.feature,choice:best.score>=6&&best.score-next.score>=2?best.id:'noDetail',
        cells:Object.fromEntries(scores.map(r=>[r.id,r.score]))};
}
export class SurfaceGuide{
    constructor(){this.reset();}
    reset(){this.choice=null;this.count=0;this.last=-Infinity;this.stable=null;this.feature=null;}
    observe(now,points,crop,image){
        const result=nearbyDetail(points,crop,image),choice=result.choice;
        if(choice!==this.choice||now-this.last>600){
            this.choice=choice;this.since=now;this.count=0;this.stable=null;
        }
        this.last=now;this.count++;this.feature=choice==='noDetail'?null:result.feature;
        if(this.count>=3&&now-this.since>=400)this.stable=choice;
        return result.cells;
    }
    current(now){return now-this.last<=550?this.stable:null;}
}

// The center tap of each 3x3 sample is the location the current reference
// actually sampled. Display up to three separated candidates on this frame.
export function centralFeatures(groups,k,crop){
    const points=[];
    for(const group of [...groups].sort((a,b)=>b.e-a.e)){
        const [x,y]=group.taps[4];
        const u=(k.cx+k.fx*x-crop.x)/crop.w,v=(k.cy-k.fy*y-crop.y)/crop.h;
        if(u<.04||u>.96||v<.06||v>.94)continue;
        if(points.every(p=>Math.hypot(u-p.u,v-p.v)>.07))points.push({u,v});
        if(points.length===3)break;
    }
    return points;
}
