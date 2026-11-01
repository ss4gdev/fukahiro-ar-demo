// WebXR session lifecycle for the Android renderer and DOM controls.
// Do not fall back to Scene Viewer: its native UI cannot keep our rotation buttons.
export async function checkAndroidSupport(xr) {
  if (!xr || !await xr.isSessionSupported('immersive-ar')) {
    throw Error('この端末ではARを開始できません。対応するAndroidのChromeとGoogle Play開発者サービス（AR）をご確認ください。');
  }
}

// Called directly from the Start button so requestSession retains user activation.
export function openAndroidSession(xr, overlayRoot, callbacks) {
  let stopped=false,session,source,space;
  const suppressSelect=event=>event.preventDefault();
  overlayRoot.addEventListener('beforexrselect',suppressSelect);
  const cleanup=()=>{
    if(stopped)return;
    stopped=true;source?.cancel();
    overlayRoot.removeEventListener('beforexrselect',suppressSelect);
    if(session)session.end().catch(()=>{});
  };
  const ready=(async()=>{
    try {
      session=await xr.requestSession('immersive-ar',{
        requiredFeatures:['hit-test','dom-overlay'],
        domOverlay:{root:overlayRoot},
      });
      if(stopped){await session.end();return;}
      session.addEventListener('end',()=>{
        if(stopped)return;
        stopped=true;source?.cancel();
        overlayRoot.removeEventListener('beforexrselect',suppressSelect);
        callbacks.end();
      },{once:true});
      if(!session.domOverlayState)throw Error('このブラウザではAR中の操作ボタンを表示できません。AndroidのChromeを更新してください。');
      space=await session.requestReferenceSpace('local');
      const viewer=await session.requestReferenceSpace('viewer');
      if(stopped)return;
      source=await session.requestHitTestSource({space:viewer,entityTypes:['plane']});
      if(stopped){source?.cancel();return;}
      if(!source)throw Error('机の検出を開始できませんでした。もう一度開いてください。');
      await callbacks.start({session,space,source});
    }catch(error){if(!stopped){cleanup();callbacks.error(error);}}
  })();
  return {ready,stop:cleanup};
}

// Horizontal surfaces only. All positions stay in the same local XR reference space.
export function tabletopHits(frame,source,space,viewerPosition) {
  if(!frame||!source||!viewerPosition)return [];
  for(const hit of frame.getHitTestResults(source)) {
    const pose=hit.getPose(space),m=pose?.transform?.matrix,p=pose?.transform?.position;
    if(!m||!p||![p.x,p.y,p.z,m[5]].every(Number.isFinite)||m[5]<.9)continue;
    const distance=Math.hypot(p.x-viewerPosition.x,p.y-viewerPosition.y,p.z-viewerPosition.z);
    if(distance>=.12&&distance<=2.5)return [{position:{x:p.x,y:p.y,z:p.z},distance,ray:0}];
  }
  return [];
}
