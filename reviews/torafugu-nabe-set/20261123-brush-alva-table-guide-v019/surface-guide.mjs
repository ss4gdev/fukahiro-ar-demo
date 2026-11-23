// Positions refer to the visible, centered object-fit:cover crop of the rear
// camera. Stay near the reticle and below the horizon. Points suggest where
// to aim; the plane solver still has to verify the surface at the reticle.
const regions=[
    {id:'aimLeft',x:.22,y:.54},{id:'aimRight',x:.78,y:.54},{id:'aimNear',x:.50,y:.71}
];
export const aimCues={
    aimLeft:['中央の丸を少し左へ','左側の模様が天板にあれば、その模様を丸に合わせてください。','←'],
    aimRight:['中央の丸を少し右へ','右側の模様が天板にあれば、その模様を丸に合わせてください。','→'],
    aimNear:['中央の丸を少し手前へ','画面下側の模様が天板にあれば、その模様を丸に合わせてください。','↓'],
    noDetail:['天板の模様を探しています','反射を避け、木目や薄い濃淡が見える場所を丸に入れてください。','']
};
export function visibleCrop(width,height,viewWidth,viewHeight){
    const scale=Math.max(viewWidth/width,viewHeight/height);
    const w=viewWidth/scale,h=viewHeight/scale;
    return {x:(width-w)/2,y:(height-h)/2,w,h};
}
function cellHasCorner(image,left,top,width,height){
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
        if(light>9*12&&light<9*242&&sum>0&&det/sum>1100&&det>.045*sum*sum)return true;
    }
    return false;
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
        let textured=0;
        for(let row=0;row<3;row++)for(let col=0;col<3;col++){
            const left=crop.x+crop.w*(x-w/2)+col*stepX,top=crop.y+crop.h*(y-h/2)+row*stepY;
            if(cellHasCorner(image,left,top,stepX,stepY))textured++;
        }
        // Sparse map points can cover just one cell even when the camera
        // clearly shows detail throughout the rest of this region.
        return {id,score:textured+(textured>=5&&cells.size>0?1:0)};
    }).sort((a,b)=>b.score-a.score);
    const [best,next]=scores;
    return {choice:best.score>=6&&best.score-next.score>=2?best.id:'noDetail',
        cells:Object.fromEntries(scores.map(r=>[r.id,r.score]))};
}
export class SurfaceGuide{
    constructor(){this.reset();}
    reset(){this.choice=null;this.count=0;this.last=-Infinity;this.stable=null;}
    observe(now,points,crop,image){
        const result=nearbyDetail(points,crop,image),choice=result.choice;
        if(choice!==this.choice||now-this.last>600){
            this.choice=choice;this.since=now;this.count=0;this.stable=null;
        }
        this.last=now;this.count++;
        if(this.count>=3&&now-this.since>=400)this.stable=choice;
        return result.cells;
    }
    current(now){return now-this.last<=550?this.stable:null;}
}
