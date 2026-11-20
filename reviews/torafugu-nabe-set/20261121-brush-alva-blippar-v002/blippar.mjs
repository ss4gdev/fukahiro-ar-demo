const errors={
    CAMERA_PERMISSION_DENIED:'カメラの使用が許可されていません。Safariのページ設定でカメラを許可してください。',
    MOTION_PERMISSION_DENIED:'動きの利用が許可されていません。もう一度起動して許可してください。',
    DEVICE_MOTION_PERMISSION_DENIED:'動きの利用が許可されていません。もう一度起動して許可してください。',
    CAMERA_NOT_AVAILABLE:'カメラを使用できません。ほかのカメラ画面を閉じてもう一度お試しください。',
    NETWORK_ERROR:'Blipparとの通信に失敗しました。接続を確認して再試行してください。',
    RESOURCE_LOAD_FAILED:'Blipparの追加データを読み込めませんでした。通信状況を確認してください。',
    MODEL_LOAD_FAILED:'鍋のデータを取得または表示できませんでした。ページを開き直してください。',
    WEBGL_NOT_SUPPORTED:'このブラウザーで3D描画を開始できませんでした。',
    UNSUPPORTED_BROWSER:'Blipparがこのブラウザーでは起動できないと報告しました。',
    LICENSE_ERROR:'Blipparがライセンスエラーを返しました。キーの登録ドメイン・期限・残りの閲覧枠を確認してください。'
};
const steps={
    page:'起動画面を読み込み中',
    sdk:'Blipparを読み込み中',
    init:'Blipparと3D表示を接続中',
    permission:'カメラ映像を待っています。許可の案内が出たらタップしてください。'
};

export function startBlippar(api,key){
    const frame=document.createElement('iframe');
    frame.id='blippar-engine';frame.title='Blipparのカメラと鍋セット';
    frame.allow='camera; accelerometer; gyroscope; fullscreen';frame.referrerPolicy='strict-origin';
    let phase='page',percent=-1,stopEngine,hasCamera=false,hasSurface=false,hasModel=false;
    let timer;
    function fail(message){if(api.live())api.fail(Error(message));}
    function arm(ms,message){clearTimeout(timer);timer=setTimeout(()=>fail(message()),ms);}
    function status(){
        if(api.live()&&!hasCamera&&!hasSurface)api.say(steps[phase]+(percent>=0?'　'+percent+'％':''));
    }
    function checkReady(){
        if(!api.live())return;
        if(hasSurface&&hasModel)clearTimeout(timer);
        else if(hasCamera||hasSurface){
            arm(60000,()=>hasSurface?'机を検出しましたが、鍋の読み込みが完了しませんでした。再試行してください。':'カメラは起動しましたが、机を検出できませんでした。机の縁や木目を画面に入れて再試行してください。');
        }
    }
    // The controls and the watchdog live outside the vendor's full-screen UI.
    window.connectTableTrial=child=>{
        if(!api.live()||child!==frame.contentWindow||child.location.origin!==location.origin)return;
        return {
            live:api.live,
            takeKey(){const value=key;key='';return value;},
            step(value){if(Object.hasOwn(steps,value)){phase=value;status();}},
            progress(value){if(Number.isFinite(value)){percent=Math.max(0,Math.min(100,Math.round(value)));status();}},
            error(code){
                const c=String(code||'').toUpperCase().replace(/^ERR_/,'');
                const message=Object.hasOwn(errors,c)?errors[c]:/LICENSE|DOMAIN|QUOTA/.test(c)?errors.LICENSE_ERROR:'Blipparが起動エラーを返しました。';
                fail(message+'（'+steps[phase]+'）');
            },
            camera(){if(!api.live())return;hasCamera=true;api.mark('camera');if(!hasSurface)api.say('カメラが起動しました。机の縁も少し映して、ゆっくり左右に動かしてください。');checkReady();},
            surface(){if(!api.live())return;hasSurface=true;api.offer({});checkReady();},
            model(cfg){if(!api.live())return;hasModel=true;api.model(cfg);checkReady();},
            lost(){if(!api.live())return;hasSurface=false;api.offer(null);api.say('位置を見失いました。机をもう一度映してください。');checkReady();},
            shown(){api.mark('shown');},
            onPlace:api.onPlace,
            onDispose(fn){stopEngine=fn;}
        };
    };
    api.cleanup(()=>{
        clearTimeout(timer);delete window.connectTableTrial;key='';
        try{stopEngine?.();}finally{frame.remove();}
    });
    arm(45000,()=>steps[phase]+'の段階で、45秒以内にカメラ映像や机の検出を確認できませんでした。通信とカメラ許可を確認してください。キーの認証結果は不明です。');
    frame.src=new URL('./blippar-frame.html',import.meta.url);
    document.getElementById('viewport').append(frame);
    status();
}
