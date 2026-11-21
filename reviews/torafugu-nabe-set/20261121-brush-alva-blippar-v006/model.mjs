import * as pc from '../20261117-splatfacto-camera-color-v001/playcanvas.mjs';
export {pc};
const previous='../20261121-brush-quick-placement-v001/';
export function createScene(canvas){
    const app=new pc.Application(canvas,{graphicsDeviceOptions:{alpha:true,antialias:false,premultipliedAlpha:true,preserveDrawingBuffer:true}});
    app.scene.gsplat.useTonemap=false;app.scene.gsplat.useFog=false;app.scene.gsplat.colorUpdateAngle=.1;app.scene.exposure=1;
    const camera=new pc.Entity('Camera');camera.addComponent('camera',{clearColor:new pc.Color(0,0,0,0),nearClip:.01,farClip:1000,gammaCorrection:pc.GAMMA_SRGB,toneMapping:pc.TONEMAP_NONE});app.root.addChild(camera);
    const stage=new pc.Entity('Table');app.root.addChild(stage);
    const dish=new pc.Entity('Brush');stage.addChild(dish);dish.enabled=false;
    const resize=()=>{const box=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.5);if(box.width&&box.height)app.setCanvasResolution(pc.RESOLUTION_FIXED,Math.round(box.width*dpr),Math.round(box.height*dpr));};
    const observer=new ResizeObserver(resize);observer.observe(canvas);resize();app.start();
    let alive=true;
    async function load(onMetadata){
        const resp=await fetch(previous+'model-config.json');if(!resp.ok)throw Error('鍋の設定を取得できません。');
        const config=await resp.json();if(!alive)return;onMetadata?.(config);
        const asset=new pc.Asset('Brush 8.81 MB','gsplat',{url:previous+config.file});app.assets.add(asset);
        await new Promise((ok,no)=>{asset.once('load',ok);asset.once('error',no);app.assets.load(asset);});
        if(!alive)return;
        if(asset.resource.numSplats!==143653||(asset.resource.shBands??asset.resource.gsplatData?.shBands)!==3)throw Error('鍋のデータが選定版と一致しません。');
        dish.addComponent('gsplat',{asset,unified:false});
        const m=new pc.Mat4();m.data.set(config.rotationColumnMajor);dish.setLocalRotation(new pc.Quat().setFromMat4(m));dish.setLocalScale(config.scale,config.scale,config.scale);dish.setLocalPosition(...config.translation);
        return config;
    }
    return {app,camera,stage,dish,load,dispose(){alive=false;observer.disconnect();app.destroy();}};
}
