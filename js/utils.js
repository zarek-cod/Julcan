import * as THREE from 'three';

export const $=id=>document.getElementById(id);
export const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
export const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
export const lerp=(a,b,t)=>a+(b-a)*t;
let seed=7;export const rnd=()=>{seed=(seed*16807)%2147483647;return (seed-1)/2147483646};

/* ---------- ruido periódico para texturas sin costuras ---------- */
export function hash(x,y,s){let h=(x*374761393+y*668265263+s*982451653)|0;h=(h^(h>>>13))*1274126177|0;return ((h^(h>>>16))>>>0)/4294967295}
export function vnoise(x,y,per,s=0){const xi=Math.floor(x),yi=Math.floor(y),xf=x-xi,yf=y-yi;
  const m=v=>((v%per)+per)%per;const u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf);
  const a=hash(m(xi),m(yi),s),b=hash(m(xi+1),m(yi),s),c=hash(m(xi),m(yi+1),s),d=hash(m(xi+1),m(yi+1),s);
  return lerp(lerp(a,b,u),lerp(c,d,u),v)}
export function fbm(x,y,per=64,oct=4,s=0){let a=.5,f=1,t=0,n=0;for(let i=0;i<oct;i++){t+=a*vnoise(x*f,y*f,per*f,s+i);n+=a;a*=.5;f*=2}return t/n}

export function makeTexture(size,fn,{bumpFn=null,repeat=[1,1],srgb=true}={}){
  const cv=document.createElement('canvas');cv.width=cv.height=size;const g=cv.getContext('2d');
  const im=g.createImageData(size,size);
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){const c=fn(x/size,y/size,x,y);const i=(y*size+x)*4;im.data[i]=c[0];im.data[i+1]=c[1];im.data[i+2]=c[2];im.data[i+3]=255}
  g.putImageData(im,0,0);return {cv,g,size};
}
export function toTex(cv,{repeat=[1,1],srgb=true}={}){const t=new THREE.CanvasTexture(cv);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(...repeat);t.anisotropy=8;if(srgb)t.colorSpace=THREE.SRGBColorSpace;return t}
