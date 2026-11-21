import {pc,createScene as createProduct} from '../20261121-brush-alva-blippar-v007/model.mjs';
export {pc};
export const referenceMode=new URLSearchParams(location.search).get('asset')==='reference';
export function createScene(canvas){
    const scene=createProduct(canvas);
    if(referenceMode){
        scene.load=async()=>{
            const {dish}=scene;
            dish.addComponent('render',{type:'cylinder'});
            dish.setLocalScale(.250592466102044,.008,.250592466102044);
            dish.setLocalPosition(0,.004,0);
            return {rimYawOffsetDegrees:0};
        };
    }
    return scene;
}

