import * as THREE from 'three';
// Use the measured local tabletop height, not an invented global floor or fixed distance.
// Limit the correction to 6 cm so an unrelated surface cannot be projected under the aim.
export function positionAtAim(camera,measured,aimRect,canvasRect){
  if(!camera||!measured||canvasRect.width<=0||canvasRect.height<=0||aimRect.width<=0)return null;
  const x=(aimRect.left+aimRect.width/2-canvasRect.left)/canvasRect.width;
  const y=(aimRect.top+aimRect.height/2-canvasRect.top)/canvasRect.height;
  if(x<0||x>1||y<0||y>1)return null;
  camera.updateMatrixWorld(true);camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  const raycaster=new THREE.Raycaster();raycaster.setFromCamera(new THREE.Vector2(x*2-1,1-y*2),camera);
  if(raycaster.ray.direction.y>=-.1)return null;
  const point=raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-measured.y),new THREE.Vector3());
  if(!point)return null;
  const distance=point.distanceTo(raycaster.ray.origin);
  if(distance<.12||distance>2.5||point.distanceTo(new THREE.Vector3(measured.x,measured.y,measured.z))>.06)return null;
  return {x:point.x,y:point.y,z:point.z};
}
