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

const guide='机の角と天板を一緒に映し、iPhoneの向きを保って左右にゆっくり動かしてください。';

export function startBlippar(api,key){
    const frame=document.createElement('iframe');
    const retry=document.getElementById('rescan');
    frame.id='blippar-engine';frame.title='Blipparのカメラと鍋セット';
    frame.allow='camera; accelerometer; gyroscope; fullscreen';frame.referrerPolicy='strict-origin';
    let phase='page',percent=-1,stopEngine,resetEngine,hasCamera=false,hasSurface=false,hasModel=false;
    let everReady=false,scanning=false,placed=false,retryAvailable=false;
    let startupTimer,scanTimer,retryTimer;
    function fail(message){if(api.live())api.fail(Error(message));}
    function status(){
        if(api.live()&&!scanning&&!hasCamera&&!hasSurface)api.say(steps[phase]+(percent>=0?'　'+percent+'％':''));
    }
    function clearScan(){
        scanning=false;retryAvailable=false;clearTimeout(scanTimer);clearTimeout(retryTimer);retry.hidden=true;
    }
    function startScan(){
        clearTimeout(startupTimer);
        if(scanning||placed)return;
        scanning=true;
        retryTimer=setTimeout(()=>{retryAvailable=true;retry.hidden=!resetEngine||hasSurface;},6000);
        scanTimer=setTimeout(()=>{
            if(hasSurface&&hasModel){clearScan();return;}
            const result=hasSurface?'机を検出しましたが、鍋の読み込みが完了しませんでした。':
                (everReady?'机の位置を再検出できませんでした。':'机に置ける位置を検出できませんでした。')+
                (hasModel?'鍋の読み込みは完了しています。':'鍋の読み込みも待機中です。');
            fail('25秒で検出を終了しました。'+result+' '+guide+' 同じ机でAlvaARも試せます。');
        },25000);
    }
    function guideScan(){
        if(!hasSurface&&!placed)api.say((everReady?'机の位置を再検出しています。':'机を探しています。')+guide);
    }
    function lost(){
        if(!api.live())return;
        if(hasSurface||placed)api.offer(null);
        hasSurface=false;placed=false;startScan();retry.hidden=!retryAvailable||!resetEngine;guideScan();
    }
    retry.onclick=()=>{
        if(!api.live()||retry.hidden||!resetEngine)return;
        clearScan();lost();
        try{resetEngine();}catch{fail('机の再検出を開始できませんでした。比較画面から再試行してください。');}
    };
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
            camera(){if(!api.live())return;hasCamera=true;api.mark('camera');startScan();guideScan();},
            surface(){if(!api.live()||hasSurface)return;hasSurface=true;everReady=true;startScan();retry.hidden=true;api.offer({});},
            model(cfg){if(!api.live())return;hasModel=true;api.model(cfg);},
            lost,
            onReset(fn){resetEngine=fn;retry.hidden=!retryAvailable||hasSurface;},
            resetObserved(){if(!api.live())return;clearScan();lost();},
            shown(){api.mark('shown');},
            onPlace(fn){api.onPlace(()=>{if(!fn())return false;placed=true;clearScan();return true;});},
            onDispose(fn){stopEngine=fn;}
        };
    };
    api.cleanup(()=>{
        clearTimeout(startupTimer);clearScan();retry.onclick=null;delete window.connectTableTrial;key='';
        try{stopEngine?.();}finally{frame.remove();}
    });
    startupTimer=setTimeout(()=>fail(steps[phase]+'の段階で、45秒以内にカメラ映像や机の検出を確認できませんでした。通信とカメラ許可を確認してください。キーの認証結果は不明です。'),45000);
    frame.src=new URL('./blippar-frame.html',import.meta.url);
    document.getElementById('viewport').append(frame);
    status();
}
