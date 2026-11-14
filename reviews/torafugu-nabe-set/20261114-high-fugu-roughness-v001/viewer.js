'use strict';

const canvas = document.querySelector('#view');
const statusLine = document.querySelector('#status');
const sourceDir = 'assets/';
const roughness = [0.62, 0.40, 0.22];
const initial = {yaw: -0.8599254404144256, tilt: 1.081212640115698, zoom: 1, angle: -32};
const view = {...initial};
let region = 'b1';
let layout = 'all';
let gl, uniforms, active;
const pending = new Map();

const vertexSource = `#version 300 es
layout(location=0) in vec3 position;
layout(location=1) in vec2 textureUV;
layout(location=2) in vec3 surfaceNormal;
uniform vec3 target;
uniform vec2 rotation, scale;
out vec2 uv;
out vec3 normal, cameraPosition;
vec3 toCamera(vec3 d) {
    float c = cos(rotation.x), s = sin(rotation.x);
    float y = s*d.x + c*d.y;
    return vec3(c*d.x-s*d.y, cos(rotation.y)*y+sin(rotation.y)*d.z,
                -sin(rotation.y)*y+cos(rotation.y)*d.z);
}
void main(){
    uv = textureUV;
    normal = toCamera(surfaceNormal);
    cameraPosition = toCamera(position-target);
    gl_Position = vec4(cameraPosition.xy/scale, -cameraPosition.z/80.0, 1.0);
}`;

const fragmentSource = `#version 300 es
precision highp float;
in vec3 normal, cameraPosition;
in vec2 uv;
uniform sampler2D photo;
uniform float roughness;
uniform vec3 lightDirection;
out vec4 pixel;
float smithG1(float n, float alpha2) {
    return 2.0*n / max(n+sqrt(alpha2+(1.0-alpha2)*n*n), 1e-6);
}
vec3 toSRGB(vec3 c) {
    return mix(1.055*pow(c,vec3(1.0/2.4))-0.055,12.92*c,lessThanEqual(c,vec3(0.0031308)));
}
void main(){
    vec3 geometric = cross(dFdx(cameraPosition),dFdy(cameraPosition));
    vec3 N = normalize(dot(normal,normal)>0.00001 ? normal : geometric);
    if (N.z < 0.0) N = -N;
    vec3 L = normalize(lightDirection), V = vec3(0,0,1), H = normalize(L+V);
    float nv = max(N.z,0.0001), nl = max(dot(N,L),0.0), nh = max(dot(N,H),0.0);
    float alpha = roughness*roughness, a2 = alpha*alpha;
    float d = nh*nh*(a2-1.0)+1.0;
    float distribution = a2/(3.14159265*d*d);
    float fresnel = 0.04+0.96*pow(1.0-clamp(dot(V,H),0.0,1.0),5.0);
    float spec = distribution*smithG1(nl,a2)*smithG1(nv,a2)*fresnel/(4.0*nv);
    vec3 albedo = texture(photo,uv).rgb;
    vec3 linear = albedo*(0.67+0.33*nl)+vec3(0.44*spec);
    pixel = vec4(toSRGB(max(linear,vec3(0.0))),1.0);
}`;

function linkProgram() {
    const program = gl.createProgram();
    for (const [kind, source] of [[gl.VERTEX_SHADER,vertexSource],[gl.FRAGMENT_SHADER,fragmentSource]]) {
        const shader = gl.createShader(kind);
        gl.shaderSource(shader,source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program,shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
    return program;
}

function decode64(encoded, Type) {
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i=0; i<bytes.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Type(bytes.buffer);
}

// Average area-weighted face normals at identical native positions, including UV tile seams.
function makeNormals(parts) {
    const smooth = new Map();
    for (const part of parts) {
        const {v, idx} = part;
        part.shared = new Array(v.length/5);
        for (let i=0; i<part.shared.length; i++) {
            const j = 5*i;
            const key = [v[j],v[j+1],v[j+2]].join(',');
            if (!smooth.has(key)) smooth.set(key,[0,0,0]);
            part.shared[i] = smooth.get(key);
        }
        for (let i=0; i<idx.length; i+=3) {
            const a=idx[i]*5, b=idx[i+1]*5, c=idx[i+2]*5;
            const x1=v[b]-v[a], y1=v[b+1]-v[a+1], z1=v[b+2]-v[a+2];
            const x2=v[c]-v[a], y2=v[c+1]-v[a+1], z2=v[c+2]-v[a+2];
            const nx=y1*z2-z1*y2, ny=z1*x2-x1*z2, nz=x1*y2-y1*x2;
            for (let k=0; k<3; k++) {
                const n=part.shared[idx[i+k]];
                n[0]+=nx; n[1]+=ny; n[2]+=nz;
            }
        }
    }
    for (const n of smooth.values()) {
        const length=Math.hypot(...n);
        if (length>0) for (let k=0; k<3; k++) n[k]/=length;
    }
    for (const part of parts) {
        part.normals=new Float32Array(part.shared.length*3);
        part.shared.forEach((n,i)=>part.normals.set(n,3*i));
        delete part.shared;
    }
}

function buffer(target,data) {
    const b=gl.createBuffer();
    gl.bindBuffer(target,b);
    gl.bufferData(target,data,gl.STATIC_DRAW);
    return b;
}

async function prepare(data) {
    const parts=data.parts.map(p=>({v:decode64(p.vertices,Float32Array),
        idx:decode64(p.indices,Uint32Array),png:p.png}));
    makeNormals(parts);
    const draws=[];
    for (const p of parts) {
        const img=new Image();
        img.src='data:image/png;base64,'+p.png;
        await img.decode();
        if (Math.max(img.width,img.height)>gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw Error('画像が表示上限を超えています');
        const vao=gl.createVertexArray();
        gl.bindVertexArray(vao);
        buffer(gl.ARRAY_BUFFER,p.v);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0,3,gl.FLOAT,false,20,0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1,2,gl.FLOAT,false,20,12);
        buffer(gl.ARRAY_BUFFER,p.normals);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2,3,gl.FLOAT,false,0,0);
        buffer(gl.ELEMENT_ARRAY_BUFFER,p.idx);
        const tex=gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D,tex);
        gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.SRGB8_ALPHA8,gl.RGBA,gl.UNSIGNED_BYTE,img);
        for (const mode of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D,mode,gl.LINEAR);
        for (const axis of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D,axis,gl.CLAMP_TO_EDGE);
        draws.push({vao,tex,count:p.idx.length});
    }
    if (gl.getError()!==gl.NO_ERROR) throw Error('3Dデータを読み込めませんでした');
    return {draws, target:data.target, span:data.half_span, faces:data.face_count};
}

function loadRegion(key) {
    if (!pending.has(key)) {
        let accept, reject;
        const promise=new Promise((resolve,fail)=>{accept=resolve; reject=fail});
        pending.set(key,{promise,accept,reject});
        const script=document.createElement('script');
        script.src=sourceDir+'high-'+key+'.js';
        script.onerror=()=>reject(Error('High Detailの参照ファイルを開けません'));
        document.head.append(script);
    }
    return pending.get(key).promise;
}
window.photoGeometry=data=>{
    const entry=pending.get(data.label.replace('high-',''));
    prepare(data).then(entry.accept,entry.reject);
};

function draw() {
    if (!gl) return;
    const slots=layout==='all' ? [0,1,2] : [Number(layout)];
    const ratio=Math.min(window.devicePixelRatio||1,2);
    const w=Math.max(1,Math.round(canvas.clientWidth*ratio/slots.length));
    const h=Math.max(1,Math.round(canvas.clientHeight*ratio));
    if (canvas.width!==w*slots.length) canvas.width=w*slots.length;
    if (canvas.height!==h) canvas.height=h;
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    if (!active) return;
    gl.uniform3fv(uniforms.target,active.target);
    gl.uniform2f(uniforms.rotation,view.yaw,view.tilt);
    const vertical=active.span*Math.max(1,h/w)/view.zoom;
    gl.uniform2f(uniforms.scale,vertical*w/h,vertical);
    const a=view.angle*Math.PI/180;
    gl.uniform3f(uniforms.lightDirection,Math.sin(a),0.37,Math.cos(a));
    for (const [panel,index] of slots.entries()) {
        gl.viewport(panel*w,0,w,h);
        gl.uniform1f(uniforms.roughness,roughness[index]);
        for (const part of active.draws) {
            gl.bindVertexArray(part.vao);
            gl.bindTexture(gl.TEXTURE_2D,part.tex);
            gl.drawElements(gl.TRIANGLES,part.count,gl.UNSIGNED_INT,0);
        }
    }
}

async function selectRegion(key) {
    region=key;
    active=null;
    for (const b of document.querySelectorAll('[data-region]')) b.setAttribute('aria-pressed',String(b.dataset.region===key));
    statusLine.textContent='読み込み中…';
    draw();
    try {
        const prepared=await loadRegion(key);
        if (region!==key) return;
        active=prepared;
        draw();
        statusLine.textContent=(key==='b1'?'身の境目':'周辺の表面')+' · '+prepared.faces.toLocaleString('ja-JP')+'面';
    } catch(error) {
        if (region===key) statusLine.textContent=error.message;
        console.error(error);
    }
}

function lightValue(a) {
    view.angle=Number(a);
    document.querySelector('#light').value=a;
    document.querySelector('#angle').value=a+'°';
}
function zoom(factor) { view.zoom=Math.max(0.35,Math.min(12,view.zoom*factor)); }
function init() {
    gl=canvas.getContext('webgl2',{alpha:false,antialias:true});
    if (!gl) throw Error('WebGL 2が利用できるブラウザーで開いてください。');
    const program=linkProgram();
    gl.useProgram(program);
    uniforms=Object.fromEntries(['target','rotation','scale','lightDirection','roughness'].map(k=>[k,gl.getUniformLocation(program,k)]));
    gl.uniform1i(gl.getUniformLocation(program,'photo'),0);
    gl.clearColor(0.84,0.86,0.85,1);
    gl.enable(gl.DEPTH_TEST);
    for (const b of document.querySelectorAll('[data-region]')) b.onclick=()=>selectRegion(b.dataset.region);
    document.querySelector('#light').oninput=e=>{lightValue(e.target.value);draw()};
    document.querySelector('#reset').onclick=()=>{Object.assign(view,initial);lightValue(view.angle);draw()};
    document.querySelector('#layout').onchange=e=>{
        layout=e.target.value;
        [...document.querySelector('#labels').children].forEach((label,i)=>label.hidden=layout!=='all' && Number(layout)!==i);
        draw();
    };
    document.querySelector('#zoom-in').onclick = () => { zoom(1.35); draw(); };
    document.querySelector('#zoom-out').onclick = () => { zoom(1/1.35); draw(); };
    let drag;
    canvas.onpointerdown=e=>{drag=[e.clientX,e.clientY];canvas.setPointerCapture(e.pointerId)};
    canvas.onpointermove=e=>{
        if (!drag) return;
        view.yaw+=(e.clientX-drag[0])*0.008;
        view.tilt+=(e.clientY-drag[1])*0.008;
        drag=[e.clientX,e.clientY];draw();
    };
    canvas.onpointerup=canvas.onpointercancel=canvas.onlostpointercapture=()=>{drag=null};
    canvas.addEventListener('wheel',e=>{e.preventDefault();zoom(Math.exp(-e.deltaY*0.001));draw()},{passive:false});
    canvas.onkeydown=e=>{
        switch(e.key) {
            case 'ArrowLeft': view.yaw-=0.10;break;
            case 'ArrowRight': view.yaw+=0.10;break;
            case 'ArrowUp': view.tilt-=0.10;break;
            case 'ArrowDown': view.tilt+=0.10;break;
            case '+': case '=': zoom(1.16);break;
            case '-': zoom(1/1.16);break;
            default:return;
        }
        e.preventDefault();draw();
    };
    new ResizeObserver(draw).observe(canvas);
    lightValue(initial.angle);
    selectRegion(region);
}
try { init() } catch(e) { statusLine.textContent=e.message;console.error(e); }
