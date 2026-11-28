// getUserMedia has already been called inside the AR button gesture.
// loadeddata exposes the first decoded image even when the compositor's first
// video-frame callback runs after WebGL or WASM setup. No extra tracker runs.
function sameImage(a,b) {
    if (!a || !b || a.width!==b.width || a.height!==b.height) return false;
    const left=a.data,right=b.data;
    // Most genuinely new frames differ in the first few samples. Comparing
    // every byte on a suspected duplicate also works on a nearly uniform desk.
    for (let i=0;i<left.length;i+=4093) if (left[i]!==right[i]) return false;
    for (let i=0;i<left.length;i++) if (left[i]!==right[i]) return false;
    return true;
}
function hasDecodedDetail(image) {
    // Some capture devices produce a uniform black frame before exposure starts.
    // This filter applies only to the extra first sample. The regular path
    // continues to receive frames from every kind of surface.
    const pixels=image.data, step=4*Math.max(1,Math.floor(image.width*image.height/1024));
    let low=255,high=0;
    for (let i=0;i<pixels.length;i+=step) {
        const value=(pixels[i]+2*pixels[i+1]+pixels[i+2])/4;
        low=Math.min(low,value);high=Math.max(high,value);
        if (high-low>=3) return true;
    }
    return false;
}

export function startDecodedFrames({video,capture,stats,transform,active,onInput,onError}) {
    const ctx=capture.getContext('2d',{willReadFrequently:true,alpha:false});
    const queue=[];
    const hasVideoCallback=typeof video.requestVideoFrameCallback==='function';
    let tracker,callback,stopped=false,lastSeen=-Infinity,lastSent=null;
    let firstImage=null,submittedImage=null,firstAt=-Infinity,submittedAt=-Infinity;
    const canRead=()=>!stopped && active() && video.readyState>=2 &&
        video.videoWidth>0 && video.videoHeight>0;
    function readPixels() {
        ctx.drawImage(video,0,0,capture.width,capture.height);
        return ctx.getImageData(0,0,capture.width,capture.height);
    }
    function submit() {
        if (stopped || !tracker) return;
        const now=performance.now();
        while (queue.length && now-queue[0].capturedAt>150) {queue.shift();stats.dropped++;}
        const next=queue.shift();
        if (!next) return;
        onInput();
        tracker.findCameraPose(transform(next.image));
        lastSent=next.mediaTime;
        submittedImage=next.image;
        submittedAt=next.capturedAt;
        stats.submitted++;
        stats.firstSubmittedSource??=next.source;
    }
    function enqueue(image,mediaTime,capturedAt,source) {
        if (queue.length===3) {queue.shift();stats.dropped++;}
        queue.push({image,mediaTime,capturedAt,source});
        stats.captured++;
        submit();
    }
    function readFirst() {
        if (!canRead() || firstImage || lastSeen!==-Infinity) return;
        try {
            const mediaTime=video.currentTime, now=performance.now();
            if (!Number.isFinite(mediaTime)) return;
            const frame=readPixels();
            if (!hasDecodedDetail(frame)) return;
            firstImage=frame;firstAt=now;lastSeen=mediaTime;
            enqueue(frame,mediaTime,now,'decoded');
        } catch (error) {onError(error);}
    }
    function schedule() {
        if (!stopped) callback=hasVideoCallback ? video.requestVideoFrameCallback(read) : requestAnimationFrame(read);
    }
    function read(now,meta) {
        if (stopped || !active()) return;
        try {
            const mediaTime=meta?.mediaTime??video.currentTime;
            if (canRead() && Number.isFinite(mediaTime) && mediaTime>lastSeen) {
                const capturedAt=meta?.captureTime>0 && meta.captureTime<=now ? meta.captureTime : now;
                if (now-capturedAt<=150) {
                    const frame=readPixels();
                    // loadeddata and rVFC can report different clocks for the
                    // very same pixels. Mark the callback time but submit once.
                    if (firstImage && now-firstAt<=150 && sameImage(firstImage,frame)) {
                        stats.duplicateFirst=(stats.duplicateFirst||0)+1;
                    } else {
                        firstImage=null;
                        enqueue(frame,mediaTime,capturedAt,'presented');
                    }
                }
                lastSeen=mediaTime;
            }
        } catch (error) {onError(error);return;}
        schedule();
    }
    function finish() {
        stopped=true;
        video.removeEventListener('loadeddata',readFirst);
        if (hasVideoCallback) video.cancelVideoFrameCallback(callback);
        else cancelAnimationFrame(callback);
        queue.length=0;
        firstImage=null;
        return lastSent;
    }
    function acceptLiveFrame(image) {
        // A single pixel check across the warmup-to-live handoff covers iOS
        // streams that report currentTime and mediaTime at different cadences.
        if (!submittedImage) return true;
        if (performance.now()-submittedAt<=150 && sameImage(submittedImage,image)) return false;
        submittedImage=null;
        return true;
    }
    video.addEventListener('loadeddata',readFirst,{once:true});
    schedule();
    readFirst();
    return {transform,ctx,finish,submit,readFirst,acceptLiveFrame,attach(alva){tracker=alva;submit();}};
}
