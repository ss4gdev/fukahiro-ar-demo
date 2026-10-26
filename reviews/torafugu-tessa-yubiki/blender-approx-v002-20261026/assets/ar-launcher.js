
(() => {
  'use strict';
  const MIME = 'model/vnd.usdz+zip';
  const EXPECTED_BYTES = 6807994;
  const EXPECTED_SHA = 'f89486d8b9dfb9bf7a8d3fbb1766bd9c2cb2d75a559e557095f6d35b47f1bd60';
  const link = document.getElementById('ar-link');
  const status = document.getElementById('ar-status');
  const alternate = document.getElementById('ar-alternate');
  const alternateMethod = document.getElementById('alternate-method');
  for (const button of [link, alternate]) {
    button.addEventListener('click', event => {
      if (button.getAttribute('aria-disabled') === 'true') {
        event.preventDefault();
      } else {
        status.textContent = button === link
          ? '3Dビューアーを開きます。画面が変わらない場合は、下の「ボタンで開かない場合」をお試しください。'
          : '別の方法で3Dビューアーを開きます。画面が変わらない場合は、この表示をチャットへお知らせください。';
      }
    });
  }
  async function prepare() {
    try {
      const model = new URL(link.getAttribute('data-model'), location.href);
      if (model.origin !== location.origin) throw new Error('Model origin mismatch');
      const response = await fetch(model.href, {credentials:'same-origin', cache:'no-store'});
      if (!response.ok || response.redirected) throw new Error('Model fetch failed');
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength !== EXPECTED_BYTES) throw new Error('Model byte count mismatch');
      const digest = await crypto.subtle.digest('SHA-256', buffer);
      const actual = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
      if (actual !== EXPECTED_SHA) throw new Error('Model hash mismatch');
      const servedType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      let target;
      if (servedType === MIME) {
        target = model.href;
      } else {
        // Apple Quick Look supports MIME-typed data URLs. Keep the approved
        // bytes unchanged when the static host uses application/octet-stream.
        const blob = new Blob([buffer], {type:MIME});
        target = await new Promise((resolve,reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Model preparation failed'));
          reader.readAsDataURL(blob);
        });
        if (typeof target !== 'string' || !target.startsWith('data:'+MIME+';base64,')) throw new Error('Model data URL mismatch');
      }
      // Keep an independent filename for non-HTTP URLs, as in Apple's examples.
      link.setAttribute('download','blender-approx-v002.usdz');
      link.setAttribute('href',target+'#allowsContentScaling=0');
      link.setAttribute('aria-disabled','false');
      // Blob URL avoids base64 navigation. Do not revoke while Quick Look reads it.
      // This diagnostic alternative omits the fragment; retain initial display size.
      try {
        const alternativeURL = URL.createObjectURL(new Blob([buffer], {type:MIME}));
        alternate.setAttribute('download','blender-approx-v002.usdz');
        alternate.setAttribute('href',alternativeURL);
        alternate.setAttribute('aria-disabled','false');
        alternateMethod.hidden = false;
      } catch (_) {
        alternate.removeAttribute('href');
        alternate.setAttribute('aria-disabled','true');
        alternateMethod.hidden = true;
      }
      link.hidden = false;
      document.getElementById('ar-prepare').hidden = true;
      status.textContent = '準備できました。「ARで開く」をタップし、ARへ切り替えてください。';
    } catch (_) {
      link.removeAttribute('href');
      link.setAttribute('aria-disabled','true');
      alternate.removeAttribute('href');
      alternate.setAttribute('aria-disabled','true');
      alternateMethod.hidden = true;
      status.textContent = 'モデルを読み込めませんでした。通信状態を確認して、ページを再読み込みしてください。';
    }
  }
  const start = document.getElementById('ar-prepare');
  start.addEventListener('click', async () => {
    start.disabled = true;
    status.textContent = 'ARモデルを準備しています（約6.81MB）…';
    await prepare();
    start.disabled = false;
  });
})();
