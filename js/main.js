import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {Sky} from 'three/addons/objects/Sky.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {mergeVertices, mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {$,clamp,smooth,lerp,rnd,hash,vnoise,fbm,makeTexture,toTex} from './utils.js';
import {adobeTexture,tileTexture,woodTexture,stoneTexture,groundTexture,fieldTexture,panelTexture} from './textures.js';
import {PERF} from './config.js';
import {createGraphicsQuality} from './performance.js';

const T={};
const ad=adobeTexture();
T.adobe=toTex(ad.map);T.adobeBump=toTex(ad.bump,{srgb:false});
T.adobeS=T.adobe.clone();T.adobeS.repeat.set(1/3,1/3);T.adobeS.needsUpdate=true;
T.adobeSB=T.adobeBump.clone();T.adobeSB.repeat.set(1/3,1/3);T.adobeSB.needsUpdate=true;
T.tile=toTex(tileTexture());
T.wood=toTex(woodTexture());T.woodD=toTex(woodTexture(true));
T.stone=toTex(stoneTexture());
T.ground=toTex(groundTexture(),{repeat:[70,70]});
T.field=toTex(fieldTexture(),{repeat:[4,2]});
T.panel=toTex(panelTexture());

/* ---------- escena ---------- */
const canvas=$('c');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:false,powerPreference:'high-performance'});
renderer.setPixelRatio(1);
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.shadowMap.autoUpdate=false;
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.90;
renderer.outputColorSpace=THREE.SRGBColorSpace;
let gfx=null;

const scene=new THREE.Scene();
scene.fog=new THREE.FogExp2(0xbfd6e5,.00075);
const camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,.1,3000);
camera.position.set(15,7.5,26);
const controls=new OrbitControls(camera,canvas);
controls.target.set(0,2.8,0);controls.enableDamping=true;controls.dampingFactor=.07;
controls.enablePan=true;controls.screenSpacePanning=true;controls.enableZoom=false;controls.zoomToCursor=false;controls.rotateSpeed=.9;controls.panSpeed=.95;controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.PAN};
canvas.addEventListener('contextmenu',e=>e.preventDefault());
controls.maxPolarAngle=Math.PI/2-.02;controls.minDistance=3;controls.maxDistance=160;

// Zoom suave y estable con la rueda: siempre acerca/aleja hacia el mismo centro de la vivienda.
// Se limita el delta para evitar saltos grandes de mouse/trackpad y no se permite paneo lateral.
canvas.addEventListener('wheel',e=>{
  if(fp)return;
  e.preventDefault();
  const radial=camera.position.clone().sub(controls.target);
  const dist=radial.length();
  const delta=clamp(e.deltaY,-45,45);
  const factor=Math.exp(delta*0.00026);
  const next=clamp(dist*factor,controls.minDistance,controls.maxDistance);
  if(Math.abs(next-dist)<0.0001)return;
  radial.setLength(next);
  camera.position.copy(controls.target).add(radial);
  controls.update();
},{passive:false});

const sky=new Sky();sky.scale.setScalar(2500);scene.add(sky);
const su=sky.material.uniforms;su.turbidity.value=5.4;su.rayleigh.value=2.0;su.mieCoefficient.value=.0036;su.mieDirectionalG.value=.76;
const envScene=new THREE.Scene();const skyEnv=new Sky();skyEnv.scale.setScalar(2500);envScene.add(skyEnv);
const pm=new THREE.PMREMGenerator(renderer);let envRT=null;

const sunLight=new THREE.DirectionalLight(0xfff4e7,4.35);
sunLight.castShadow=true;sunLight.shadow.mapSize.set(PERF.shadowMapSize,PERF.shadowMapSize);
const sc=sunLight.shadow.camera;sc.left=-34;sc.right=34;sc.top=34;sc.bottom=-34;sc.near=1;sc.far=260;
sunLight.shadow.bias=-.0004;sunLight.shadow.normalBias=.04;
scene.add(sunLight,sunLight.target);
const moonLight=new THREE.DirectionalLight(0x6f8cff,0);scene.add(moonLight);
const hemi=new THREE.HemisphereLight(0xe4f2ff,0xb08d5f,1.02);scene.add(hemi);

const starGeo=new THREE.BufferGeometry();{const p=[];for(let i=0;i<PERF.starCount;i++){const a=rnd()*Math.PI*2,b=Math.acos(rnd()*.98+.02);p.push(1200*Math.sin(b)*Math.cos(a),1200*Math.cos(b),1200*Math.sin(b)*Math.sin(a))}starGeo.setAttribute('position',new THREE.Float32BufferAttribute(p,3))}
const stars=new THREE.Points(starGeo,new THREE.PointsMaterial({color:0xffffff,size:2.2,sizeAttenuation:false,transparent:true,opacity:0,fog:false,depthWrite:false}));scene.add(stars);

/* ---------- terreno de Julcán ---------- */
function hFn(x,z){const r=Math.hypot(x,z);const flat=smooth(22,70,r);
  const hills=(fbm(x*.012+50,z*.012+50,1024,5,3)-.4)*20;
  const ridge=1-Math.abs(fbm(x*.006+9,z*.006+3,1024,4,14)*2-1);
  const mount=smooth(120,320,r)*(40+ridge*ridge*150);
  const near=(fbm(x*.09,z*.09,1024,3,5)-.5)*.6*smooth(8,40,r);
  return flat*hills+mount+near}
T.detail=toTex(makeTexture(256,(u,v)=>{const n=fbm(u*10,v*10,10,4,31),m=fbm(u*50,v*50,50,3,32);const k=.62+.5*n+.25*(m-.5);const c=clamp(255*k,0,255);return [c,c,c*.96]}).cv,{repeat:[140,140]});
const dirtCol=new THREE.Color(.75,.58,.38),dryCol=new THREE.Color(.94,.79,.50),greenCol=new THREE.Color(.49,.70,.34),rockCol=new THREE.Color(.61,.56,.50),puna=new THREE.Color(.78,.74,.47);
function pathX(z){return z<22?0:12*Math.sin((z-22)*.03)}
{
  const N=PERF.terrainSegments,SZ=1000;const g=new THREE.PlaneGeometry(SZ,SZ,N,N);g.rotateX(-Math.PI/2);
  const p=g.attributes.position;const col=new Float32Array(p.count*3);const c=new THREE.Color();
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);const h=hFn(x,z);p.setY(i,h);
    const sl=(Math.abs(hFn(x+3,z)-h)+Math.abs(hFn(x,z+3)-h))/3;
    const n=fbm(x*.03,z*.03,1024,4,12),m=fbm(x*.2,z*.2,1024,3,13);
    c.copy(dryCol).lerp(greenCol,smooth(.38,.62,n)*(1-smooth(30,90,h)));
    c.lerp(puna,smooth(40,100,h)*.6);
    c.multiplyScalar(.88+.25*m);
    c.lerp(rockCol,clamp(smooth(.5,1.3,sl)+smooth(90,150,h)*.6,0,1));
    const dp=Math.abs(x-pathX(z));const pf=(1-smooth(1.0,3.4,dp))*smooth(4,9,z)*(1-smooth(150,230,z));
    c.lerp(dirtCol,pf*.9);
    col.set([c.r,c.g,c.b],i*3)}
  g.setAttribute('color',new THREE.BufferAttribute(col,3));g.computeVertexNormals();
  var groundMat=new THREE.MeshStandardMaterial({map:T.detail,color:0xf5e6bc,bumpMap:T.detail,bumpScale:1.5,vertexColors:true,roughness:.98,metalness:0,envMapIntensity:.4});
  const ground=new THREE.Mesh(g,groundMat);ground.receiveShadow=true;scene.add(ground);
}
function radialAlpha(inner){const cv=document.createElement('canvas');cv.width=cv.height=256;const g=cv.getContext('2d');const gr=g.createRadialGradient(128,128,0,128,128,128);gr.addColorStop(0,'#fff');gr.addColorStop(inner,'#fff');gr.addColorStop(1,'#000');g.fillStyle=gr;g.fillRect(0,0,256,256);return new THREE.CanvasTexture(cv)}
T.groundH=T.ground.clone();T.groundH.repeat.set(6,6);T.groundH.needsUpdate=true;
const houseGround=new THREE.Mesh(new THREE.CircleGeometry(21,64),new THREE.MeshStandardMaterial({map:T.groundH,color:0xe5bd79,roughness:.96,envMapIntensity:.34,transparent:true,alphaMap:radialAlpha(.55),depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));
houseGround.rotation.x=-Math.PI/2;houseGround.position.y=.03;houseGround.receiveShadow=true;scene.add(houseGround);
T.ground.needsUpdate=true;

const MAX_ANISO=Math.min(renderer.capabilities.getMaxAnisotropy(),16);
function improveTextureQuality(root){
  const seen=new Set();
  root.traverse(obj=>{
    const mats=Array.isArray(obj.material)?obj.material:(obj.material?[obj.material]:[]);
    mats.forEach(m=>{
      for(const key in m){
        const v=m[key];
        if(v&&v.isTexture&&!seen.has(v)){
          seen.add(v);
          v.anisotropy=MAX_ANISO;
          v.needsUpdate=true;
        }
      }
    });
  });
}
function optimizeTinyShadows(root){
  root.traverse(o=>{
    if(!o.isMesh||!o.geometry)return;
    if(o.material?.transparent&&o.material.opacity<.92){o.castShadow=false;return}
    if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();
    const b=o.geometry.boundingBox;if(!b)return;
    const sx=b.max.x-b.min.x,sy=b.max.y-b.min.y,sz=b.max.z-b.min.z;
    if(Math.max(sx,sy,sz)<.16)o.castShadow=false;
  });
}

/* ---------- materiales ---------- */
const mats={};
const std=(o)=>{const m=new THREE.MeshStandardMaterial({envMapIntensity:.45,...o});return m};
mats.adobeBox=std({map:T.adobe,bumpMap:T.adobeBump,bumpScale:2.05,roughness:.94,color:0xf2c88f});
mats.adobeShape=std({map:T.adobeS,bumpMap:T.adobeSB,bumpScale:2.05,roughness:.94,color:0xf2c88f});
mats.plinth=std({map:T.stone,roughness:.95,bumpMap:T.stone,bumpScale:2,color:0xd0c0aa});
mats.tile=std({map:T.tile,bumpMap:T.tile,bumpScale:2.7,roughness:.8,transparent:true,color:0xffb07a});
mats.ridge=std({color:0xb34725,roughness:.8});
mats.wood=std({map:T.wood,roughness:.79,color:0xb87042});
mats.woodD=std({map:T.woodD,roughness:.76,color:0x8f4f2d});
mats.floor=std({map:T.wood,color:0xc99763,roughness:.78});
mats.dark=std({color:0x1c1410,roughness:1});
mats.metal=std({color:0x8a9096,roughness:.4,metalness:.8});
mats.panel=std({map:T.panel,roughness:.2,metalness:.6,envMapIntensity:1,color:0x2b79ff});
mats.field=std({map:T.field,roughness:1});
mats.rock=std({color:0x8a847a,roughness:1,flatShading:true});
mats.glass=[];
function glassMat(){const m=new THREE.MeshPhysicalMaterial({color:0x9db9c6,roughness:.04,metalness:0,transparent:true,opacity:.38,emissive:0xffb85a,emissiveIntensity:0,envMapIntensity:1.6,side:THREE.DoubleSide,depthWrite:false});mats.glass.push(m);return m}
const roofMats=[mats.tile,mats.ridge];

/* ---------- helpers de geometría ---------- */
const BOX_GEO_CACHE=new Map();
function boxGeo(w,h,d,s=3){
  const key=[w,h,d,s].map(v=>(+v).toFixed(4)).join('|');
  const cached=BOX_GEO_CACHE.get(key);if(cached)return cached;
  const g=new THREE.BoxGeometry(w,h,d);const uv=g.attributes.uv;
  const dims=[[d,h],[d,h],[w,d],[w,d],[w,h],[w,h]];
  for(let f=0;f<6;f++)for(let i=0;i<4;i++){const k=f*4+i;uv.setXY(k,uv.getX(k)*dims[f][0]/s,uv.getY(k)*dims[f][1]/s)}
  g.userData.sharedBox=true;BOX_GEO_CACHE.set(key,g);return g
}
function add(parent,geo,mat,x=0,y=0,z=0,{cast=true,recv=true}={}){const m=new THREE.Mesh(geo,mat);m.position.set(x,y,z);m.castShadow=cast;m.receiveShadow=recv;parent.add(m);return m}
function B(parent,w,h,d,mat,x,y,z,s=3,o){return add(parent,boxGeo(w,h,d,s),mat,x,y,z,o)}
function disposeGroup(g){g.traverse(o=>{if(o.geometry&&!o.geometry.userData?.sharedBox)o.geometry.dispose()});while(g.children.length)g.remove(g.children[0])}

function mergeStaticGroupByMaterial(group){
  group.updateMatrixWorld(true);
  const inv=new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets=new Map(), originals=[];
  group.traverse(o=>{
    if(!o.isMesh||o.isInstancedMesh||o.children.length)return;
    const mat=o.material;if(Array.isArray(mat))return;
    const rel=new THREE.Matrix4().multiplyMatrices(inv,o.matrixWorld);
    const geo=o.geometry.clone();geo.applyMatrix4(rel);
    if(!buckets.has(mat))buckets.set(mat,[]);buckets.get(mat).push(geo);originals.push(o);
  });
  if(originals.length<4)return;
  originals.forEach(o=>o.parent&&o.parent.remove(o));
  for(const [mat,geos] of buckets){
    if(!geos.length)continue;const mg=mergeGeometries(geos,false);if(!mg)continue;
    geos.forEach(x=>x.dispose());const mm=new THREE.Mesh(mg,mat);mm.castShadow=true;mm.receiveShadow=true;group.add(mm);
  }
}

function wallShape(w,h,t,notch,holes){
  const s=new THREE.Shape();s.moveTo(0,0);
  if(notch){s.lineTo(notch.x0,0);s.lineTo(notch.x0,notch.h);s.lineTo(notch.x1,notch.h);s.lineTo(notch.x1,0)}
  s.lineTo(w,0);s.lineTo(w,h);s.lineTo(0,h);s.lineTo(0,0);
  for(const o of holes){const p=new THREE.Path();p.moveTo(o.x,o.y);p.lineTo(o.x,o.y+o.h);p.lineTo(o.x+o.w,o.y+o.h);p.lineTo(o.x+o.w,o.y);p.lineTo(o.x,o.y);s.holes.push(p)}
  const g=new THREE.ExtrudeGeometry(s,{depth:t,bevelEnabled:false,curveSegments:1});g.translate(-w/2,0,0);return g}
function gableGeo(pts,t){const s=new THREE.Shape(pts.map(p=>new THREE.Vector2(p[0],p[1])));return new THREE.ExtrudeGeometry(s,{depth:t,bevelEnabled:false})}

function windowFrame(w,h,{mull=1.3,depth=.14,sill=true,back=true}={}){
  const g=new THREE.Group();const f=.07;
  B(g,w+.1,f,depth,mats.woodD,0,h/2-f/2+.0,0,1);B(g,w+.1,f,depth,mats.woodD,0,-h/2+f/2,0,1);
  B(g,f,h,depth,mats.woodD,-w/2+f/2,0,0,1);B(g,f,h,depth,mats.woodD,w/2-f/2,0,0,1);
  const n=Math.max(1,Math.round(w/mull));
  for(let i=1;i<n;i++)B(g,.045,h,depth*.7,mats.woodD,-w/2+i*w/n,0,0,1);
  B(g,w,.04,depth*.7,mats.woodD,0,h*.1,0,1);
  const gl=add(g,new THREE.BoxGeometry(w-.1,h-.1,.02),glassMat(),0,0,0,{cast:false,recv:false});gl.renderOrder=2;
  if(back){const bk=add(g,new THREE.BoxGeometry(w-.1,h-.1,.01),std({color:0x2a2018,roughness:1,emissive:0x5a3a1a,emissiveIntensity:0}),0,0,-.25,{cast:false});mats.interiorGlow=mats.interiorGlow||[];mats.interiorGlow.push(bk.material);}
  if(sill){B(g,w+.5,.07,.42,mats.plinth,0,-h/2-.07,.1,1.5);}
  B(g,w+.7,.2,.5,mats.woodD,0,h/2+.14,0,1.2);
  return g}

function roofSlab(parent,{x,len,zr,run,ridgeY,theta,side}){
  const th=THREE.MathUtils.degToRad(theta);const L=run/Math.cos(th);const slab=boxGeo(len,.12,L,2.5);
  const m=new THREE.Mesh(slab,mats.tile);m.castShadow=m.receiveShadow=true;
  const dy=run*Math.tan(th)/2;
  m.position.set(x,ridgeY-dy+.06,zr+side*run/2);
  m.rotation.x=side*th;parent.add(m);
  return m}
function gableRoof(parent,{x,len,zr,runF,runB,ridgeY,theta}){
  roofSlab(parent,{x,len,zr,run:runF+.05,ridgeY,theta,side:1});
  roofSlab(parent,{x,len,zr,run:runB+.05,ridgeY,theta,side:-1});
  const th=THREE.MathUtils.degToRad(theta);
  B(parent,len+.1,.16,.34,mats.ridge,x,ridgeY+.14,zr,2);
  // vigas de alero y tablas de borde
  for(const s of [1,-1]){const run=s>0?runF:runB;const y=ridgeY-run*Math.tan(th);
    B(parent,len+.05,.1,.12,mats.woodD,x,y+.02,zr+s*(run+.04),1)}
}

const snowRoofMat=std({color:0xf8fbff,roughness:1,metalness:0,transparent:true,opacity:.96});
const snowRoofEdgeMat=std({color:0xffffff,roughness:.95,metalness:0,transparent:true,opacity:.98});
function snowRoofSlab(parent,{x,len,zr,run,ridgeY,theta,side}){
  const th=THREE.MathUtils.degToRad(theta);
  const L=(run-.08)/Math.cos(th);
  const slab=boxGeo(Math.max(.4,len-.12),.05,Math.max(.4,L),2.5);
  const m=new THREE.Mesh(slab,snowRoofMat);m.castShadow=false;m.receiveShadow=true;
  const dy=run*Math.tan(th)/2;
  m.position.set(x,ridgeY-dy+.12,zr+side*run/2);
  m.rotation.x=side*th;parent.add(m);
  const yE=ridgeY-run*Math.tan(th)+.085;
  const zE=zr+side*(run+.02);
  B(parent,len-.05,.055,.18,snowRoofEdgeMat,x,yE,zE,1,{cast:false});
  return m
}
function snowGableRoof(parent,{x,len,zr,runF,runB,ridgeY,theta}){
  snowRoofSlab(parent,{x,len,zr,run:runF+.02,ridgeY,theta,side:1});
  snowRoofSlab(parent,{x,len,zr,run:runB+.02,ridgeY,theta,side:-1});
  B(parent,len-.08,.07,.20,snowRoofEdgeMat,x,ridgeY+.205,zr,1,{cast:false});
}

/* ---------- casa ---------- */
const house=new THREE.Group();scene.add(house);
const roofGroup=new THREE.Group();house.add(roofGroup);
const roofSnowGroup=new THREE.Group();roofSnowGroup.visible=false;house.add(roofSnowGroup);
const frontMain=new THREE.Group(),frontWing=new THREE.Group(),frontUp=new THREE.Group();house.add(frontMain,frontWing,frontUp);
const ST={R:3.9/22,T:.27,top:3.9,ymid:3.9-11*3.9/22,x1:-2.95,x2:-4.15};
const TH=.45;
const tanT=Math.tan(THREE.MathUtils.degToRad(16));
const HR=4.19;const roofY=z=>HR-Math.abs(z)*tanT;
const lights={};

function buildWing(){
  const wing=new THREE.Group();house.add(wing);
  const x0=-10,x1=-6,hw=2.5,wh=2.7;
  B(wing,4.0,wh,TH,mats.adobeBox,-8,wh/2,-hw+TH/2);
  const tW=Math.tan(THREE.MathUtils.degToRad(24)),HRw=wh+hw*tW;
  const g=gableGeo([[-hw,0],[hw,0],[hw,wh],[0,HRw],[-hw,wh]],TH);const m=new THREE.Mesh(g,mats.adobeShape);m.rotation.y=-Math.PI/2;m.position.set(x0+TH,0,0);m.castShadow=m.receiveShadow=true;wing.add(m);
  gableRoof(roofGroup,{x:-8.1,len:5.2,zr:0,runF:hw+.55,runB:hw+.55,ridgeY:HRw,theta:24});
  B(wing,4.5,.5,.55,mats.plinth,-8,.25,hw-.2,2);B(wing,.55,.5,5.1,mats.plinth,x0+.2,.25,0,2);
  // chimenea
  B(wing,.55,2,.55,mats.adobeBox,-8.6,4.1,-.6);B(wing,.75,.12,.75,mats.plinth,-8.6,5.15,-.6,1.5);
  lights.wing=new THREE.PointLight(0xffb45a,0,9,1.6);lights.wing.position.set(-8,1.6,0);house.add(lights.wing);
  B(wing,4,.1,5,mats.floor,-8,.08,0,2,{cast:false});
}
function buildWingFront(){
  disposeGroup(frontWing);
  const g=wallShape(4,2.7,TH,null,[{x:1,y:.95,w:2,h:1.15}]);
  const m=new THREE.Mesh(g,mats.adobeShape);m.position.set(-8,0,2.5-TH);m.castShadow=m.receiveShadow=true;frontWing.add(m);
  const wf=windowFrame(2,1.15,{mull:1.0});wf.position.set(-8,1.525,2.5-TH/2);frontWing.add(wf);
}
function buildMainFront(wWin){
  disposeGroup(frontMain);
  const W=12,H=roofY(3),cx=2.5;
  const holes=[{x:W/2+cx-wWin/2,y:.95,w:wWin,h:1.5}];
  const g=wallShape(W,H,TH,{x0:W/2-3.55,x1:W/2-2.45,h:2.2},holes);
  const m=new THREE.Mesh(g,mats.adobeShape);m.position.set(0,0,3-TH);m.castShadow=m.receiveShadow=true;frontMain.add(m);
  const wf=windowFrame(wWin,1.5,{mull:1.25});wf.position.set(cx,.95+.75,3-TH/2);frontMain.add(wf);
  // puerta
  const door=new THREE.Group();B(door,1.1,2.2,.07,mats.woodD,0,1.1,0,1.4);
  for(let i=0;i<4;i++)B(door,.06,2.1,.09,mats.wood,-.4+i*.27,1.1,0,1);
  B(door,1.0,.08,.09,mats.metal,0,.5,0,1);B(door,1.0,.08,.09,mats.metal,0,1.7,0,1);
  const kn=add(door,new THREE.SphereGeometry(.04,12,12),std({color:0xc9a24a,metalness:1,roughness:.3}),.4,1.1,.07);
  const pivot=new THREE.Group();pivot.position.set(-3.55,0,3-TH*.55);door.position.set(.55,0,0);pivot.add(door);frontMain.add(pivot);window.doorPivot=pivot;
  B(frontMain,1.5,.2,.6,mats.woodD,-3,2.32,3-TH/2,1);
  // sobrecimiento de piedra
  B(frontMain,2.45,.45,.55,mats.plinth,-4.775,.225,3-.2,2);B(frontMain,8.5,.45,.55,mats.plinth,1.75,.225,3-.2,2);
  // umbral
  B(frontMain,1.3,.08,.5,mats.plinth,-3,.04,3-TH/2,1.5);
  $('wTxt').textContent=wWin.toFixed(1)+' m';
}
function buildUp(){
  disposeGroup(frontUp);
  const x0=-4,x1=2,W=6,cx=-1,yb=3.9,hh=2.5,zf=1.6,zb=-2.2,zr=-.3;
  const t2=Math.tan(THREE.MathUtils.degToRad(14)),HR2=yb+hh+(zf-zr)*t2;
  const roofY2=z=>HR2-Math.abs(z-zr)*t2;
  B(house,W,.9,zf-zb,mats.adobeBox,cx,3.45,(zf+zb)/2);
  B(house,W,hh,.4,mats.adobeBox,cx,yb+hh/2,zb+.2);
  for(const xe of [x0,x1]){const g=gableGeo([[zb,yb],[zf,yb],[zf,roofY2(zf)],[zr,HR2],[zb,roofY2(zb)]],.4);const m=new THREE.Mesh(g,mats.adobeShape);m.rotation.y=-Math.PI/2;m.position.set(xe===x0?xe+.4:xe,0,0);m.castShadow=m.receiveShadow=true;house.add(m)}
  const g=wallShape(W,hh,.4,{x0:.5,x1:1.6,h:2.1},[{x:3.3,y:.8,w:2.2,h:1.1}]);
  const m=new THREE.Mesh(g,mats.adobeShape);m.position.set(cx,yb,zf-.4);m.castShadow=m.receiveShadow=true;frontUp.add(m);
  const wf=windowFrame(2.2,1.1,{mull:.75,back:false});wf.position.set(cx-W/2+3.3+1.1,yb+.8+.55,zf-.2);frontUp.add(wf);
  /* marco fijo + hoja con bisagras que se abre sola */
  {const zc=zf-.2,hx=cx-W/2+.5;
    B(frontUp,.09,2.18,.42,mats.woodD,hx-.03,yb+1.09,zc,1);B(frontUp,.09,2.18,.42,mats.woodD,hx+1.13,yb+1.09,zc,1);B(frontUp,1.3,.1,.42,mats.woodD,hx+.55,yb+2.13,zc,1);
    B(frontUp,1.2,.05,.42,mats.plinth,hx+.55,yb+.025,zc,1.5);
    const leaf=new THREE.Group(),wd=mats.wood,wk=mats.woodD;
    B(leaf,1.04,2.04,.04,wk,0,1.03,0,1);
    for(const sx of [-.46,.46])B(leaf,.12,2.04,.06,wd,sx,1.03,0,1);
    B(leaf,1.04,.12,.06,wd,0,2.0,0,1);B(leaf,1.04,.16,.06,wd,0,.1,0,1);B(leaf,1.04,.1,.06,wd,0,1.02,0,1);B(leaf,1.04,.09,.06,wd,0,1.62,0,1);
    for(const px of [-.2,.2]){B(leaf,.34,.7,.05,wk,px,.62,.01,1);B(leaf,.28,.58,.06,wd,px,.62,.015,1)}
    for(const px of [-.2,.2])for(const py of [1.3,1.76]){const gp=add(leaf,new THREE.BoxGeometry(.34,.32,.015),glassMat(),px,py,0,{cast:false,recv:false});gp.renderOrder=2}
    B(leaf,.03,.7,.07,wd,0,1.53,0,1);
    for(const sd of [-1,1]){add(leaf,new THREE.SphereGeometry(.035,14,12),mats.metal,.4,1.0,sd*.06);B(leaf,.07,.16,.012,mats.metal,.4,1.0,sd*.035,1)}
    for(const hy of [.25,1.0,1.8])add(leaf,new THREE.CylinderGeometry(.018,.018,.12,10),mats.metal,-.53,hy,0);
    leaf.position.set(.55,0,0);
    const pv=new THREE.Group();pv.position.set(hx,yb,zc);pv.add(leaf);frontUp.add(pv);window.upDoorPivot=pv;}
  // balcón
  B(frontUp,W+.6,.16,1.5,mats.floor,cx,yb-.08,zf+.55,2);
  B(frontUp,W+.8,.2,.18,mats.woodD,cx,yb-.28,zf+1.28,1);
  const inGap=q=>q>-3.6&&q<-2.3;for(let i=0;i<=12;i++){const px=x0-.2+i*(W+.4)/12;if(!inGap(px))B(frontUp,.08,1,.08,mats.woodD,px,yb+.5,zf+1.28,1);if(i<12&&!inGap(px+.25))B(frontUp,.03,.7,.03,mats.wood,px+.25,yb+.55,zf+1.28,1)}
  for(const [c,w] of [[-3.958,.583],[.0915,4.317],[-3.5835,.167],[-2.2335,.333]]){B(frontUp,w,.07,.12,mats.woodD,c,yb+1.02,zf+1.28,1);B(frontUp,w,.05,.08,mats.woodD,c,yb+.35,zf+1.28,1)}for(const c of [-3.5835,-2.2335])B(frontUp,.03,.7,.03,mats.wood,c,yb+.55,zf+1.28,1);
  for(const px of [x0,x0+2,x0+4,x1]){B(frontUp,.16,.9,.16,mats.woodD,px,3.4,zf+1.15,1)}
  // marquesina sobre la ventana
  const can=new THREE.Mesh(boxGeo(2.9,.07,.8,2.5),mats.tile);can.position.set(cx-W/2+4.4,yb+2.05,zf+.1);can.rotation.x=.12;can.castShadow=true;frontUp.add(can);
  for(const dx of [-1.2,1.2])B(frontUp,.06,.35,.06,mats.woodD,cx-W/2+4.4+dx,yb+1.9,zf-.1,1);
  // techo piso alto
  gableRoof(roofGroup,{x:cx,len:W+1.8,zr,runF:(zf-zr)+.85,runB:(zr-zb)+.85,ridgeY:HR2,theta:14});
  lights.up=new THREE.PointLight(0xffb45a,0,9,1.6);lights.up.position.set(cx,yb+1.4,zr);house.add(lights.up);
  B(house,W-.4,.1,zf-zb-.4,mats.floor,cx,yb+.05,zr,2,{cast:false});
}
const SEATS=[];try{makeScreens()}catch(e){console.warn('pantallas',e)}
const SW={top:3.9,R:3.9/22,T:.27,x1:-2.95,x2:-4.15,W:1.2,zL0:6.9,zM0:9.6,zM1:10.8};
function stairSurf(x,z){
  const o=[],{top,R,T}=SW;const ymid=top-11*R;
  if(x>-3.5&&x<-2.4&&z>2.8&&z<6.9)o.push(top);
  if(x>-3.5&&x<-2.4&&z>=6.9&&z<9.6)o.push(top-(Math.floor((z-6.9)/T)+1)*R);
  if(x>-4.7&&x<-3.6&&z>=6.9&&z<9.6)o.push(ymid-Math.ceil((9.6-z)/T)*R);
  if(x>-4.7&&x<-2.4&&z>=9.6&&z<10.7)o.push(ymid);
  if(x>-4.15&&x<1.55&&z>1.65&&z<2.85)o.push(top);
  if(x>-3.45&&x<-2.45&&z>=1.15&&z<=1.66)o.push(4.0);
  if(x>-3.55&&x<1.55&&z>-1.75&&z<1.16){
    const fu=[[-3.6,-2.55,-1.8,.1],[-2.5,-2.1,-1.75,-1.35],[-.45,.85,-1.8,-1.2],[1.2,1.6,-1.2,-.0],[-.4,1.0,.55,1.2],[.05,.55,.15,.65],[1.0,1.6,.25,1.25],[1.1,1.55,-1.7,-1.3]];
    if(!fu.some(r=>x>r[0]&&x<r[1]&&z>r[2]&&z<r[3]))o.push(4.04);
  }
  return o;
}
function fpSurf(x,z,cur){
  const c=[];
  if(!blocked(x,z)&&!(x>-4.85&&x<-2.25&&z>6.92&&z<10.9))c.push((x>-10.2&&x<5.6&&z>-3&&z<3)?.14:(Math.abs(x)<7&&z>3&&z<6.3)?.3:hFn(x,z));
  for(const y of stairSurf(x,z))c.push(y);
  if(!c.length)return null;
  if(cur!==cur)return c[0];
  let best=null,bd=.4;for(const y of c){const d=Math.abs(y-cur);if(d<=bd){bd=d;best=y}}
  return best;
}
function buildSecondFloorStairs(){
  const g=new THREE.Group();house.add(g);
  const {top,R,T,W}=SW,ymid=top-11*R,wd=mats.wood,wk=mats.woodD;
  const bb=(a,b,c,m,x,y,z)=>B(g,a,b,c,m,x,y,z,1);
  const foot=(x,z,y0)=>bb(.5,.24,.5,mats.plinth,x,y0+.0,z);
  const post=(x,z,y0,y1,s=.14)=>bb(s,y1-y0,s,wk,x,(y0+y1)/2,z);
  /* pasarela desde el balcón */
  for(const jx of [-3.5,-2.95,-2.4])bb(.1,.2,4.12,wk,jx,3.74,4.86);
  for(let z=2.95;z<6.9;z+=.2)bb(1.3,.05,.18,mats.floor,-2.95,3.875,Math.min(z,6.81));
  bb(1.3,.2,.14,wk,-2.95,3.74,6.88);bb(1.3,.14,.14,wk,-2.95,3.55,5.75);bb(1.3,.14,.14,wk,-2.95,3.55,6.78);
  for(const px of [-3.5,-2.4]){foot(px,5.75,.3);post(px,5.75,.3,3.62);foot(px,6.78,0);post(px,6.78,0,3.62);
    const br=bb(.07,.07,.95,wk,px,3.28,5.38);br.rotation.x=Math.PI/4;}
  /* tramos con peldaños cerrados y zancas dentadas (sin rotaciones) */
  function run(xc,zS,dir,yS,n){
    for(let k=1;k<=n;k++){
      const yk=yS-k*R,yp=yS-(k-1)*R,a=zS+dir*(k-1)*T,b=zS+dir*k*T,zc=(a+b)/2;
      bb(W,.045,T+.04,wd,xc,yk-.0225,zc+dir*.02);
      bb(W-.1,R-.03,.025,wk,xc,(yk+yp)/2-.015-.02,b-dir*.0125-dir*.012);
      for(const sx of [-1,1])bb(.06,.34,T+.02,wk,xc+sx*(W/2-.03),yk-.17,zc);
    }
    for(const k of [3,6,9])bb(W-.12,.08,.08,wk,xc,yS-k*R-.38,zS+dir*(k-.5)*T);
  }
  run(SW.x1,6.9,1,top,10);run(SW.x2,9.6,-1,ymid,10);
  bb(2.4,.12,1.2,mats.floor,-3.55,ymid-.06,10.2);
  for(const zz of [9.66,10.74])bb(2.4,.18,.1,wk,-3.55,ymid-.2,zz);
  for(const px of [-4.75,-2.35])bb(.1,.18,1.2,wk,px,ymid-.2,10.2);
  for(const [px,pz] of [[-4.7,10.74],[-2.4,10.74],[-3.55,10.74],[-4.7,9.66],[-2.4,9.66],[-3.55,9.66]]){foot(px,pz,0);post(px,pz,0,ymid-.12)}
  const yl1=z=>top-(z-6.9)/T*R,yl2=z=>ymid-(9.6-z)/T*R;
  for(const px of [-3.5,-2.4]){foot(px,8.25,0);post(px,8.25,0,yl1(8.25)-.36,.12)}
  for(const px of [-4.7,-3.6]){foot(px,8.25,0);post(px,8.25,0,yl2(8.25)-.36,.12)}
  bb(1.7,.1,1.0,mats.plinth,SW.x2,0,6.55);
  function guard(x,za,ya,zb,yb,h=.92){
    const L=Math.hypot(zb-za,yb-ya),th=-Math.atan2(yb-ya,zb-za),yq=z=>ya+(yb-ya)*(z-za)/(zb-za),np=Math.max(1,Math.ceil(L/1.1));
    for(let i=0;i<=np;i++){const z=za+(zb-za)*i/np;bb(.09,h+.24,.09,wk,x,yq(z)+(h-.16)/2,z)}
    bb(.08,.06,L+.1,wk,x,(ya+yb)/2+h,(za+zb)/2).rotation.x=th;bb(.05,.04,L,wk,x,(ya+yb)/2+h*.5,(za+zb)/2).rotation.x=th;
    const nb=Math.round(Math.abs(zb-za)/.12);
    for(let i=1;i<nb;i++){const z=za+(zb-za)*i/nb;bb(.03,h+.12,.03,wd,x,yq(z)+(h-.18)/2,z)}
  }
  for(const px of [-3.5,-2.4])guard(px,2.95,top,6.9,top,1.02);
  guard(-2.4,6.9,top,9.6,top-10*R);guard(-3.55,6.9,top,9.6,top-10*R);
  guard(-4.7,6.9,ymid-10*R,9.6,ymid);
  guard(-2.4,9.6,ymid,10.74,ymid);guard(-4.7,9.6,ymid,10.74,ymid);
  {const z=10.74,y=ymid,h=.92;bb(2.4,.06,.08,wk,-3.55,y+h,z);bb(2.4,.04,.05,wk,-3.55,y+h*.5,z);
    for(let x=-4.62;x<-2.45;x+=.12)bb(.03,h+.12,.03,wd,x,y+(h-.18)/2,z);}
  // Misma apariencia, muchas menos llamadas de dibujo.
  mergeStaticGroupByMaterial(g);
}

let studentRoomGroup=null;
function buildStudentRoom(){
  const room=new THREE.Group();studentRoomGroup=room;house.add(room);
  const y0=4.04;
  const bx=(w,h,d,mat,x,y,z)=>B(room,w,h,d,mat,x,y,z,1);
  const cyl=(rt,rb,h,mat,x,y,z,seg=16)=>add(room,new THREE.CylinderGeometry(rt,rb,h,seg),mat,x,y,z);
  const RB=(w,h,d,r)=>new RoundedBoxGeometry(w,h,d,4,r);
  const M={
    woodL:std({map:T.wood,color:0xd9b27c,roughness:.7}),woodM:std({map:T.wood,color:0xa8693b,roughness:.72}),woodK:std({map:T.woodD,color:0x6e3c20,roughness:.68}),
    paint:std({color:0x4f7f8e,roughness:.95}),white:std({color:0xf3efe6,roughness:1}),tick:std({color:0xe4ddcc,roughness:1}),
    brass:std({color:0xc9a24a,metalness:1,roughness:.3}),steel:std({color:0x9aa0a6,metalness:.85,roughness:.35}),blk:std({color:0x15171b,roughness:.5}),
    leaf:std({color:0x3f7a3a,roughness:.8}),leaf2:std({color:0x2f6a30,roughness:.8}),clay:std({color:0x9a5a38,roughness:.9}),cork:std({color:0xb98b5a,roughness:1}),
    cream:std({color:0xe8dcc0,roughness:1,side:THREE.DoubleSide}),
    screen:std({color:0x101827,emissive:0x3a6aa0,emissiveIntensity:.55,roughness:.3}),
    shade:std({color:0xf1deb0,emissive:0xffc070,emissiveIntensity:.35,roughness:.9,side:THREE.DoubleSide}),
    bulb:std({color:0xfff2c8,emissive:0xffd890,emissiveIntensity:.3,roughness:.4})
  };
  const blanketC=cloth(0xffffff,F.blanket), rugC=cloth(0xffffff,F.rug), ponchoC=cloth(0xffffff,F.poncho), aguC=cloth(0xffffff,F.aguayo);
  window.upLampMats=[M.shade,M.bulb];
  const boards=[0xc99763,0xb98550,0xd3a572,0xc08c58].map(c=>std({map:T.wood,color:c,roughness:.55}));
  const nb=18,bw=3.0/nb;
  for(let i=0;i<nb;i++){
    const z=-1.8+bw*(i+.5), m=boards[(i*7+3)%4], j=-1.6+rnd()*2.4;
    bx(j+3.6-.005,.04,bw-.006,m,(-3.6+j)/2,y0-.02,z);bx(1.6-j-.005,.04,bw-.006,boards[(i*5+1)%4],(j+1.6)/2,y0-.02,z);
  }
  bx(5.2,.12,.03,M.woodK,-1,y0+.06,-1.785);bx(.03,.12,3.0,M.woodK,-3.585,y0+.06,-.3);bx(.03,.12,3.0,M.woodK,1.585,y0+.06,-.3);bx(4.0,.12,.03,M.woodK,-.4,y0+.06,1.185);
  bx(5.2,1.0,.02,M.paint,-1,y0+.56,-1.79);bx(.02,1.0,3.0,M.paint,-3.59,y0+.56,-.3);bx(.02,1.0,3.0,M.paint,1.59,y0+.56,-.3);bx(1.7,1.0,.02,M.paint,-1.55,y0+.56,1.19);
  bx(5.2,.04,.05,M.woodK,-1,y0+1.08,-1.775);bx(.05,.04,3.0,M.woodK,-3.575,y0+1.08,-.3);bx(.05,.04,3.0,M.woodK,1.575,y0+1.08,-.3);
  bx(2.0,.012,1.4,rugC,-1.4,y0+.006,-.1);
  const bxC=-3.075;
  for(const [px,pz,h] of [[-3.55,-1.76,.95],[-2.6,-1.76,.95],[-3.55,.03,.5],[-2.6,.03,.5]]) bx(.07,h,.07,M.woodK,px,y0+h/2,pz);
  for(const px of [-3.55,-2.6]) bx(.05,.2,1.85,M.woodM,px,y0+.28,-.87);
  for(const pz of [-1.76,.03]) bx(.95,.2,.05,M.woodM,bxC,y0+.28,pz);
  bx(.88,.5,.05,M.woodM,bxC,y0+.66,-1.76);bx(1.02,.07,.07,M.woodK,bxC,y0+.93,-1.76);bx(.88,.26,.05,M.woodM,bxC,y0+.38,.03);
  bx(.92,.04,1.78,M.woodL,bxC,y0+.22,-.87);
  add(room,RB(.92,.2,1.78,.05),M.tick,bxC,y0+.34,-.87);
  add(room,RB(.94,.03,1.8,.015),M.white,bxC,y0+.445,-.87);
  add(room,RB(.96,.07,1.15,.03),blanketC,bxC,y0+.48,-.3);add(room,RB(.96,.1,.14,.04),blanketC,bxC,y0+.5,-.9);add(room,RB(.95,.07,.3,.03),M.white,bxC,y0+.485,-1.04);
  for(const px of [-3.3,-2.85]){const p=add(room,new THREE.SphereGeometry(.24,18,12),M.white,px,y0+.52,-1.45);p.scale.set(1,.34,.8);p.rotation.y=px<-3?.08:-.06}
  bx(.4,.5,.4,M.woodK,-2.3,y0+.25,-1.55);bx(.44,.03,.44,M.woodM,-2.3,y0+.515,-1.55);
  bx(.32,.14,.01,M.woodM,-2.3,y0+.34,-1.345);add(room,new THREE.SphereGeometry(.018,10,8),M.brass,-2.3,y0+.34,-1.335);
  cyl(.07,.09,.08,M.clay,-2.3,y0+.57,-1.55);cyl(.012,.012,.2,M.brass,-2.3,y0+.71,-1.55,8);cyl(.1,.17,.17,M.shade,-2.3,y0+.88,-1.55,24);
  const lampL=new THREE.PointLight(0xffc27a,0,5,1.8);lampL.position.set(-2.3,y0+.85,-1.5);room.add(lampL);window.upLamp=lampL;
  bx(.2,.04,1.1,M.woodM,-3.5,y0+1.45,-.95);bx(.2,.04,1.1,M.woodM,-3.5,y0+1.85,-.95);
  {const bc=[0xb0302a,0x2a5a8a,0x3a7a4a,0xd9a22a,0x6a3d7a,0x8a5a32];let z=-1.45;for(let i=0;i<8;i++){const w=.04+rnd()*.03,h=.18+rnd()*.1;bx(.15,h,w,std({color:bc[i%6],roughness:.85}),-3.5,y0+1.47+h/2,z+w/2);z+=w+.004}
   cyl(.05,.065,.1,M.clay,-3.5,y0+1.92,-.5,14);add(room,new THREE.SphereGeometry(.08,14,10),M.leaf,-3.5,y0+2.05,-.5);}
  {const cv=document.createElement('canvas');cv.width=512;cv.height=340;const g=cv.getContext('2d');
    const sk=g.createLinearGradient(0,0,0,200);sk.addColorStop(0,'#7fb4e0');sk.addColorStop(1,'#f4e2b8');g.fillStyle=sk;g.fillRect(0,0,512,340);
    g.fillStyle='#ffd86a';g.beginPath();g.arc(400,70,30,0,7);g.fill();
    g.fillStyle='#6b6f8a';g.beginPath();g.moveTo(0,200);g.lineTo(90,100);g.lineTo(170,170);g.lineTo(260,70);g.lineTo(380,190);g.lineTo(512,120);g.lineTo(512,230);g.lineTo(0,230);g.fill();
    g.fillStyle='#fff';g.beginPath();g.moveTo(260,70);g.lineTo(235,100);g.lineTo(285,100);g.fill();
    g.fillStyle='#7a9a4a';g.fillRect(0,215,512,40);g.fillStyle='#b9a24a';g.fillRect(0,250,512,40);g.fillStyle='#8a6a3a';g.fillRect(0,285,512,55);
    g.fillStyle='#c98a4a';g.fillRect(70,185,60,35);g.fillStyle='#8a2f23';g.beginPath();g.moveTo(62,187);g.lineTo(100,160);g.lineTo(138,187);g.fill();
    const tx=new THREE.CanvasTexture(cv);tx.colorSpace=THREE.SRGBColorSpace;tx.anisotropy=8;
    bx(.96,.74,.04,M.woodK,-3.05,y0+1.6,-1.775);
    const pl=new THREE.Mesh(new THREE.PlaneGeometry(.84,.55),new THREE.MeshStandardMaterial({map:tx,roughness:.6}));pl.position.set(-3.05,y0+1.6,-1.752);room.add(pl);}
  bx(.5,.05,.06,M.woodK,-1.3,y0+1.75,-1.77);for(let i=0;i<4;i++)add(room,new THREE.SphereGeometry(.025,8,8),M.brass,-1.45+i*.1,y0+1.72,-1.73);
  bx(.3,.5,.03,ponchoC,-1.3,y0+1.45,-1.73);
  bx(1.3,1.95,.55,M.woodK,.2,y0+.975,-1.525);bx(1.38,.07,.6,M.woodM,.2,y0+1.99,-1.5);bx(1.3,.08,.55,M.woodM,.2,y0+.04,-1.525);
  for(const dx of [-.33,.33]){bx(.6,1.72,.025,M.woodM,.2+dx,y0+1.0,-1.24);bx(.46,1.52,.012,M.woodK,.2+dx,y0+1.0,-1.225)}
  for(const dx of [-.04,.04])cyl(.012,.012,.22,M.brass,.2+dx,y0+1.0,-1.21,8);
  const bz=-.6,sh=[.03,.43,.83,1.23,1.63];
  for(const dz of [-.55,.55])bx(.3,1.75,.03,M.woodM,1.43,y0+.875,bz+dz);
  bx(.02,1.75,1.1,M.woodK,1.585,y0+.875,bz);
  for(const h of sh)bx(.28,.03,1.07,M.woodM,1.43,y0+h,bz);
  {const bc=[0xb0302a,0x2a5a8a,0x3a7a4a,0xd9a22a,0x6a3d7a,0x8a5a32,0xe8e0cc,0x1f3a4a];
   for(let r=0;r<4;r++){let z=bz-.5;const base=y0+sh[r]+.015;
    while(z<bz+.46){const w=.035+rnd()*.035,h=.17+rnd()*.12;const b=bx(.2,h,w,std({color:bc[(rnd()*bc.length)|0],roughness:.85}),1.42,base+h/2,z+w/2);if(rnd()<.06)b.rotation.x=.25;z+=w+.004}}}
  cyl(.15,.11,.24,M.clay,1.3,y0+.12,-1.5,16);
  for(let i=0;i<9;i++){const a=i/9*6.28,l=add(room,new THREE.SphereGeometry(.09,8,6),i%2?M.leaf:M.leaf2,1.3+Math.cos(a)*.1,y0+.38+(i%3)*.1,-1.5+Math.sin(a)*.1);l.scale.set(.5,1.8,.5);l.rotation.z=Math.cos(a)*.5;l.rotation.x=Math.sin(a)*.5}
  bx(1.4,.04,.58,M.woodM,.3,y0+.72,.88);
  for(const [lx,lz] of [[-.35,.62],[-.35,1.12],[.95,1.12]])bx(.06,.7,.06,M.woodK,lx,y0+.35,lz);
  bx(1.2,.28,.02,M.woodK,.3,y0+.55,1.13);bx(.4,.68,.52,M.woodK,.72,y0+.34,.9);
  for(const dy of [.2,.5]){bx(.34,.26,.015,M.woodM,.72,y0+dy,.635);add(room,new THREE.SphereGeometry(.016,8,8),M.brass,.72,y0+dy,.625)}
  bx(.34,.018,.24,M.steel,.05,y0+.749,.8);bx(.3,.004,.16,M.blk,.05,y0+.76,.8);
  {const sc_=bx(.34,.22,.012,M.screen,.05,y0+.86,.93);sc_.rotation.x=.28;
   const lp=new THREE.Mesh(new THREE.PlaneGeometry(.31,.19),window.laptopMat||M.screen);lp.position.set(0,0,-.0066);lp.rotation.y=Math.PI;sc_.add(lp);}
  bx(.2,.03,.14,std({color:0x8a2a2a,roughness:.8}),-.25,y0+.755,.95);bx(.19,.03,.13,std({color:0x2a5a8a,roughness:.8}),-.25,y0+.785,.95);
  cyl(.045,.04,.1,M.clay,.45,y0+.79,1.05,14);for(let i=0;i<4;i++){const p=cyl(.006,.006,.2,std({color:[0xd9a22a,0xb0302a,0x2a5a8a,0x3a7a4a][i]}),.44+i*.01,y0+.92,1.05,6);p.rotation.z=(i-1.5)*.12}
  cyl(.07,.08,.02,M.blk,-.3,y0+.75,1.05,16);cyl(.008,.008,.28,M.blk,-.3,y0+.89,1.05,6);bx(.22,.012,.012,M.blk,-.21,y0+1.03,1.05).rotation.z=-.3;cyl(.02,.07,.07,M.blk,-.12,y0+1.03,1.05,14);
  add(room,RB(.46,.06,.44,.025),M.woodM,.3,y0+.45,.4);add(room,RB(.42,.06,.4,.03),cloth(0x3f6fbe),.3,y0+.5,.4);
  for(const [lx,lz] of [[.1,.2],[.5,.2],[.1,.58],[.5,.58]])bx(.04,.43,.04,M.woodK,lx,y0+.215,lz);
  for(const lx of [.1,.5])bx(.04,.5,.04,M.woodK,lx,y0+.7,.2);
  for(const dy of [.62,.76,.9])bx(.42,.07,.025,M.woodM,.3,y0+dy,.2);
  bx(.5,.46,1.0,M.woodK,1.3,y0+.23,.75);bx(.54,.05,1.04,M.woodM,1.3,y0+.485,.75);add(room,RB(.5,.03,.8,.012),aguC,1.3,y0+.52,.75);
  for(const pz of [.4,1.1])bx(.52,.1,.04,M.brass,1.3,y0+.35,pz);
  bx(2.4,.04,.16,M.woodL,.4,4.72,1.12);cyl(.014,.014,2.7,M.brass,.4,5.94,1.1,10).rotation.z=Math.PI/2;
  for(const [cx2,w] of [[-.62,.52],[1.42,.42]]){
    for(let k=0;k<5;k++)bx(w/5*1.05,1.18,.02,M.cream,cx2-w/2+w*(k+.5)/5,5.33,1.08+(k%2?.02:0));
    for(let k=0;k<4;k++)add(room,new THREE.TorusGeometry(.02,.006,6,10),M.brass,cx2-w/2+w*(k+.5)/4,5.94,1.1);}
  bx(.75,.52,.025,M.woodK,-1.55,y0+1.5,1.17);bx(.67,.44,.02,M.cork,-1.55,y0+1.5,1.155);
  [[-1.75,1.62,0xfff29a],[-1.5,1.45,0xffb0b0],[-1.35,1.62,0xb0e0ff]].forEach(n=>{bx(.12,.12,.004,std({color:n[2],roughness:1}),n[0],y0+n[1],1.14);add(room,new THREE.SphereGeometry(.009,6,6),M.brass,n[0],y0+n[1]+.045,1.135)});
  {const ck=cyl(.19,.19,.04,M.woodK,-2.0,y0+2.05,1.17,32);ck.rotation.x=Math.PI/2;const fc=cyl(.165,.165,.01,M.white,-2.0,y0+2.05,1.15,32);fc.rotation.x=Math.PI/2;
   bx(.012,.1,.004,M.blk,-2.0,y0+2.1,1.143);bx(.008,.13,.004,M.blk,-2.03,y0+2.03,1.143).rotation.z=.9;}
  const ceilUp=new THREE.Group();roofGroup.add(ceilUp);
  B(ceilUp,5.2,.06,3.0,M.woodL,-1,6.28,-.3,2);for(let i=0;i<6;i++)B(ceilUp,.14,.18,3.0,M.woodK,-3.3+i*.85,6.16,-.3,1);
  cyl(.005,.005,.3,M.blk,-1,6.1,-.3,6);add(room,new THREE.SphereGeometry(.07,14,12),M.bulb,-1,5.92,-.3,{cast:false});
  SEATS.push({name:'la silla del escritorio',x:.3,z:.4,eye:y0+.5+.62,yaw:Math.PI,floor:y0,sx:-.8,sz:.6,laptop:true});
  SEATS.push({name:'la cama',x:-3.0,z:-.1,eye:y0+.5+.6,yaw:-Math.PI/2,floor:y0,sx:-2.2,sz:-.1});
  SEATS.push({name:'el baúl andino',x:1.3,z:.4,eye:y0+.52+.62,yaw:Math.PI/2,floor:y0,sx:.9,sz:.05});
}

function buildBody(){
  const hW=roofY(3);
  B(house,12,hW,TH,mats.adobeBox,0,hW/2,-3+TH/2);
  for(const xe of [-6,6]){const pts=xe===-6?[[-3,0],[-1.3,0],[-1.3,2.1],[-.3,2.1],[-.3,0],[3,0],[3,roofY(3)],[0,HR],[-3,roofY(-3)]]:[[-3,0],[3,0],[3,roofY(3)],[0,HR],[-3,roofY(-3)]];const g=gableGeo(pts,TH);const m=new THREE.Mesh(g,mats.adobeShape);m.rotation.y=-Math.PI/2;m.position.set(xe===-6?xe+TH:xe,0,0);m.castShadow=m.receiveShadow=true;house.add(m)}
  B(house,12,.1,6,mats.floor,0,.09,0,2,{cast:false});
  B(house,.55,.45,5.4,mats.plinth,5.75,.225,0,2);B(house,12.2,.45,.55,mats.plinth,0,.225,-2.75,2);
  gableRoof(roofGroup,{x:-5.3,len:2.6,zr:0,runF:5.2,runB:3.65,ridgeY:HR,theta:16});
  gableRoof(roofGroup,{x:4.3,len:4.6,zr:0,runF:5.2,runB:3.65,ridgeY:HR,theta:16});
  roofSlab(roofGroup,{x:-1,len:6.02,zr:1.62,run:5.25-1.62,ridgeY:roofY(1.62),theta:16,side:1});
  roofSlab(roofGroup,{x:-1,len:6.02,zr:-2.2,run:3.7-2.2,ridgeY:roofY(2.2),theta:16,side:-1});
  B(roofGroup,6.05,.1,.12,mats.woodD,-1,HR-5.2*tanT+.02,5.24,1);B(roofGroup,6.05,.1,.12,mats.woodD,-1,HR-3.65*tanT+.02,-3.69,1);
  // vigas (rollizos) que sobresalen
  for(let i=0;i<13;i++){const x=-6+i*1;const m=add(house,new THREE.CylinderGeometry(.08,.08,.9,10),mats.woodD,x,2.88,3.35);m.rotation.x=Math.PI/2}
  // porche
  B(house,13,.3,3.1,mats.plinth,0,.15,4.45,3);
  B(house,13.2,.2,.3,mats.plinth,0,.1,5.95,2);
  const porchY=.3,postH=2.45,pz=5;
  for(const px of [-6.1,-2,2,6.1]){
    B(house,.6,.45,.6,mats.plinth,px,porchY+.22,pz,1.5);
    add(house,new THREE.BoxGeometry(.24,postH,.24),mats.woodD,px,porchY+.45+postH/2,pz);
    B(house,.34,.1,.34,mats.woodD,px,porchY+.45+postH,pz,1);
  }
  B(house,13,.26,.3,mats.woodD,0,porchY+.45+postH+.15,pz,1.2);
  for(const px of [-4,0,4]){B(house,.1,.1,2,mats.woodD,px,porchY+.45+postH+.15,pz-1,1)}
  // luz interior
  lights.body=new THREE.PointLight(0xffb45a,0,14,1.5);lights.body.position.set(0,2,0);house.add(lights.body);
  
}
buildBody();buildWing();buildUp();buildMainFront(3);buildWingFront();buildSecondFloorStairs();

// nieve más realista sobre los tejados (solo visible en modo nieve / helada)
snowGableRoof(roofSnowGroup,{x:-5.26,len:2.5,zr:0,runF:5.16,runB:3.61,ridgeY:HR,theta:16});
snowGableRoof(roofSnowGroup,{x:4.26,len:4.5,zr:0,runF:5.16,runB:3.61,ridgeY:HR,theta:16});
snowRoofSlab(roofSnowGroup,{x:-1,len:6,zr:1.62,run:5.18-1.62,ridgeY:roofY(1.62),theta:16,side:1});
snowRoofSlab(roofSnowGroup,{x:-1,len:6,zr:-2.2,run:3.63-2.2,ridgeY:roofY(2.2),theta:16,side:-1});
snowGableRoof(roofSnowGroup,{x:-8.1,len:5.02,zr:0,runF:3.01,runB:3.01,ridgeY:(2.7+2.5*Math.tan(THREE.MathUtils.degToRad(24))),theta:24});
snowGableRoof(roofSnowGroup,{x:-1.0,len:7.62,zr:-.3,runF:2.71,runB:2.71,ridgeY:(3.9+2.5+(1.9*Math.tan(THREE.MathUtils.degToRad(14)))),theta:14});
B(roofSnowGroup,2.76,.04,.72,snowRoofMat,-.90,5.98,1.72,1,{cast:false});
B(roofSnowGroup,2.88,.055,.12,snowRoofEdgeMat,-.90,6.02,2.10,1,{cast:false});

// escalones y senda de lajas
{const s=new THREE.Group();house.add(s);
  B(s,3.2,.18,1,mats.plinth,0,.09,6.5,2);B(s,2.6,.14,.7,mats.plinth,0,.07,7.2,2);
  let z=8.5;for(let i=0;i<9;i++){const w=1.7+rnd()*.5,d=.85+rnd()*.25;const m=add(s,boxGeo(w,.08,d,1.5),std({map:T.stone,roughness:1,color:0xcdbb9c}),(rnd()-.5)*.4,.04,z);m.rotation.y=(rnd()-.5)*.12;z+=1.3}
}
// paneles solares térmicos sobre la cubierta alta
// La bisagra está en el borde inferior: al aumentar el ángulo, el borde superior sube.
// El mínimo de 14° coincide con la pendiente de la cubierta y evita que el panel la atraviese.
const SOLAR_ROOF_ANGLE=14;
function buildSolarPanel(px,pz){
  const solar=new THREE.Group();solar.position.set(px,6.43,pz);house.add(solar);
  const solarPivot=new THREE.Group();solarPivot.position.set(0,.12,0);solar.add(solarPivot);
  const PW=2.35,PD=1.55;
  B(solarPivot,PW,.065,PD,mats.metal,0,0,-PD/2,1);
  B(solarPivot,PW-.14,.028,PD-.14,mats.panel,0,.052,-PD/2,1,{cast:false});
  B(solarPivot,PW+.04,.08,.07,mats.metal,0,.08,-.035,1);
  B(solarPivot,PW+.04,.08,.07,mats.metal,0,.08,-PD+.035,1);
  B(solarPivot,.07,.08,PD,mats.metal,-PW/2,.08,-PD/2,1);
  B(solarPivot,.07,.08,PD,mats.metal,PW/2,.08,-PD/2,1);
  // apoyos discretos, mejor alineados con el techo
  for(const x of [-.82,.82]){
    B(solar,.10,.18,.10,mats.metal,x,.02,0,1);
    B(solar,.08,.24,.08,mats.metal,x,.14,-1.20,1);
  }
  return {root:solar,pivot:solarPivot};
}
const solarPanels=[buildSolarPanel(-1.35,1.58),buildSolarPanel(1.35,1.58)];
const solar=solarPanels[0].root;
const solarPivot=solarPanels[0].pivot;
const solarPivots=solarPanels.map(s=>s.pivot);

/* ================== ENTORNO REALISTA ================== */
const grassTime={value:0};
function radialTex(stops){const cv=document.createElement('canvas');cv.width=cv.height=256;const g=cv.getContext('2d');const gr=g.createRadialGradient(128,128,0,128,128,128);stops.forEach(s=>gr.addColorStop(s[0],s[1]));g.fillStyle=gr;g.fillRect(0,0,256,256);const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;return t}
const puffTex=radialTex([[0,'rgba(255,255,255,.9)'],[1,'rgba(255,255,255,0)']]);
function cloudTexture(){const S=256;const cv=document.createElement('canvas');cv.width=cv.height=S;const g=cv.getContext('2d');const im=g.createImageData(S,S);
  for(let y=0;y<S;y++)for(let x=0;x<S;x++){const dx=(x-128)/128,dy=(y-128)/128;const fall=clamp(1-Math.hypot(dx,dy*1.5),0,1);const n=fbm(x/S*6,y/S*6,6,5,41);const a=clamp((n*1.5-.35)*smooth(0,.6,fall),0,1);const sh=.82+.18*fbm(x/S*5,y/S*5+.3,5,3,42);const i=(y*S+x)*4;im.data[i]=im.data[i+1]=im.data[i+2]=255*sh;im.data[i+3]=a*235}
  g.putImageData(im,0,0);const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;return t}
window._cloudMat=new THREE.SpriteMaterial({map:cloudTexture(),transparent:true,opacity:.85,depthWrite:false,fog:false});
for(let c=0;c<14;c++){const a=rnd()*6.28,r=250+rnd()*600,cx=Math.cos(a)*r,cz=Math.sin(a)*r,cy=170+rnd()*120;for(let k=0;k<4;k++){const s=new THREE.Sprite(_cloudMat);s.position.set(cx+(rnd()-.5)*180,cy+(rnd()-.5)*20,cz+(rnd()-.5)*180);const w=200+rnd()*220;s.scale.set(w,w*.45,1);scene.add(s)}}

// --------- Sol y luna visibles ---------
const sunCore=new THREE.Sprite(new THREE.SpriteMaterial({map:radialTex([[0,'rgba(255,255,255,1)'],[.17,'rgba(255,252,230,1)'],[.26,'rgba(255,225,150,.5)'],[.5,'rgba(255,200,110,.12)'],[1,'rgba(255,190,100,0)']]),blending:THREE.AdditiveBlending,transparent:true,depthWrite:false,fog:false,toneMapped:false}));
const sunGlow=new THREE.Sprite(new THREE.SpriteMaterial({map:radialTex([[0,'rgba(255,230,170,.55)'],[.25,'rgba(255,210,140,.2)'],[1,'rgba(255,200,120,0)']]),blending:THREE.AdditiveBlending,transparent:true,depthWrite:false,fog:false,toneMapped:false}));
sunCore.scale.set(430,430,1);sunGlow.scale.set(2100,2100,1);sunCore.renderOrder=3;sunGlow.renderOrder=2;scene.add(sunGlow,sunCore);
const moon=(()=>{const cv=document.createElement('canvas');cv.width=cv.height=128;const g=cv.getContext('2d');g.fillStyle='#e8ecf2';g.beginPath();g.arc(64,64,52,0,7);g.fill();for(let i=0;i<14;i++){g.fillStyle='rgba(120,130,150,.35)';g.beginPath();g.arc(64+(rnd()-.5)*70,64+(rnd()-.5)*70,3+rnd()*8,0,7);g.fill()}const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,fog:false,depthWrite:false,toneMapped:false}));s.scale.set(120,120,1);return s})();scene.add(moon);
const sunDisc=new THREE.Sprite(new THREE.SpriteMaterial({map:radialTex([[0,'rgba(255,255,255,1)'],[.55,'rgba(255,253,240,1)'],[.7,'rgba(255,244,200,.9)'],[.85,'rgba(255,220,150,.25)'],[1,'rgba(255,200,120,0)']]),blending:THREE.AdditiveBlending,transparent:true,depthWrite:false,fog:false,toneMapped:false}));
sunDisc.scale.set(170,170,1);sunDisc.renderOrder=4;scene.add(sunDisc);
const sunBurst=new THREE.Sprite(new THREE.SpriteMaterial({map:(()=>{const S=512,cv=document.createElement('canvas');cv.width=cv.height=S;const g=cv.getContext('2d');g.translate(S/2,S/2);
  for(let i=0;i<32;i++){g.save();g.rotate(i/32*Math.PI*2);const len=S*(i%4===0?.5:i%2?.26:.38);const gr=g.createLinearGradient(0,0,len,0);gr.addColorStop(0,'rgba(255,238,180,.75)');gr.addColorStop(1,'rgba(255,200,120,0)');g.fillStyle=gr;g.beginPath();g.moveTo(0,-S*.008);g.lineTo(len,0);g.lineTo(0,S*.008);g.closePath();g.fill();g.restore()}
  const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;return t})(),blending:THREE.AdditiveBlending,transparent:true,depthWrite:false,fog:false,toneMapped:false}));
sunBurst.scale.set(1500,1500,1);sunBurst.renderOrder=2;scene.add(sunBurst);
const sunHalo=new THREE.Sprite(new THREE.SpriteMaterial({map:radialTex([[0,'rgba(255,255,255,0)'],[.55,'rgba(255,255,255,0)'],[.66,'rgba(255,180,120,.10)'],[.72,'rgba(255,255,170,.14)'],[.78,'rgba(150,255,200,.08)'],[.86,'rgba(150,190,255,.06)'],[1,'rgba(255,255,255,0)']]),blending:THREE.AdditiveBlending,transparent:true,depthWrite:false,fog:false,toneMapped:false}));
sunHalo.scale.set(3300,3300,1);sunHalo.renderOrder=1;scene.add(sunHalo);
const flareDefs=[[.55,.07,'255,230,160',.35],[-.35,.16,'255,170,90',.18],[-.8,.07,'160,220,255',.25],[-1.25,.22,'255,200,130',.12],[1.6,.1,'255,140,200',.16],[.2,.04,'255,255,255',.4]];
const flares=flareDefs.map(d=>{const s=new THREE.Sprite(new THREE.SpriteMaterial({map:radialTex([[0,`rgba(${d[2]},0)`],[.6,`rgba(${d[2]},.35)`],[.86,`rgba(${d[2]},.9)`],[1,`rgba(${d[2]},0)`]]),blending:THREE.AdditiveBlending,transparent:true,depthWrite:false,depthTest:false,fog:false,toneMapped:false}));s.renderOrder=20;s.visible=false;scene.add(s);return s});
const flareRay=new THREE.Raycaster();let flareVis=0,flareTick=0,flareOcc=false;
function updateSunSprites(){
  const y=sunDir.y;const vis=smooth(-.07,.03,y);const k=smooth(0,.4,y);const pos=camera.position;
  sunCore.position.copy(pos).addScaledVector(sunDir,1800);sunGlow.position.copy(sunCore.position);
  sunDisc.position.copy(sunCore.position);sunBurst.position.copy(sunCore.position);sunHalo.position.copy(sunCore.position);
  sunCore.material.opacity=vis*.9;sunGlow.material.opacity=vis*(state.fog?.5:1)*1.15;
  sunCore.material.color.setRGB(1,lerp(.55,1,k),lerp(.25,.92,k));sunGlow.material.color.copy(sunCore.material.color);sunBurst.material.color.copy(sunCore.material.color);
  sunDisc.material.color.setRGB(1,lerp(.8,1,k),lerp(.55,.97,k));
  const sc=lerp(1.5,1,k);sunCore.scale.set(520*sc,520*sc,1);sunGlow.scale.set(2600*sc,2600*sc,1);sunDisc.scale.set(170*sc,170*sc,1);
  const fogK=state.fog?.35:1,rainK=state.rain?.3:1;
  sunDisc.material.opacity=vis*Math.max(.35,fogK*rainK);sunBurst.material.opacity=vis*.55*fogK*rainK*(.6+.4*k);sunHalo.material.opacity=vis*.9*fogK*rainK*k;
  sunBurst.material.rotation=performance.now()*.00004;
  moon.position.copy(pos).addScaledVector(sunDir,-1700);moon.material.opacity=nightF;
  if(++flareTick%8===0){flareRay.set(pos,sunDir);flareRay.far=300;flareRay.camera=camera;let hit=false;try{hit=flareRay.intersectObject(house,true).some(h=>h.object.isMesh&&h.object.visible&&!(h.object.material&&h.object.material.transparent&&h.object.material.opacity<.6))}catch(e){}flareOcc=hit}
  const v=sunCore.position.clone().project(camera);
  const on=v.z<1&&Math.abs(v.x)<1.2&&Math.abs(v.y)<1.2&&!flareOcc&&vis>.3&&y>.02;
  const edge=on?Math.max(0,1-Math.hypot(v.x,v.y)*.55):0;
  flareVis+=((on?edge*(state.fog?.4:1)*(state.rain?.2:1):0)-flareVis)*.15;
  flares.forEach((f,i)=>{const d=flareDefs[i];f.visible=flareVis>.01;if(!f.visible)return;
    const p=new THREE.Vector3(v.x*d[0],v.y*d[0],.5).unproject(camera).sub(pos).normalize();
    f.position.copy(pos).addScaledVector(p,40);const sz=d[1]*2*40*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*(i===0?1.6:1);f.scale.set(sz,sz,1);f.material.opacity=flareVis*d[3]*(i===0?2:1)});
}

// --------- rayos solares didácticos ---------
const MAX_RAYS=24;
const sunRayGroup=new THREE.Group();sunRayGroup.visible=false;scene.add(sunRayGroup);
const sunPathGroup=new THREE.Group();sunPathGroup.visible=false;scene.add(sunPathGroup);
const rayLines=[];
for(let i=0;i<MAX_RAYS;i++){
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(6),3));
  const mat=new THREE.LineBasicMaterial({color:0xffd36a,transparent:true,opacity:.72,depthWrite:false,blending:THREE.AdditiveBlending});
  const ln=new THREE.Line(geo,mat);ln.frustumCulled=false;sunRayGroup.add(ln);rayLines.push(ln);
}
const hitGeo=new THREE.SphereGeometry(.065,10,10),hitMat=new THREE.MeshBasicMaterial({color:0x7ee08a,transparent:true,opacity:.85,depthWrite:false});
const sunHits=new THREE.InstancedMesh(hitGeo,hitMat,MAX_RAYS);sunHits.frustumCulled=false;sunRayGroup.add(sunHits);
const hitDummy=new THREE.Object3D();
function rayTargetPoints(){
  const mode=$('rayTarget')?.value||'house',pts=[];
  if(mode==='panel'){
    // puntos reales sobre los dos paneles, transformados a coordenadas del mundo
    solarPivots.forEach(pivot=>{
      for(const x of [-.82,0,.82])for(const z of [-.22,-.72,-1.22])pts.push(pivot.localToWorld(new THREE.Vector3(x,.10,z)));
    });
  }else if(mode==='window'){
    for(const x of [1.55,2.05,2.55,3.05,3.45])for(const y of [1.25,1.75,2.15])pts.push(new THREE.Vector3(x,y,3.05));
  }else{
    // cubierta, fachada y ventana principal
    for(const x of [-5,-2.5,0,2.5,5])pts.push(new THREE.Vector3(x,roofY(1.6)+.12,1.6));
    for(const x of [-3,0,3])pts.push(new THREE.Vector3(x,2.1,3.05));
    for(const x of [1.6,2.5,3.4])pts.push(new THREE.Vector3(x,1.65,3.08));
    pts.push(new THREE.Vector3(-1,6.75,.6));
  }
  return pts.slice(0,MAX_RAYS);
}
function sunVectorAt(h){const a=Math.PI*(h-6)/12;return new THREE.Vector3(Math.cos(a)*.95,Math.sin(a)*.92,Math.sin(a)*.34).normalize()}
{const pts=[];for(let h=5.7;h<=18.3;h+=.18){const v=sunVectorAt(h).multiplyScalar(34);v.y+=2.2;pts.push(v)}
 const geo=new THREE.BufferGeometry().setFromPoints(pts);const mat=new THREE.LineBasicMaterial({color:0xffc85d,transparent:true,opacity:.7,depthWrite:false});sunPathGroup.add(new THREE.Line(geo,mat));
 for(const h of [6,9,12,15,18]){const v=sunVectorAt(h).multiplyScalar(34);v.y+=2.2;const m=new THREE.Mesh(new THREE.SphereGeometry(.16,10,10),new THREE.MeshBasicMaterial({color:0xffd36a}));m.position.copy(v);sunPathGroup.add(m)}}
function updateSunRays(){
  const daylight=sunDir.y>.015,pwr=+$('rayPower').value/100;$('rayTxt').textContent=Math.round(pwr*100)+'%';
  sunRayGroup.visible=state.sunRays&&daylight;sunPathGroup.visible=state.sunTrack;
  const pts=rayTargetPoints(),offset=sunDir.clone().multiplyScalar(36);
  for(let i=0;i<MAX_RAYS;i++){
    const ln=rayLines[i];
    if(i<pts.length){const end=pts[i],start=end.clone().add(offset),a=ln.geometry.attributes.position.array;a[0]=start.x;a[1]=start.y;a[2]=start.z;a[3]=end.x;a[4]=end.y;a[5]=end.z;ln.geometry.attributes.position.needsUpdate=true;ln.visible=true;ln.material.opacity=.28+.72*pwr*smooth(0,.30,sunDir.y);hitDummy.position.copy(end);hitDummy.scale.setScalar(.65+.55*pwr)}
    else{ln.visible=false;hitDummy.scale.setScalar(0)}
    hitDummy.updateMatrix();sunHits.setMatrixAt(i,hitDummy.matrix);
  }
  sunHits.instanceMatrix.needsUpdate=true;hitMat.opacity=.35+.5*pwr;
  const el=THREE.MathUtils.radToDeg(Math.asin(sunDir.y)),mode=$('rayTarget')?.selectedOptions?.[0]?.textContent||'la vivienda';
  $('rayInfo').innerHTML=daylight?`Elevación del Sol: <b>${el.toFixed(1)}°</b><br>Visualizando incidencia sobre: <b>${mode}</b>.`:'El Sol está bajo el horizonte. Cambia la hora para volver a ver radiación directa.';
}

// --------- vegetación ---------
function cardTexture(kind){const S=256;const cv=document.createElement('canvas');cv.width=cv.height=S;const g=cv.getContext('2d');
  if(kind==='euca'){for(let i=0;i<150;i++){const a0=rnd()*6.28,rr=Math.sqrt(rnd())*100;const x=128+Math.cos(a0)*rr,y=128+Math.sin(a0)*rr*.9;const ang=Math.PI/2+(rnd()-.5)*1.4,l=24+rnd()*26;
      const h=95+rnd()*35,s=14+rnd()*14,li=26+rnd()*26;g.fillStyle=`hsl(${h},${s}%,${li}%)`;g.beginPath();const ex=x+Math.cos(ang)*l,ey=y+Math.sin(ang)*l,nx=-Math.sin(ang),ny=Math.cos(ang);
      g.moveTo(x,y);g.quadraticCurveTo((x+ex)/2+nx*6,(y+ey)/2+ny*6,ex,ey);g.quadraticCurveTo((x+ex)/2-nx*6,(y+ey)/2-ny*6,x,y);g.fill();}
    g.strokeStyle='rgba(60,50,40,.7)';g.lineWidth=1.2;for(let i=0;i<9;i++){g.beginPath();g.moveTo(128,128);g.quadraticCurveTo(128+(rnd()-.5)*100,128+(rnd()-.5)*80,128+(rnd()-.5)*190,128+(rnd()-.5)*160);g.stroke()}}
  else if(kind==='shrub'){for(let i=0;i<190;i++){const a0=rnd()*6.28,rr=Math.sqrt(rnd())*105;const x=128+Math.cos(a0)*rr,y=128+Math.sin(a0)*rr;g.fillStyle=`hsl(${75+rnd()*35},${35+rnd()*25}%,${24+rnd()*22}%)`;g.beginPath();g.ellipse(x,y,3+rnd()*3,9+rnd()*9,rnd()*3.1,0,7);g.fill()}
    for(let i=0;i<48;i++){const a0=rnd()*6.28,rr=Math.sqrt(rnd())*100;g.fillStyle=`hsl(${44+rnd()*12},95%,${52+rnd()*14}%)`;g.beginPath();g.arc(128+Math.cos(a0)*rr,128+Math.sin(a0)*rr,2.5+rnd()*3.2,0,7);g.fill()}}
  else{for(let i=0;i<46;i++){const x0=20+rnd()*216,lean=(rnd()-.5)*70,h=90+rnd()*150,w=2+rnd()*3;const t=140+rnd()*115;g.fillStyle=`rgb(${t},${t},${t*.9})`;g.beginPath();g.moveTo(x0-w,S);g.quadraticCurveTo(x0-w+lean*.2,S-h*.6,x0+lean,S-h);g.quadraticCurveTo(x0+w+lean*.3,S-h*.6,x0+w,S);g.fill()}
    const gr=g.createLinearGradient(0,S,0,S*.45);gr.addColorStop(0,'rgba(0,0,0,.55)');gr.addColorStop(1,'rgba(0,0,0,0)');g.globalCompositeOperation='source-atop';g.fillStyle=gr;g.fillRect(0,0,S,S)}
  const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t}
function cardGeo(w,h,crossed,lift){const list=[];const mk=(rot,flip)=>{const q=new THREE.PlaneGeometry(w,h);q.translate(0,lift?h/2:0,0);if(flip)q.rotateY(Math.PI);q.rotateY(rot);return q};
  for(let k=0;k<(crossed?2:1);k++){list.push(mk(k*Math.PI/2,false));list.push(mk(k*Math.PI/2,true))}
  const pos=[],uv=[],idx=[];let off=0;list.forEach(q=>{const p=q.attributes.position,u=q.attributes.uv;for(let i=0;i<p.count;i++){pos.push(p.getX(i),p.getY(i),p.getZ(i));uv.push(u.getX(i),u.getY(i))}Array.from(q.index.array).forEach(i=>idx.push(i+off));off+=p.count});
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);
  g.setAttribute('normal',new THREE.Float32BufferAttribute(pos.map((v,i)=>i%3===1?1:0),3));return g}
const eucaMat=new THREE.MeshStandardMaterial({map:cardTexture('euca'),alphaTest:.45,roughness:.85,envMapIntensity:.5});
const shrubMat=new THREE.MeshStandardMaterial({map:cardTexture('shrub'),alphaTest:.45,roughness:.9,envMapIntensity:.4});
const grassMat=new THREE.MeshStandardMaterial({map:cardTexture('grass'),alphaToCoverage:true,alphaTest:.3,roughness:1,side:THREE.FrontSide,envMapIntensity:.3});
grassMat.onBeforeCompile=sh=>{sh.uniforms.uTime=grassTime;sh.vertexShader='uniform float uTime;\n'+sh.vertexShader.replace('#include <begin_vertex>',`vec3 transformed=vec3(position);float wv=position.y*position.y;
 #ifdef USE_INSTANCING
 vec3 ip=instanceMatrix[3].xyz;
 #else
 vec3 ip=vec3(0.);
 #endif
 transformed.x+=sin(uTime*1.6+ip.x*.45+ip.z*.3)*.16*wv;transformed.z+=cos(uTime*1.2+ip.z*.4+ip.x*.2)*.1*wv;`)};
const barkTex=toTex(makeTexture(128,(u,v)=>{const k=.5+.55*fbm(u*4,v*28,32,4,51);return [clamp(118*k,0,255),clamp(104*k,0,255),clamp(90*k,0,255)]}).cv,{repeat:[2,3]});
const barkMat=std({map:barkTex,bumpMap:barkTex,bumpScale:3,roughness:1});

const bad=(x,z)=>(x>-13&&x<14&&z>-5&&z<11)||(Math.abs(x)<1.8&&z>4&&z<26)||(Math.abs(x-pathX(z))<1.4&&z>=26&&z<160)||(x>-23&&x<-11&&z>-1&&z<8)||(x>13&&x<26&&z>3&&z<17)||(x>-14&&x<-5&&z>-6&&z<-1);
const dummy=new THREE.Object3D();
const cardEuca=cardGeo(3.4,3.0,false,false);
const eucaInst=[],eucaCol=[];
function eucalyptus(x,z,sc){
  const base=new THREE.Vector3(x,hFn(x,z)-.2,z);const H=(9+rnd()*7)*sc;const g=new THREE.Group();g.position.copy(base);scene.add(g);
  const lean=new THREE.Vector2((rnd()-.5)*.5,(rnd()-.5)*.5);let cur=new THREE.Vector3();const seg=5,r0=.33*sc;
  for(let i=0;i<seg;i++){const nxt=cur.clone().add(new THREE.Vector3(lean.x*H/seg+(rnd()-.5)*.25,H/seg,lean.y*H/seg+(rnd()-.5)*.25));
    const rb=r0*(1-i/seg*.82),rt=r0*(1-(i+1)/seg*.82);const v=nxt.clone().sub(cur);const m=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,v.length(),9),barkMat);m.position.copy(cur).add(nxt).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.clone().normalize());m.castShadow=m.receiveShadow=true;g.add(m);cur=nxt}
  const top=cur.clone();const nb=7+Math.floor(rnd()*4);const ends=[];
  for(let i=0;i<nb;i++){const t=.45+.5*(i/nb);const sp=new THREE.Vector3(lean.x*H*t,H*t,lean.y*H*t);const a=i*2.4+rnd(),len=(2.2+rnd()*2.6)*sc*(1.15-t*.5);
    const ep=sp.clone().add(new THREE.Vector3(Math.cos(a)*len,len*.55+rnd()*1.2,Math.sin(a)*len));const v=ep.clone().sub(sp);
    const m=new THREE.Mesh(new THREE.CylinderGeometry(.04*sc,.1*sc,v.length(),6),barkMat);m.position.copy(sp).add(ep).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.clone().normalize());m.castShadow=true;g.add(m);ends.push(ep)}
  ends.push(top.clone().add(new THREE.Vector3(0,1.2,0)));
  for(const ep of ends)for(let k=0;k<9;k++){
    dummy.position.set(base.x+ep.x+(rnd()-.5)*3.6*sc,base.y+ep.y+(rnd()-.4)*2.4*sc,base.z+ep.z+(rnd()-.5)*3.6*sc);
    dummy.rotation.set((rnd()-.5)*.9,rnd()*6.28,(rnd()-.5)*.9);const s=(1.0+rnd()*.9)*sc;dummy.scale.set(s,s,s);dummy.updateMatrix();
    eucaInst.push(dummy.matrix.clone());const hFrac=clamp((ep.y)/(H*1.1),0,1);eucaCol.push(new THREE.Color().setHSL(.24+rnd()*.05,.2+rnd()*.12,.55+.45*hFrac*(.7+rnd()*.5)))}
}
[[-15,-9,1.1],[14,-11,1.2],[-25,-2,1],[27,-6,1.15],[-29,15,1.05],[31,23,1.1],[-21,27,.95],[8,-18,1.2],[22,-16,1]].forEach(t=>eucalyptus(t[0],t[1],t[2]));
for(let i=0;i<55;i++){const a=rnd()*6.28,r=42+rnd()*150,x=Math.cos(a)*r,z=Math.sin(a)*r;if(Math.abs(x-pathX(z))<4&&z>10)continue;eucalyptus(x,z,.85+rnd()*.5)}
{const im=new THREE.InstancedMesh(cardEuca,eucaMat,eucaInst.length);eucaInst.forEach((m,i)=>{im.setMatrixAt(i,m);im.setColorAt(i,eucaCol[i])});im.castShadow=true;scene.add(im)}
{const geo=cardGeo(2.2,1.8,true,true),N=130,im=new THREE.InstancedMesh(geo,shrubMat,N);let k=0;const c=new THREE.Color();
  while(k<N){const a=rnd()*6.28,r=12+rnd()*95,x=Math.cos(a)*r,z=Math.sin(a)*r;if(bad(x,z)||Math.hypot(x,z)<14)continue;dummy.position.set(x,hFn(x,z)-.05,z);dummy.rotation.set(0,rnd()*6.28,0);const s=.7+rnd()*1.2;dummy.scale.set(s,s*(.8+rnd()*.5),s);dummy.updateMatrix();im.setMatrixAt(k,dummy.matrix);c.setHSL(.2+rnd()*.07,.3,.5+rnd()*.35);im.setColorAt(k,c);k++}
  im.castShadow=true;im.userData.qualityVegetation=true;im.userData.maxCount=N;scene.add(im)}
function grassField(N,rMin,rMax,scMin,scMax){const geo=cardGeo(1.0,.85,true,true);const im=new THREE.InstancedMesh(geo,grassMat,N);const c=new THREE.Color();let k=0,tries=0;
  while(k<N&&tries++<N*8){const a=rnd()*6.28,r=rMin+Math.sqrt(rnd())*(rMax-rMin),x=Math.cos(a)*r,z=Math.sin(a)*r;if(bad(x,z))continue;
    dummy.position.set(x,hFn(x,z)-.02,z);dummy.rotation.set(0,rnd()*6.28,0);const s=scMin+rnd()*(scMax-scMin);dummy.scale.set(s*(.8+rnd()*.7),s*(.6+rnd()*.9),s*(.8+rnd()*.7));dummy.updateMatrix();im.setMatrixAt(k,dummy.matrix);
    const dry=fbm(x*.04,z*.04,1024,3,12);c.setHSL(lerp(.22,.12,smooth(.4,.7,dry))+rnd()*.03,.35+rnd()*.25,.34+rnd()*.2);im.setColorAt(k,c);k++}
  im.count=k;im.userData.qualityVegetation=true;im.userData.maxCount=k;scene.add(im)}
grassField(16000,5,45,.7,1.25);grassField(14000,45,150,1.1,2.0);
{const geo=new THREE.IcosahedronGeometry(.06,0),N=1100,im=new THREE.InstancedMesh(geo,std({color:0xffffff,roughness:.7}),N);let k=0;const pal=[0xf2d03b,0xffffff,0xb06ad6,0xff8f3a,0xe85a7a];const c=new THREE.Color();
  while(k<N){const a=rnd()*6.28,r=7+rnd()*55,x=Math.cos(a)*r,z=Math.sin(a)*r;if(bad(x,z))continue;dummy.position.set(x,hFn(x,z)+.25+rnd()*.35,z);dummy.rotation.set(0,0,0);const s=.8+rnd()*1.2;dummy.scale.set(s,s*.7,s);dummy.updateMatrix();im.setMatrixAt(k,dummy.matrix);c.setHex(pal[Math.floor(rnd()*pal.length)]);im.setColorAt(k,c);k++}
  im.userData.qualityVegetation=true;im.userData.maxCount=N;scene.add(im)}
{const leaf=new THREE.ConeGeometry(.16,1.5,5);leaf.translate(0,.75,0);const am=std({color:0x7e9a6a,roughness:.7});
  [[-11,8.5],[12,9.5],[-9,-5.5],[17.5,-3],[-27,8],[25,-10]].forEach(p=>{const g=new THREE.Group();g.position.set(p[0],hFn(p[0],p[1]),p[1]);scene.add(g);for(let i=0;i<14;i++){const m=new THREE.Mesh(leaf,am);m.rotation.set(0,i*2.4,.55+rnd()*.5);m.scale.setScalar(.8+rnd()*.5);m.castShadow=true;g.add(m)}})}
{const stoneI=new THREE.InstancedMesh(new THREE.DodecahedronGeometry(.5,0),std({color:0xffffff,roughness:1,flatShading:true}),1500);let k=0;const c=new THREE.Color();
  function pirca(x1,z1,x2,z2,rows=3){const L=Math.hypot(x2-x1,z2-z1),n=Math.floor(L/.55);for(let r=0;r<rows;r++)for(let i=0;i<n;i++){if(k>=1500)return;const t=i/n,x=lerp(x1,x2,t)+(rnd()-.5)*.1,z=lerp(z1,z2,t)+(rnd()-.5)*.1;const s=.4+rnd()*.35;dummy.position.set(x,r*.32+.2,z);dummy.rotation.set(rnd()*3,rnd()*3,rnd()*3);dummy.scale.set(s*1.2,s*.75,s);dummy.updateMatrix();stoneI.setMatrixAt(k,dummy.matrix);const g=.42+rnd()*.28;c.setRGB(g,g*.95,g*.88);stoneI.setColorAt(k,c);k++}}
  pirca(-23,-1.5,-11.2,-1.5,3);pirca(-23,-1.5,-23,8.5,3);pirca(-23,8.5,-11.2,8.5,2);pirca(-11.2,8.5,-11.2,5.5,2);
  pirca(26.5,-14,26.5,-4,2);pirca(26.5,-4,32,2,2);
  stoneI.count=k;stoneI.castShadow=stoneI.receiveShadow=true;scene.add(stoneI)}
for(let i=0;i<60;i++){const a=rnd()*6.28,r=10+rnd()*70;const x=Math.cos(a)*r,z=Math.sin(a)*r;if(bad(x,z))continue;const s=.15+rnd()*.8;
  const m=new THREE.Mesh(new THREE.DodecahedronGeometry(s,1),mats.rock);m.position.set(x,hFn(x,z)+s*.25,z);m.scale.set(1+rnd()*.6,.55+rnd()*.3,1+rnd()*.4);m.rotation.set(rnd()*3,rnd()*3,rnd()*3);m.castShadow=m.receiveShadow=true;scene.add(m)}
{const f=new THREE.Group();f.position.set(-17,0,3.5);scene.add(f);
  add(f,new THREE.BoxGeometry(11,.12,9.5),std({color:0x6b5035,roughness:1,map:T.field}),0,.06,0,{cast:false});
  for(let i=0;i<9;i++){add(f,new THREE.BoxGeometry(.65,.28,9),std({color:0x5a432c,roughness:1}),-4.6+i*1.15,.2,0,{cast:false})}
  const leafG=new THREE.IcosahedronGeometry(.17,0),N=9*14*4,li=new THREE.InstancedMesh(leafG,std({color:0xffffff,roughness:.8,flatShading:true}),N),fl=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(.045,0),std({color:0xffffff,roughness:.6}),9*14);let k=0,q=0;const c=new THREE.Color();
  for(let i=0;i<9;i++)for(let j=0;j<14;j++){const x=-4.6+i*1.15,z=-4+j*.62;for(let l=0;l<4;l++){dummy.position.set(x+(rnd()-.5)*.35,.42+rnd()*.12,z+(rnd()-.5)*.3);dummy.rotation.set(rnd()*3,rnd()*3,rnd()*3);const s=.8+rnd()*.7;dummy.scale.set(s*1.4,s*.8,s*1.1);dummy.updateMatrix();li.setMatrixAt(k,dummy.matrix);c.setHSL(.27+rnd()*.06,.5,.2+rnd()*.14);li.setColorAt(k,c);k++}
    dummy.position.set(x,.68,z);dummy.rotation.set(0,0,0);dummy.scale.setScalar(1);dummy.updateMatrix();fl.setMatrixAt(q,dummy.matrix);c.setHex(rnd()<.5?0xffffff:0xb89ad6);fl.setColorAt(q,c);q++}
  li.castShadow=true;f.add(li,fl)}
const corral=new THREE.Group();scene.add(corral);
{const x0=14,x1=25,z0=4.5,z1=16;const post=(x,z)=>{const h=1.1+rnd()*.2;add(corral,new THREE.CylinderGeometry(.07,.09,h,7),mats.woodD,x,h/2,z)};
  const rail=(ax,az,bx,bz)=>{const L=Math.hypot(bx-ax,bz-az);for(const y of [.45,.85]){const m=add(corral,new THREE.CylinderGeometry(.035,.035,L,6),mats.wood,(ax+bx)/2,y,(az+bz)/2);m.rotation.order='YXZ';m.rotation.y=Math.atan2(bx-ax,bz-az);m.rotation.x=Math.PI/2}}
  const edges=[[x0,z0,x1,z0],[x1,z0,x1,z1],[x1,z1,x0,z1],[x0,z1,x0,10.5],[x0,8.2,x0,z0]];
  edges.forEach(e=>{const L=Math.hypot(e[2]-e[0],e[3]-e[1]),n=Math.ceil(L/1.6);for(let i=0;i<=n;i++)post(lerp(e[0],e[2],i/n),lerp(e[1],e[3],i/n));rail(e[0],e[1],e[2],e[3])})}

// letrero con el nombre del creador
{const cv=document.createElement('canvas');cv.width=1024;cv.height=512;const g=cv.getContext('2d');
  const gr=g.createLinearGradient(0,0,0,512);gr.addColorStop(0,'#6b4529');gr.addColorStop(1,'#4a2d18');g.fillStyle=gr;g.fillRect(0,0,1024,512);
  for(let i=0;i<260;i++){g.strokeStyle=`rgba(${20+rnd()*40|0},${10+rnd()*20|0},5,${.05+rnd()*.12})`;g.lineWidth=1+rnd()*2;g.beginPath();const y=rnd()*512;g.moveTo(0,y);g.bezierCurveTo(300,y+rnd()*10-5,700,y+rnd()*10-5,1024,y+rnd()*6-3);g.stroke()}
  g.strokeStyle='#e8c88a';g.lineWidth=8;g.strokeRect(22,22,980,468);g.textAlign='center';g.fillStyle='#f7e3bd';
  g.font='bold 49px Georgia, serif';g.fillText('VIVIENDA SEGURA Y SOSTENIBLE',512,120);
  g.font='italic 36px Georgia, serif';g.fillText('Diseño Matemático · Julcán, Perú',512,182);
  g.fillStyle='#ffcf8a';g.fillRect(212,214,600,4);
  g.fillStyle='#f7e3bd';g.font='32px Georgia, serif';g.fillText('Adobe mejorado · energía solar',512,280);
  g.fillStyle='#ffffff';g.font='bold 76px Georgia, serif';g.fillText('ESTEYBIN LÓPEZ',512,362);
  g.fillStyle='#e8c88a';g.font='30px Georgia, serif';g.fillText('Los Picapiedras · 4.° A · Matemática 2026',512,432);
  const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=8;
  const sg=new THREE.Group();sg.position.set(-6.2,0,11.5);sg.rotation.y=.28;scene.add(sg);
  for(const dx of [-1.15,1.15])add(sg,new THREE.CylinderGeometry(.07,.09,2.3,8),mats.woodD,dx,1.15,0);
  add(sg,new THREE.BoxGeometry(2.7,1.35,.09),mats.woodD,0,1.55,0);
  const face=new THREE.Mesh(new THREE.PlaneGeometry(2.55,1.275),new THREE.MeshStandardMaterial({map:tex,roughness:.8}));face.position.set(0,1.55,.055);face.castShadow=true;sg.add(face);
  add(sg,new THREE.BoxGeometry(2.9,.1,.22),mats.tile,0,2.3,0)}

// humo
const smoke=[];const smokeMat=new THREE.SpriteMaterial({map:puffTex,color:0xcfcfcf,transparent:true,opacity:.5,depthWrite:false});
for(let i=0;i<34;i++){const s=new THREE.Sprite(smokeMat.clone());s.userData.t=i/34;scene.add(s);smoke.push(s)}

/* ================== TELAS, INTERIOR, PERSONAS, ANIMALES ================== */
function fabricTex(c1,c2,c3,motif=true){const S=128;const cv=document.createElement('canvas');cv.width=cv.height=S;const g=cv.getContext('2d');g.fillStyle=c1;g.fillRect(0,0,S,S);
  if(motif){g.fillStyle=c2;g.fillRect(0,0,S,10);g.fillRect(0,S-10,S,10);g.fillStyle=c3;g.fillRect(0,14,S,4);g.fillRect(0,S-18,S,4);
    for(let i=0;i<4;i++){const cx=i*32+16,cy=S/2;g.fillStyle=c2;g.beginPath();g.moveTo(cx,cy-24);g.lineTo(cx+14,cy);g.lineTo(cx,cy+24);g.lineTo(cx-14,cy);g.closePath();g.fill();g.fillStyle=c3;g.beginPath();g.moveTo(cx,cy-12);g.lineTo(cx+7,cy);g.lineTo(cx,cy+12);g.lineTo(cx-7,cy);g.closePath();g.fill();g.fillStyle=c1;g.fillRect(cx-2,cy-2,4,4)}}
  for(let i=0;i<S;i+=2){g.fillStyle='rgba(0,0,0,.07)';g.fillRect(i,0,1,S);g.fillStyle='rgba(255,255,255,.04)';g.fillRect(0,i,S,1)}
  const t=new THREE.CanvasTexture(cv);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;return t}
const F={poncho:fabricTex('#8a2f23','#1d1512','#e6b04a'),lli:fabricTex('#1e7f8c','#e0a62a','#c2336a'),aguayo:fabricTex('#b0302a','#e0a22a','#2a6aa0'),rug:fabricTex('#7a3a2a','#e9d9b0','#2a4a6a'),blanket:fabricTex('#c0442f','#f0d9a0','#2f6a8c'),sofa:fabricTex('#7b4a35','#8c5a42','#6a3d2c',false),ponchoG:fabricTex('#5a5f66','#2d3036','#c9c2b0'),polleraM:fabricTex('#a02a5a','#2a7a5a','#f0c040'),polleraB:fabricTex('#2c4b86','#c9a43a','#a23a2a'),chullo:fabricTex('#c2552f','#2a6aa0','#f0d9a0')};
const strawTex=(()=>{const S=128;const cv=document.createElement('canvas');cv.width=cv.height=S;const g=cv.getContext('2d');g.fillStyle='#cdb27a';g.fillRect(0,0,S,S);for(let i=0;i<S;i+=3){g.fillStyle=`rgba(${90+rnd()*50|0},${70+rnd()*40|0},30,.35)`;g.fillRect(i,0,1.5,S);g.fillStyle='rgba(255,240,190,.2)';g.fillRect(0,i,S,1)}const t=new THREE.CanvasTexture(cv);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;return t})();
const furBump=toTex(makeTexture(256,(u,v)=>{const n=fbm(u*34,v*34,34,4,71);const c=clamp(70+n*190,0,255);return [c,c,c]}).cv,{srgb:false,repeat:[1,1]});
function cloth(color,tex,rep){const m=std({color:tex?0xffffff:color,map:tex||null,roughness:1,side:THREE.DoubleSide});if(tex&&rep){m.map=tex.clone();m.map.repeat.set(rep[0],rep[1]);m.map.needsUpdate=true}return m}
const lat=(pts,seg=16)=>new THREE.LatheGeometry(pts.map(p=>new THREE.Vector2(p[0],p[1])),seg);
function limb(parent,a,b,r1,r2,mat,seg=8){const v=b.clone().sub(a);const m=new THREE.Mesh(new THREE.CylinderGeometry(r2,r1,v.length(),seg),mat);m.position.copy(a).add(b).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.clone().normalize());m.castShadow=m.receiveShadow=true;parent.add(m);return m}

/* ---------- INTERIOR ---------- */
const fy=.14;const fireM=std({color:0x331100,emissive:0xff6a1a,emissiveIntensity:2.5});
const clay=std({color:0x9a5a38,roughness:.9}),creamM=std({color:0xd9c9a3,roughness:1}),paintBlue=std({color:0x4f7f8e,roughness:.95}),paintOcre=std({color:0xd7b57a,roughness:1}),darkM=std({color:0x1b1511,roughness:.6});
const stripeM=[0xb0302a,0xe0a22a,0x2a6aa0,0x3a8a4a,0xd9d0b0].map(c=>std({color:c,roughness:1}));
const interior=new THREE.Group();house.add(interior);const ceilGroup=new THREE.Group();roofGroup.add(ceilGroup);
const sofaM=cloth(0xffffff,F.sofa),aguayoM=cloth(0xffffff,F.aguayo),rugM=cloth(0xffffff,F.rug),blanketM=cloth(0xffffff,F.blanket);
const tvScreen=std({color:0x050608,emissive:0x2a5a9a,emissiveIntensity:.9,roughness:.2});
let lampLight2,tvLight;
{
  // cielo raso con vigas
  B(ceilGroup,11.1,.08,5.1,mats.floor,0,3.2,0,2);for(let i=0;i<12;i++)B(ceilGroup,.2,.24,5.1,mats.woodD,-5.5+i*1.0,3.06,0,1.2);
  B(ceilGroup,3.5,.06,4.0,mats.floor,-7.8,2.62,0,2);for(let i=0;i<4;i++)B(ceilGroup,.16,.2,4.0,mats.woodD,-9.2+i*1.0,2.52,0,1.2);
  // zócalos pintados y rodapié
  B(interior,11.0,1.05,.03,paintBlue,0,fy+.525,-2.535,2);B(interior,.03,1.05,5.0,paintBlue,5.535,fy+.525,0,2);B(interior,11.0,.12,.05,mats.woodD,0,fy+.06,-2.53,1);B(interior,.05,.12,5.0,mats.woodD,5.53,fy+.06,0,1);
  B(interior,.03,1.05,2.3,paintBlue,-5.535,fy+.525,1.4,2);B(interior,.03,1.05,2.3,paintBlue,-5.535,fy+.525,-1.85,2);
  // ---------- COCINA ----------
  B(interior,1.6,.85,1.1,mats.adobeBox,-4.9,fy+.425,-1.9);B(interior,1.6,.06,1.15,darkM,-4.9,fy+.88,-1.9,1);
  for(const dx of [-.35,.35]){add(interior,new THREE.CylinderGeometry(.22,.19,.26,18),mats.metal,-4.9+dx,fy+1.04,-1.9);add(interior,new THREE.CylinderGeometry(.23,.23,.03,18),mats.metal,-4.9+dx,fy+1.19,-1.9)}
  B(interior,.55,.32,.05,fireM,-4.9,fy+.38,-1.33,1,{cast:false});
  const hood=add(interior,new THREE.CylinderGeometry(.2,.7,.9,4,1,true),mats.adobeBox,-4.9,2.55,-1.9);hood.rotation.y=Math.PI/4;add(interior,new THREE.CylinderGeometry(.2,.2,.7,10),darkM,-4.9,3.0,-1.9);
  const tin=add(interior,new THREE.SphereGeometry(.3,18,14),clay,-3.5,fy+.38,-2.15);tin.scale.set(1,1.25,1);add(interior,new THREE.CylinderGeometry(.14,.2,.14,14),clay,-3.5,fy+.9,-2.15);
  B(interior,1.9,.07,.9,mats.wood,-2.4,fy+.8,-.9,1.5);for(const dx of [-.8,.8])for(const dz of [-.35,.35])B(interior,.08,.8,.08,mats.woodD,-2.4+dx,fy+.4,-.9+dz,1);
  [[-3.0,-.1],[-1.8,-.1],[-2.4,-1.7]].forEach(p=>{add(interior,new THREE.CylinderGeometry(.19,.17,.45,12),mats.wood,p[0],fy+.225,p[1])});
  for(const dx of [-.5,.2,.7])add(interior,new THREE.CylinderGeometry(.13,.08,.05,14),clay,-2.4+dx,fy+.86,-.9);
  const jug=add(interior,new THREE.SphereGeometry(.13,14,12),clay,-2.9,fy+.96,-.8);jug.scale.y=1.3;
  add(interior,new THREE.CylinderGeometry(.09,.09,.03,12),stripeM[0],-1.95,fy+.84,-.7);
  B(interior,1.9,.05,.3,mats.wood,-2.4,1.55,-2.36,1);B(interior,1.9,.05,.3,mats.wood,-2.4,2.1,-2.36,1);
  for(let i=0;i<5;i++){const p=add(interior,new THREE.SphereGeometry(.11+rnd()*.05,12,10),clay,-3.2+i*.34,1.7,-2.36);p.scale.y=1.2}
  for(let i=0;i<4;i++)add(interior,new THREE.CylinderGeometry(.09,.07,.18,10),i%2?creamM:clay,-3.1+i*.42,2.22,-2.36);
  B(interior,1.15,.04,.04,mats.woodD,-3.35,2.75,.7,1);for(let i=0;i<7;i++){const c=add(interior,new THREE.CylinderGeometry(.04,.03,.22,6),std({color:0xe0b93a,roughness:.8}),-3.8+i*.1,2.62-(i%2)*.08,.7);c.rotation.z=.05}
  for(let i=0;i<6;i++){const a=add(interior,new THREE.SphereGeometry(.035,8,8),std({color:0xc42a1a}),-1.8+i*.07,2.7,1.7);a.scale.y=2}
  // banca junto a la puerta
  B(interior,1.5,.07,.42,mats.wood,-4.6,fy+.46,2.3,1.5);for(const dx of [-.6,.6])B(interior,.07,.46,.38,mats.woodD,-4.6+dx,fy+.23,2.3,1);
  // ---------- SALA ----------
  B(interior,3.9,.014,2.7,rugM,3.2,fy+.01,-.75,2,{cast:false});
  const sofaR=cloth(0xffffff,F.sofa,[3,2]);const RBg=(w,h,d,r)=>new RoundedBoxGeometry(w,h,d,4,r);
  const sofa=new THREE.Group();sofa.position.set(3.2,fy,-1.95);interior.add(sofa);
  add(sofa,RBg(3.0,.3,.95,.08),sofaR,0,.3,0);add(sofa,RBg(3.0,.62,.26,.1),sofaR,0,.82,-.36);
  for(const sx of [-1,1])add(sofa,RBg(.26,.6,.95,.1),sofaR,sx*1.38,.62,0);
  for(let i=0;i<3;i++){add(sofa,RBg(.86,.17,.74,.08),sofaR,-.9+i*.9,.57,.08);const bk=add(sofa,RBg(.84,.5,.2,.09),sofaR,-.9+i*.9,.93,-.2);bk.rotation.x=-.16}
  [[-1.0,0xe0a22a],[1.0,0x2a6aa0]].forEach(p=>{const c=add(sofa,RBg(.42,.4,.13,.05),std({color:p[1],roughness:1}),p[0],.9,-.02);c.rotation.z=(p[0]>0?-.2:.2)});
  for(const dx of [-1.3,1.3])for(const dz of [-.38,.38])B(sofa,.07,.12,.07,mats.woodD,dx,.06,dz,1);
  const arm=new THREE.Group();arm.position.set(.95,fy,-.2);arm.rotation.y=Math.PI/2;interior.add(arm);
  add(arm,RBg(.95,.3,.9,.08),sofaR,0,.3,0);add(arm,RBg(.95,.62,.22,.1),sofaR,0,.78,-.34);
  for(const sx of [-1,1])add(arm,RBg(.2,.52,.9,.09),sofaR,sx*.38,.55,0);
  add(arm,RBg(.6,.17,.7,.08),sofaR,0,.57,.06);const abk=add(arm,RBg(.6,.44,.16,.07),sofaR,0,.87,-.2);abk.rotation.x=-.16;
  for(const dx of [-.4,.4])for(const dz of [-.35,.35])B(arm,.06,.1,.06,mats.woodD,dx,.05,dz,1);
  
  B(interior,1.3,.05,.75,mats.wood,3.2,fy+.42,-.5,1.5);for(const dx of [-.55,.55])for(const dz of [-.28,.28])B(interior,.06,.42,.06,mats.woodD,3.2+dx,fy+.21,-.5+dz,1);
  add(interior,new THREE.CylinderGeometry(.06,.045,.2,12),clay,3.5,fy+.55,-.45);for(let i=0;i<5;i++){const fl=add(interior,new THREE.SphereGeometry(.045,8,8),std({color:[0xf2d03b,0xe85a7a,0xb06ad6,0xffffff,0xff8f3a][i]}),3.5+(i-2)*.035,fy+.74+Math.abs(i-2)*-.015,-.45)}
  B(interior,.28,.03,.2,stripeM[2],2.85,fy+.455,-.45,1);add(interior,new THREE.CylinderGeometry(.04,.035,.07,10),creamM,3.0,fy+.5,-.7);
  // TV
  B(interior,.5,.5,1.7,mats.woodD,5.25,fy+.25,0,1.4);B(interior,.54,.03,1.76,mats.wood,5.25,fy+.515,0,1.4);
  for(const dz of [-.43,.43]){B(interior,.012,.38,.78,mats.wood,4.995,fy+.25,dz,1);add(interior,new THREE.CylinderGeometry(.012,.012,.12,8),mats.metal,4.985,fy+.28,dz+(dz>0?-.3:.3));}
  B(interior,.05,.66,1.16,darkM,5.38,fy+.95,0,1);B(interior,.16,.02,.5,mats.metal,5.3,fy+.535,0,1);B(interior,.04,.1,.14,darkM,5.34,fy+.58,0,1);
  window.tvPlane=new THREE.Mesh(new THREE.PlaneGeometry(1.08,.608),window.tvMat||tvScreen);window.tvPlane.position.set(5.352,fy+.95,0);window.tvPlane.rotation.y=-Math.PI/2;interior.add(window.tvPlane);
  B(interior,.1,.07,.9,darkM,5.2,fy+.56,0,1);for(const dz of [-.74,.74])B(interior,.14,.28,.14,darkM,5.25,fy+.67,dz,1);
  
  // fotos, aguayo y reloj
  B(interior,1.35,1.2,.03,aguayoM,3.2,1.95,-2.52,1.2);B(interior,1.45,.05,.05,mats.woodD,3.2,2.58,-2.5,1);B(interior,1.45,.05,.05,mats.woodD,3.2,1.32,-2.5,1);
  [[0.5,1.9,.5,.4,0x6b8f5a],[0.5,1.35,.34,.44,0x9a6a4a],[1.1,1.7,.4,.5,0x7a9ab0]].forEach(p=>{B(interior,p[2]+.08,p[3]+.08,.04,mats.woodD,p[0],p[1],-2.52,1);B(interior,p[2],p[3],.045,std({color:p[4],roughness:.9}),p[0],p[1],-2.51,1)});
  add(interior,new THREE.CylinderGeometry(.17,.17,.05,24),mats.woodD,5.0,2.2,-2.52).rotation.x=Math.PI/2;add(interior,new THREE.CylinderGeometry(.14,.14,.055,24),creamM,5.0,2.2,-2.5).rotation.x=Math.PI/2;
  B(interior,.015,.1,.01,darkM,5.0,2.23,-2.47,1);B(interior,.08,.015,.01,darkM,5.03,2.2,-2.47,1);
  // plantas y lámpara de pie
  [[5.0,-2.1],[-0.2,-2.15]].forEach(p=>{add(interior,new THREE.CylinderGeometry(.2,.15,.32,14),clay,p[0],fy+.16,p[1]);for(let i=0;i<9;i++){const l=add(interior,new THREE.ConeGeometry(.07,.55,5),std({color:0x3f7a3a,roughness:.8}),p[0],fy+.55,p[1]);l.rotation.set((rnd()-.5)*.9,i*.7,(rnd()-.5)*.9)}});
  add(interior,new THREE.CylinderGeometry(.015,.02,1.6,6),darkM,0.9,fy+.8,-2.1);const shade=add(interior,new THREE.CylinderGeometry(.14,.22,.26,16,1,true),std({color:0xf0dfba,emissive:0xffc070,emissiveIntensity:.5,side:THREE.DoubleSide,roughness:1}),0.9,fy+1.7,-2.1,{cast:false});
  // ---------- DORMITORIO (ala izquierda) ----------
  B(interior,2.0,.4,1.1,mats.woodD,-7.9,fy+.2,-1.5,1.5);B(interior,1.9,.17,1.0,creamM,-7.9,fy+.48,-1.5,1);B(interior,1.35,.05,1.04,blanketM,-7.65,fy+.58,-1.5,1.3);
  B(interior,.5,.12,.8,creamM,-8.7,fy+.62,-1.5,1);B(interior,.1,.9,1.15,mats.woodD,-8.95,fy+.55,-1.5,1);
  B(interior,.5,.55,.5,mats.wood,-6.7,fy+.28,-1.8,1);add(interior,new THREE.CylinderGeometry(.03,.03,.1,8),creamM,-6.7,fy+.62,-1.8);const flame=add(interior,new THREE.SphereGeometry(.018,8,8),std({color:0xffe38a,emissive:0xffaa33,emissiveIntensity:3}),-6.7,fy+.7,-1.8,{cast:false});
  B(interior,.55,1.9,1.2,mats.wood,-9.3,fy+.95,.9,1.4);B(interior,.02,1.7,.55,mats.woodD,-9.02,fy+.95,.6,1);B(interior,.02,1.7,.55,mats.woodD,-9.02,fy+.95,1.2,1);
  B(interior,1.0,.45,.55,mats.woodD,-7.0,fy+.22,1.6,1.2);B(interior,1.02,.06,.57,mats.metal,-7.0,fy+.46,1.6,1);
  B(interior,2.6,.014,2.0,blanketM,-7.9,fy+.01,.3,2,{cast:false});
  B(interior,.04,.45,.2,mats.woodD,-8.9,fy+2.0,-2.0,1);B(interior,.04,.18,.5,mats.woodD,-8.9,fy+2.0,-2.0,1);
  // puerta de comunicación: dintel, jambas y cortina
  B(interior,.6,.2,1.2,mats.woodD,-5.8,2.3,-.8,1);B(interior,.6,2.2,.1,mats.woodD,-5.8,1.1,-1.3,1);B(interior,.6,2.2,.1,mats.woodD,-5.8,1.1,-.3,1);
  B(interior,.04,1.95,.55,cloth(0xffffff,F.lli),-5.72,1.2,-1.0,1);
}
const fireLight=new THREE.PointLight(0xff7a2a,2.2,7,1.6);fireLight.position.set(-4.9,.8,-1.2);house.add(fireLight);
const lampLight=new THREE.PointLight(0xffc27a,2,9,1.6);lampLight.position.set(-2.4,2.3,-.9);house.add(lampLight);
lampLight2=new THREE.PointLight(0xffd8a0,1.6,9,1.6);lampLight2.position.set(3.2,2.4,-.3);house.add(lampLight2);
tvLight=new THREE.PointLight(0x6fa0ff,.0,4,2);tvLight.position.set(4.6,1.1,0);house.add(tvLight);
{const lamp=add(interior,new THREE.SphereGeometry(.11,14,12),std({color:0xffe2a0,emissive:0xffb347,emissiveIntensity:1.8}),-2.4,2.35,-.9,{cast:false});add(interior,new THREE.CylinderGeometry(.01,.01,.9,5),darkM,-2.4,2.8,-.9)}

/* ---------- PERSONAS ---------- */

function pleatLathe(pts,seg,pleats,amp){const g=new THREE.LatheGeometry(pts.map(p=>new THREE.Vector2(p[0],p[1])),seg);const p=g.attributes.position;
  for(let i=0;i<p.count;i++){const x=p.getX(i),z=p.getZ(i);const a=Math.atan2(z,x);const k=1+amp*Math.sin(a*pleats);p.setX(i,x*k);p.setZ(i,z*k)}g.computeVertexNormals();return g}
function makeHand(parent,skinM,side){
  const h=new THREE.Group();parent.add(h);
  const palm=add(h,new THREE.SphereGeometry(.03,10,8),skinM,0,-.03,0);palm.scale.set(1,1.25,.55);
  for(let i=0;i<4;i++){const f=new THREE.Group();f.position.set((i-1.5)*.014,-.06,0);h.add(f);f.rotation.x=-.25-i*.03;
    add(f,new THREE.CapsuleGeometry(.0085,.032,3,6),skinM,0,-.02,0);const t=new THREE.Group();t.position.set(0,-.04,0);f.add(t);t.rotation.x=-.45;add(t,new THREE.CapsuleGeometry(.0075,.024,3,6),skinM,0,-.014,0)}
  const th=new THREE.Group();th.position.set(side*-.026,-.04,.008);h.add(th);th.rotation.z=side*.7;th.rotation.x=-.3;add(th,new THREE.CapsuleGeometry(.009,.03,3,6),skinM,0,-.016,0);
  return h}
function makePersonNew(o){
  const skinC=new THREE.Color(o.skin||0xb07a58);
  const skinM=std({color:skinC,roughness:.55,bumpMap:furBump,bumpScale:.15}),hairM=std({color:o.hair??0x14100e,roughness:.7}),
    sh=cloth(o.shirt,o.shirtTex),pn=cloth(o.pants??0x2d3036,null);
  const lipM=std({color:skinC.clone().lerp(new THREE.Color(0x9a3a38),.55),roughness:.45}),blushM=std({color:skinC.clone().lerp(new THREE.Color(0xd9605a),.28),roughness:.6}),earIn=std({color:skinC.clone().multiplyScalar(.78),roughness:.7});
  const irisM=std({color:o.eyes||0x2b1a0e,roughness:.2}),scleraM=std({color:0xf4f1ea,roughness:.25});
  const leather=std({color:0x3a2a1c,roughness:.75}),dark=std({color:0x15110e,roughness:.6});
  const g=new THREE.Group(),body=new THREE.Group();body.position.y=.92;g.add(body);const legs=[],arms=[];
  for(const s of [-1,1]){const hip=new THREE.Group();hip.position.set(s*.085,.92,0);g.add(hip);
    const lm=o.skirt?skinM:pn;add(hip,lat([[.001,.02],[.09,-.01],[.095,-.12],[.088,-.24],[.07,-.4],[.06,-.42]],16),lm,0,0,0);
    const knee=new THREE.Group();knee.position.set(0,-.42,0);hip.add(knee);add(knee,lat([[.058,.0],[.066,-.06],[.058,-.2],[.046,-.34],[.04,-.4],[.001,-.41]],14),lm,0,0,0);
    add(knee,new THREE.SphereGeometry(.058,10,8),lm,0,0,.004);
    if(!o.skirt)add(hip,new THREE.BoxGeometry(.004,.14,.004),dark,s*.0,-.12,.092);
    const ft=new THREE.Group();ft.position.set(0,-.4,0);knee.add(ft);
    if(o.boots){const bt=std({color:0x3a2a1c,roughness:.7});add(ft,lat([[.001,.03],[.058,.03],[.056,-.06],[.05,-.08],[.001,-.08]],12),bt,0,.04,0);
      const toe=add(ft,new THREE.SphereGeometry(.05,12,10),bt,0,-.05,.085);toe.scale.set(1.05,.75,1.7);add(ft,new THREE.BoxGeometry(.108,.026,.29),dark,0,-.082,.055);
      for(let i=0;i<3;i++)add(ft,new THREE.BoxGeometry(.06,.005,.008),std({color:0xd9ceb5,roughness:.9}),0,-.005-i*.017,.07+i*.004)}
    else{const fo=add(ft,new THREE.SphereGeometry(.052,12,10),skinM,0,-.045,.045);fo.scale.set(.95,.6,2.2);
      for(let i=0;i<5;i++)add(ft,new THREE.SphereGeometry(.011-i*.0008,6,6),skinM,(i-2)*.019,-.058,.155-Math.abs(i-2)*.008);
      add(ft,new THREE.BoxGeometry(.105,.016,.285),std({color:0x241810,roughness:.9}),0,-.085,.05);
      for(const t of [-1,1]){const st=add(ft,new THREE.TorusGeometry(.045,.005,4,10,Math.PI),std({color:0x5a3a1c,roughness:.8}),0,-.05,.06);st.rotation.y=Math.PI/2;st.rotation.x=t*.2}}
    legs.push({hip,knee})}
  const tor=add(body,lat([[.001,0],[.135,0],[.14,.1],[.128,.2],[.148,.34],[.165,.45],[.15,.54],[.09,.6],[.05,.64],[.001,.65]],22),sh,0,0,0);tor.scale.set(1.14,1,.78);
  if(!o.skirt){const belt=add(body,new THREE.TorusGeometry(.136,.011,6,26),leather,0,.01,0);belt.rotation.x=Math.PI/2;belt.scale.set(1.14,.78,1);add(body,new THREE.BoxGeometry(.03,.028,.01),std({color:0xc9a24a,metalness:1,roughness:.3}),0,.01,.108)}
  if(!o.poncho&&!o.shawl)for(let i=0;i<5;i++)add(body,new THREE.SphereGeometry(.0065,6,6),std({color:0xe8e0cc,roughness:.4}),0,.1+i*.095,.112+(i>2?.002:0));
  const nk=add(body,new THREE.CylinderGeometry(.043,.055,.12,12),skinM,0,.68,0);
  const col=add(body,new THREE.TorusGeometry(.062,.016,6,16),sh,0,.645,0);col.rotation.x=Math.PI/2+.25;
  for(const s of [-1,1]){const shd=new THREE.Group();shd.position.set(s*.2,.55,0);body.add(shd);
    add(shd,new THREE.SphereGeometry(.052,12,10),sh,0,0,0);add(shd,lat([[.001,.0],[.052,-.01],[.048,-.14],[.042,-.28],[.001,-.29]],12),sh,0,0,0);
    const el=new THREE.Group();el.position.set(0,-.28,0);shd.add(el);add(el,lat([[.001,.0],[.042,-.005],[.036,-.14],[.028,-.25],[.026,-.26]],12),o.longSleeve?sh:skinM,0,0,0);
    if(o.longSleeve)add(el,new THREE.TorusGeometry(.027,.006,5,12),sh,0,-.255,0).rotation.x=Math.PI/2;
    makeHand(el,skinM,s).position.set(0,-.26,0);
    arms.push({sh:shd,el})}
  const head=new THREE.Group();head.position.set(0,.8,0);body.add(head);
  const sk=add(head,new THREE.SphereGeometry(.105,24,18),skinM,0,.0,0);sk.scale.set(.92,1.1,1.02);
  const jaw=add(head,new THREE.SphereGeometry(.078,18,14),skinM,0,-.06,.02);jaw.scale.set(1,.9,1);
  const chin=add(head,new THREE.SphereGeometry(.03,10,8),skinM,0,-.105,.06);chin.scale.set(1.2,.8,.9);
  for(const s of [-1,1]){const ear=add(head,new THREE.SphereGeometry(.027,10,8),skinM,s*.098,-.005,0);ear.scale.set(.42,1.05,.8);add(head,new THREE.SphereGeometry(.015,8,6),earIn,s*.1,-.005,.004).scale.set(.3,.9,.6);
    add(head,new THREE.SphereGeometry(.03,10,8),blushM,s*.06,-.04,.082).scale.set(1,.65,.4);
    add(head,new THREE.SphereGeometry(.02,10,8),skinM,s*.04,.02,.088).scale.set(1.5,.6,.55);
    add(head,new THREE.SphereGeometry(.0145,12,10),scleraM,s*.04,.014,.092).scale.set(1.25,.85,.5);add(head,new THREE.SphereGeometry(.0085,10,8),irisM,s*.04,.014,.1);add(head,new THREE.SphereGeometry(.0045,8,6),dark,s*.04,.014,.104);add(head,new THREE.SphereGeometry(.0018,6,6),scleraM,s*.043,.018,.106);
    const br=add(head,new THREE.CapsuleGeometry(.005,.04,3,6),hairM,s*.042,.046,.094);br.rotation.z=Math.PI/2+s*.12;
    add(head,new THREE.BoxGeometry(.034,.003,.004),dark,s*.04,.003,.096)}
  const nose=add(head,new THREE.SphereGeometry(.018,10,8),skinM,0,-.022,.108);nose.scale.set(.9,1.2,1.1);add(head,new THREE.ConeGeometry(.012,.035,8),skinM,0,-.002,.102).rotation.x=Math.PI/2+.2;
  for(const s of [-1,1])add(head,new THREE.SphereGeometry(.004,6,6),dark,s*.008,-.034,.118);
  add(head,new THREE.CapsuleGeometry(.006,.034,3,6),lipM,0,-.058,.097).rotation.z=Math.PI/2;add(head,new THREE.CapsuleGeometry(.0075,.03,3,6),lipM,0,-.07,.094).rotation.z=Math.PI/2;
  if(o.hairStyle!=='bald'){const hc=add(head,new THREE.SphereGeometry(.11,22,14,0,Math.PI*2,0,Math.PI*.56),hairM,0,.014,-.012);hc.rotation.x=-.3;
    for(const s of [-1,1])add(head,new THREE.BoxGeometry(.012,.05,.02),hairM,s*.094,-.03,.03);
    add(head,new THREE.SphereGeometry(.095,14,10),hairM,0,.0,-.04).scale.set(1,1.05,.8)}
  if(o.braids)for(const s of [-1,1]){const x=s*.07;for(let i=0;i<11;i++){const y=-.02-i*.032,z=-.085-i*.004;add(head,new THREE.SphereGeometry(.0185-i*.0006,8,6),hairM,x+(i%2?.008:-.008),y,z).scale.set(1,1.3,1)}
    add(head,new THREE.SphereGeometry(.02,8,6),stripeM[0],x,-.385,-.13);add(head,new THREE.CylinderGeometry(.006,.005,.05,6),stripeM[0],x,-.41,-.13)}
  if(o.mustache){const mh=std({color:0xd0d0d0,roughness:1});for(const s of [-1,1]){const m=add(head,new THREE.CapsuleGeometry(.007,.03,3,6),mh,s*.017,-.046,.106);m.rotation.z=Math.PI/2-s*.25}}
  if(o.hat==='straw'){add(head,new THREE.CylinderGeometry(.275,.28,.016,30),std({map:strawTex,roughness:1}),0,.095,0);const cr=add(head,new THREE.CylinderGeometry(.11,.125,.12,22),std({map:strawTex,roughness:1}),0,.155,0);add(head,new THREE.CylinderGeometry(.128,.128,.03,22),stripeM[0],0,.12,0);add(head,new THREE.TorusGeometry(.275,.006,4,36),std({color:0xb59a5a,roughness:1}),0,.095,0).rotation.x=Math.PI/2;
    for(const s of [-1,1])add(head,new THREE.CapsuleGeometry(.003,.12,3,4),dark,s*.1,.0,.07)}
  if(o.hat==='felt'){const fc=o.hatColor||0x4a3a2a;add(head,new THREE.CylinderGeometry(.22,.225,.014,30),std({color:fc,roughness:1}),0,.095,0);add(head,new THREE.CylinderGeometry(.095,.115,.13,22),std({color:fc,roughness:1}),0,.16,0);add(head,new THREE.CylinderGeometry(.117,.117,.025,22),mats.dark,0,.118,0)}
  if(o.hat==='white'){add(head,new THREE.CylinderGeometry(.21,.215,.014,30),std({color:0xf1ece0,roughness:1}),0,.1,0);add(head,new THREE.CylinderGeometry(.1,.115,.12,22),std({color:0xf1ece0,roughness:1}),0,.16,0);add(head,new THREE.CylinderGeometry(.117,.117,.025,22),stripeM[0],0,.122,0);add(head,new THREE.TorusGeometry(.117,.004,4,24),stripeM[1],0,.136,0).rotation.x=Math.PI/2}
  if(o.hat==='chullo'){const ch=add(head,new THREE.SphereGeometry(.12,22,14,0,Math.PI*2,0,Math.PI*.62),cloth(0xffffff,F.chullo),0,.01,0);for(const s of [-1,1]){add(head,new THREE.BoxGeometry(.03,.1,.025),cloth(0xffffff,F.chullo),s*.108,-.06,0);add(head,new THREE.CapsuleGeometry(.004,.12,3,4),stripeM[1],s*.108,-.17,0);add(head,new THREE.SphereGeometry(.012,6,6),stripeM[1],s*.108,-.24,0)}add(head,new THREE.SphereGeometry(.03,10,8),stripeM[1],0,.125,0)}
  if(o.skirt){const sm=cloth(0xffffff,o.skirtTex||F.polleraM);
    add(g,pleatLathe([[.14,.0],[.18,-.05],[.28,-.3],[.4,-.58],[.405,-.62]],48,24,.035),sm,0,.97,0).material.side=THREE.DoubleSide;
    add(g,pleatLathe([[.13,-.02],[.2,-.1],[.31,-.34],[.43,-.66],[.435,-.7]],48,30,.03),cloth(0xf2ece0,null),0,.97,0).material.side=THREE.DoubleSide;
    add(g,new THREE.TorusGeometry(.4,.014,6,32),stripeM[1],0,.4,0).rotation.x=Math.PI/2;add(g,new THREE.TorusGeometry(.33,.012,6,32),stripeM[2],0,.55,0).rotation.x=Math.PI/2;
    add(g,new THREE.TorusGeometry(.145,.02,6,22),stripeM[0],0,.97,0).rotation.x=Math.PI/2;
    if(o.shawl){const lm=cloth(0xffffff,o.shawl);add(body,lat([[.1,.64],[.19,.58],[.23,.46],[.2,.3]],22),lm,0,0,0).scale.set(1.12,1,.85);add(body,new THREE.BoxGeometry(.3,.36,.16),cloth(0xffffff,F.aguayo),0,.36,-.19);add(body,new THREE.TorusGeometry(.2,.01,5,24),stripeM[0],0,.31,0).rotation.x=Math.PI/2}
    if(o.apron){add(g,new THREE.BoxGeometry(.28,.42,.02),std({color:0xf2eee2,roughness:1}),0,.72,.15);add(g,new THREE.BoxGeometry(.3,.02,.025),std({color:0xe2d8c0,roughness:1}),0,.93,.15)}}
  if(o.poncho){const pm=cloth(0xffffff,o.poncho);add(body,pleatLathe([[.1,.62],[.2,.56],[.3,.38],[.34,.12],[.345,.08]],36,16,.02),pm,0,0,0);add(body,new THREE.TorusGeometry(.345,.008,4,40),stripeM[0],0,.08,0).rotation.x=Math.PI/2;add(body,new THREE.TorusGeometry(.355,.012,4,40),stripeM[1],0,.06,0).rotation.x=Math.PI/2}
  g.scale.setScalar(o.height||1);g.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true}});
  return {g,body,legs,arms,head}}
function makePerson(o){try{return makePersonNew(o)}catch(e){console.warn('persona',e);return makePersonOld(o)}}

function makePersonOld(o){
  const skinM=std({color:o.skin||0xb07a58,roughness:.6}),hairM=std({color:o.hair??0x14100e,roughness:.8}),sh=cloth(o.shirt,o.shirtTex),pn=cloth(o.pants??0x2d3036,null);
  const g=new THREE.Group(),body=new THREE.Group();body.position.y=.92;g.add(body);const legs=[],arms=[];
  for(const s of [-1,1]){const hip=new THREE.Group();hip.position.set(s*.085,.92,0);g.add(hip);
    const lm=o.skirt?skinM:pn;add(hip,lat([[.001,.02],[.09,-.01],[.092,-.18],[.07,-.41],[.001,-.42]],14),lm,0,0,0);
    const knee=new THREE.Group();knee.position.set(0,-.42,0);hip.add(knee);add(knee,lat([[.001,.0],[.068,-.01],[.058,-.2],[.04,-.37],[.001,-.4]],12),lm,0,0,0);
    const ft=new THREE.Group();ft.position.set(0,-.4,0);knee.add(ft);
    if(o.boots){add(ft,new THREE.BoxGeometry(.105,.12,.27),std({color:0x3a2a1c,roughness:.8}),0,-.04,.05)}
    else{add(ft,new THREE.SphereGeometry(.05,10,8),skinM,0,-.04,.04).scale.set(1,.6,2.2);add(ft,new THREE.BoxGeometry(.1,.018,.27),std({color:0x241810,roughness:.9}),0,-.075,.05)}
    legs.push({hip,knee})}
  const tor=add(body,lat([[.001,0],[.135,0],[.14,.1],[.128,.2],[.148,.34],[.162,.45],[.145,.54],[.07,.6],[.001,.61]],18),sh,0,0,0);tor.scale.set(1.14,1,.78);
  add(body,new THREE.CylinderGeometry(.045,.052,.1,10),skinM,0,.66,0);
  for(const s of [-1,1]){const shd=new THREE.Group();shd.position.set(s*.2,.55,0);body.add(shd);
    add(shd,new THREE.SphereGeometry(.05,10,8),sh,0,0,0);add(shd,lat([[.001,.0],[.05,-.01],[.046,-.14],[.04,-.28],[.001,-.29]],10),sh,0,0,0);
    const el=new THREE.Group();el.position.set(0,-.28,0);shd.add(el);add(el,lat([[.001,.0],[.04,-.005],[.034,-.14],[.027,-.25],[.001,-.26]],10),o.longSleeve?sh:skinM,0,0,0);
    add(el,new THREE.SphereGeometry(.033,10,8),skinM,0,-.29,0).scale.set(1,1.35,.7);add(el,new THREE.SphereGeometry(.014,6,6),skinM,s*-.03,-.27,.02);
    arms.push({sh:shd,el})}
  const head=new THREE.Group();head.position.set(0,.8,0);body.add(head);
  add(head,new THREE.SphereGeometry(.105,20,16),skinM,0,.0,0).scale.set(.92,1.1,1.02);add(head,new THREE.SphereGeometry(.078,16,12),skinM,0,-.06,.018).scale.set(1,.9,1);
  for(const s of [-1,1]){add(head,new THREE.SphereGeometry(.026,8,8),skinM,s*.098,0,0).scale.set(.45,1,.8);
    add(head,new THREE.SphereGeometry(.013,8,8),std({color:0xf4f1ea,roughness:.3}),s*.04,.016,.092).scale.set(1.2,.8,.5);add(head,new THREE.SphereGeometry(.0075,8,8),mats.dark,s*.04,.016,.098);
    add(head,new THREE.BoxGeometry(.04,.007,.01),hairM,s*.04,.043,.096).rotation.z=s*-.15}
  const nose=add(head,new THREE.ConeGeometry(.017,.042,8),skinM,0,-.012,.103);nose.rotation.x=Math.PI/2+.25;
  add(head,new THREE.BoxGeometry(.042,.007,.012),std({color:0x6b2f2a,roughness:.5}),0,-.062,.092);
  if(o.hairStyle!=='bald'){const hc=add(head,new THREE.SphereGeometry(.108,18,12,0,Math.PI*2,0,Math.PI*.56),hairM,0,.014,-.012);hc.rotation.x=-.3}
  if(o.braids)for(const s of [-1,1]){const br=limb(head,new THREE.Vector3(s*.065,-.02,-.08),new THREE.Vector3(s*.07,-.36,-.11),.022,.012,hairM,6);add(head,new THREE.SphereGeometry(.018,6,6),stripeM[0],s*.07,-.37,-.11)}
  if(o.mustache)add(head,new THREE.BoxGeometry(.06,.012,.014),std({color:0xd0d0d0,roughness:1}),0,-.045,.1);
  if(o.hat==='straw'){add(head,new THREE.CylinderGeometry(.275,.28,.016,26),std({map:strawTex,roughness:1}),0,.095,0);const cr=add(head,new THREE.CylinderGeometry(.11,.125,.12,18),std({map:strawTex,roughness:1}),0,.155,0);add(head,new THREE.CylinderGeometry(.128,.128,.03,18),stripeM[0],0,.12,0)}
  if(o.hat==='felt'){const fc=o.hatColor||0x4a3a2a;add(head,new THREE.CylinderGeometry(.22,.225,.014,26),std({color:fc,roughness:1}),0,.095,0);add(head,new THREE.CylinderGeometry(.095,.115,.13,18),std({color:fc,roughness:1}),0,.16,0);add(head,new THREE.CylinderGeometry(.117,.117,.025,18),mats.dark,0,.118,0)}
  if(o.hat==='white'){add(head,new THREE.CylinderGeometry(.21,.215,.014,26),std({color:0xf1ece0,roughness:1}),0,.1,0);add(head,new THREE.CylinderGeometry(.1,.115,.12,18),std({color:0xf1ece0,roughness:1}),0,.16,0);add(head,new THREE.CylinderGeometry(.117,.117,.025,18),stripeM[0],0,.122,0)}
  if(o.hat==='chullo'){const ch=add(head,new THREE.SphereGeometry(.12,18,12,0,Math.PI*2,0,Math.PI*.62),cloth(0xffffff,F.chullo),0,.01,0);for(const s of [-1,1])add(head,new THREE.BoxGeometry(.03,.1,.025),cloth(0xffffff,F.chullo),s*.108,-.06,0);add(head,new THREE.SphereGeometry(.03,8,8),stripeM[1],0,.125,0)}
  if(o.skirt){const sm=cloth(0xffffff,o.skirtTex||F.polleraM);add(g,lat([[.14,.0],[.18,-.05],[.28,-.3],[.4,-.58],[.405,-.62]],24),sm,0,.97,0).material.side=THREE.DoubleSide;
    add(g,new THREE.TorusGeometry(.4,.014,6,26),stripeM[1],0,.4,0).rotation.x=Math.PI/2;add(g,new THREE.TorusGeometry(.33,.012,6,26),stripeM[2],0,.55,0).rotation.x=Math.PI/2;
    if(o.shawl){const lm=cloth(0xffffff,o.shawl);add(body,lat([[.1,.64],[.19,.58],[.23,.46],[.2,.3]],18),lm,0,0,0).scale.set(1.12,1,.85);const q=add(body,new THREE.BoxGeometry(.3,.36,.16),cloth(0xffffff,F.aguayo),0,.36,-.19)}
    if(o.apron)add(g,new THREE.BoxGeometry(.28,.42,.02),std({color:0xf2eee2,roughness:1}),0,.72,.15)}
  if(o.poncho){const pm=cloth(0xffffff,o.poncho);add(body,lat([[.1,.62],[.2,.56],[.3,.38],[.34,.12],[.345,.08]],22),pm,0,0,0)}
  g.scale.setScalar(o.height||1);g.traverse(m=>{if(m.isMesh){m.castShadow=true;m.receiveShadow=true}});
  return {g,body,legs,arms,head}}
function placeP(p,x,y,z,ry=0){p.g.position.set(x,y,z);p.g.rotation.y=ry;scene.add(p.g);return p}
const pCamp=placeP(makePerson({skin:0xa9714f,shirt:0xe9e3d3,pants:0x3a3a3f,hat:'straw',poncho:F.poncho,longSleeve:true,mustache:false,boots:true}),4,.03,12);
const pMuj=placeP(makePerson({skin:0xb4795a,shirt:0xe8dcc0,skirt:true,skirtTex:F.polleraM,shawl:F.lli,hat:'white',braids:true,longSleeve:true,height:.95}),-3,.03,9);
const pNino=placeP(makePerson({skin:0xb98262,shirt:0x3a73a8,pants:0x5a4a3a,hat:'chullo',longSleeve:true,height:.62}),-1,.03,11);
const pAgri=placeP(makePerson({skin:0x9a6444,shirt:0x56765a,pants:0x4a3d2a,hat:'straw',longSleeve:true,boots:true,height:1.02}),-16.5,.14,3.2,.5);
const pCook=placeP(makePerson({skin:0xb07a58,shirt:0xe5dcc6,skirt:true,skirtTex:F.polleraB,apron:true,braids:true,longSleeve:false,height:.94}),-4.9,fy,-.95,Math.PI);
const pAbu=placeP(makePerson({skin:0x9d6a4a,shirt:0x8c6a3a,pants:0x3a3a3a,hat:null,hair:0xd8d8d8,mustache:true,longSleeve:true,height:.98}),.9,fy-.28,-.2,Math.PI/2);
const pBal=placeP(makePerson({skin:0xc08a6a,shirt:0xc86a3a,skirt:true,skirtTex:F.polleraM,braids:true,height:.82}),-0.6,3.9,2.4);
const pDor=placeP(makePerson({skin:0xb98262,shirt:0x7a5ab0,pants:0x2d3036,hair:0x1a1410,longSleeve:false,height:.9}),3.0,fy-.22,-2.0,0);
const peopleAll=[pCamp,pMuj,pNino,pAgri,pCook,pAbu,pBal,pDor];
// pose sentada
function sit(p){p.legs.forEach(l=>{l.hip.rotation.x=-1.5;l.knee.rotation.x=1.5})}sit(pAbu);sit(pDor);
const walkers=[{p:pCamp,pts:[[4,12],[9,16],[3,22],[-4,19],[-6,13]],sp:1.1},{p:pMuj,pts:[[-3,9],[-8,8],[-9,12],[-4,14]],sp:.9},{p:pNino,pts:[[-1,11],[6,9],[11,14],[2,17],[-2,13]],sp:1.9}].map(w=>({...w,pts:w.pts.map(a=>new THREE.Vector3(a[0],0,a[1])),i:0,ph:rnd()*6}));
function stepWalker(w,dt){const g=w.p.g,t=w.pts[w.i],dx=t.x-g.position.x,dz=t.z-g.position.z,d=Math.hypot(dx,dz);if(d<.4){w.i=(w.i+1)%w.pts.length;return}
  g.position.x+=dx/d*w.sp*dt;g.position.z+=dz/d*w.sp*dt;let dy=Math.atan2(dx,dz)-g.rotation.y;dy=Math.atan2(Math.sin(dy),Math.cos(dy));g.rotation.y+=dy*Math.min(1,dt*4);w.ph+=dt*w.sp*3.3;
  const s=Math.sin(w.ph)*.62,p=w.p;p.legs[0].hip.rotation.x=s;p.legs[1].hip.rotation.x=-s;p.legs[0].knee.rotation.x=Math.max(0,s)*1.0;p.legs[1].knee.rotation.x=Math.max(0,-s)*1.0;
  p.arms[0].sh.rotation.x=-s*.75;p.arms[1].sh.rotation.x=s*.75;p.arms[0].el.rotation.x=-.2-Math.max(0,-s)*.5;p.arms[1].el.rotation.x=-.2-Math.max(0,s)*.5;
  p.body.position.y=.92+Math.abs(Math.cos(w.ph))*.02;p.body.rotation.z=Math.sin(w.ph)*.025}

/* ---------- ANIMALES ---------- */
function woolGeo(r,detail,lump,sx,sy,sz){let g=new THREE.IcosahedronGeometry(r,detail);g.deleteAttribute('normal');g.deleteAttribute('uv');g=mergeVertices(g);const p=g.attributes.position;
  for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);const n=vnoise(x*9+y*4+20,z*9+y*5+20,64,61)*.6+vnoise(x*22+3,z*22+y*9+8,64,62)*.4;const k=1+lump*(n-.5);p.setXYZ(i,x*k*sx,y*k*sy,z*k*sz)}g.computeVertexNormals();return g}
const woolG=woolGeo(.42,6,.3,.95,.85,1.4);
const woolM=new THREE.MeshStandardMaterial({color:0xece4d2,roughness:1,bumpMap:furBump,bumpScale:2.5});
const faceM=std({color:0x3b312b,roughness:.8}),hoofM=std({color:0x1a1512,roughness:.7});
function makeSheepOld(){const g=new THREE.Group();
  add(g,woolG,woolM,0,.68,0);const nk=add(g,new THREE.SphereGeometry(.2,14,12),woolM,0,.76,.46);nk.scale.set(1,1.1,1.2);add(g,new THREE.SphereGeometry(.12,10,8),woolM,0,.72,-.6);
  const head=new THREE.Group();head.position.set(0,.74,.62);g.add(head);
  const hd=add(head,new THREE.SphereGeometry(.09,16,12),faceM,0,-.03,.09);hd.scale.set(.9,1.05,1.45);add(head,new THREE.SphereGeometry(.05,10,8),std({color:0x2a2220,roughness:.5}),0,-.07,.22);
  for(const s of [-1,1]){const e=add(head,new THREE.SphereGeometry(.05,8,6),faceM,s*.12,.03,.0);e.scale.set(1.5,.4,.8);e.rotation.z=s*-.5;add(head,new THREE.SphereGeometry(.017,8,8),std({color:0xd8c27a,roughness:.3}),s*.075,.02,.1);add(head,new THREE.BoxGeometry(.018,.006,.006),mats.dark,s*.082,.02,.112)}
  add(head,new THREE.SphereGeometry(.08,10,8),woolM,0,.1,-.01).scale.set(1,.7,.9);
  const legs=[];for(const [x,z] of [[-.17,.36],[.17,.36],[-.17,-.38],[.17,-.38]]){const l=new THREE.Group();l.position.set(x,.42,z);g.add(l);add(l,lat([[.001,0],[.045,-.02],[.03,-.2],[.022,-.38],[.001,-.4]],8),faceM,0,0,0);add(l,new THREE.BoxGeometry(.05,.04,.065),hoofM,0,-.4,.01);legs.push(l)}
  g.traverse(m=>{if(m.isMesh){m.castShadow=true}});g.userData={head,legs,type:'sheep'};return g}
const llamaG=woolGeo(.36,6,.22,.8,1.0,1.9);
function makeLlamaOld(col){const g=new THREE.Group();const fur=new THREE.MeshStandardMaterial({color:col,roughness:1,bumpMap:furBump,bumpScale:2});
  add(g,llamaG,fur,0,1.08,0);
  const a=new THREE.Vector3(0,1.3,.62),b=new THREE.Vector3(0,2.02,.86);limb(g,a,b,.15,.085,fur,10);const nw=add(g,woolGeo(.17,3,.3,1,1.5,1),fur,0,1.55,.7);nw.rotation.x=.3;
  const head=new THREE.Group();head.position.set(0,2.05,.9);g.add(head);
  const hh=add(head,new THREE.SphereGeometry(.1,16,12),fur,0,0,.02);hh.scale.set(.85,.95,1.35);add(head,new THREE.SphereGeometry(.065,12,10),fur,0,-.06,.14);add(head,new THREE.SphereGeometry(.03,8,6),mats.dark,0,-.09,.2);
  add(head,new THREE.SphereGeometry(.1,10,8),fur,0,.1,-.04).scale.set(1,.7,.9);
  for(const s of [-1,1]){const ear=add(head,new THREE.ConeGeometry(.04,.2,8),fur,s*.06,.17,-.03);ear.rotation.z=-s*.18;ear.rotation.x=-.15;
    add(head,new THREE.SphereGeometry(.024,10,8),std({color:0x120d0a,roughness:.2}),s*.075,.035,.08);add(head,new THREE.TorusGeometry(.026,.004,4,10),mats.dark,s*.075,.05,.08)}
  const legs=[];for(const [x,z] of [[-.2,.5],[.2,.5],[-.2,-.5],[.2,-.5]]){const l=new THREE.Group();l.position.set(x,.84,z);g.add(l);add(l,lat([[.001,0],[.075,-.02],[.055,-.3],[.04,-.84],[.001,-.86]],8),fur,0,0,0);add(l,new THREE.BoxGeometry(.08,.05,.11),hoofM,0,-.85,.01);legs.push(l)}
  add(g,new THREE.ConeGeometry(.07,.26,6),fur,0,1.28,-.88).rotation.x=-2.3;
  g.traverse(m=>{if(m.isMesh)m.castShadow=true});g.userData={head,legs,type:'llama'};return g}
function makeHenOld(col){const g=new THREE.Group();const fm=std({color:col,roughness:.9,bumpMap:furBump,bumpScale:1});const body=add(g,new THREE.SphereGeometry(.13,14,12),fm,0,.22,0);body.scale.set(.85,.8,1.3);
  const head=new THREE.Group();head.position.set(0,.34,.14);g.add(head);add(head,new THREE.SphereGeometry(.05,10,8),fm,0,.06,.03);add(head,new THREE.ConeGeometry(.018,.05,6),std({color:0xe0a82a}),0,.055,.1).rotation.x=Math.PI/2;
  for(let i=0;i<3;i++)add(head,new THREE.SphereGeometry(.014,6,6),std({color:0xc42a1a}),0,.115+(i===1?.008:0),.04-i*.02);add(head,new THREE.SphereGeometry(.014,6,6),std({color:0xc42a1a}),0,.02,.09);
  for(const s of [-1,1])add(head,new THREE.SphereGeometry(.007,6,6),mats.dark,s*.035,.07,.06);
  add(g,new THREE.SphereGeometry(.06,8,8),fm,0,.3,.1).scale.set(1,1.4,1);
  for(let i=0;i<3;i++){const t=add(g,new THREE.ConeGeometry(.035,.22,6),std({color:[0x1c2a22,0x2a1c14,0x1c2a22][i],roughness:.8}),(i-1)*.04,.34,-.2);t.rotation.x=-.8;t.rotation.z=(i-1)*.25}
  const legs=[];for(const s of [-1,1]){const l=new THREE.Group();l.position.set(s*.05,.13,0);g.add(l);add(l,new THREE.CylinderGeometry(.008,.01,.13,5),std({color:0xe0a82a}),0,-.065,0);add(l,new THREE.BoxGeometry(.035,.008,.06),std({color:0xe0a82a}),0,-.13,.02);legs.push(l)}
  g.traverse(m=>{if(m.isMesh)m.castShadow=true});g.userData={head,legs,type:'hen'};return g}
function makeDogOld(){const g=new THREE.Group();const fm=std({color:0xb98a52,roughness:.95,bumpMap:furBump,bumpScale:1}),dk=std({color:0x1d1612,roughness:.9});
  const bd=add(g,new THREE.CapsuleGeometry(.14,.42,6,12),fm,0,.17,0);bd.rotation.x=Math.PI/2;
  const head=new THREE.Group();head.position.set(0,.14,.42);g.add(head);add(head,new THREE.SphereGeometry(.1,14,12),fm,0,0,0).scale.set(1,.9,1.05);add(head,new THREE.SphereGeometry(.065,12,10),dk,0,-.03,.1).scale.set(1,.8,1.1);add(head,new THREE.SphereGeometry(.02,8,8),mats.dark,0,-.01,.16);
  for(const s of [-1,1]){const e=add(head,new THREE.SphereGeometry(.05,8,6),dk,s*.095,.02,-.02);e.scale.set(.4,1,.8);e.rotation.z=s*.3}
  for(const s of [-1,1]){const f=add(g,new THREE.CapsuleGeometry(.032,.2,4,8),fm,s*.09,.04,.4);f.rotation.x=Math.PI/2}
  const tail=add(g,new THREE.CapsuleGeometry(.025,.2,4,8),fm,.05,.14,-.4);tail.rotation.set(.9,0,.5);
  g.traverse(m=>{if(m.isMesh)m.castShadow=true});g.userData={head,tail,body:bd,type:'dog'};return g}

/* ===== ANIMALES MÁS REALES: lana/pelaje con color por vértice, mechones instanciados, cabezas y patas detalladas ===== */
function furGeoC(r,detail,lump,sx,sy,sz,base,vary){
  let g=new THREE.IcosahedronGeometry(r,detail);g.deleteAttribute('normal');g.deleteAttribute('uv');g=mergeVertices(g);const p=g.attributes.position;
  const col=new Float32Array(p.count*3),uv=new Float32Array(p.count*2);const c=new THREE.Color();
  for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const n=vnoise(x*9+y*4+20,z*9+y*5+20,64,61)*.6+vnoise(x*22+3,z*22+y*9+8,64,62)*.4;const k=1+lump*(n-.5);
    const X=x*k*sx,Y=y*k*sy,Z=z*k*sz;p.setXYZ(i,X,Y,Z);
    const h=Y/(r*sy);const ao=.6+.4*Math.min(1,Math.max(0,(h+.9)/1.5));
    const t2=vnoise(x*5+40,z*5+y*3+40,64,63);const m=(1-vary)+vary*t2*2;
    c.copy(base).multiplyScalar(ao*m);col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;
    uv[i*2]=(Math.atan2(z,x)/(Math.PI*2)+.5)*5;uv[i*2+1]=(h*.5+.5)*3}
  g.setAttribute('color',new THREE.BufferAttribute(col,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.computeVertexNormals();return g}
const furMat=new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:1,bumpMap:furBump,bumpScale:3});
const tuftMat=new THREE.MeshStandardMaterial({color:0xffffff,roughness:1});
const tuftG=woolGeo(.07,1,.55,1,.8,1.25),tuftS=woolGeo(.022,1,.5,1,.7,1.7);
function addTufts(g,cx,cy,cz,rx,ry,rz,count,base,vary,geo){
  const im=new THREE.InstancedMesh(geo||tuftG,tuftMat,count);const d=new THREE.Object3D(),c=new THREE.Color();
  for(let i=0;i<count;i++){let x=rnd()*2-1,y=rnd()*2-1,z=rnd()*2-1;const L=Math.hypot(x,y,z)||1;x/=L;y/=L;z/=L;
    const k=.95+rnd()*.1;d.position.set(cx+x*rx*k,cy+y*ry*k,cz+z*rz*k);d.rotation.set(rnd()*6,rnd()*6,rnd()*6);const s=.7+rnd()*.9;d.scale.set(s,s*(.8+rnd()*.4),s);d.updateMatrix();im.setMatrixAt(i,d.matrix);
    const ao=.62+.38*Math.min(1,Math.max(0,(y+.8)/1.4));c.copy(base).multiplyScalar(ao*(1-vary+vary*2*rnd()));im.setColorAt(i,c)}
  im.instanceMatrix.needsUpdate=true;if(im.instanceColor)im.instanceColor.needsUpdate=true;im.castShadow=true;im.userData.qualityFur=true;im.userData.maxCount=count;g.add(im);return im}
const eyeAmber=std({color:0xd9b24a,roughness:.25}),eyeBlack=std({color:0x0d0907,roughness:.15}),pinkM=std({color:0xc98a86,roughness:.6}),noseM=std({color:0x1a1210,roughness:.35});
function makeSheepNew(){
  const g=new THREE.Group();
  const idx=rnd()<.15?4:Math.floor(rnd()*4);
  const wc=new THREE.Color([0xece4d3,0xe4dbc8,0xdad0bb,0xcbbfa8,0x9d9283][idx]);
  const faceC=rnd()<.7?0x3b312b:0x6b5546;const fM=std({color:faceC,roughness:.75,bumpMap:furBump,bumpScale:1});
  add(g,furGeoC(.42,4,.3,.95,.85,1.4,wc,.38),furMat,0,.68,0);
  add(g,furGeoC(.2,3,.3,1,1.1,1.25,wc,.3),furMat,0,.76,.46);add(g,furGeoC(.13,3,.3,1,1,1,wc,.3),furMat,0,.72,-.6);
  addTufts(g,0,.68,0,.40,.36,.60,200,wc,.32);addTufts(g,0,.78,.46,.18,.2,.22,36,wc,.3);addTufts(g,0,.72,-.6,.12,.12,.14,16,wc,.3);
  const head=new THREE.Group();head.position.set(0,.74,.62);g.add(head);
  const sk=add(head,new THREE.SphereGeometry(.085,18,14),fM,0,-.01,.07);sk.scale.set(.95,1.05,1.35);
  const mz=add(head,new THREE.SphereGeometry(.05,14,12),fM,0,-.075,.19);mz.scale.set(.9,.85,1.5);
  add(head,new THREE.SphereGeometry(.022,10,8),noseM,0,-.062,.27).scale.set(1.5,.9,.7);
  for(const s of [-1,1]){add(head,new THREE.SphereGeometry(.007,6,6),noseM,s*.015,-.066,.282);
    const e=add(head,new THREE.SphereGeometry(.05,10,8),fM,s*.1,.0,.03);e.scale.set(1.9,.32,.75);e.rotation.z=s*-.35;e.rotation.y=s*.25;
    add(head,new THREE.SphereGeometry(.019,10,8),eyeAmber,s*.072,.022,.1);add(head,new THREE.BoxGeometry(.02,.006,.005),eyeBlack,s*.074,.022,.118)}
  add(head,new THREE.BoxGeometry(.05,.004,.01),pinkM,0,-.098,.235);
  add(head,furGeoC(.07,2,.35,1,.7,.9,wc,.2),furMat,0,.1,.0);
  const legs=[];for(const [x,z] of [[-.17,.36],[.17,.36],[-.17,-.38],[.17,-.38]]){const l=new THREE.Group();l.position.set(x,.42,z);g.add(l);
    add(l,lat([[.001,0],[.05,-.02],[.034,-.14],[.026,-.28],[.03,-.37],[.001,-.4]],10),fM,0,0,0);
    add(l,new THREE.SphereGeometry(.03,8,6),fM,0,-.2,.012).scale.set(1,1.2,1.1);
    add(l,furGeoC(.1,2,.3,1,1.05,1,wc,.25),furMat,0,-.04,0);
    add(l,new THREE.BoxGeometry(.055,.04,.07),hoofM,0,-.4,.012);legs.push(l)}
  add(g,furGeoC(.06,2,.3,1,1.4,1,wc,.2),furMat,0,.62,-.76);
  g.traverse(m=>{if(m.isMesh){m.castShadow=true}});g.userData={head,legs,type:'sheep'};return g}
function makeLlamaNew(col){
  const g=new THREE.Group();const base=new THREE.Color(col);const fur=new THREE.MeshStandardMaterial({color:col,roughness:1,bumpMap:furBump,bumpScale:2});
  add(g,furGeoC(.36,4,.24,.8,1.0,1.9,base,.45),furMat,0,1.08,0);
  addTufts(g,0,1.08,0,.3,.34,.66,150,base,.4);
  const P=[[1.3,.62,.16],[1.62,.78,.13],[1.95,.85,.105],[2.1,.9,.088]];
  for(let i=0;i<P.length-1;i++){const a=new THREE.Vector3(0,P[i][0],P[i][1]),b=new THREE.Vector3(0,P[i+1][0],P[i+1][1]);limb(g,a,b,P[i][2],P[i+1][2],fur,12)}
  add(g,furGeoC(.17,3,.3,1,1.7,1,base,.35),furMat,0,1.62,.77);addTufts(g,0,1.68,.77,.13,.35,.13,55,base,.4);
  const head=new THREE.Group();head.position.set(0,2.1,.92);g.add(head);
  const hh=add(head,new THREE.SphereGeometry(.09,18,14),fur,0,.02,.02);hh.scale.set(.85,1,1.3);
  const mz=add(head,new THREE.SphereGeometry(.058,14,12),fur,0,-.055,.15);mz.scale.set(.9,.9,1.5);
  add(head,new THREE.SphereGeometry(.026,10,8),noseM,0,-.05,.235).scale.set(1.5,.8,.7);add(head,new THREE.BoxGeometry(.004,.03,.006),noseM,0,-.085,.225);
  add(head,furGeoC(.085,2,.35,1,.7,.9,base,.3),furMat,0,.11,-.02);
  for(const s of [-1,1]){const ear=add(head,new THREE.ConeGeometry(.035,.22,10),fur,s*.06,.2,-.03);ear.rotation.z=-s*.16;ear.rotation.x=-.2;
    add(head,new THREE.SphereGeometry(.03,12,10),eyeBlack,s*.075,.045,.07);add(head,new THREE.SphereGeometry(.007,6,6),std({color:0xffffff,roughness:.1}),s*.083,.056,.092);
    add(head,new THREE.TorusGeometry(.03,.004,4,12,Math.PI),noseM,s*.076,.062,.075).rotation.z=Math.PI*.5}
  const legs=[];for(const [x,z] of [[-.2,.5],[.2,.5],[-.2,-.5],[.2,-.5]]){const l=new THREE.Group();l.position.set(x,.84,z);g.add(l);
    add(l,lat([[.001,0],[.095,-.03],[.08,-.28],[.052,-.48],[.04,-.64],[.046,-.78],[.001,-.84]],12),fur,0,0,0);
    add(l,new THREE.SphereGeometry(.058,10,8),fur,0,-.5,.02).scale.set(1,1.1,1.2);
    add(l,furGeoC(.13,2,.3,1,1.4,1,base,.3),furMat,0,-.1,0);
    add(l,new THREE.BoxGeometry(.085,.045,.13),hoofM,0,-.84,.02);legs.push(l)}
  const tl=add(g,new THREE.ConeGeometry(.06,.3,8),fur,0,1.35,-.74);tl.rotation.x=-.9;
  g.traverse(m=>{if(m.isMesh)m.castShadow=true});g.userData={head,legs,type:'llama'};return g}
function makeHenNew(col){
  const g=new THREE.Group();const base=new THREE.Color(col);const fm=std({color:col,roughness:.9,bumpMap:furBump,bumpScale:1});
  const bd=add(g,furGeoC(.13,3,.1,.85,.85,1.3,base,.4),furMat,0,.22,0);
  addTufts(g,0,.22,0,.11,.11,.17,45,base,.4,tuftS);
  for(const s of [-1,1]){const w=add(g,new THREE.SphereGeometry(.09,10,8),fm,s*.1,.23,-.01);w.scale.set(.28,.75,1.3);w.rotation.z=s*.1}
  const breast=add(g,furGeoC(.07,2,.2,1,1.3,1,base,.3),furMat,0,.28,.09);
  const head=new THREE.Group();head.position.set(0,.36,.14);g.add(head);
  add(head,furGeoC(.05,2,.1,1,1.1,1.1,base,.25),furMat,0,.05,.03);
  add(head,new THREE.ConeGeometry(.016,.05,6),std({color:0xe0a82a}),0,.045,.105).rotation.x=Math.PI/2;
  const red=std({color:0xc42a1a,roughness:.5});
  for(let i=0;i<4;i++){const c=add(head,new THREE.SphereGeometry(.013,8,8),red,0,.108+(i===1||i===2?.008:0),.06-i*.02);c.scale.set(.7,1.2,1)}
  for(const s of [-1,1]){add(head,new THREE.SphereGeometry(.01,6,6),red,s*.007,.012,.088).scale.set(.7,1.6,.7);
    add(head,new THREE.SphereGeometry(.008,8,8),std({color:0xe0a82a,roughness:.2}),s*.035,.065,.06);add(head,new THREE.SphereGeometry(.0045,6,6),mats.dark,s*.038,.065,.065)}
  const fan=[0x1c2a22,0x2a1c14,0x1c2a22,0x3a2a1c,0x1c2a22];
  for(let i=0;i<5;i++){const t=add(g,new THREE.ConeGeometry(.032,.24,6),std({color:fan[i],roughness:.7}),(i-2)*.035,.36,-.2);t.rotation.x=-.75;t.rotation.z=(i-2)*.22}
  const legs=[];for(const s of [-1,1]){const l=new THREE.Group();l.position.set(s*.05,.13,0);g.add(l);
    const ym=std({color:0xe0a82a,roughness:.7});add(l,new THREE.CylinderGeometry(.007,.01,.13,6),ym,0,-.065,0);
    for(const a of [-.35,0,.35]){const toe=add(l,new THREE.CylinderGeometry(.004,.006,.045,4),ym,Math.sin(a)*.018,-.128,.02+Math.cos(a)*.018);toe.rotation.x=Math.PI/2;toe.rotation.z=-a}
    legs.push(l)}
  g.traverse(m=>{if(m.isMesh)m.castShadow=true});g.userData={head,legs,type:'hen'};return g}
function makeDogNew(){
  const g=new THREE.Group();const base=new THREE.Color(0xb98a52);const fm=std({color:0xb98a52,roughness:.95,bumpMap:furBump,bumpScale:1}),dk=std({color:0x2a1d14,roughness:.9}),cr=std({color:0xe4cfa4,roughness:.95});
  const bd=add(g,furGeoC(.17,3,.18,1,.9,2.3,base,.35),furMat,0,.17,-.04);
  add(g,furGeoC(.14,3,.15,1,1,1,base,.3),furMat,0,.2,.2);add(g,furGeoC(.13,3,.15,1.1,.9,1.1,base,.3),furMat,0,.14,-.28);
  addTufts(g,0,.18,0,.15,.14,.38,60,base,.35,tuftS);
  const head=new THREE.Group();head.position.set(0,.2,.42);g.add(head);
  add(head,new THREE.SphereGeometry(.095,16,12),fm,0,0,0).scale.set(1,.92,1.08);
  const mz=add(head,new THREE.SphereGeometry(.058,12,10),cr,0,-.03,.11);mz.scale.set(.95,.8,1.4);
  add(head,new THREE.SphereGeometry(.02,10,8),noseM,0,-.012,.19).scale.set(1.3,.9,.8);
  for(const s of [-1,1]){const e=add(head,new THREE.SphereGeometry(.05,10,8),dk,s*.088,.012,-.02);e.scale.set(.38,1.15,.8);e.rotation.z=s*.35;
    add(head,new THREE.SphereGeometry(.012,8,8),eyeBlack,s*.045,.03,.075);add(head,new THREE.BoxGeometry(.03,.006,.006),dk,s*.045,.052,.08)}
  const lg=[[-.09,.13],[.09,.13],[-.1,-.24],[.1,-.24]];
  for(const [x,z] of lg){const f=add(g,new THREE.CapsuleGeometry(.034,.16,4,8),fm,x,.04,z+(z>0?.12:0));f.rotation.x=Math.PI/2;add(g,new THREE.SphereGeometry(.04,8,8),cr,x,.032,z+(z>0?.24:.08)).scale.set(1,.6,1.3)}
  const tail=new THREE.Group();tail.position.set(.0,.16,-.42);tail.rotation.x=.9;g.add(tail);
  const tc=add(tail,new THREE.CapsuleGeometry(.025,.22,4,8),fm,0,.11,0);
  g.traverse(m=>{if(m.isMesh)m.castShadow=true});g.userData={head,tail,body:bd,type:'dog'};return g}
function makeSheep(){try{return makeSheepNew()}catch(e){console.warn('oveja',e);return makeSheepOld()}}
function makeLlama(c){try{return makeLlamaNew(c)}catch(e){console.warn('llama',e);return makeLlamaOld(c)}}
function makeHen(c){try{return makeHenNew(c)}catch(e){console.warn('gallina',e);return makeHenOld(c)}}
function makeDog(){try{return makeDogNew()}catch(e){console.warn('perro',e);return makeDogOld()}}

const animals=[];
for(let i=0;i<8;i++){const g=makeSheep();g.scale.setScalar(.85+rnd()*.3);scene.add(g);animals.push({g,cx:19.5+(rnd()-.5)*4,cz:10.3+(rnd()-.5)*3,rx:.6+rnd()*1.1,rz:.6+rnd()*1.0,a:rnd()*6.28,sp:.12+rnd()*.12,ph:rnd()*6,dir:rnd()<.5?1:-1})}
[[0x8a6a4a,17,8],[0xece4d4,22,13]].forEach((c,i)=>{const g=makeLlama(c[0]);scene.add(g);animals.push({g,cx:c[1],cz:c[2],rx:1.5,rz:1.2,a:i*3,sp:.1,ph:i,dir:1})});
for(let i=0;i<4;i++){const g=makeSheep();g.scale.setScalar(.8);scene.add(g);animals.push({g,cx:-30+(rnd()-.5)*10,cz:-18+(rnd()-.5)*10,rx:3,rz:2,a:rnd()*6,sp:.07,ph:rnd()*6,dir:1})}
for(let i=0;i<5;i++){const g=makeHen([0xa8481f,0xe9e0cc,0x3a2a22,0xc9822a,0x8a3a1a][i]);scene.add(g);animals.push({g,cx:-9+(rnd()-.5)*4,cz:12.5+(rnd()-.5)*3,rx:1.2+rnd(),rz:1+rnd(),a:rnd()*6.28,sp:.35+rnd()*.3,ph:rnd()*6,dir:rnd()<.5?1:-1})}
const dog=makeDog();dog.position.set(-5.3,.3,4.9);dog.rotation.y=.7;scene.add(dog);const dogA={g:dog,static:true};animals.push(dogA);

/* ---------- animación general ---------- */
let doorOpen=0;
function animateLife(dt,t){
  walkers.forEach(w=>stepWalker(w,dt));
  const set=(a,b)=>{a.rotation.x=b};
  pAgri.body.rotation.x=.85+Math.sin(t*1.9)*.3;pAgri.arms.forEach(a=>{a.sh.rotation.x=-1.0-Math.sin(t*1.9)*.3;a.el.rotation.x=-.35});
  pCook.arms[1].sh.rotation.x=-1.0+Math.sin(t*3.2)*.2;pCook.arms[1].el.rotation.x=-.9;pCook.arms[0].sh.rotation.x=-.4;pCook.arms[0].el.rotation.x=-.8;pCook.head.rotation.y=Math.sin(t*.5)*.3;pCook.body.rotation.y=Math.sin(t*3.2)*.05;
  [pAbu,pDor].forEach((p,i)=>{p.arms[0].sh.rotation.x=-.5;p.arms[1].sh.rotation.x=-.5;p.arms[0].el.rotation.x=-1.0;p.arms[1].el.rotation.x=-1.0;p.head.rotation.y=Math.sin(t*.4+i)*.25;p.body.position.y=.92+Math.sin(t*1.4+i)*.004});
  pBal.arms[1].sh.rotation.z=2.5+Math.sin(t*5)*.3;pBal.arms[1].el.rotation.x=-.3;pBal.head.rotation.y=Math.sin(t*.6)*.2;
  animals.forEach((a,ai)=>{
    if(a.static){const u=a.g.userData;if(perfFrame%2===0){u.tail.rotation.z=.5+Math.sin(t*6)*.5;a.g.scale.y=1+Math.sin(t*1.8)*.015;u.head.rotation.x=Math.sin(t*.6)*.03}return}
    const u=a.g.userData;a.a+=a.dir*a.sp*dt;const c=Math.cos(a.a),s=Math.sin(a.a);const x=a.cx+c*a.rx,z=a.cz+s*a.rz;const hy=(u.type==='hen')?(Math.abs(x-0)<7&&z<6.5?.3:0):hFn(x,z);
    a.g.position.set(x,hy,z);a.g.rotation.y=Math.atan2(-s*a.rx*a.dir,c*a.rz*a.dir);
    const d2=(camera.position.x-x)**2+(camera.position.z-z)**2;
    const qg=gfx?.current;const animDist=qg?.fullAnimationDistance??PERF.fullAnimationDistance;const animDiv=qg?.farAnimationDivisor??PERF.farAnimationDivisor;
    const detail=d2<animDist*animDist||((perfFrame+ai)%animDiv===0);
    if(!detail)return;
    if(u.type==='hen'){const peck=Math.max(0,Math.sin(t*2.6+a.ph));u.head.rotation.x=peck*.9;a.g.rotation.x=peck*.25;u.legs.forEach((l,i)=>l.rotation.x=Math.sin(t*9+i*3.14+a.ph)*.5)}
    else{const gaitSp=u.type==='llama'?2.2:2.8;u.head.rotation.x=.55*Math.max(0,Math.sin(t*.6+a.ph))+Math.sin(t*1.7+a.ph)*.03;
      const amp=u.type==='llama'?.3:.35;u.legs.forEach((l,i)=>{const diag=(i===0||i===3)?0:Math.PI;l.rotation.x=Math.sin(t*gaitSp+diag+a.ph)*amp});
      a.g.position.y+=Math.abs(Math.sin(t*gaitSp+a.ph))*.012}});
  fireLight.intensity=2.2+Math.sin(t*17)*.4+Math.sin(t*9.3)*.3;
  const night=nightF;lampLight.intensity=.5+night*2.2;lampLight2.intensity=.4+night*2.0;tvLight.intensity=.4+night*1.2+Math.sin(t*3.1)*.15;tvScreen.emissiveIntensity=.8;
  if(window.doorPivot){const dx=camera.position.x+3,dz=camera.position.z-3.4;const near=Math.hypot(dx,dz)<3.4||(fp&&Math.abs(camera.position.z)<3.3&&camera.position.x<-1&&camera.position.x>-5);doorOpen+=((near?1.75:0)-doorOpen)*Math.min(1,dt*4);window.doorPivot.rotation.y=doorOpen}
  if(window.upDoorPivot){const nearU=fp&&Math.hypot(camera.position.x+2.95,camera.position.z-1.9)<2.1&&camera.position.y>3.8;window.upOpen=(window.upOpen||0);window.upOpen+=((nearU?1.7:0)-window.upOpen)*Math.min(1,dt*4);window.upDoorPivot.rotation.y=window.upOpen}
  if(window.upLamp){window.upLamp.intensity=.15+night*2.2;for(const m of window.upLampMats||[])m.emissiveIntensity=.3+night*1.6}
}

/* ---------- RECORRIDO EN PRIMERA PERSONA ---------- */
let fp=false,yaw=0,pitch=0,saved=null,bob=0,drag=false,lastX=0,lastY=0;const keys={},vel=new THREE.Vector3();let fpGY=NaN,jy=0,jv=0;
const wallRects=[[-6.45,6.45,-3.4,-2.5],[-6.45,-5.55,-3.4,-1.3],[-6.45,-5.55,-.3,3.1],[5.55,6.45,-3.4,3.1],[-6.45,-3.55,2.5,3.1],[-2.45,6.45,2.5,3.1],[-10.3,-5.9,-2.55,-2.0],[-10.3,-5.9,2.0,2.55],[-10.3,-9.5,-2.55,2.55]];
const furnRects=[[-5.9,-3.9,-2.6,-1.25],[-3.4,-1.4,-1.4,-.4],[1.6,4.8,-2.5,-1.45],[2.55,3.85,-.82,-.08],[.35,1.35,-.75,.4],[4.95,5.6,-.85,.85],[-5.5,-3.85,2.05,2.55],[-8.95,-6.9,-2.05,-.95],[-9.6,-9.0,.2,1.45],[-7.5,-6.5,1.3,1.9]];
const rects=wallRects.concat(furnRects);
function blocked(x,z){const m=.26;for(const r of rects)if(x>r[0]-m&&x<r[1]+m&&z>r[2]-m&&z<r[3]+m)return true;return Math.hypot(x,z)>95}
function fpUpdate(dt){
  if(keys.KeyQ)yaw+=dt*1.8;if(keys.KeyE)yaw-=dt*1.8;
  if(seatNow){sitUpdate(dt);return}
  const f=(keys.KeyW||keys.ArrowUp||keys.forward?1:0)-(keys.KeyS||keys.ArrowDown||keys.backward?1:0),r=(keys.KeyD||keys.ArrowRight||keys.right?1:0)-(keys.KeyA||keys.ArrowLeft||keys.left?1:0);
  const spd=keys.ShiftLeft||keys.ShiftRight?4.4:2.2;const tx=(-Math.sin(yaw)*f+Math.cos(yaw)*r)*spd,tz=(-Math.cos(yaw)*f-Math.sin(yaw)*r)*spd;
  const k=1-Math.exp(-dt*9);vel.x+=(tx-vel.x)*k;vel.z+=(tz-vel.z)*k;
  const nx=camera.position.x+vel.x*dt,nz=camera.position.z+vel.z*dt;
  if(fpSurf(nx,camera.position.z,fpGY)!==null)camera.position.x=nx;else vel.x=0;if(fpSurf(camera.position.x,nz,fpGY)!==null)camera.position.z=nz;else vel.z=0;
  const x=camera.position.x,z=camera.position.z;const sp=Math.hypot(vel.x,vel.z);bob+=sp*dt*2.6;
  const gs=fpSurf(x,z,fpGY);if(gs!==null)fpGY=gs;const gy=fpGY===fpGY?fpGY:hFn(x,z);
  if((keys.Space||keys.jump)&&jy===0&&jv===0)jv=3.5;
  jv-=9.8*dt;jy+=jv*dt;if(jy<=0){jy=0;jv=0}
  camera.position.y=lerp(camera.position.y,gy+1.66+Math.sin(bob)*.022*Math.min(1,sp)*(jy>0?0:1)+jy,Math.min(1,dt*(jy>0?40:12)));
  camera.rotation.set(pitch,yaw,0,'YXZ')}
const miniCv=$('mini'),mg=miniCv.getContext('2d');
function drawMini(){const S=10,X0=-12,Z0=-4;const X=x=>(x-X0)*S,Z=z=>(z-Z0)*S;mg.clearRect(0,0,200,130);mg.fillStyle='rgba(30,36,44,.92)';mg.fillRect(0,0,200,130);
  mg.fillStyle='#4a3a2a';mg.fillRect(X(-10),Z(-2.5),X(6)-X(-10),Z(2.5)-Z(-2.5));mg.fillStyle='#7a5a3a';mg.fillRect(X(-6),Z(-3),X(6)-X(-6),Z(3)-Z(-3));
  mg.fillStyle='#b87a45';wallRects.forEach(r=>mg.fillRect(X(r[0]),Z(r[2]),(r[1]-r[0])*S,(r[3]-r[2])*S));
  mg.fillStyle='#3b2a1c';furnRects.forEach(r=>mg.fillRect(X(r[0]),Z(r[2]),(r[1]-r[0])*S,(r[3]-r[2])*S));
  mg.fillStyle='#6a5a48';mg.fillRect(X(-6.2),Z(3),X(6.2)-X(-6.2),Z(5.9)-Z(3));
  const px=clamp(X(camera.position.x),4,196),pz=clamp(Z(camera.position.z),4,126);const fx=-Math.sin(yaw),fz=-Math.cos(yaw);
  mg.save();mg.translate(px,pz);mg.rotate(Math.atan2(fx,-fz));mg.fillStyle='#ffd23f';mg.beginPath();mg.moveTo(0,-8);mg.lineTo(5.5,6);mg.lineTo(-5.5,6);mg.closePath();mg.fill();mg.strokeStyle='#000';mg.lineWidth=1;mg.stroke();mg.restore();
  mg.fillStyle='#fff';mg.font='9px Segoe UI';mg.fillText('SALA',X(1.7),Z(-0.4));mg.fillText('COCINA',X(-5.6),Z(0.9));mg.fillText('DORM.',X(-9.2),Z(-.2));mg.fillText('N ↓',4,12)}
function enterFP(x=-3,z=9,y=0){if(fp)return;fp=true;seatNow=null;fpGY=NaN;jy=0;jv=0;camTween=null;saved={p:camera.position.clone(),t:controls.target.clone(),fov:camera.fov};controls.enabled=false;camera.fov=70;camera.near=.05;camera.updateProjectionMatrix();
  camera.position.set(x,1.7,z);yaw=y;pitch=-.03;vel.set(0,0,0);labelsGroup.visible=false;$('walkPad').style.display='flex';$('cross').style.display='block';$('fpBar').style.display='flex';miniCv.style.display='block';canvas.style.cursor='grab';$('hud').style.display='none';$('panel').classList.add('hide');$('tog').style.display='block'}
function exitFP(){if(!fp)return;fp=false;seatNow=null;if(sitHint)sitHint.style.display='none';controls.enabled=true;document.pointerLockElement&&document.exitPointerLock();camera.fov=saved.fov;camera.near=.1;camera.rotation.set(0,0,0);camera.updateProjectionMatrix();camera.position.copy(saved.p);controls.target.copy(saved.t);controls.update();labelsGroup.visible=state.labels;
  $('walkPad').style.display='none';$('cross').style.display='none';$('fpBar').style.display='none';miniCv.style.display='none';canvas.style.cursor='';$('hud').style.display='';$('panel').classList.remove('hide');$('tog').style.display=$('panel').classList.contains('panelCollapsed')?'block':'none'}
$('bWalk').onclick=()=>enterFP(-3,12,0);
$('bGoIn').onclick=()=>{if(fp)exitFP();enterFP(-3,5.6,0)};
$('bUp').onclick=()=>{if(fp)exitFP();enterFP(-4.15,5.9,Math.PI)};
$('bExit').onclick=exitFP;
document.querySelectorAll('[data-act]').forEach(b=>b.addEventListener('click',()=>{if(!fp)return;if(b.dataset.act==='sit')toggleSit();else if(window.TV)TV.next()}));
canvas.addEventListener('pointerdown',e=>{if(!fp)return;drag=true;lastX=e.clientX;lastY=e.clientY;try{canvas.setPointerCapture(e.pointerId)}catch(_){}canvas.style.cursor='grabbing';if($('lockMouse').checked&&e.pointerType==='mouse')canvas.requestPointerLock()});
canvas.addEventListener('pointermove',e=>{if(!fp)return;if(document.pointerLockElement===canvas){yaw-=e.movementX*.0022;pitch=clamp(pitch-e.movementY*.0022,-1.4,1.4);return}if(!drag)return;const dx=e.clientX-lastX,dy=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;yaw-=dx*.0042;pitch=clamp(pitch-dy*.0042,-1.4,1.4)});
const endDrag=()=>{drag=false;if(fp)canvas.style.cursor='grab'};canvas.addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);
document.addEventListener('keydown',e=>{keys[e.code]=true;if(fp&&(e.code.startsWith('Arrow')||e.code==='Space'))e.preventDefault();if(e.code==='Escape'&&fp)exitFP()});document.addEventListener('keyup',e=>keys[e.code]=false);
document.querySelectorAll('[data-move]').forEach(b=>{const k=b.dataset.move;b.onpointerdown=e=>{e.preventDefault();keys[k]=true;try{b.setPointerCapture(e.pointerId)}catch(_){}};b.onpointerup=b.onpointercancel=()=>keys[k]=false});
$('bPeople').onclick=()=>{const v=!peopleAll[0].g.visible;peopleAll.forEach(p=>p.g.visible=v);$('bPeople').classList.toggle('on',v)};
$('bAnimals').onclick=()=>{const v=!animals[0].g.visible;animals.forEach(a=>a.g.visible=v);$('bAnimals').classList.toggle('on',v)};
document.querySelectorAll('.tabs button').forEach(b=>b.onclick=()=>{document.querySelectorAll('.tabs button').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.id===b.dataset.tab))});
document.querySelectorAll('[data-hour]').forEach(b=>b.onclick=()=>{state.hour=+b.dataset.hour;$('hour').value=state.hour;updateTime()});

/* ---------- lluvia y nieve ---------- */
const NR=PERF.rainCount;const rainPos=new Float32Array(NR*6);for(let i=0;i<NR;i++){const x=(rnd()-.5)*70,y=rnd()*40,z=(rnd()-.5)*70;rainPos.set([x,y,z,x-.04,y-.7,z],i*6)}
const rainGeo=new THREE.BufferGeometry();rainGeo.setAttribute('position',new THREE.BufferAttribute(rainPos,3));
const rain=new THREE.LineSegments(rainGeo,new THREE.LineBasicMaterial({color:0xbfd4e6,transparent:true,opacity:.45,fog:false}));rain.visible=false;rain.frustumCulled=false;scene.add(rain);

function snowTex(size=64){const c=document.createElement('canvas');c.width=c.height=size;const g=c.getContext('2d');const grad=g.createRadialGradient(size*.5,size*.5,0,size*.5,size*.5,size*.5);grad.addColorStop(0,'rgba(255,255,255,1)');grad.addColorStop(.45,'rgba(255,255,255,.98)');grad.addColorStop(.75,'rgba(225,236,255,.55)');grad.addColorStop(1,'rgba(225,236,255,0)');g.fillStyle=grad;g.beginPath();g.arc(size*.5,size*.5,size*.48,0,Math.PI*2);g.fill();const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t}
function makeSnowSystem(count,spread,height,size,opacity){
  const pos=new Float32Array(count*3),sca=new Float32Array(count),vel=new Float32Array(count),drift=new Float32Array(count),ph=new Float32Array(count);
  for(let i=0;i<count;i++){
    pos[i*3]=(rnd()-.5)*spread;pos[i*3+1]=rnd()*height+.5;pos[i*3+2]=(rnd()-.5)*spread;
    sca[i]=lerp(.55,1.7,rnd());vel[i]=lerp(.45,1.55,rnd());drift[i]=lerp(.18,.85,rnd())*(rnd()>.5?1:-1);ph[i]=rnd()*Math.PI*2;
  }
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('aScale',new THREE.BufferAttribute(sca,1));
  const mat=new THREE.PointsMaterial({map:snowTex(64),color:0xf5fbff,size,transparent:true,opacity,depthWrite:false,alphaTest:.05,blending:THREE.NormalBlending,fog:true,sizeAttenuation:true});
  const pts=new THREE.Points(geo,mat);pts.frustumCulled=false;pts.visible=false;scene.add(pts);
  return {pts,geo,pos,sca,vel,drift,ph,count,spread,height,baseY:.5};
}
const snowFar=makeSnowSystem(PERF.snowFar,78,30,.28,.88);
const snowNear=makeSnowSystem(PERF.snowNear,38,18,.5,.98);
const snowFront=makeSnowSystem(PERF.snowFront,16,10,.78,.95);
const snowGroup=new THREE.Group();snowGroup.visible=false;scene.add(snowGroup);snowGroup.add(snowFar.pts,snowNear.pts,snowFront.pts);
const snowGround=new THREE.Mesh(new THREE.CircleGeometry(20.2,64),new THREE.MeshStandardMaterial({color:0xf3f8ff,transparent:true,opacity:.22,alphaMap:radialAlpha(.62),depthWrite:false,roughness:1,polygonOffset:true,polygonOffsetFactor:-1}));
snowGround.rotation.x=-Math.PI/2;snowGround.position.set(0,.03,0);snowGround.visible=false;scene.add(snowGround);
function updateSnow(sys,dt,camFollow=.35,wind=.0){const p=sys.geo.attributes.position.array;const active=Math.max(1,Math.floor(sys.count*(gfx?.current?.particleScale??1)));for(let i=0;i<active;i++){const k=i*3;const sway=Math.sin(clock.elapsedTime*1.2+sys.ph[i])*0.18; p[k]+= (sys.drift[i]*.18+sway+wind)*dt; p[k+1]-=sys.vel[i]*dt*(sys===snowFront?2.1:1.4); p[k+2]+=Math.cos(clock.elapsedTime*.9+sys.ph[i])*.04*dt + sys.drift[i]*.05*dt; if(p[k+1]<sys.baseY){p[k]=(rnd()-.5)*sys.spread + camera.position.x*camFollow; p[k+1]=sys.height+rnd()*4; p[k+2]=(rnd()-.5)*sys.spread + camera.position.z*camFollow;}}sys.geo.attributes.position.needsUpdate=true;sys.pts.position.x=camera.position.x*(camFollow);sys.pts.position.z=camera.position.z*(camFollow)}

/* ---------- etiquetas 3D ---------- */
function label(text,{color='#fff',bg='rgba(10,14,18,.78)',scale=1}={}){
  const cv=document.createElement('canvas');const g=cv.getContext('2d');g.font='bold 34px system-ui';const w=g.measureText(text).width+34;cv.width=w;cv.height=60;
  g.font='bold 34px system-ui';g.fillStyle=bg;g.beginPath();g.roundRect(0,0,w,60,14);g.fill();g.fillStyle=color;g.textBaseline='middle';g.fillText(text,17,31);
  const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthTest:false,fog:false}));
  s.scale.set(w/60*.55*scale,.55*scale,1);s.renderOrder=10;s.userData.text=text;return s}
const labelsGroup=new THREE.Group();scene.add(labelsGroup);
function setLabel(sp,text,pos,opts){if(sp.userData.text!==text){const n=label(text,opts);sp.material.map.dispose();sp.material=n.material;sp.scale.copy(n.scale);sp.userData.text=text}sp.position.copy(pos)}

const L1=label('Vivienda segura y sostenible · Julcán'),L2=label('Paneles solares térmicos'),L3=label('Ventana orientada al sol');
L1.position.set(0,8.6,0);L2.position.set(0,8.25,.75);labelsGroup.add(L1,L2,L3);
buildStudentRoom();

/* ---------- observador y triángulo (Problema 2) ---------- */
const obs=new THREE.Group();obs.visible=false;scene.add(obs);
const obsBody=new THREE.Group();obs.add(obsBody);
{const sk=std({color:0xe0b08c,roughness:.8}),cl=std({color:0x2f5c9a,roughness:.9}),pn=std({color:0x222a35,roughness:.9});
  add(obsBody,new THREE.CylinderGeometry(.09,.09,.8,10),pn,-.1,.4,0);add(obsBody,new THREE.CylinderGeometry(.09,.09,.8,10),pn,.1,.4,0);
  add(obsBody,new THREE.CapsuleGeometry(.2,.55,4,12),cl,0,1.15,0);add(obsBody,new THREE.SphereGeometry(.12,16,16),sk,0,1.6,0)}
const pole=new THREE.Group();obs.add(pole);
const poleMesh=add(pole,new THREE.CylinderGeometry(.04,.04,1,8),std({color:0xe8e8e8}),0,.5,0);
const poleTip=add(pole,new THREE.SphereGeometry(.22,18,18),std({color:0xff3b30,emissive:0xff3b30,emissiveIntensity:.8}),0,10.6,0,{cast:false});
const lnMat=(c)=>new THREE.LineBasicMaterial({color:c,depthTest:false,transparent:true});
const mkLine=(c)=>{const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,1)]),lnMat(c));l.renderOrder=9;l.frustumCulled=false;obs.add(l);return l}
const lineSight=mkLine(0xffd23f),lineHor=mkLine(0x4fd1ff),lineVert=mkLine(0x7ee08a),lineGround=mkLine(0xffffff);
const arc=new THREE.Line(new THREE.BufferGeometry(),lnMat(0xffd23f));arc.renderOrder=9;arc.frustumCulled=false;obs.add(arc);
const obsLabels=[label('α = 37°',{color:'#ffd23f'}),label('d = 12 m',{color:'#4fd1ff'}),label('h₂ = 9 m',{color:'#7ee08a'}),label('H = 10.60 m',{color:'#ff8a80'}),label('1.60 m',{color:'#fff'})];
obsLabels.forEach(l=>obs.add(l));

function setLine(l,a,b){l.geometry.setFromPoints([a,b])}
function updateObs(){
  const al=+$('alpha').value,d=+$('dist').value,e=1.6;
  const tanA=al===37?.75:Math.tan(THREE.MathUtils.degToRad(al));
  const h2=d*tanA,H=e+h2;
  const px=9,zw=3;const zo=zw+d;
  obsBody.position.set(px,0,zo);
  pole.position.set(px,0,zw);poleMesh.scale.y=H;poleMesh.position.y=H/2;poleTip.position.y=H;
  const eye=new THREE.Vector3(px,e,zo),top=new THREE.Vector3(px,H,zw),hp=new THREE.Vector3(px,e,zw),g0=new THREE.Vector3(px,.05,zo),g1=new THREE.Vector3(px,.05,zw);
  setLine(lineSight,eye,top);setLine(lineHor,eye,hp);setLine(lineVert,hp,top);setLine(lineGround,g0,g1);
  const pts=[];const R=Math.min(2.4,d*.35);const a=THREE.MathUtils.degToRad(al);
  for(let i=0;i<=24;i++){const t=a*i/24;pts.push(new THREE.Vector3(px,e+Math.sin(t)*R,zo-Math.cos(t)*R))}
  arc.geometry.setFromPoints(pts);
  const t=Math.atan2(h2,d);
  setLabel(obsLabels[0],`α = ${al}°`,new THREE.Vector3(px,e+.55,zo-R-.9),{color:'#ffd23f'});
  setLabel(obsLabels[1],`d = ${d} m`,new THREE.Vector3(px,.7,(zo+zw)/2),{color:'#4fd1ff'});
  setLabel(obsLabels[2],`h₂ = ${h2.toFixed(2)} m`,new THREE.Vector3(px+1.8,e+h2/2,zw),{color:'#7ee08a'});
  setLabel(obsLabels[3],`H = ${H.toFixed(2)} m`,new THREE.Vector3(px+1.8,H+.7,zw),{color:'#ff8a80'});
  setLabel(obsLabels[4],`1.60 m`,new THREE.Vector3(px+1.1,e/2,zo),{color:'#fff'});
  $('aTxt').textContent=al+'°';$('dTxt').textContent=d+' m';drawTri(al,d,h2,H);
  $('obsInfo').innerHTML=`tan(${al}°) ${al===37?'≈ 3/4 = 0.75':'= '+tanA.toFixed(3)}<br>h₂ = d · tan α = ${d} × ${tanA.toFixed(2)} = <b>${h2.toFixed(2)} m</b><br>H = h₁ + h₂ = 1.60 + ${h2.toFixed(2)} = <b class="ok">${H.toFixed(2)} m</b><br><span style="opacity:.7">Con α = 37° y d = 12 m el resultado coincide con el informe: 10.60 m.</span>`;
}

/* ---------- gráficos 2D del panel ---------- */
function cv2(id,w,h){const cv=$(id);const d=2;cv.width=w*d;cv.height=h*d;const g=cv.getContext('2d');g.setTransform(d,0,0,d,0,0);g.clearRect(0,0,w,h);cv.style.aspectRatio=w+' / '+h;g.lineJoin='round';g.lineCap='round';return g}
function rr(g,x,y,w,h,r){g.beginPath();g.roundRect?g.roundRect(x,y,w,h,r):g.rect(x,y,w,h)}
function drawTemps(){
  const tmin=+$('tmin').value,tmax=Math.max(+$('tmax').value,tmin+1),iso=+$('iso').value;
  $('tTxt').textContent=tmin+' °C';$('tMaxTxt').textContent=tmax+' °C';$('isoTxt').textContent='+'+iso+' °C';
  const A=[tmin,tmax],A2=[tmin+iso,tmax+iso],Bc=[12,22];
  const I=[Math.max(A2[0],Bc[0]),Math.min(A2[1],Bc[1])];const has=I[0]<=I[1];
  const W=360,H=215,g=cv2('cvT',W,H);
  const lo=-10,hi=32,L=22,R=W-14,X=t=>L+(t-lo)/(hi-lo)*(R-L);
  g.fillStyle='#e9eef2';g.font='bold 12px Segoe UI, sans-serif';g.fillText('Recta numérica de temperaturas (°C)',12,18);
  // banda de confort
  const gr=g.createLinearGradient(0,28,0,170);gr.addColorStop(0,'rgba(76,200,110,.30)');gr.addColorStop(1,'rgba(76,200,110,.10)');
  g.fillStyle=gr;g.fillRect(X(12),28,X(22)-X(12),142);
  g.strokeStyle='rgba(126,224,138,.8)';g.setLineDash([4,3]);g.lineWidth=1;g.strokeRect(X(12),28,X(22)-X(12),142);g.setLineDash([]);
  g.fillStyle='#7ee08a';g.font='11px Segoe UI, sans-serif';g.fillText('zona de confort B',X(12)+4,40);
  // rejilla
  g.strokeStyle='rgba(255,255,255,.08)';g.fillStyle='#9fb0bb';g.font='10px Segoe UI';
  for(let t=-10;t<=30;t+=5){g.beginPath();g.moveTo(X(t),28);g.lineTo(X(t),176);g.stroke();g.fillText(t,X(t)-(t<0?7:4),190)}
  g.strokeStyle='#8aa0ad';g.lineWidth=1.4;g.beginPath();g.moveTo(L-6,176);g.lineTo(R,176);g.stroke();
  g.fillStyle='#9fb0bb';g.fillText('°C',R-14,205);
  // 0 °C
  g.strokeStyle='rgba(120,180,255,.5)';g.setLineDash([2,3]);g.beginPath();g.moveTo(X(0),28);g.lineTo(X(0),176);g.stroke();g.setLineDash([]);
  const bar=(r,y,c1,c2,txt)=>{const x0=X(r[0]),x1=X(r[1]);const gg=g.createLinearGradient(x0,0,x1,0);gg.addColorStop(0,c1);gg.addColorStop(1,c2);
    g.fillStyle=gg;rr(g,x0,y,Math.max(4,x1-x0),22,7);g.fill();g.strokeStyle='#ffffffaa';g.lineWidth=1;g.stroke();
    g.fillStyle='#fff';g.font='bold 11px Segoe UI';const tw=g.measureText(txt).width;g.fillText(txt,x0+Math.max(5,(x1-x0-tw)/2),y+15);
    [r[0],r[1]].forEach(v=>{g.fillStyle='#fff';g.beginPath();g.arc(X(v),y+11,3,0,7);g.fill()})};
  bar(A,52,'#2f6fd0','#6aa6ff',`A = [${A[0]}, ${A[1]}]`);
  // flecha +iso
  g.strokeStyle='#ffc58a';g.fillStyle='#ffc58a';g.lineWidth=1.6;const ay=88;g.beginPath();g.moveTo(X(A[0]+(A[1]-A[0])/2),78);g.lineTo(X(A2[0]+(A2[1]-A2[0])/2),ay+2);g.stroke();
  g.font='bold 10.5px Segoe UI';g.fillText(`+${iso} °C`,X((A[0]+A2[0])/2+(A[1]-A[0])/2)+6,86);
  bar(A2,96,'#d9622a','#ffa55e',`A' = [${A2[0]}, ${A2[1]}]`);
  if(has)bar(I,128,'#c9a400','#ffe066',`A' ∩ B = [${I[0]}, ${I[1]}]`);else{g.fillStyle='#ff7b7b';g.font='bold 11px Segoe UI';g.fillText('A\' ∩ B = ∅ (sin confort)',X(12),145)}
  const outL=Math.max(0,Bc[0]-A2[0]),outH=Math.max(0,A2[1]-Bc[1]);
  let st,cl;if(!has){st="A' no toca el rango de confort.";cl='bad'}
  else if(A2[0]>=12&&A2[1]<=22){st="A' está completamente dentro de B ✔";cl='ok'}
  else{st=(outL?`Faltan ${outL} °C para llegar a 12 °C. `:'')+(outH?`Sobran ${outH} °C sobre 22 °C: ventilar.`:'');cl='warn'}
  $('tInfo').innerHTML=`<b>1)</b> A′ = [${A[0]} + ${iso}, ${A[1]} + ${iso}] = <b>[${A2[0]}, ${A2[1]}] °C</b><br><b>2)</b> A′ ∩ B = <b>${has?`[${I[0]}, ${I[1]}] °C`:'∅'}</b><br><span class="${cl}">${st}</span>`;
  mats._comfort=has}

function drawQuad(){
  const x=+$('win').value;const f=v=>-v*v+6*v+8;
  const W=360,H=235,g=cv2('cvQ',W,H);
  const L=44,R=W-16,T=34,Bt=H-38;const xmax=6.5,ymax=20;const PX=v=>L+v/xmax*(R-L),PY=v=>Bt-v/ymax*(Bt-T);
  g.fillStyle='#e9eef2';g.font='bold 12px Segoe UI';g.fillText('A(x) = −x² + 6x + 8',12,18);
  g.fillStyle='#9fb0bb';g.font='10px Segoe UI';
  for(let t=0;t<=6;t++){g.strokeStyle='rgba(255,255,255,.07)';g.beginPath();g.moveTo(PX(t),T);g.lineTo(PX(t),Bt);g.stroke();g.fillText(t,PX(t)-3,Bt+13)}
  for(let t=0;t<=20;t+=5){g.strokeStyle='rgba(255,255,255,.07)';g.beginPath();g.moveTo(L,PY(t));g.lineTo(R,PY(t));g.stroke();g.fillText(t,L-17,PY(t)+3)}
  g.strokeStyle='#8aa0ad';g.lineWidth=1.5;g.beginPath();g.moveTo(L,T-6);g.lineTo(L,Bt);g.lineTo(R+4,Bt);g.stroke();
  g.fillStyle='#b8c6cf';g.font='11px Segoe UI';g.fillText('x: ancho de la ventana (m)',L+60,H-8);g.save();g.translate(12,Bt-40);g.rotate(-Math.PI/2);g.fillText('A: área (m²)',0,0);g.restore();
  // área bajo la curva
  const grd=g.createLinearGradient(0,T,0,Bt);grd.addColorStop(0,'rgba(240,138,60,.38)');grd.addColorStop(1,'rgba(240,138,60,.02)');
  g.beginPath();g.moveTo(PX(0),Bt);for(let i=0;i<=120;i++){const v=i/120*xmax;g.lineTo(PX(v),PY(Math.max(0,f(v))))}g.lineTo(PX(xmax),Bt);g.closePath();g.fillStyle=grd;g.fill();
  g.strokeStyle='#ff9a4d';g.lineWidth=2.6;g.beginPath();for(let i=0;i<=120;i++){const v=i/120*xmax,y=f(v);i?g.lineTo(PX(v),PY(y)):g.moveTo(PX(v),PY(y))}g.stroke();
  // puntos de la tabla
  [1,2,3,4,5].forEach(v=>{g.fillStyle='#fff';g.beginPath();g.arc(PX(v),PY(f(v)),2.6,0,7);g.fill();g.fillStyle='#b8c6cf';g.font='9.5px Segoe UI';g.fillText(f(v),PX(v)-6,PY(f(v))-7)});
  // máximo
  g.strokeStyle='rgba(126,224,138,.7)';g.setLineDash([4,3]);g.lineWidth=1;g.beginPath();g.moveTo(PX(3),Bt);g.lineTo(PX(3),PY(17));g.moveTo(L,PY(17));g.lineTo(PX(3),PY(17));g.stroke();g.setLineDash([]);
  g.fillStyle='#7ee08a';g.beginPath();g.arc(PX(3),PY(17),5.5,0,7);g.fill();g.strokeStyle='#fff';g.lineWidth=1.5;g.stroke();
  g.font='bold 11px Segoe UI';g.fillText('Vértice (3 ; 17) = máximo',PX(3)+9,PY(17)-9);
  // punto actual
  const a=f(x);g.strokeStyle='#ffd23f';g.setLineDash([3,3]);g.lineWidth=1.3;g.beginPath();g.moveTo(PX(x),Bt);g.lineTo(PX(x),PY(a));g.lineTo(L,PY(a));g.stroke();g.setLineDash([]);
  g.fillStyle='#ffd23f';g.beginPath();g.arc(PX(x),PY(a),6,0,7);g.fill();g.strokeStyle='#000a';g.lineWidth=1.5;g.stroke();
  const tx=`x = ${x.toFixed(1)} m → A = ${a.toFixed(2)} m²`;g.font='bold 11px Segoe UI';const tw=g.measureText(tx).width;const bx=clamp(PX(x)-tw/2,L+4,R-tw-8),by=Bt-44;
  g.fillStyle='rgba(0,0,0,.65)';rr(g,bx-5,by-13,tw+10,19,6);g.fill();g.fillStyle='#ffd23f';g.fillText(tx,bx,by);
  $('qInfo').innerHTML=`Vértice: h = −b / 2a = −6 / (−2) = <b>3 m</b><br>k = A(3) = −9 + 18 + 8 = <b>17 m²</b><br>${Math.abs(x-3)<.05?'<span class="ok">✔ ¡Máxima captación de calor!</span>':`<span class="warn">Con x = ${x.toFixed(1)} m faltan ${(17-a).toFixed(2)} m² para el máximo.</span>`}`;
  $('wTxt').textContent=x.toFixed(1)+' m'}

function drawTri(al,d,h2,Ht){
  const W=360,H=230,g=cv2('cvO',W,H);const gy=H-34,eye=1.6;
  const sc=Math.min((W-100)/(d+2.5),(gy-40)/(Ht*1.08));const xT=38,xO=xT+d*sc;
  g.fillStyle='#e9eef2';g.font='bold 12px Segoe UI';g.fillText('Esquema del ángulo de elevación',12,18);
  g.fillStyle='rgba(120,90,50,.55)';g.fillRect(0,gy,W,H-gy);g.strokeStyle='#a8895a';g.lineWidth=1.5;g.beginPath();g.moveTo(0,gy);g.lineTo(W,gy);g.stroke();
  // edificio
  g.fillStyle='rgba(190,130,80,.35)';g.strokeStyle='#d99a63';g.lineWidth=1.2;rr(g,xT-26,gy-Math.min(Ht*sc,(gy-30)),26,Math.min(Ht*sc,(gy-30)),3);g.fill();g.stroke();
  const eyeY=gy-eye*sc,topY=gy-Ht*sc;
  // observador
  g.strokeStyle='#cfe3ff';g.fillStyle='#cfe3ff';g.lineWidth=2;g.beginPath();g.arc(xO,eyeY,4.5,0,7);g.fill();g.beginPath();g.moveTo(xO,eyeY+5);g.lineTo(xO,gy-eye*sc*.42);g.moveTo(xO,gy-eye*sc*.42);g.lineTo(xO-4,gy);g.moveTo(xO,gy-eye*sc*.42);g.lineTo(xO+4,gy);g.stroke();
  // líneas
  g.lineWidth=1.4;g.setLineDash([5,4]);g.strokeStyle='#4fd1ff';g.beginPath();g.moveTo(xO,eyeY);g.lineTo(xT,eyeY);g.stroke();g.setLineDash([]);
  g.strokeStyle='#ffd23f';g.lineWidth=2.2;g.beginPath();g.moveTo(xO,eyeY);g.lineTo(xT,topY);g.stroke();
  g.strokeStyle='#7ee08a';g.lineWidth=2.2;g.beginPath();g.moveTo(xT,eyeY);g.lineTo(xT,topY);g.stroke();
  g.strokeStyle='#ffffff88';g.lineWidth=1;g.beginPath();g.moveTo(xT,gy);g.lineTo(xT,eyeY);g.stroke();
  g.fillStyle='#ff5a4f';g.beginPath();g.arc(xT,topY,5.5,0,7);g.fill();g.strokeStyle='#fff';g.lineWidth=1.3;g.stroke();
  // arco
  const ang=THREE.MathUtils.degToRad(al);const rad=Math.min(46,d*sc*.4);g.strokeStyle='#ffd23f';g.lineWidth=1.8;g.beginPath();g.arc(xO,eyeY,rad,Math.PI,Math.PI+ang,false);g.stroke();
  // rótulos
  const tag=(t,x,y,c)=>{g.font='bold 11px Segoe UI';const w=g.measureText(t).width;g.fillStyle='rgba(0,0,0,.65)';rr(g,x-w/2-5,y-12,w+10,18,6);g.fill();g.fillStyle=c;g.fillText(t,x-w/2,y+1)};
  tag(`α = ${al}°`,xO-rad-24,eyeY-8,'#ffd23f');
  tag(`d = ${d} m`,(xO+xT)/2,eyeY+16,'#4fd1ff');
  tag(`h₂ = ${h2.toFixed(2)} m`,xT+50,(eyeY+topY)/2,'#7ee08a');
  tag(`H = ${Ht.toFixed(2)} m`,xT+50,topY-12,'#ff8a80');
  tag(`${eye.toFixed(2)} m`,xO+26,gy-eye*sc/2,'#ffffff');
  g.fillStyle='#b8c6cf';g.font='10px Segoe UI';g.fillText('borde superior del panel',xT+10,Math.max(32,topY+18))}

/* ---------- estado y tiempo ---------- */
const state={hour:15,play:false,rain:false,frost:false,fog:false,orbit:false,roof:false,wire:false,shadow:true,labels:true,obs:false,sunRays:false,sunTrack:false};
const sunDir=new THREE.Vector3();let lastEnvBucket=-1,nightF=0;
function sunVec(h){const a=Math.PI*(h-6)/12;sunDir.set(Math.cos(a)*.95,Math.sin(a)*.92,Math.sin(a)*.34).normalize();return sunDir}
function updateTime(){
  const h=state.hour;sunVec(h);
  skyBeauty(sunDir.y);su.sunPosition.value.copy(sunDir);skyEnv.material.uniforms.sunPosition.value.copy(sunDir);
  const y=sunDir.y;nightF=smooth(.08,-.14,y);
  const dayF=smooth(-.02,.35,y);
  sunLight.position.copy(sunDir).multiplyScalar(110);sunLight.target.position.set(0,0,0);
  const qLight=gfx?.current;const lightBoost=qLight?.lightBoost??1;
  sunLight.intensity=dayF*4.7*(state.fog?.7:1)*(state.rain?.58:1)*lightBoost;
  sunLight.color.setRGB(1,lerp(.72,.98,smooth(0,.4,y)),lerp(.48,.92,smooth(0,.4,y)));
  moonLight.position.set(-sunDir.x*100,Math.max(30,-sunDir.y*100),-sunDir.z*100);moonLight.intensity=nightF*.22;
  hemi.intensity=lerp(.12,1.18,dayF)*(state.rain?.82:1)*lerp(1,lightBoost,.65);
  hemi.color.setHex(nightF>.5?0x586c9a:0xd6edff);
  renderer.toneMappingExposure=lerp(1.0,.92,dayF)*(qLight?.exposureBoost??1);
  stars.material.opacity=nightF*.9;updateSunSprites();
  const fogDay=new THREE.Color(state.rain?0x96a4b0:0xc7dae4),fogNight=new THREE.Color(0x070a12),fogDusk=new THREE.Color(0xe0aa80);
  const fc=fogNight.clone().lerp(fogDusk,smooth(-.15,.02,y)*(1-dayF)).lerp(fogDay,dayF);
  scene.fog.color.copy(fc);scene.fog.density=(state.fog?.0065:.00072)*(state.rain?1.35:1);
  _cloudMat.color.copy(new THREE.Color(1,1,1).lerp(new THREE.Color(.08,.1,.16),nightF)).lerp(new THREE.Color(1,.75,.6),smooth(.3,0,y)*(1-nightF)*.6);
  const gl=nightF*(1);
  mats.glass.forEach(m=>m.emissiveIntensity=gl*.8);(mats.interiorGlow||[]).forEach(m=>m.emissiveIntensity=gl*2.2);
  const li=(mats._comfort===false?.6:1)*gl;
  lights.body.intensity=li*14+dayF*3.5;lights.wing.intensity=li*9+dayF*2.5;lights.up.intensity=li*9;
  const hh=Math.floor(h)%24,mm=Math.floor((h%1)*60);$('hTxt').textContent=String(hh).padStart(2,'0')+':'+String(mm).padStart(2,'0');
  const el=THREE.MathUtils.radToDeg(Math.asin(y));$('sunInfo').innerHTML=`Elevación solar: <b>${el.toFixed(1)}°</b> ${y>0?'☀':'🌙'}<br>La fachada con ventanas mira al norte (Hemisferio Sur).`;
  updatePanel();updateSunRays();
  const envBucket=(h<5||h>=20)?0:(h<8?1:(h<17?2:3));
  if(envBucket!==lastEnvBucket){lastEnvBucket=envBucket;if(envRT)envRT.dispose();envRT=pm.fromScene(envScene);scene.environment=envRT.texture}
}
function updatePanel(){
  const a=+$('pan').value;
  // gira desde el borde inferior; nunca baja por debajo de la pendiente de 14° de la cubierta
  solarPivots.forEach(p=>p.rotation.x=THREE.MathUtils.degToRad(a));
  const n=new THREE.Vector3(0,Math.cos(THREE.MathUtils.degToRad(a)),Math.sin(THREE.MathUtils.degToRad(a)));
  const irr=Math.max(0,n.dot(sunDir))*100;
  $('pTxt').textContent=a+'°';
  $('panInfo').innerHTML=`Dos paneles colocados sobre la cubierta alta.<br>Inclinación mínima del modelo: <b>${SOLAR_ROOF_ANGLE}°</b> (paralela al techo).<br>Incidencia solar visual ahora: <b class="${irr>70?'ok':irr>30?'warn':'bad'}">${irr.toFixed(0)} %</b><br><span style="opacity:.75">El ángulo de <b>37°</b> del Problema 2 corresponde al ángulo de elevación del observador hacia el borde superior del panel.</span>`;
  if(state.sunRays)updateSunRays();
}

/* ---------- menú lateral plegable ---------- */
const panel=$('panel'),menuOpen=$('tog'),menuClose=$('panelClose');
function setPanelCollapsed(v){panel.classList.toggle('panelCollapsed',v);menuOpen.style.display=v?'block':'none'}
menuOpen.onclick=()=>setPanelCollapsed(false);menuClose.onclick=()=>setPanelCollapsed(true);

/* ---------- eventos UI ---------- */
$('hour').oninput=e=>{state.hour=+e.target.value;updateTime()};
['tmin','tmax','iso'].forEach(id=>$(id).oninput=()=>{drawTemps();updateTime()});
let rebuildT=0;
$('win').oninput=()=>{drawQuad();cancelAnimationFrame(rebuildT);rebuildT=requestAnimationFrame(()=>buildMainFront(+$('win').value))};
$('bOpt').onclick=()=>{$('win').value=3;$('win').oninput()};
['alpha','dist'].forEach(id=>$(id).oninput=updateObs);
$('pan').oninput=updatePanel;$('bPanOpt').onclick=()=>{$('pan').value=14;updatePanel()};
$('rayPower').oninput=updateSunRays;$('rayTarget').onchange=updateSunRays;
$('rayTarget').value='panel';$('rayPower').value=85;$('rayTxt').textContent='85%';$('bSunRays').classList.remove('on');$('bSunRays').textContent='☀ Mostrar rayos';
$('bSunRays').onclick=()=>{state.sunRays=!state.sunRays;$('bSunRays').classList.toggle('on',state.sunRays);$('bSunRays').textContent=state.sunRays?'☀ Ocultar rayos':'☀ Mostrar rayos';updateSunRays()};
$('bSunTrack').onclick=()=>{state.sunTrack=!state.sunTrack;$('bSunTrack').classList.toggle('on',state.sunTrack);updateSunRays()};
const tgl=(id,key,fn)=>{$(id).onclick=()=>{state[key]=!state[key];$(id).classList.toggle('on',state[key]);fn&&fn()}};
tgl('bPlay','play',()=>{$('bPlay').textContent=state.play?'⏸ Pausar':'▶ Animar día'});
tgl('bRain','rain',()=>{rain.visible=state.rain;updateTime()});
tgl('bFrost','frost',()=>{const f=state.frost;
  if(f&&state.rain){state.rain=false;rain.visible=false;$('bRain').classList.remove('on')}
  snowGroup.visible=f;roofSnowGroup.visible=f;snowGround.visible=f;snowFar.pts.visible=f;snowNear.pts.visible=f;snowFront.pts.visible=f;
  groundMat.color.set(f?0xe7eef6:0xf5e6bc);houseGround.material.color.set(f?0xecf3fa:0xe5bd79);mats.tile.color.set(f?0xf3f7fb:0xffb07a);mats.ridge.color.set(f?0xe7edf5:0xb34725);mats.wood.color.set(f?0xc4906b:0xb87042);mats.woodD.color.set(f?0x9f6747:0x8f4f2d);
  snowRoofMat.opacity=f?.96:0;snowRoofEdgeMat.opacity=f?.98:0;snowGround.material.opacity=f?.32:.0;$('tmin').value=f?-6:-2;$('tmax').value=f?4:8;drawTemps();updateTime()});
tgl('bFog','fog',updateTime);
tgl('bOrbit','orbit',()=>{controls.autoRotate=state.orbit;controls.autoRotateSpeed=.8});
tgl('bRoof','roof',()=>{ceilGroup.visible=!state.roof;mats.tile.opacity=state.roof?.12:1;mats.ridge.transparent=true;mats.ridge.opacity=state.roof?.12:1;mats.tile.depthWrite=!state.roof;$('bRoof').textContent=state.roof?'🏠 Poner techo':'🏚 Ver sin techo';
  mats.tile.needsUpdate=mats.ridge.needsUpdate=true;if(state.roof)goView('aerial')});
tgl('bWire','wire',()=>{scene.traverse(o=>{if(o.isMesh&&o.material&&!o.isSprite&&o!==sky){const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>{if(m.wireframe!==undefined&&!(o.parent===scene&&o.geometry.type==='PlaneGeometry'))m.wireframe=state.wire})}})});
$('bShadow').onclick=()=>{if(gfx&&!gfx.current.shadows)return;state.shadow=!state.shadow;$('bShadow').classList.toggle('on',state.shadow);sunLight.castShadow=state.shadow;renderer.shadowMap.needsUpdate=true;scene.traverse(o=>{if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.needsUpdate=true)})};
tgl('bLabels','labels',()=>{labelsGroup.visible=state.labels;obs.children.forEach(c=>{if(c.isSprite)c.visible=state.labels})});
$('bObs').onclick=()=>{state.obs=!state.obs;obs.visible=state.obs;$('bObs').classList.toggle('on',state.obs);if(state.obs){updateObs();goView('side')}};
$('bShot').onclick=()=>{renderer.render(scene,camera);const a=document.createElement('a');a.href=renderer.domElement.toDataURL('image/png');a.download='vivienda_segura_sostenible_julcan.png';a.click()};
$('bFull').onclick=()=>{document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()};

const views={front:[[14,6.5,26],[0,2.8,0]],side:[[34,6,6],[2,3.5,4]],aerial:[[18,26,24],[0,2,0]],back:[[-14,7,-24],[0,2.8,0]],close:[[1,2.1,13],[-2,1.6,3]]};
let camTween=null;
function goView(k){if(fp)exitFP();const v=views[k];camTween={p:new THREE.Vector3(...v[0]),t:new THREE.Vector3(...v[1]),k:0}}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>goView(b.dataset.view));

addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});


function makeScreens(){
  const W=1280,H=720,slides=[];
  const mk=fn=>{const c=document.createElement('canvas');c.width=W;c.height=H;fn(c.getContext('2d'));slides.push(c)};
  const font=(g,s,w='700')=>g.font=`${w} ${s}px "Segoe UI",system-ui,sans-serif`;
  const T_=(g,t,x,y,s,col='#fff',al='left',w='700')=>{font(g,s,w);g.fillStyle=col;g.textAlign=al;g.fillText(t,x,y)};
  const sky=(g,a,b)=>{const gr=g.createLinearGradient(0,0,0,H);gr.addColorStop(0,a);gr.addColorStop(1,b);g.fillStyle=gr;g.fillRect(0,0,W,H)};
  const hills=g=>{g.fillStyle='#51628a';g.beginPath();g.moveTo(0,520);for(let x=0;x<=W;x+=40)g.lineTo(x,470+Math.sin(x*.008)*50+Math.sin(x*.021)*22);g.lineTo(W,H);g.lineTo(0,H);g.fill();
    g.fillStyle='#3a6a46';g.beginPath();g.moveTo(0,600);for(let x=0;x<=W;x+=40)g.lineTo(x,560+Math.sin(x*.01+2)*30);g.lineTo(W,H);g.lineTo(0,H);g.fill()};
  const sunD=(g,x,y,r)=>{const gr=g.createRadialGradient(x,y,0,x,y,r*3);gr.addColorStop(0,'rgba(255,240,180,1)');gr.addColorStop(.3,'rgba(255,200,100,.5)');gr.addColorStop(1,'rgba(255,200,100,0)');g.fillStyle=gr;g.beginPath();g.arc(x,y,r*3,0,7);g.fill();g.fillStyle='#fff6d0';g.beginPath();g.arc(x,y,r,0,7);g.fill()};
  const rrect=(g,x,y,w,h,r)=>{g.beginPath();if(g.roundRect)g.roundRect(x,y,w,h,r);else g.rect(x,y,w,h)};
  const house=(g,x,y,s)=>{g.save();g.translate(x,y);g.scale(s,s);g.fillStyle='#d9a066';g.fillRect(-80,-50,160,50);g.fillRect(-45,-95,90,45);g.fillStyle='#b8452a';g.beginPath();g.moveTo(-95,-50);g.lineTo(-60,-72);g.lineTo(95,-50);g.lineTo(80,-50);g.fill();g.beginPath();g.moveTo(-55,-95);g.lineTo(0,-120);g.lineTo(55,-95);g.fill();
    g.fillStyle='#2a1a10';g.fillRect(-14,-38,28,38);g.fillStyle='#bfe3ff';g.fillRect(30,-38,34,22);g.fillRect(-64,-38,34,22);g.fillStyle='#1c4fa0';g.fillRect(-22,-112,18,8);g.fillRect(4,-112,18,8);g.restore()};
  const card=(g,x,y,w,h,col='rgba(0,0,0,.35)')=>{g.fillStyle=col;rrect(g,x,y,w,h,22);g.fill()};
  mk(g=>{sky(g,'#2a3f7a','#f5b57a');sunD(g,1000,330,48);hills(g);house(g,300,600,2.2);
    T_(g,'VIVIENDA SEGURA Y SOSTENIBLE',60,120,62,'#fff');T_(g,'Julcán · La Libertad · Perú',64,175,34,'#ffe2b4','left','500');
    T_(g,'Adobe mejorado · energía solar · diseño matemático',64,225,28,'#d6e6ff','left','400');
    card(g,60,260,720,150,'rgba(0,0,0,.45)');
    T_(g,'Creador del proyecto',92,308,26,'#ffd29a','left','500');T_(g,'ESTEYBIN LÓPEZ',92,375,66,'#ffffff');
    T_(g,'Los Picapiedras · 4.° A · Matemática 2026',64,690,28,'#ffffff','left','500')});
  mk(g=>{sky(g,'#16202c','#0e151d');T_(g,'Planta de la vivienda',60,90,54,'#ffd29a');
    const S=64,X0=640,Z0=370,X=x=>X0+x*S,Z=z=>Z0+z*S;g.lineWidth=4;
    const R=(x0,z0,x1,z1,fill,stroke,lab)=>{g.fillStyle=fill;g.fillRect(X(x0),Z(z0),(x1-x0)*S,(z1-z0)*S);g.strokeStyle=stroke;g.strokeRect(X(x0),Z(z0),(x1-x0)*S,(z1-z0)*S);if(lab)T_(g,lab,X((x0+x1)/2),Z((z0+z1)/2)+8,22,'#fff','center','600')};
    R(-6,-2.5,6,2.5,'#7a5a3a','#f0d0a0');
    R(-6,-2.5,-1.4,2.5,'#8a6a46','#f0d0a0','COCINA · COMEDOR');R(1.4,-2.5,6,2.5,'#9a6a40','#f0d0a0','SALA');R(-10,-2.5,-6,2.5,'#6a4a30','#f0d0a0','DORMITORIO');
    g.setLineDash([10,8]);g.strokeStyle='#7ee08a';g.strokeRect(X(-4),Z(-2.2),6*S,3.8*S);g.setLineDash([]);T_(g,'2.º piso: cuarto del estudiante + balcón',X(-1),Z(-3.2),24,'#7ee08a','center','600');
    g.fillStyle='#d8b070';g.fillRect(X(-3.6),Z(3),1.2*S,3.9*S);g.fillRect(X(-4.75),Z(6.9),2.4*S,3.9*S);T_(g,'escalera exterior en U',X(-3.5),Z(11.6),20,'#ffd29a','center','700');
    T_(g,'N ↓ (fachada con ventanas hacia el norte)',60,690,26,'#9fc0d8','left','400')});
  mk(g=>{sky(g,'#1d2a44','#0f1626');T_(g,'Problema 1 · Intervalos térmicos',60,90,50,'#ffd29a');
    const L=90,Rr=1190,X=t=>L+(t+4)/30*(Rr-L);g.strokeStyle='#8aa0ad';g.lineWidth=3;g.beginPath();g.moveTo(L,560);g.lineTo(Rr,560);g.stroke();
    for(let t=-4;t<=26;t+=2){g.strokeStyle='#445568';g.lineWidth=1;g.beginPath();g.moveTo(X(t),170);g.lineTo(X(t),560);g.stroke();T_(g,String(t),X(t),592,20,'#b8c6cf','center','500')}
    T_(g,'°C',Rr-10,625,24,'#9fb0bb','right');
    const bar=(r,y,c1,c2,t)=>{const gr=g.createLinearGradient(X(r[0]),0,X(r[1]),0);gr.addColorStop(0,c1);gr.addColorStop(1,c2);g.fillStyle=gr;rrect(g,X(r[0]),y,X(r[1])-X(r[0]),56,16);g.fill();T_(g,t,(X(r[0])+X(r[1]))/2,y+37,26,'#fff','center')};
    bar([-2,8],200,'#2f6fd0','#6aa6ff','A = [−2 ; 8] °C  (exterior)');bar([13,23],300,'#d9622a','#ffa55e',"A′ = [13 ; 23] °C  (+15 por el adobe)");
    bar([12,22],400,'#2a8a55','#7ee08a','B = [12 ; 22] °C  (confort)');bar([13,22],480,'#c9a400','#ffe066','A′ ∩ B = [13 ; 22] °C');
    T_(g,'El adobe mejorado lleva el interior al rango de confort.',60,680,30,'#ffffff','left','500')});
  mk(g=>{sky(g,'#7fb4e0','#f4e2b8');T_(g,'Problema 2 · Ángulo de elevación',60,90,50,'#1b2a44');
    g.fillStyle='#8a6a3a';g.fillRect(0,620,W,100);
    const px=300,py=620,topY=py-9*40,ox=300+12*40,oy=py-1.6*40;
    g.fillStyle='#c98a4a';g.fillRect(px-26,topY,52,py-topY);g.fillStyle='#8a2f23';g.beginPath();g.moveTo(px-34,topY);g.lineTo(px,topY-30);g.lineTo(px+34,topY);g.fill();
    g.strokeStyle='#1b2a44';g.lineWidth=4;g.beginPath();g.moveTo(ox,oy);g.lineTo(px,topY);g.stroke();
    g.setLineDash([10,8]);g.beginPath();g.moveTo(ox,oy);g.lineTo(px,oy);g.moveTo(px,oy);g.lineTo(px,topY);g.stroke();g.setLineDash([]);
    g.fillStyle='#2f5c9a';g.beginPath();g.arc(ox,oy-30,16,0,7);g.fill();g.fillRect(ox-14,oy-20,28,60);
    g.strokeStyle='#d98a00';g.lineWidth=5;g.beginPath();g.arc(ox,oy,90,Math.PI,Math.PI+Math.atan2(9*40,12*40));g.stroke();
    T_(g,'α = 37°',ox-170,oy-26,36,'#b36a00');T_(g,'d = 12 m',(ox+px)/2,oy+44,34,'#1b2a44','center');T_(g,'h₂ = 9 m',px+50,(topY+oy)/2,34,'#0a6a3a');
    card(g,700,140,520,260,'rgba(255,255,255,.65)');T_(g,'tan 37° ≈ 3/4',740,210,40,'#1b2a44');T_(g,'h₂ = d · tan α = 12 × 0,75 = 9 m',740,270,30,'#1b2a44','left','600');
    T_(g,'H = 1,60 + 9 = 10,60 m',740,340,38,'#0a6a3a')});
  mk(g=>{sky(g,'#1b2438','#0d121c');T_(g,'Problema 3 · Ventana óptima',60,90,50,'#ffd29a');T_(g,'A(x) = −x² + 6x + 8',60,150,38,'#fff','left','500');
    const L=130,Rr=760,Tp=200,Bt=620,xm=6.5,ym=20,PX=v=>L+v/xm*(Rr-L),PY=v=>Bt-v/ym*(Bt-Tp);g.strokeStyle='#445568';g.lineWidth=1;
    for(let t=0;t<=6;t++){g.beginPath();g.moveTo(PX(t),Tp);g.lineTo(PX(t),Bt);g.stroke();T_(g,String(t),PX(t),Bt+30,20,'#b8c6cf','center','500')}
    for(let t=0;t<=20;t+=5){g.beginPath();g.moveTo(L,PY(t));g.lineTo(Rr,PY(t));g.stroke();T_(g,String(t),L-12,PY(t)+7,20,'#b8c6cf','right','500')}
    g.strokeStyle='#ff9a4d';g.lineWidth=6;g.beginPath();for(let i=0;i<=120;i++){const v=i/120*xm,y=-v*v+6*v+8;i?g.lineTo(PX(v),PY(y)):g.moveTo(PX(v),PY(y))}g.stroke();
    g.setLineDash([10,8]);g.strokeStyle='#7ee08a';g.lineWidth=3;g.beginPath();g.moveTo(PX(3),Bt);g.lineTo(PX(3),PY(17));g.moveTo(L,PY(17));g.lineTo(PX(3),PY(17));g.stroke();g.setLineDash([]);
    g.fillStyle='#7ee08a';g.beginPath();g.arc(PX(3),PY(17),12,0,7);g.fill();T_(g,'Vértice (3 ; 17)',PX(3)+22,PY(17)-14,28,'#7ee08a');
    card(g,820,200,400,330);T_(g,'h = −b / 2a = 3 m',850,265,32,'#fff','left','600');T_(g,'k = A(3) = 17 m²',850,325,32,'#fff','left','600');T_(g,'Ancho óptimo:',850,410,30,'#ffd29a','left','500');T_(g,'x = 3 m',850,480,64,'#7ee08a')});
  mk(g=>{sky(g,'#5aa0e0','#f9e0a0');sunD(g,1060,170,44);T_(g,'Panel solar térmico',60,100,56,'#1b2a44');
    g.fillStyle='#8a2f23';g.beginPath();g.moveTo(80,560);g.lineTo(760,430);g.lineTo(760,720);g.lineTo(80,720);g.fill();
    g.save();g.translate(250,520);g.rotate(-14*Math.PI/180);g.fillStyle='#1c4fa0';g.fillRect(0,-30,330,30);g.strokeStyle='#9ec3ff';g.lineWidth=3;for(let i=1;i<6;i++){g.beginPath();g.moveTo(i*55,-30);g.lineTo(i*55,0);g.stroke()}g.restore();
    g.strokeStyle='rgba(255,220,120,.8)';g.lineWidth=5;for(let i=0;i<6;i++){g.beginPath();g.moveTo(1000-i*20,230+i*10);g.lineTo(340+i*45,470-i*8);g.stroke()}
    card(g,720,330,500,250,'rgba(255,255,255,.7)');T_(g,'Inclinación mínima: 14°',750,400,38,'#1b2a44');T_(g,'Paralela a la cubierta alta',750,455,30,'#1b2a44','left','500');T_(g,'Calienta agua con el sol de Julcán',750,520,28,'#8a4a00','left','600')});
  mk(g=>{sky(g,'#3a6fb0','#ffd9a0');sunD(g,200,200,40);hills(g);
    const llama=(x,y,s,c)=>{g.save();g.translate(x,y);g.scale(s,s);g.fillStyle=c;rrect(g,-50,-60,100,50,22);g.fill();g.fillRect(28,-130,18,80);rrect(g,26,-150,50,28,12);g.fill();g.fillRect(-42,-15,10,40);g.fillRect(-18,-15,10,40);g.fillRect(14,-15,10,40);g.fillRect(34,-15,10,40);g.beginPath();g.moveTo(34,-150);g.lineTo(38,-175);g.lineTo(46,-150);g.fill();g.restore()};
    llama(420,640,2,'#d9c9a8');llama(820,650,1.6,'#8a6a4a');house(g,1100,640,1.6);
    T_(g,'Vida en Julcán',60,100,60,'#fff');T_(g,'Llamas, ovejas, gallinas y mucha vida en la chacra',64,150,30,'#fff3d6','left','500')});
  mk(g=>{sky(g,'#241a3a','#0f0b1a');T_(g,'Anuncios',60,100,60,'#ffd29a');
    const items=['Hoy · Matemática 4.° A — Los Picapiedras','Panel solar: inclinación mínima 14°','Ventana óptima: x = 3 m  (A = 17 m²)','Adobe mejorado: +15 °C de confort','Altura medida con α = 37° y d = 12 m: H = 10,60 m','Sube por la escalera exterior al cuarto del estudiante'];
    items.forEach((t,i)=>{card(g,60,150+i*88,1160,72,'rgba(255,255,255,.1)');T_(g,t,92,198+i*88,32,'#fff','left','500')});
    T_(g,'Proyecto de ESTEYBIN LÓPEZ',60,700,28,'#ffd29a','left','600')});
  const cv=document.createElement('canvas');cv.width=W;cv.height=H;const g=cv.getContext('2d');
  const tex=new THREE.CanvasTexture(cv);tex.colorSpace=THREE.SRGBColorSpace;tex.anisotropy=8;
  window.tvMat=new THREE.MeshBasicMaterial({map:tex,toneMapped:false});
  const ticker='  ★  ESTEYBIN LÓPEZ presenta: Vivienda segura y sostenible en Julcán  ★  Adobe mejorado +15 °C  ★  Panel solar térmico a 14°  ★  Ventana óptima x = 3 m  ★  Los Picapiedras · 4.° A · Matemática 2026  ';
  const TV={idx:0,t:0,fade:1,prev:0,manual:-99};window.TV=TV;
  TV.next=()=>{TV.prev=TV.idx;TV.idx=(TV.idx+1)%slides.length;TV.fade=0;TV.t=0;TV.manual=performance.now()/1000};
  let acc=0;
  TV.update=(dt,t)=>{
    TV.t+=dt;if(TV.fade<1)TV.fade=Math.min(1,TV.fade+dt/.7);
    if(TV.t>9&&performance.now()/1000-TV.manual>14){TV.next();TV.manual=-99}
    acc+=dt;if(acc<.07)return;acc=0;
    g.globalAlpha=1;g.drawImage(slides[TV.fade<1?TV.prev:TV.idx],0,0);
    if(TV.fade<1){g.globalAlpha=TV.fade;g.drawImage(slides[TV.idx],0,0);g.globalAlpha=1}
    g.fillStyle='rgba(0,0,0,.62)';g.fillRect(0,660,W,60);font(g,28,'600');g.textAlign='left';g.fillStyle='#ffe2b4';
    const tw=g.measureText(ticker).width||1,off=(t*90)%tw;g.fillText(ticker,-off,700);g.fillText(ticker,-off+tw,700);
    g.fillStyle='rgba(0,0,0,.55)';rrect(g,W-250,18,232,46,14);g.fill();
    const d=new Date();T_(g,`CH ${String(TV.idx+1).padStart(2,'0')} · ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`,W-134,50,26,'#fff','center','600');
    g.fillStyle='#ffffff55';g.fillRect(0,656,W*(Math.min(1,TV.t/9)),4);
    tex.needsUpdate=true;
  };
  TV.update(0,0);
  const LW=640,LH=400,lc=document.createElement('canvas');lc.width=LW;lc.height=LH;const lg=lc.getContext('2d');
  const ltex=new THREE.CanvasTexture(lc);ltex.colorSpace=THREE.SRGBColorSpace;ltex.anisotropy=8;
  window.laptopMat=new THREE.MeshBasicMaterial({map:ltex,toneMapped:false});
  const ann=['Hoy · Matemática 4.° A · Los Picapiedras','Panel solar térmico: inclinación mínima 14°','Ventana óptima: x = 3 m → A = 17 m²','Adobe mejorado: +15 °C de confort','H = 10,60 m (α = 37°, d = 12 m)','Recordatorio: terminar la tarea de Matemática','Bienvenido a Julcán, La Libertad · Perú'];
  const LT={t:0,acc:0};window.LT=LT;
  LT.update=(dt,t)=>{
    LT.acc+=dt;if(LT.acc<.2)return;LT.acc=0;
    const gr=lg.createLinearGradient(0,0,LW,LH);gr.addColorStop(0,'#10294f');gr.addColorStop(.55,'#1b4f7a');gr.addColorStop(1,'#e08a4a');lg.fillStyle=gr;lg.fillRect(0,0,LW,LH);
    lg.fillStyle='#ffd88a';lg.beginPath();lg.arc(520,300,34,0,7);lg.fill();lg.fillStyle='#16304f';lg.beginPath();lg.moveTo(0,400);lg.lineTo(0,320);for(let x=0;x<=LW;x+=40)lg.lineTo(x,310-Math.abs(Math.sin(x*.015))*60);lg.lineTo(LW,400);lg.fill();
    lg.fillStyle='rgba(0,0,0,.45)';lg.fillRect(0,0,LW,28);const d=new Date();
    const f2=(s,w='600')=>lg.font=`${w} ${s}px "Segoe UI",system-ui,sans-serif`;
    f2(15);lg.fillStyle='#fff';lg.textAlign='left';lg.fillText('Vivienda Julcán',12,19);lg.textAlign='right';lg.fillText(`Batería 92%   ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`,LW-12,19);
    lg.textAlign='center';lg.shadowColor='#7fd0ff';lg.shadowBlur=18;f2(54,'800');lg.fillStyle='#fff';lg.fillText('ESTEYBIN LÓPEZ',LW/2,130);lg.shadowBlur=0;
    f2(22,'500');lg.fillStyle='#cfe6ff';lg.fillText('Creador del proyecto',LW/2,76);f2(21,'500');lg.fillStyle='#ffe2b4';lg.fillText('Vivienda segura y sostenible · Julcán, Perú',LW/2,166);
    f2(18,'500');lg.fillStyle='#fff';lg.fillText('Los Picapiedras · 4.° A · Matemática 2026',LW/2,194);
    const k=Math.floor(t/3.2)%ann.length,ph=(t/3.2)%1,slide=Math.min(1,ph*6),alpha=ph>.88?(1-ph)/.12:1;
    lg.globalAlpha=alpha;lg.fillStyle='rgba(10,20,40,.78)';rrect(lg,60+(1-slide)*600,236,LW-120,64,16);lg.fill();lg.fillStyle='#fff';f2(23,'600');lg.fillText(ann[k],LW/2+(1-slide)*600,276);lg.globalAlpha=1;
    for(let i=0;i<ann.length;i++){lg.fillStyle=i===k?'#ffd88a':'#ffffff55';lg.beginPath();lg.arc(LW/2-ann.length*7+i*14,320,i===k?5:3.5,0,7);lg.fill()}
    lg.fillStyle='rgba(0,0,0,.5)';lg.fillRect(0,372,LW,28);f2(16,'500');lg.fillStyle='#ffe2b4';lg.textAlign='left';const tt='Proyecto: Vivienda segura y sostenible   ·   Creador: ESTEYBIN LÓPEZ   ·   ';const off=(t*60)%(lg.measureText(tt).width||1);lg.fillText(tt+tt+tt,-off,391);
    ltex.needsUpdate=true;
  };
  LT.update(1,0);
}

function plankTexture(){
  const S=1024,cv=document.createElement('canvas');cv.width=S;cv.height=S;const g=cv.getContext('2d');
  const rows=8,rh=S/rows;
  for(let r=0;r<rows;r++){
    const cuts=[0,.35+rnd()*.3,1].map(v=>v*S);
    for(let c=0;c<2;c++){
      const x0=cuts[c],x1=cuts[c+1];const h=18+rnd()*14,l=26+rnd()*14;
      g.fillStyle=`hsl(${h},${48+rnd()*14}%,${l}%)`;g.fillRect(x0,r*rh,x1-x0,rh);
      for(let k=0;k<26;k++){g.strokeStyle=`rgba(${20+rnd()*30|0},${8+rnd()*14|0},4,${.05+rnd()*.12})`;g.lineWidth=.6+rnd()*1.6;g.beginPath();const y=r*rh+rnd()*rh;g.moveTo(x0,y);g.bezierCurveTo(x0+(x1-x0)*.3,y+(rnd()-.5)*6,x0+(x1-x0)*.7,y+(rnd()-.5)*6,x1,y+(rnd()-.5)*3);g.stroke()}
      if(rnd()<.35){const kx=x0+(x1-x0)*(.2+rnd()*.6),ky=r*rh+rh*(.3+rnd()*.4);const gr=g.createRadialGradient(kx,ky,1,kx,ky,14);gr.addColorStop(0,'rgba(30,12,4,.7)');gr.addColorStop(1,'rgba(30,12,4,0)');g.fillStyle=gr;g.beginPath();g.ellipse(kx,ky,16,9,0,0,7);g.fill()}
      g.fillStyle='rgba(15,6,2,.85)';g.fillRect(x0,r*rh,2.5,rh);
    }
    g.fillStyle='rgba(15,6,2,.9)';g.fillRect(0,r*rh,S,3);
    g.fillStyle='rgba(255,220,170,.07)';g.fillRect(0,r*rh+3,S,3);
  }
  const t=new THREE.CanvasTexture(cv);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=16;return t;
}
function softShadowTex(){const cv=document.createElement('canvas');cv.width=cv.height=128;const g=cv.getContext('2d');const gr=g.createRadialGradient(64,64,6,64,64,64);gr.addColorStop(0,'rgba(0,0,0,.55)');gr.addColorStop(.6,'rgba(0,0,0,.25)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(0,0,128,128);return new THREE.CanvasTexture(cv)}
function buildLivingUpgrade(){
  const g=new THREE.Group();house.add(g);const fy=.14;
  const pt=plankTexture();
  const mkFloor=(w,d,cx,cz)=>{const t=pt.clone();t.needsUpdate=true;t.repeat.set(w/2.4,d/1.2);t.wrapS=t.wrapT=THREE.RepeatWrapping;
    const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),new THREE.MeshStandardMaterial({map:t,bumpMap:t,bumpScale:.6,roughness:.5,metalness:.02,envMapIntensity:.7}));
    m.rotation.x=-Math.PI/2;m.position.set(cx,fy+.004,cz);m.receiveShadow=true;g.add(m)};
  mkFloor(11.1,5.1,0,0);mkFloor(3.8,4.9,-8,0);
  B(g,1.5,.02,1.7,mats.plinth,-4.9,fy+.012,-1.7,1.2);
  const st=softShadowTex();
  const ao=(x,z,w,d,o=1)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),new THREE.MeshBasicMaterial({map:st,transparent:true,depthWrite:false,opacity:o,polygonOffset:true,polygonOffsetFactor:-2}));m.rotation.x=-Math.PI/2;m.position.set(x,fy+.012,z);m.renderOrder=1;g.add(m)};
  ao(3.2,-1.85,3.8,1.6);ao(.95,-.2,1.7,1.6);ao(3.2,-.5,2.0,1.3,.8);ao(5.25,0,1.0,2.4);ao(-2.4,-.9,2.8,2.2);ao(-4.9,-1.9,2.4,1.8);ao(-7.9,-1.5,3.0,1.8);ao(-4.6,2.3,2.0,.9,.8);
  const D=interior;
  {
    B(D,1.7,.012,.4,cloth(0xffffff,F.aguayo),-2.4,fy+.842,-.9,1.2);
    const plate=std({color:0xf1ece0,roughness:.35}),fruit=[0xd9342a,0xf2b230,0x7ab648].map(c=>std({color:c,roughness:.5}));
    for(const [px,pz] of [[-3.0,-.7],[-1.8,-.7],[-3.0,-1.1],[-1.8,-1.1]]){add(D,new THREE.CylinderGeometry(.12,.1,.02,20),plate,px,fy+.86,pz);}
    add(D,new THREE.CylinderGeometry(.17,.12,.07,18),mats.wood,-2.4,fy+.88,-.9);
    for(let i=0;i<5;i++)add(D,new THREE.SphereGeometry(.045,10,8),fruit[i%3],-2.4+(i-2)*.05,fy+.95+(i%2)*.02,-.9+((i*3)%3-1)*.04);
    B(D,2.8,.012,1.9,cloth(0xffffff,F.aguayo,[2,1]),-2.4,fy+.01,-.9,2,{cast:false});
  }
  const lampMat=std({color:0xf0dfba,emissive:0xffc070,emissiveIntensity:.5,roughness:.9,side:THREE.DoubleSide});window.pendMat=lampMat;
  for(const [px,pz] of [[-2.4,-.9],[3.2,-.6]]){add(g,new THREE.CylinderGeometry(.008,.008,.8,6),darkM,px,2.65,pz);add(g,new THREE.CylinderGeometry(.12,.3,.28,24,1,true),lampMat,px,2.2,pz,{cast:false});add(g,new THREE.SphereGeometry(.05,10,8),std({color:0xfff2c8,emissive:0xffd890,emissiveIntensity:2}),px,2.15,pz,{cast:false});
    const pl=new THREE.PointLight(0xffc27a,0,7,1.6);pl.position.set(px,2.0,pz);g.add(pl);(window.pendLights=window.pendLights||[]).push(pl)}
  for(let i=0;i<8;i++){const l=add(g,new THREE.CylinderGeometry(.045,.05,.5,8),mats.woodD,-3.55,fy+.06+(i>5?.1:0),-1.0+(i%6)*.1-(i>5?.05:0));l.rotation.z=Math.PI/2}
  add(g,new THREE.CylinderGeometry(.3,.26,.55,18),clay,-5.9,fy+.28,-0.5);add(g,new THREE.TorusGeometry(.3,.025,8,20),clay,-5.9,fy+.56,-0.5).rotation.x=Math.PI/2;
  const sofaTop=fy+.655,eyeS=.62;
  [[2.3,-1.82],[3.2,-1.82],[4.1,-1.82]].forEach(p=>SEATS.push({name:'el sofá',x:p[0],z:p[1],eye:sofaTop+eyeS,yaw:Math.PI,floor:fy,sx:p[0],sz:-1.15,tv:true}));
  SEATS.push({name:'el sillón',x:1.01,z:-.2,eye:sofaTop+eyeS,yaw:-Math.PI/2,floor:fy,sx:1.0,sz:.95,tv:true});
  [[-3.0,-.1,0,.75],[-1.8,-.1,0,.75],[-2.4,-1.7,Math.PI,null]].forEach(p=>SEATS.push({name:'el banquito',x:p[0],z:p[1],eye:fy+.45+.66,yaw:p[2],floor:fy,sx:p[3]===null?-1.0:p[0],sz:p[3]===null?-1.7:p[3]}));
}
let seatNow=null,sitT=0;
const sitHint=document.getElementById('sitHint');
function nearestSeat(){
  if(!fp||seatNow)return null;let best=null,bd=1.15;const fwx=-Math.sin(yaw),fwz=-Math.cos(yaw);
  for(const s of SEATS){if(Math.abs((fpGY===fpGY?fpGY:0)-s.floor)>.5)continue;
    const dx=s.x-camera.position.x,dz=s.z-camera.position.z,d=Math.hypot(dx,dz);if(d>bd)continue;
    if(d>.35&&(dx*fwx+dz*fwz)/d<.15)continue;best=s;bd=d}
  return best;
}
function doSit(s){if(!s||seatNow)return;seatNow=s;sitT=0;vel.set(0,0,0);jy=0;jv=0}
function doStand(){
  if(!seatNow)return;const s=seatNow;seatNow=null;
  const tries=[[s.sx,s.sz],[s.sx+.4,s.sz],[s.sx-.4,s.sz],[s.sx,s.sz+.4],[s.sx,s.sz-.4]];
  for(const [x,z] of tries){const y=fpSurf(x,z,s.floor);if(y!==null){camera.position.x=x;camera.position.z=z;fpGY=y;return}}
  fpGY=s.floor;
}
function toggleSit(){if(seatNow)doStand();else{const s=nearestSeat();if(s)doSit(s)}}
function sitUpdate(dt){
  sitT+=dt;const k=1-Math.exp(-dt*7);
  camera.position.x+=(seatNow.x-camera.position.x)*k;camera.position.z+=(seatNow.z-camera.position.z)*k;camera.position.y+=(seatNow.eye-camera.position.y)*k;
  let dy=seatNow.yaw-yaw;dy=Math.atan2(Math.sin(dy),Math.cos(dy));if(sitT<1.4)yaw+=dy*k*.6;
  const mv=keys.KeyW||keys.KeyA||keys.KeyS||keys.KeyD||keys.ArrowUp||keys.ArrowDown||keys.ArrowLeft||keys.ArrowRight||keys.forward||keys.backward||keys.left||keys.right||keys.Space||keys.jump;
  if(mv&&sitT>.5){doStand();return}
  camera.rotation.set(pitch,yaw,0,'YXZ');
}
function updateHints(){
  if(!sitHint)return;let html='';
  if(fp){
    if(seatNow){html=`Sentado en ${seatNow.name} · <b>F</b> o moverte para levantarte`+(seatNow.tv?' · <b>T</b> cambia la TV':'')+(seatNow.laptop?' · mira la laptop':'')}
    else{const s=nearestSeat();if(s)html=`<b>F</b> · Sentarse en ${s.name}`;
      else if(fpGY<1&&Math.hypot(camera.position.x-5.3,camera.position.z)<4.8)html='<b>T</b> · cambiar la imagen de la TV'}
  }
  if(html){sitHint.innerHTML=html;sitHint.style.display='block'}else sitHint.style.display='none';
}
if(sitHint)sitHint.addEventListener('click',()=>{if(seatNow)doStand();else toggleSit()});
document.addEventListener('keydown',e=>{if(!fp)return;if(e.code==='KeyF')toggleSit();if(e.code==='KeyT'&&window.TV)TV.next()});
function skyBeauty(y){
  const k=smooth(0,.5,y);su.rayleigh.value=lerp(3.6,1.9,k);su.mieCoefficient.value=lerp(.010,.0034,k);su.mieDirectionalG.value=lerp(.88,.76,k);su.turbidity.value=lerp(8,5.4,k);
}
function makeShaft(getRect,floorY){
  const geo=new THREE.BufferGeometry();const pos=new Float32Array(8*3),col=new Float32Array(8*3);
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('color',new THREE.BufferAttribute(col,3));
  geo.setIndex([0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7]);
  const m=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({vertexColors:true,blending:THREE.AdditiveBlending,transparent:true,depthWrite:false,side:THREE.DoubleSide,fog:false,toneMapped:false}));
  m.frustumCulled=false;m.renderOrder=5;scene.add(m);
  return {m,update(on,strength){m.visible=on;if(!on)return;const r=getRect();const P=[[r.x0,r.y0],[r.x1,r.y0],[r.x1,r.y1],[r.x0,r.y1]];
    P.forEach((p,i)=>{const o=i*3;pos[o]=p[0];pos[o+1]=p[1];pos[o+2]=r.z;const t=Math.min(r.len,(p[1]-floorY)/Math.max(.25,sunDir.y));
      pos[12+o]=p[0]-sunDir.x*t;pos[12+o+1]=p[1]-sunDir.y*t;pos[12+o+2]=r.z-sunDir.z*t;
      col[o]=col[o+1]=col[o+2]=strength;col[12+o]=col[12+o+1]=col[12+o+2]=0});
    geo.attributes.position.needsUpdate=true;geo.attributes.color.needsUpdate=true}};
}
let shafts=[],dust=null;
function buildLightFx(){
  shafts=[makeShaft(()=>{const w=+$('win').value;return {x0:2.5-w/2,x1:2.5+w/2,y0:.95,y1:2.45,z:2.52,len:6}},.14),
          makeShaft(()=>({x0:-.7,x1:1.5,y0:4.7,y1:5.8,z:1.2,len:5}),4.04)];
  const N=120,p=new Float32Array(N*3);for(let i=0;i<N;i++){p[i*3]=-1+rnd()*7;p[i*3+1]=.4+rnd()*2.3;p[i*3+2]=-1.8+rnd()*4.2}
  const gd=new THREE.BufferGeometry();gd.setAttribute('position',new THREE.BufferAttribute(p,3));
  dust=new THREE.Points(gd,new THREE.PointsMaterial({color:0xfff0c8,size:.035,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,sizeAttenuation:true,fog:false}));dust.frustumCulled=false;scene.add(dust);
}
function featureUpdate(dt,t){
  const dayF=smooth(-.02,.35,sunDir.y),sunny=sunDir.y>.12&&sunDir.z>.02&&!state.rain&&!state.fog;
  const lightFx=gfx?.current?.lightFx??true;
  if(shafts.length){shafts[0].update(lightFx&&sunny,.16*dayF);shafts[1].update(lightFx&&sunny,.13*dayF)}
  if(dust){dust.visible=lightFx;dust.material.opacity=lightFx?(sunny?.55:.12)*dayF:0;if(lightFx){const a=dust.geometry.attributes.position.array;for(let i=0;i<a.length;i+=3){a[i+1]+=Math.sin(t*.4+i)*dt*.02;a[i]+=Math.sin(t*.3+i*1.3)*dt*.015;if(a[i+1]>2.7)a[i+1]=.4}dust.geometry.attributes.position.needsUpdate=true}}
  if(window.TV)TV.update(dt,t);if(window.LT)LT.update(dt,t);
  if(window.pendLights){window.pendLights.forEach(l=>l.intensity=.5+nightF*3.2);if(window.pendMat)window.pendMat.emissiveIntensity=.5+nightF*1.6}
  updateHints();
}

/* ---------- perfiles gráficos + optimización adaptativa ---------- */
let perfFrame=0;
const QUALITY_DESC={
  performance:'Máximo rendimiento: baja resolución interna, pocas partículas, efectos de luz reducidos y sin sombras.',
  smooth:'Muy fluido: conserva el diseño, reduce partículas y detalle lejano; sombras desactivadas.',
  standard:'Equilibrado: buena nitidez, efectos principales y animaciones optimizadas; sombras desactivadas.',
  high:'Alta calidad: más nitidez, partículas y distancia de detalle; todavía prioriza FPS sin sombras.',
  ultra:'Calidad alta completa: sombras suaves 2048 px, partículas completas y mayor distancia de detalle.',
  ultraMax:'Máxima calidad: supersampling, sombras 4096 px, animaciones completas, iluminación y color reforzados.'
};
function setDrawFraction(geo,total,fraction,vertsPerItem=1){
  if(!geo)return;const items=Math.max(1,Math.floor(total*fraction));geo.setDrawRange(0,items*vertsPerItem);
}
function setShadowResolution(size){
  if(!size)return;
  if(sunLight.shadow.mapSize.x===size&&sunLight.shadow.mapSize.y===size)return;
  sunLight.shadow.mapSize.set(size,size);
  if(sunLight.shadow.map){sunLight.shadow.map.dispose();sunLight.shadow.map=null}
  renderer.shadowMap.needsUpdate=true;
}
function updateQualityUI(profile,key,mode){
  const auto=mode==='auto';
  if($('qualityMode'))$('qualityMode').value=mode;
  if($('qualityName'))$('qualityName').textContent=auto?`Automático · ${profile.label}`:profile.label;
  if($('qualityInfo'))$('qualityInfo').innerHTML=`<b>${auto?'🤖 Automático ahora:':'🎮 Perfil:'} ${profile.label}</b><br>${QUALITY_DESC[key]}<br><span style="opacity:.76">Render ${profile.pixelRatio.toFixed(2)}× · ${profile.shadows?`Sombras ${profile.shadowMapSize}px`:'Sin sombras'} · Partículas ${Math.round(profile.particleScale*100)}%</span>${auto?'<br><span class="ok">El sistema sube o baja este nivel según los FPS.</span>':''}`;
}
function applyGraphicsProfile(profile,key,mode){
  renderer.setPixelRatio(profile.pixelRatio);
  renderer.shadowMap.enabled=profile.shadows;
  setShadowResolution(profile.shadowMapSize);
  state.shadow=profile.shadows;
  sunLight.castShadow=state.shadow;
  renderer.shadowMap.needsUpdate=true;
  const sb=$('bShadow');if(sb){sb.disabled=!profile.shadows;sb.classList.toggle('on',state.shadow);sb.classList.toggle('qualityDisabled',!profile.shadows);sb.textContent=profile.shadows?'🌑 Sombras':'🌑 Sombras · Ultra+'}
  setDrawFraction(starGeo,PERF.starCount,profile.particleScale,1);
  setDrawFraction(rainGeo,NR,profile.particleScale,2);
  setDrawFraction(snowFar.geo,snowFar.count,profile.particleScale,1);
  setDrawFraction(snowNear.geo,snowNear.count,profile.particleScale,1);
  setDrawFraction(snowFront.geo,snowFront.count,profile.particleScale,1);
  scene.traverse(o=>{
    if(o.isInstancedMesh&&o.userData.qualityVegetation){o.count=Math.max(1,Math.floor(o.userData.maxCount*profile.vegetationScale))}
    if(o.isInstancedMesh&&o.userData.qualityFur){o.count=Math.max(1,Math.floor(o.userData.maxCount*profile.furScale))}
  });
  groundMat.envMapIntensity=.34*profile.envBoost;
  mats.panel.envMapIntensity=1.0*profile.envBoost;
  updateQualityUI(profile,key,mode);
  updateTime();
}
function initGraphicsQuality(){
  gfx=createGraphicsQuality({renderer,initialMode:'auto',initialAutoProfile:'standard',applyProfile:(p,k,m)=>applyGraphicsProfile(p,k,m)});
  const sel=$('qualityMode');if(sel){sel.value=gfx.mode;sel.onchange=()=>gfx.setMode(sel.value)}
  updateQualityUI(gfx.current,gfx.currentKey,gfx.mode);
}
function updateDetailVisibility(){
  const d=Math.hypot(camera.position.x,camera.position.z),q=gfx?.current;
  const inD=q?.interiorDetailDistance??PERF.interiorDetailDistance;
  const upD=q?.studentRoomDetailDistance??PERF.studentRoomDetailDistance;
  const nearHouse=fp||state.roof||d<inD;
  if(typeof interior!=='undefined')interior.visible=nearHouse;
  if(studentRoomGroup)studentRoomGroup.visible=fp||state.roof||d<upD||camera.position.y>4.2&&d<Math.max(34,upD+6);
}

/* ---------- bucle ---------- */
const clock=new THREE.Clock();let fpsA=0,fpsN=0,hudT=0;
function animate(){
  requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.1),t=clock.elapsedTime;perfFrame++;gfx?.tick(dt);updateDetailVisibility();
  if(state.play){state.hour=(state.hour+dt*.35)%24;$('hour').value=state.hour;updateTime()}
  if(camTween){camTween.k=Math.min(1,camTween.k+dt*1.2);const e=camTween.k*camTween.k*(3-2*camTween.k);
    camera.position.lerp(camTween.p,e*.12+.02);controls.target.lerp(camTween.t,e*.12+.02);if(camTween.k>=1&&camera.position.distanceTo(camTween.p)<.05)camTween=null}
  const smokeDiv=gfx?.current?.smokeDivisor??1;if(perfFrame%smokeDiv===0)smoke.forEach(s=>{s.userData.t=(s.userData.t+dt*.07*smokeDiv)%1;const k=s.userData.t;
    s.position.set(-8.6+k*5+Math.sin(k*9+t)*.3,5.3+k*6,-.6+Math.cos(k*7)*.3);const sc=.6+k*3.2;s.scale.set(sc,sc,1);s.material.opacity=Math.sin(k*Math.PI)*.4*(1-nightF*.6)});
  if(rain.visible){const p=rainGeo.attributes.position;const activeRain=Math.max(1,Math.floor(NR*(gfx?.current?.particleScale??1)));for(let i=0;i<activeRain;i++){const k=i*6;const dy=dt*28;p.array[k+1]-=dy;p.array[k+4]-=dy;if(p.array[k+1]<0){p.array[k+1]+=40;p.array[k+4]+=40}}p.needsUpdate=true;rain.position.set(camera.position.x*.5,0,camera.position.z*.5)}
  if(state.frost){const wind=Math.sin(t*.22)*.05,q=gfx?.current;const df=q?.snowFarDivisor??2,dn=q?.snowNearDivisor??1,dc=q?.snowFrontDivisor??1;if(perfFrame%df===0)updateSnow(snowFar,dt*df,.35,wind);if(perfFrame%dn===0)updateSnow(snowNear,dt*dn,.55,wind*1.2);if(perfFrame%dc===0)updateSnow(snowFront,dt*dc,.8,wind*1.8)}
  L3.position.set(2.5,3.1,3.6);L2.position.set(0,8.2,.75);
  grassTime.value=t;animateLife(dt,t);try{featureUpdate(dt,t)}catch(e){}if(fp){fpUpdate(dt);drawMini()}else controls.update();updateSunSprites();if(state.shadow&&gfx?.shouldRefreshShadow())renderer.shadowMap.needsUpdate=true;renderer.render(scene,camera);
  fpsA+=dt;fpsN++;hudT+=dt;if(hudT>.5){const q=gfx?.current;const shadowTxt=q?.shadows?(state.shadow?`${q.shadowMapSize}px`:'OFF'):'OFF';$('hud').innerHTML=`${Math.round(fpsN/fpsA)} FPS<br>${gfx?.displayName||'Gráficos'}<br>Render: ${(q?.pixelRatio??1).toFixed(2)}× · Sombras ${shadowTxt}<br>Cámara: ${camera.position.distanceTo(controls.target).toFixed(1)} m del centro`;fpsA=fpsN=hudT=0}
}
try{buildLivingUpgrade()}catch(e){console.warn('planta baja',e)}
try{buildLightFx()}catch(e){console.warn('luz',e)}
initGraphicsQuality();
optimizeTinyShadows(scene);
improveTextureQuality(scene);
drawTemps();drawQuad();updateObs();updateTime();updatePanel();updateSunRays();
animate();
setTimeout(()=>{$('load').style.opacity=0;setTimeout(()=>$('load').remove(),700)},300);
window.addEventListener('error',e=>{const l=$('load');if(l){l.style.opacity=1;l.textContent='Error: '+e.message}});
