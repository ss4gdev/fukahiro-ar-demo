// Estimate contrast in neighbourhoods across the field. A bright lamp or one
// dark edge should not determine the exposure gain for every tracking pixel.
function distribution(data,w,h,channels){
    const ranges=[],noise=[];
    const value=(x,y)=>{
        const i=(y*w+x)*channels;
        return channels===1?data[i]:(data[i]+2*data[i+1]+data[i+2])*.25;
    };
    const dx=Math.max(8,Math.floor(w/16)),dy=Math.max(8,Math.floor(h/14));
    for(let y=5;y<h-5;y+=dy)for(let x=5;x<w-5;x+=dx){
        const c=value(x,y);
        const area=[c,value(x-4,y-4),value(x+4,y-4),value(x-4,y+4),value(x+4,y+4)];
        ranges.push(Math.max(...area)-Math.min(...area));
        noise.push(Math.abs(4*c-value(x-1,y)-value(x+1,y)-value(x,y-1)-value(x,y+1)));
    }
    ranges.sort((a,b)=>a-b);noise.sort((a,b)=>a-b);
    return {contrast:ranges[Math.floor(.80*ranges.length)]||0,noise:(noise[Math.floor(.5*noise.length)]||0)*.33};
}

// Only the image supplied to the tracker is changed. The original video
// remains the AR background. Amplify repeatable detail, with a spatial mesh
// for the local mean so a broad illumination gradient does not clip it.
export function createTableFrame(width,height,createGrainFrame){
    const standard=createGrainFrame(width,height), enhanced=new ImageData(width,height);
    const cell=24,cols=Math.ceil(width/cell)+1,rows=Math.ceil(height/cell)+1;
    const means=new Float32Array(cols*rows);
    return image=>{
        const src=image.data,out=enhanced.data,stats=distribution(src,width,height,4);
        // In richly textured views retain the established spatially filtered
        // tracker input as well. Raw fine edges can make the map less stable.
        if(stats.contrast>=13 || stats.noise>Math.max(2.5,stats.contrast*.55))return standard(image);
        const gain=Math.min(6,28/Math.max(5,stats.contrast));
        for(let cy=0;cy<rows;cy++)for(let cx=0;cx<cols;cx++){
            let n=0,sum=0;
            for(let v=-12;v<=12;v+=6)for(let u=-12;u<=12;u+=6){
                const x=Math.min(width-1,Math.max(0,cx*cell+u)),y=Math.min(height-1,Math.max(0,cy*cell+v));
                const i=(y*width+x)*4;
                sum+=(src[i]+2*src[i+1]+src[i+2])*.25;n++;
            }
            means[cy*cols+cx]=sum/n;
        }
        for(let y=0;y<height;y++){
            const cy=Math.floor(y/cell),ty=y/cell-cy;
            for(let x=0;x<width;x++){
                const cx=Math.floor(x/cell),tx=x/cell-cx,j=cy*cols+cx;
                const mean=(1-ty)*(means[j]*(1-tx)+means[j+1]*tx)+ty*(means[j+cols]*(1-tx)+means[j+cols+1]*tx);
                const i=(y*width+x)*4,luma=(src[i]+2*src[i+1]+src[i+2])*.25;
                out[i]=out[i+1]=out[i+2]=128+(luma-mean)*gain+(mean-128)*.4;
                out[i+3]=255;
            }
        }
        return standard(enhanced);
    };
}

// One distinguishable two-dimensional patch per cell. Use raw current-view
// intensities here, never pixels transplanted from an earlier accepted plane.
const offsets=[[-4,-4],[0,-4],[4,-4],[-4,0],[0,0],[4,0],[-4,4],[0,4],[4,4]];
function centeredPatch(gray,w,x,y){
    const a=offsets.map(([dx,dy])=>gray[(y+dy)*w+x+dx]);
    const mean=a.reduce((v,i)=>v+i,0)/a.length;
    return a.map(v=>v-mean);
}
function energy(a){return a.reduce((v,i)=>v+i*i,0);}
function correlation(a,b){
    const ab=a.reduce((v,i,k)=>v+i*b[k],0);
    return ab/Math.sqrt(energy(a)*energy(b))||0;
}

export function wideTableReference(image,k,camera){
    const {width:w,height:h,gray}=image;
    const {noise}=distribution(gray,w,h,1);
    const groups=[],floor=9*Math.max(3.5,noise*2.6)**2;
    for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++){
        const cx=Math.round(w*(.5+x*.135)),cy=Math.round(h*(.5+y*.135));
        const peaks=[];
        for(let oy=-9;oy<=9;oy+=3)for(let ox=-9;ox<=9;ox+=3){
            const u=cx+ox,v=cy+oy;
            if(u<23||v<23||u>=w-23||v>=h-23)continue;
            const a=centeredPatch(gray,w,u,v),e=energy(a);
            if(e<floor)continue;
            // Smallest structure-tensor eigenvalue rewards real corners over
            // a high-contrast but ambiguous straight edge.
            let xx=0,yy=0,xy=0;
            for(const [i,j] of offsets){
                const at=(v+j)*w+u+i, gx=gray[at+1]-gray[at-1],gy=gray[at+w]-gray[at-w];
                xx+=gx*gx;yy+=gy*gy;xy+=gx*gy;
            }
            const corner=.5*(xx+yy-Math.hypot(xx-yy,2*xy));
            if(corner<floor*.05)continue;
            peaks.push({u,v,a,e,rank:Math.min(e,6*corner)});
        }
        peaks.sort((a,b)=>b.rank-a.rank);
        for(const p of peaks.slice(0,4)){
            let alias=-1;
            for(const d of [6,10,14,18]){
                for(const [dx,dy] of [[d,0],[-d,0],[0,d],[0,-d],[d,d],[-d,d]]){
                    alias=Math.max(alias,correlation(p.a,centeredPatch(gray,w,p.u+dx,p.v+dy)));
                }
            }
            if(alias>.965)continue;
            const taps=offsets.map(([dx,dy],i)=>[(p.u+dx-k.cx)/k.fx,(k.cy-p.v-dy)/k.fy,p.a[i]]);
            groups.push({x,y,e:p.e,taps});break;
        }
    }
    return {world:camera.getWorldTransform().clone(),groups,originalCount:groups.length};
}
