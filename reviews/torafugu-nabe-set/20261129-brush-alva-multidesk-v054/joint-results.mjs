// The desk label is for measurement only. The tracker always uses camera input.
export function initializeDeskPicker(select,onChange){
    const current=new URLSearchParams(location.search).get('desk');
    const known=Array.from(select.options,o=>o.value);
    select.value=known.includes(current)?current:current==='light-wood'?'weak':'unspecified';
    const related=Array.from(document.querySelectorAll('a[href^="?"]'));
    function syncLinks(){
        for(const link of related){
            const url=new URL(link.href);
            url.searchParams.set('desk',select.value);
            link.href=url.href;
        }
    }
    syncLinks();
    select.addEventListener('change',()=>{syncLinks();onChange();});
    return select;
}

function reading(row){
    const e=row.events||{},m=row.manual||{};
    const ready=Number.isFinite(e.placeButtonEnabledMs)?e.placeButtonEnabledMs:null;
    const drawn=ready!==null && Number.isFinite(e.placedMs) && Number.isFinite(e.firstDishFrameMs)
        && e.placedMs>=ready && e.firstDishFrameMs>=e.placedMs;
    return {id:row.id,ready,drawn,width:m.widthCm??null,drift:m.driftAt30Cm??null,
        replaced:!!row.anchorEvents?.some(x=>x.event==='manual-replace')};
}

export function latestDeskReadings(saved,records,version,desk,lastAttempt){
    const byId=new Map(saved.map(row=>[row.id,row]));
    for(const row of [...records,lastAttempt]){
        if(!row || row.version!==version || row.desk!==desk || row.asset!=='Brush PLY'
            || !Number.isFinite(row.endMs) || typeof row.id!=='string')continue;
        byId.set(row.id,reading(row));
    }
    return [...byId.values()].sort((a,b)=>a.id.localeCompare(b.id)).slice(-10);
}

export function deskResultText(rows){
    const placed=rows.filter(row=>row.drawn),times=placed.map(row=>row.ready);
    const measured=placed.filter(row=>!row.replaced);
    const widths=measured.map(row=>row.width).filter(Number.isFinite);
    const drifts=measured.map(row=>row.drift).filter(Number.isFinite);
    const passed=measured.filter(row=>row.ready<2000 && Number.isFinite(row.width) && row.width>=23.75
        && row.width<=26.25 && Number.isFinite(row.drift) && row.drift>=0 && row.drift<=3).length;
    const finiteRange=values=>Math.min(...values).toFixed(2)+'〜'+Math.max(...values).toFixed(2)+'cm';
    const seconds=ms=>(ms/1000).toFixed(3)+'秒';
    const stats=['この机の直近'+rows.length+'回','配置・描画 '+placed.length+'回','全条件合格 '+passed+'回'];
    if(times.length)stats.push('置けた回の最速 '+seconds(Math.min(...times))+'、最遅 '+seconds(Math.max(...times)));
    if(placed.length<rows.length)stats.push('全試行の最遅は未確定');
    stats.push('皿幅 '+(widths.length?finiteRange(widths)+'（'+widths.length+'回）':'未測定'),
        'ずれの最大 '+(drifts.length?Math.max(...drifts).toFixed(2)+'cm（'+drifts.length+'回）':'未測定'));
    return stats.join(' ／ ');
}

export function displayDeskTrials(panel,records,version,desk,referenceMode,lastAttempt){
    if(referenceMode){panel.hidden=true;return;}
    // Keep the ten small readings independent of optional full sensor logs and their storage limit.
    const key='fukahiro-trial-summary:'+version+':'+desk;
    let saved=[];
    try{const stored=JSON.parse(localStorage.getItem(key));if(Array.isArray(stored))saved=stored;}catch{}
    const rows=latestDeskReadings(saved,records,version,desk,lastAttempt);
    panel.hidden=rows.length===0;
    if(rows.length){
        panel.textContent=deskResultText(rows);
        try{localStorage.setItem(key,JSON.stringify(rows));}catch{}
    }
}
