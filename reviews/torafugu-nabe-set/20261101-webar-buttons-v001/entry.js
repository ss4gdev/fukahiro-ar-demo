// Route before importing the renderer: iPhone need not fetch the GLB or WebAR engine.
export function platform(nav){
  if(/iPhone|iPad|iPod/i.test(nav.userAgent)||(nav.platform==='MacIntel'&&nav.maxTouchPoints>1))return 'ios';
  return /Android/i.test(nav.userAgent)?'android':'desktop';
}
const $=id=>document.getElementById(id),mode=platform(navigator);
document.body.dataset.platform=mode;
if(new URLSearchParams(location.search).get('preview')==='1'){
  await import('./app.js?v=native-v007');
}else if(mode==='ios'){
  $('start').hidden=true;$('loading').hidden=true;$('quicklook').hidden=false;
  $('badge').textContent='iPhone・iPadでAR表示';
  $('instructions').innerHTML='<li>「机に置いて見る」を押す</li><li>机に向けて、表示を待つ</li><li>指で料理の向きを変える</li>';
  $('operation').textContent='置いた後は、2本の指で料理を回せます。';
  $('support').textContent='Safariで開いてください。AR画面から戻ると、このページに戻れます。';
  $('preview-link').textContent='3Dを確認する（カメラなし）';
}else if(mode==='android'){
  $('badge').textContent='Android・ボタンで回せるAR';
  $('support').textContent='Chromeで開いてください。AR対応端末と、Google Play開発者サービス（AR）が必要です。';
  await import('./app.js?v=native-v007');
}else{
  $('start').hidden=true;$('loading').hidden=true;
  $('badge').textContent='スマホでAR表示';
  $('instructions').innerHTML='<li>このページをスマホで開く</li><li>iPhoneはSafari、AndroidはChromeを使う</li><li>「机に置いて見る」から始める</li>';
  $('operation').textContent='iPhoneは指で、Androidは大きなボタンで回せます。';
  $('support').textContent='この端末では、下のリンクからカメラなしの3D表示を確認できます。';
}
