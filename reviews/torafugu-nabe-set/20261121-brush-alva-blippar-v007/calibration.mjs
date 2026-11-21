import {pc} from './model.mjs';

const error=message=>{throw Error(message);};
const sourceRimMeters=.250592466102044;
const physicalRimMeters=.25;
function ray(view,point){
    const {fx,fy,cx,cy}=view.k;
    return view.world.transformVector(new pc.Vec3((point.x-cx)/fx,(cy-point.y)/fy,-1)).normalize();
}
function triangulate(first,second,index){
    const a=first.world.getTranslation(),b=second.world.getTranslation();
    const u=ray(first,first.points[index]),v=ray(second,second.points[index]);
    const baseline=b.clone().sub(a),dot=u.dot(v),denom=1-dot*dot;
    if(dot<=0||denom<.0049)error('視点が近すぎます。カメラをもう少し横に移して、2枚目を撮り直してください。');
    const p=baseline.dot(u),q=baseline.dot(v);
    const t=(p-dot*q)/denom,s=(dot*p-q)/denom;
    if(t<=0||s<=0)error('同じ角を同じ順に選んでください。');
    const left=a.add(u.mulScalar(t)),right=b.add(v.mulScalar(s));
    if(left.distance(right)>.009*Math.min(t,s))error('2枚の角の位置が合いません。2枚目で同じ3点を選び直してください。');
    return left.add(right).mulScalar(.5);
}
export function measureDesk(first,second,widthMeters,gravity){
    if(!Number.isFinite(widthMeters)||widthMeters<=0)error('手前の辺の実測値を入力してください。');
    const [a,b,c]=[0,1,2].map(i=>triangulate(first,second,i));
    const ab=b.clone().sub(a),ac=c.clone().sub(a),width=ab.length(),depth=ac.length();
    if(!(width>0&&depth>0)||Math.abs(ab.dot(ac)/(width*depth))>.24)error('直角になる3つの角を選んでください。');
    const right=ab.clone().normalize(),up=new pc.Vec3().cross(right,ac).normalize();
    const eye=second.world.getTranslation();
    if(up.dot(eye.clone().sub(a))<0)up.mulScalar(-1);
    if(gravity&&gravity.dot(up)<.94)error('机の傾きと端末の向きが合いません。平らな机の同じ3点を選び直してください。');
    const back=ac.sub(right.clone().mulScalar(ac.dot(right))).normalize();
    const scale=width/widthMeters*physicalRimMeters/sourceRimMeters;
    return {a,b,c,right,up,back,width,widthMeters,depth:c.clone().sub(a).dot(back),scale};
}
export function deskHit(desk,camera){
    const eye=camera.getPosition(),incidence=-desk.up.dot(camera.forward);
    if(incidence<.12)return null;
    const depth=eye.clone().sub(desk.a).dot(desk.up)/incidence;
    if(depth<=0)return null;
    const point=eye.clone().add(camera.forward.clone().mulScalar(depth));
    const d=point.clone().sub(desk.a),x=d.dot(desk.right)/desk.width,y=d.dot(desk.back)/desk.depth;
    if(x<-.02||x>1.02||y<-.02||y>1.02)return null;
    return {point,depth,up:desk.up};
}

// The still and the tracking pose come from the same processed camera frame.
// Taps are in the full camera image, independent of CSS cropping in live AR.
export function deskGuide(physicalWidth,onComplete){
    const panel=document.getElementById('desk-guide'),still=document.getElementById('desk-still');
    const note=document.getElementById('desk-step'),take=document.getElementById('desk-freeze'),undo=document.getElementById('desk-undo'),again=document.getElementById('desk-again');
    const ctx=still.getContext('2d'),names=['手前の左角','手前の右角','奥の左角'];
    let first=null,view=null,latest=null,sessionGravity=null,finished=false;
    function aim(message){
        view=null;again.hidden=!first;panel.hidden=false;still.hidden=true;undo.hidden=true;take.hidden=false;
        take.disabled=true;latest=null;
        take.textContent=first?'2枚目を止める':'1枚目を止める';
        note.textContent=message||(first?'横に一歩移動し、先ほどと同じ3つの角を映してください。':'机の手前の左右と奥の左角を映し、少し横に動いてください。');
    }
    function draw(){
        ctx.drawImage(view.image,0,0);
        for(const [i,p] of view.points.entries()){
            ctx.beginPath();ctx.arc(p.x,p.y,9,0,Math.PI*2);ctx.fillStyle='#184c37';ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();
            ctx.font='bold 12px sans-serif';ctx.textAlign='center';ctx.fillStyle='#fff';ctx.fillText(String(i+1),p.x,p.y+4);
        }
        note.textContent=(first?'2枚目':'1枚目')+' · '+names[view.points.length]+'をタップ';
    }
    take.onclick=()=>{
        if(!latest||performance.now()-latest.now>350){take.disabled=true;note.textContent='位置を確認中です。ゆっくり横に動いてください。';return;}
        const {image,world,k}=latest,copy=document.createElement('canvas');
        copy.width=still.width=image.width;copy.height=still.height=image.height;
        copy.getContext('2d').drawImage(image,0,0);
        view={image:copy,world:world.clone(),k,points:[]};
        still.hidden=false;take.hidden=true;undo.hidden=false;draw();
    };
    again.onclick=()=>{first=null;aim();};
    undo.onclick=()=>{if(view?.points.length){view.points.pop();draw();}else aim();};
    still.onclick=e=>{
        if(!view)return;
        const box=still.getBoundingClientRect();
        const x=(e.clientX-box.left)*still.width/box.width,y=(e.clientY-box.top)*still.height/box.height;
        view.points.push({x,y});
        if(view.points.length<3){draw();return;}
        if(!first){first=view;aim();return;}
        try{const desk=measureDesk(first,view,physicalWidth,sessionGravity);finished=true;panel.hidden=true;view=first=latest=null;onComplete(desk);}
        catch(err){aim(err.message);}
    };
    aim();
    return {
        frame(image,camera,k,now,vertical){
            if(finished)return;
            sessionGravity=vertical;
            if(view)return;
            latest={image,world:camera.getWorldTransform(),k,now};
            take.disabled=false;
        },
        lost(){if(!finished){latest=null;take.disabled=true;}},
        reset(){finished=false;first=null;sessionGravity=null;aim('机の追跡をやり直します。3つの角を映してください。');},
        dispose(){panel.hidden=true;still.onclick=take.onclick=undo.onclick=again.onclick=null;view=first=latest=null;}
    };
}

export function outlineDesk(desk,camera,visible){
    const canvas=document.getElementById('desk-outline');
    canvas.hidden=!visible;
    if(!visible)return;
    const width=canvas.clientWidth,height=canvas.clientHeight,dpr=Math.min(devicePixelRatio||1,2);
    if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){
        canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    }
    const ctx=canvas.getContext('2d');
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
    const screen=p=>camera.camera.worldToScreen(p);
    const pts=[desk.c,desk.a,desk.b].map(screen);
    // Don't draw a segment through the camera when the user walks past the table.
    if([desk.c,desk.a,desk.b].some(p=>p.clone().sub(camera.getPosition()).dot(camera.forward)<=0))return;
    function path(points,color,thickness){
        ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);
        for(const p of points.slice(1))ctx.lineTo(p.x,p.y);
        ctx.lineWidth=thickness;ctx.strokeStyle=color;ctx.stroke();
    }
    path(pts,'#173f32',4);path(pts,'#bbf3ce',2);
    const start=desk.a.clone().add(desk.back.clone().mulScalar(.12*desk.depth));
    const end=start.clone().add(desk.right.clone().mulScalar(.25*desk.width/desk.widthMeters));
    if(desk.widthMeters>=.25){
        const a=screen(start),b=screen(end);path([a,b],'#142c22',6);path([a,b],'white',3);
        const x=(a.x+b.x)/2,y=(a.y+b.y)/2-7;
        ctx.font='bold 16px sans-serif';ctx.textAlign='center';ctx.lineWidth=4;ctx.strokeStyle='#142c22';ctx.strokeText('25 cm',x,y);ctx.fillStyle='white';ctx.fillText('25 cm',x,y);
    }
}
