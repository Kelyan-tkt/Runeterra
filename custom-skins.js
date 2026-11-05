// Skins locaux ajoutés au catalogue, sans modification des inventaires Firestore.
export const MAVAYNE_SKIN = Object.freeze({
  key:'mavayne-v1', champion:'Vayne', slot:999, name:'Mavayne', rarity:'kLegendary',
  portrait:'./mavayne-portrait.jpg', splash:'./mavayne-splash.jpg'
});
export function installCustomSkins(champions,skinsById){
  const champion=champions.find(c=>c.id===MAVAYNE_SKIN.champion);
  const championKey=Number(champion?.key);
  if(!champion||!Number.isSafeInteger(championKey)||championKey<=0){
    console.warn('Mavayne : champion Vayne introuvable ; catalogue officiel conservé.');
    return [];
  }
  const id=championKey*1000+MAVAYNE_SKIN.slot;
  if(id>=1000000){console.warn('Mavayne : identifiant incompatible avec ce catalogue.');return [];}
  const existing=skinsById[id];
  if(existing&&existing.customSkinKey!==MAVAYNE_SKIN.key){
    console.warn(`Mavayne : l’identifiant ${id} est déjà occupé. Aucun skin existant n’a été remplacé.`);
    return [];
  }
  const portrait=new URL(MAVAYNE_SKIN.portrait,import.meta.url).href;
  const splash=new URL(MAVAYNE_SKIN.splash,import.meta.url).href;
  const skin={id,name:MAVAYNE_SKIN.name,isBase:false,rarity:MAVAYNE_SKIN.rarity,
    customSkinKey:MAVAYNE_SKIN.key,customPortrait:portrait,customSplash:splash,
    loadScreenPath:portrait,splashPath:splash,uncenteredSplashPath:splash,tilePath:portrait};
  skinsById[id]=skin;
  return [skin];
}
export function customSkinArtwork(skin){
  if(skin?.customSkinKey!==MAVAYNE_SKIN.key)return null;
  return {img:skin.customPortrait,imgAlt:skin.customSplash,
    splash:skin.customSplash,splashAlt:skin.customPortrait};
}
