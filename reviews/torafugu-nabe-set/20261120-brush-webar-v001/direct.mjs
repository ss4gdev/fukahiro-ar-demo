import * as pc from '../20261117-splatfacto-camera-color-v001/playcanvas.mjs';

const canvas = document.querySelector('#view');
const status = document.querySelector('#status');
const frame = document.querySelector('#frame');
const buttons = [...document.querySelectorAll('button')];
const point = a => new pc.Vec3(...a);
let app;
try {
    app = new pc.Application(canvas, {graphicsDeviceOptions: {
        deviceTypes: ['webgl2'], antialias: false, alpha: false, preserveDrawingBuffer: true
    }});
    app.graphicsDevice.maxPixelRatio = Math.min(devicePixelRatio, 2);
    app.setCanvasResolution(pc.RESOLUTION_AUTO);
    app.scene.gsplat.useTonemap = false;
    app.scene.gsplat.useFog = false;
    app.scene.gsplat.colorUpdateAngle = .1;
    app.scene.exposure = 1;
    const camera = new pc.Entity('Camera');
    camera.addComponent('camera', {clearColor: new pc.Color(0,0,0),nearClip:.01,farClip:1000,
        gammaCorrection:pc.GAMMA_SRGB,toneMapping:pc.TONEMAP_NONE});
    app.root.addChild(camera);
    const views = await (await fetch('./views.json')).json();
    function resize() {
        app.resizeCanvas(Math.round(frame.clientWidth),Math.round(frame.clientHeight));
    }
    new ResizeObserver(resize).observe(frame);
    resize();
    const data = new pc.Asset('鍋セット', 'gsplat', {url:'./nabe-brush.ply'});
    app.assets.add(data);
    await new Promise((resolve,reject)=>{
        data.once('load',resolve);
        data.once('error',reject);
        app.assets.load(data);
    });
    const model = new pc.Entity('Nabe');
    model.addComponent('gsplat', {asset:data,unified:false});
    app.root.addChild(model);
    const centre = new pc.Vec3(-1.85,-3.20,2.8);
    let azimuth=0,elevation=25,distance=76;
    function setView(key) {
        const v=views[key];
        camera.setPosition(point(v.position));
        camera.lookAt(point(v.look),point(v.up));
        camera.camera.fov=v.fov;
        const d=point(v.position).sub(centre);
        distance=d.length();
        elevation=Math.asin(d.z/distance)*180/Math.PI;
        azimuth=Math.atan2(d.y,d.x);
    }
    function orbit() {
        const e=elevation*Math.PI/180;
        camera.setPosition(centre.x+distance*Math.cos(e)*Math.cos(azimuth),
            centre.y+distance*Math.cos(e)*Math.sin(azimuth),centre.z+distance*Math.sin(e));
        camera.lookAt(centre,pc.Vec3.FORWARD.clone().mulScalar(-1));
    }
    setView('e25-a195');
    app.start();
    const pointers=new Map();
    let prevDistance=0;
    canvas.addEventListener('pointerdown',e=>{
        canvas.setPointerCapture(e.pointerId);
        pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
        prevDistance=0;
    });
    canvas.addEventListener('pointermove',e=>{
        const previous=pointers.get(e.pointerId);
        if(!previous)return;
        pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
        if(pointers.size===1){
            azimuth-=(e.clientX-previous.x)*.008;
            elevation=Math.max(2,Math.min(85,elevation+(e.clientY-previous.y)*.2));
        }else{
            const p=[...pointers.values()];
            const d=Math.hypot(p[1].x-p[0].x,p[1].y-p[0].y);
            if(prevDistance>0&&d>0)distance=Math.max(30,Math.min(200,distance*prevDistance/d));
            prevDistance=d;
        }
        orbit();
    });
    for(const name of ['pointerup','pointercancel'])canvas.addEventListener(name,e=>{
        pointers.delete(e.pointerId);prevDistance=0;
    });
    canvas.addEventListener('wheel',e=>{
        e.preventDefault();
        distance=Math.max(30,Math.min(200,distance*Math.exp(e.deltaY*.001)));
        orbit();
    },{passive:false});
    document.querySelector('#left').onclick=()=>{azimuth-=Math.PI/12;orbit();};
    document.querySelector('#right').onclick=()=>{azimuth+=Math.PI/12;orbit();};
    document.querySelector('#higher').onclick=()=>{elevation=elevation>40?25:60;orbit();};
    document.querySelector('#reset').onclick=()=>setView('e25-a195');
    document.querySelector('#zoom-in').onclick=()=>{distance=Math.max(30,distance*.85);orbit();};
    document.querySelector('#zoom-out').onclick=()=>{distance=Math.min(200,distance/ .85);orbit();};
    window.splatReview={app,camera,model,data,setView,ready:true};
    app.once('frameend',()=>{status.hidden=true;buttons.forEach(b=>b.disabled=false);});
    canvas.addEventListener('webglcontextlost',()=>{status.hidden=false;status.textContent='表示が中断しました。ページを再読み込みしてください。';});
    document.addEventListener('visibilitychange',()=>{app.autoRender=!document.hidden;});
} catch(error) {
    status.hidden=false;
    status.textContent='読み込めませんでした。Safariでページを再読み込みしてください。';
    console.error(error);
}
