// Only completed sessions on this device enter the rolling ten. A failed
// placement still occupies its chronological slot. Missing readings stay null.
export function scoreTrials(records,version){
    const rows=records.filter(r=>r.version===version && r.asset==='Brush PLY' && Number.isFinite(r.endMs))
        .sort((a,b)=>a.id.localeCompare(b.id)).slice(-10);
    const successful=[],readyTimes=[];
    let incomplete=0;
    for(const r of rows){
        const e=r.events||{},time=e.placeButtonEnabledMs;
        const displayed=Number.isFinite(time) && Number.isFinite(e.placedMs) &&
            Number.isFinite(e.firstDishFrameMs) && e.placedMs>=time && e.firstDishFrameMs>=e.placedMs;
        if(displayed)readyTimes.push(time);
        const w=r.manual?.widthCm,d=r.manual?.driftAt30Cm;
        const replaced=r.anchorEvents?.some(x=>x.event==='manual-replace');
        const measured=Number.isFinite(w) && Number.isFinite(d);
        if(displayed && !replaced && !measured)incomplete++;
        if(displayed && !replaced && measured && time<2000 && w>=23.75 && w<=26.25 && d>=0 && d<=3)successful.push(r.id);
    }
    return {count:rows.length,passed:successful.length,incomplete,
        worst:rows.length && readyTimes.length===rows.length?Math.max(...readyTimes):null};
}
