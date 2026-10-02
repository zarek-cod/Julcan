import {clamp, smooth, lerp, fbm, hash, makeTexture, rnd, vnoise} from './utils.js';

/* ---------- texturas procedurales ---------- */
export function adobeTexture(){
  const S=512;const tx=makeTexture(S,(u,v)=>{
    const big=fbm(u*6,v*6,6,4,1),mid=fbm(u*24,v*24,24,3,2),fine=vnoise(u*160,v*160,160,3);
    let k=.86+.24*big+.12*(mid-.5)+.08*(fine-.5);
    const row=Math.floor(v*8),col=Math.floor((u+(row%2)*.5/4)*4);
    const bt=hash(col,row,11)*.12-.06;k+=bt;
    const ev=Math.abs(((v*8)%1)-.5)*2;if(ev>.96)k-=.06;
    const ev2=Math.abs((((u+(row%2)*.125)*4)%1)-.5)*2;if(ev2>.97)k-=.05;
    return [clamp(204*k,0,255),clamp(158*k,0,255),clamp(105*k,0,255)]});
  const g=tx.g;g.lineCap='round';
  for(let i=0;i<260;i++){const x=rnd()*S,y=rnd()*S,l=4+rnd()*14,a=rnd()*Math.PI;g.strokeStyle=rnd()<.6?'rgba(224,190,120,.55)':'rgba(70,45,25,.35)';g.lineWidth=1;g.beginPath();g.moveTo(x,y);g.lineTo(x+Math.cos(a)*l,y+Math.sin(a)*l);g.stroke()}
  for(let i=0;i<5;i++){let x=rnd()*S,y=rnd()*S*.6;g.strokeStyle='rgba(55,35,20,.5)';g.lineWidth=1.3;g.beginPath();g.moveTo(x,y);for(let j=0;j<18;j++){x+=(rnd()-.5)*12;y+=4+rnd()*8;g.lineTo(x,y)}g.stroke()}
  const bump=document.createElement('canvas');bump.width=bump.height=S;const b=bump.getContext('2d');b.drawImage(tx.cv,0,0);
  const im=b.getImageData(0,0,S,S);for(let i=0;i<im.data.length;i+=4){const l=(im.data[i]+im.data[i+1]+im.data[i+2])/3;im.data[i]=im.data[i+1]=im.data[i+2]=l}b.putImageData(im,0,0);
  return {map:tx.cv,bump};
}
export function tileTexture(){
  const S=512;const tx=makeTexture(S,(u,v)=>{
    const cols=10,rows=5;const cx=u*cols,cy=v*rows;const c=Math.floor(cx),r=Math.floor(cy);
    const fx=cx-c,fy=cy-r;
    const prof=.55+.45*Math.sin(fx*Math.PI);
    const shade=.55+.45*smooth(0,.85,fy)*(1-.35*smooth(.85,1,fy));
    const sh2=fy>.9?.45:1;
    const tone=.82+.35*hash(c,r,5)+.2*(fbm(u*30,v*30,30,3,3)-.5);
    const k=prof*shade*sh2*tone;
    return [clamp(214*k,0,255),clamp(101*k,0,255),clamp(58*k,0,255)]});
  const g=tx.g;for(let i=0;i<300;i++){g.fillStyle=rnd()<.5?'rgba(90,110,60,.25)':'rgba(40,20,10,.25)';g.beginPath();g.arc(rnd()*S,rnd()*S,1+rnd()*3,0,7);g.fill()}
  return tx.cv}
export function woodTexture(dark=false){
  const S=256;const b=dark?[82,50,30]:[128,84,50];
  return makeTexture(S,(u,v)=>{
    const gr=fbm(u*3,v*40,64,3,4),ring=Math.sin((u*8+gr*4)*Math.PI*2)*.5+.5;
    const plank=Math.floor(u*4),pk=.85+.3*hash(plank,1,9);
    const edge=((u*4)%1)<.02?.5:1;
    const k=(.65+.3*gr+.12*ring)*pk*edge;
    return [clamp(b[0]*k*1.2,0,255),clamp(b[1]*k*1.2,0,255),clamp(b[2]*k*1.2,0,255)]}).cv}
export function stoneTexture(){
  const S=512,N=6;const pts=[];for(let j=0;j<N;j++)for(let i=0;i<N;i++)pts.push([(i+.15+.7*hash(i,j,21))/N,(j+.15+.7*hash(i,j,22))/N,hash(i,j,23)]);
  return makeTexture(S,(u,v)=>{let d1=9,d2=9,id=0;
    for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++)for(let j=0;j<N;j++){}
    for(const p of pts)for(let oy=-1;oy<=1;oy++)for(let ox=-1;ox<=1;ox++){const dx=u-(p[0]+ox),dy=v-(p[1]+oy);const d=dx*dx+dy*dy;if(d<d1){d2=d1;d1=d;id=p[2]}else if(d<d2)d2=d}
    const e=Math.sqrt(d2)-Math.sqrt(d1);const mortar=e<.012;
    const n=fbm(u*50,v*50,50,3,6);let k=mortar?.4:(.7+.4*id)*(.8+.4*n);
    return [clamp(148*k,0,255),clamp(139*k,0,255),clamp(126*k,0,255)]}).cv}
export function groundTexture(){
  return makeTexture(512,(u,v)=>{const n=fbm(u*8,v*8,8,5,7),m=fbm(u*40,v*40,40,3,8);
    const g=smooth(.35,.65,n);const k=.75+.5*m;
    const r=lerp(170,116,g)*k,gg=lerp(136,140,g)*k,b=lerp(82,72,g)*k;return [clamp(r,0,255),clamp(gg,0,255),clamp(b,0,255)]}).cv}
export function fieldTexture(){
  return makeTexture(256,(u,v)=>{const f=Math.sin(u*Math.PI*2*10)*.5+.5;const n=fbm(u*30,v*30,30,3,9);const k=(.55+.45*f)*(.8+.4*n);return [clamp(124*k,0,255),clamp(88*k,0,255),clamp(56*k,0,255)]}).cv}
export function panelTexture(){
  const S=256;const tx=makeTexture(S,(u,v)=>{const lx=((u*6)%1),ly=((v*10)%1);const line=lx<.04||ly<.05;const k=line?.5:1;const gl=.7+.3*Math.sin((u+v)*9);return [14*k*gl,38*k*gl+8,80*k*gl+10]});return tx.cv}
