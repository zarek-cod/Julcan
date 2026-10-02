export const QUALITY_ORDER=['performance','smooth','standard','high','ultra','ultraMax'];

export const QUALITY_PROFILES=Object.freeze({
  performance:Object.freeze({
    label:'Rendimiento',pixelRatio:.65,shadows:false,shadowMapSize:0,shadowEvery:0,
    particleScale:.30,vegetationScale:.25,furScale:.12,fullAnimationDistance:9,farAnimationDivisor:6,
    interiorDetailDistance:12,studentRoomDetailDistance:15,lightFx:false,
    smokeDivisor:4,snowFarDivisor:4,snowNearDivisor:3,snowFrontDivisor:2,
    exposureBoost:.94,lightBoost:.92,envBoost:.75
  }),
  smooth:Object.freeze({
    label:'Suave',pixelRatio:.82,shadows:false,shadowMapSize:0,shadowEvery:0,
    particleScale:.48,vegetationScale:.45,furScale:.30,fullAnimationDistance:13,farAnimationDivisor:5,
    interiorDetailDistance:16,studentRoomDetailDistance:19,lightFx:false,
    smokeDivisor:3,snowFarDivisor:3,snowNearDivisor:2,snowFrontDivisor:2,
    exposureBoost:.97,lightBoost:.96,envBoost:.86
  }),
  standard:Object.freeze({
    label:'Estándar',pixelRatio:1.00,shadows:false,shadowMapSize:0,shadowEvery:0,
    particleScale:.70,vegetationScale:.70,furScale:.60,fullAnimationDistance:18,farAnimationDivisor:4,
    interiorDetailDistance:21,studentRoomDetailDistance:24,lightFx:true,
    smokeDivisor:2,snowFarDivisor:3,snowNearDivisor:2,snowFrontDivisor:1,
    exposureBoost:1.00,lightBoost:1.00,envBoost:1.00
  }),
  high:Object.freeze({
    label:'Alta',pixelRatio:1.20,shadows:false,shadowMapSize:0,shadowEvery:0,
    particleScale:.88,vegetationScale:.90,furScale:.85,fullAnimationDistance:23,farAnimationDivisor:3,
    interiorDetailDistance:26,studentRoomDetailDistance:30,lightFx:true,
    smokeDivisor:2,snowFarDivisor:2,snowNearDivisor:1,snowFrontDivisor:1,
    exposureBoost:1.01,lightBoost:1.01,envBoost:1.08
  }),
  ultra:Object.freeze({
    label:'Ultra',pixelRatio:1.40,shadows:true,shadowMapSize:2048,shadowEvery:2,
    particleScale:1.00,vegetationScale:1.00,furScale:1.00,fullAnimationDistance:29,farAnimationDivisor:2,
    interiorDetailDistance:32,studentRoomDetailDistance:36,lightFx:true,
    smokeDivisor:1,snowFarDivisor:2,snowNearDivisor:1,snowFrontDivisor:1,
    exposureBoost:1.02,lightBoost:1.03,envBoost:1.18
  }),
  ultraMax:Object.freeze({
    label:'Ultra Máximo',pixelRatio:1.70,shadows:true,shadowMapSize:4096,shadowEvery:1,
    particleScale:1.00,vegetationScale:1.00,furScale:1.00,fullAnimationDistance:42,farAnimationDivisor:1,
    interiorDetailDistance:44,studentRoomDetailDistance:48,lightFx:true,
    smokeDivisor:1,snowFarDivisor:1,snowNearDivisor:1,snowFrontDivisor:1,
    exposureBoost:1.07,lightBoost:1.07,envBoost:1.32
  })
});

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

export function createGraphicsQuality({renderer,applyProfile,initialMode='auto',initialAutoProfile='standard',storageKey='julcan3d-quality'}){
  let mode='auto';
  let currentKey=initialAutoProfile in QUALITY_PROFILES?initialAutoProfile:'standard';
  let current=QUALITY_PROFILES[currentKey];
  let acc=0,frames=0,lastFPS=60,cooldown=0,upStreak=0,downStreak=0,shadowCounter=0;

  try{
    const saved=localStorage.getItem(storageKey);
    if(saved&&(saved==='auto'||saved in QUALITY_PROFILES))initialMode=saved;
  }catch(_){ }

  function apply(key,reason='manual'){
    if(!(key in QUALITY_PROFILES))key='standard';
    currentKey=key;current=QUALITY_PROFILES[key];shadowCounter=0;
    renderer.setPixelRatio(current.pixelRatio);
    applyProfile?.(current,key,mode,reason,lastFPS);
  }

  function setMode(next,{persist=true}={}){
    mode=(next==='auto'||next in QUALITY_PROFILES)?next:'auto';
    upStreak=downStreak=0;cooldown=2.5;
    if(mode==='auto'){
      if(!(currentKey in QUALITY_PROFILES))currentKey='standard';
      apply(currentKey,'auto-start');
    }else apply(mode,'manual');
    if(persist){try{localStorage.setItem(storageKey,mode)}catch(_){}}
  }

  function step(delta,reason){
    const i=QUALITY_ORDER.indexOf(currentKey);
    const ni=clamp(i+delta,0,QUALITY_ORDER.length-1);
    if(ni===i)return false;
    apply(QUALITY_ORDER[ni],reason);cooldown=3.5;upStreak=downStreak=0;return true;
  }

  function tick(dt){
    acc+=dt;frames++;cooldown=Math.max(0,cooldown-dt);
    if(acc<1.35)return false;
    lastFPS=frames/acc;acc=0;frames=0;
    if(mode!=='auto'||cooldown>0)return false;

    // En automático se intenta subir calidad mientras la PC sostenga fluidez.
    // Si un perfil nuevo resulta pesado, baja con mayor rapidez que la subida.
    if(lastFPS<38){return step(-2,'fps-critical')}
    if(lastFPS<49){downStreak++;upStreak=0;if(downStreak>=1)return step(-1,'fps-low')}
    else if(lastFPS<54){downStreak++;upStreak=0;if(downStreak>=2)return step(-1,'fps-soft-low')}
    else if(lastFPS>57.5){upStreak++;downStreak=0;if(upStreak>=2)return step(1,'fps-high')}
    else {upStreak=downStreak=0}
    return false;
  }

  function shouldRefreshShadow(){
    if(!current.shadows||current.shadowEvery<=0)return false;
    shadowCounter++;
    return shadowCounter%current.shadowEvery===0;
  }

  // Aplica el modo inicial sin guardar de nuevo.
  if(initialMode==='auto')mode='auto';else if(initialMode in QUALITY_PROFILES){mode=initialMode;currentKey=initialMode}
  apply(currentKey,'initial');

  return {
    tick,setMode,shouldRefreshShadow,
    get mode(){return mode},
    get current(){return current},
    get currentKey(){return currentKey},
    get fps(){return lastFPS},
    get pixelRatio(){return current.pixelRatio},
    get displayName(){return mode==='auto'?`Automático · ${current.label}`:current.label}
  };
}
