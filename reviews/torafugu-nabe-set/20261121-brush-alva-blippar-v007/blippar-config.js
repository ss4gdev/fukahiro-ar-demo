'use strict';
if (window.parent !== window) {
    window.tableBridge = window.parent.connectTableTrial?.(window);
}
if (window.tableBridge) {
    const trial = window.tableBridge;
    window.tableProgress = data => trial.progress(data?.percentage);
    window.tableError = err => trial.error(err?.code);
    window.WEBAR_SDK_CONFIG = {
        'license-key': trial.takeKey(),
        'webar-mode': 'surface-tracking',
        'rendering-engine': 'playcanvas',
        'auto-init': 'true',
        'auto-start-tracking': 'true',
        'static-camera': 'true',
        'show-guide-view': 'true',
        'render-scene-on-desktop': 'false',
        'show-qr-card-on-desktop': 'false',
        'on-progress': 'tableProgress',
        'on-error': 'tableError'
    };
    trial.step('sdk');
}
