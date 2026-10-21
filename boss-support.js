// Utilitaires de Chasse aux boss. Affectations de jeu, pas classement officiel des positions.
const ROLE_NAMES = ['Top','Jungle','Mid','ADC','Support'];
const GROUPS = {
 Top: `Aatrox Akali Ambessa Camille Chogath Darius DrMundo Fiora Gangplank Garen Gnar Gragas Gwen Heimerdinger Illaoi Irelia Jax Jayce Kayle Kennen Kled KSante Malphite Mordekaiser Nasus Olaf Ornn Pantheon Poppy Quinn Renekton Rengar Riven Rumble Ryze Sett Shen Shyvana Singed Sion Swain Sylas TahmKench Teemo Trundle Tryndamere Udyr Urgot Vayne Vladimir Volibear Warwick MonkeyKing Yasuo Yone Yorick Zac`,
 Jungle: `Amumu Belveth Brand Briar Diana DrMundo Ekko Elise Evelynn Fiddlesticks Gragas Graves Gwen Hecarim Ivern JarvanIV Jax Karthus Kayn Khazix Kindred LeeSin Lillia Maokai MasterYi Morgana Naafiri Nidalee Nocturne Nunu Olaf Pantheon Poppy Qiyana Rammus RekSai Rell Rengar Rumble Sejuani Shaco Shen Shyvana Skarner Sylas Talon Taliyah Trundle Twitch Udyr Vi Viego Volibear Warwick MonkeyKing XinZhao Zac Zed Zyra`,
 Mid: `Ahri Akali Akshan Anivia Annie AurelionSol Aurora Azir Brand Cassiopeia Chogath Corki Diana Ekko Fizz Galio Gangplank Gragas Heimerdinger Hwei Irelia Jayce Karma Karthus Kassadin Katarina Kayle Kennen KogMaw Leblanc Lissandra Lucian Lux Malphite Malzahar Mel Morgana Naafiri Neeko Orianna Pantheon Qiyana Rumble Ryze Seraphine Smolder Swain Sylas Syndra Taliyah Talon Tristana TwistedFate Varus Veigar Velkoz Vex Viktor Vladimir Xerath Yasuo Yone Zed Ziggs Zilean Zoe`,
 ADC: `Aphelios Ashe Caitlyn Corki Draven Ezreal Jhin Jinx Kaisa Kalista Kindred KogMaw Lucian MissFortune Nilah Samira Senna Seraphine Sivir Smolder Swain Tristana Twitch Varus Vayne Veigar Xayah Yasuo Ziggs`,
 Support: `Alistar Amumu Annie Ashe Bard Blitzcrank Brand Braum Fiddlesticks Galio Heimerdinger Hwei Ivern Janna Karma Leona Lissandra Lulu Lux Malphite Maokai Milio Morgana Nami Nautilus Neeko Pantheon Poppy Pyke Rakan Rell Renata Senna Seraphine Sett Shaco Shen Sona Soraka Swain TahmKench Taric Thresh Twitch Veigar Velkoz Xerath Yuumi Zac Zilean Zyra`
};
const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
const MEMBERS=Object.fromEntries(Object.entries(GROUPS).map(([role,names])=>[role,new Set(names.trim().split(/\s+/).map(norm))]));
export function rolesForChampion(champion){
 if(!champion)return [];
 const id=norm(champion.id),name=norm(champion.name);
 const manual=ROLE_NAMES.filter(r=>MEMBERS[r].has(id)||MEMBERS[r].has(name));
 if(manual.length)return manual;
 const tags=new Set((champion.tags||[]).map(x=>String(x).toLowerCase()));
 const roles=new Set();
 if(tags.has('fighter')){roles.add('Top');roles.add('Jungle');}
 if(tags.has('tank')){roles.add('Top');roles.add('Support');}
 if(tags.has('mage'))roles.add('Mid');
 if(tags.has('assassin')){roles.add('Mid');roles.add('Jungle');}
 if(tags.has('marksman'))roles.add('ADC');
 if(tags.has('support'))roles.add('Support');
 // Sans aucune donnée reconnue : choix libre plutôt que carte inutilisable.
 return roles.size?ROLE_NAMES.filter(r=>roles.has(r)):[...ROLE_NAMES];
}
const CDN='https://ddragon.leagueoflegends.com';
const RAW_KEYS={FlatHPPoolMod:'hp',FlatPhysicalDamageMod:'ad',FlatMagicDamageMod:'ap',FlatArmorMod:'armor',FlatSpellBlockMod:'mr'};
const KEYS=['hp','ad','ap','armor','mr'];
function normalizeItems(items){
 const seen=new Set();
 return (Array.isArray(items)?items:[]).map(it=>{
  const stats={};
  for(const k of KEYS){const n=Number(it.stats?.[k]);if(Number.isFinite(n)&&n>0)stats[k]=n;}
  return {id:String(it.id??''),name:String(it.name||it.id||''),cost:Number(it.cost)||0,stats,img:String(it.img||'')};
 }).filter(it=>{
  if(!it.id||it.cost<=0||!Object.keys(it.stats).length||seen.has(it.id))return false;
  seen.add(it.id);return true;
 }).sort((a,b)=>a.cost-b.cost);
}
async function json(url){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),10000);
 try{
  const res=await fetch(url,{signal:controller.signal,cache:'no-cache'});
  if(!res.ok)throw new Error(`HTTP ${res.status}`);
  return await res.json();
 }finally{clearTimeout(timer);}
}
export function itemsFromDataDragon(data,version){
 const result=[];
 for(const [id,it] of Object.entries(data||{})){
  if(it.gold?.purchasable!==true||!(it.gold.total>=200))continue;
  if(it.maps?.['11']!==true||it.inStore===false||it.hideFromAll===true)continue;
  if(it.requiredChampion||it.requiredAlly)continue;
  const stats={};
  for(const [key,dest] of Object.entries(RAW_KEYS)){
   const n=Number(it.stats?.[key]);if(Number.isFinite(n)&&n>0)stats[dest]=n;
  }
  result.push({id,name:it.name,cost:it.gold.total,stats,img:`${CDN}/cdn/${version}/img/item/${it.image?.full||id+'.png'}`});
 }
 return normalizeItems(result);
}
let remotePromise=null;
export async function loadBossItems(getLocalItems,force=false){
 if(!force){
  try{const local=normalizeItems(typeof getLocalItems==='function'?getLocalItems():[]);if(local.length)return local;}catch(e){console.warn('Catalogue local des boss :',e);}
 }
 if(force)remotePromise=null;
 if(!remotePromise){
  remotePromise=(async()=>{
   const versions=await json(`${CDN}/api/versions.json`);
   const version=versions?.[0];if(typeof version!=='string')throw new Error('Version Data Dragon introuvable.');
   let result;
   try{result=await json(`${CDN}/cdn/${version}/data/fr_FR/item.json`);}
   catch(frError){result=await json(`${CDN}/cdn/${version}/data/en_US/item.json`);}
   const items=itemsFromDataDragon(result.data,result.version||version);
   if(!items.length)throw new Error('Le fichier des objets a été reçu, mais aucun objet avec les statistiques prises en charge n’a été trouvé.');
   return items;
  })().catch(e=>{remotePromise=null;throw e;});
 }
 try{return await remotePromise;}
 catch(e){throw new Error(e.name==='AbortError'?'Chargement des objets trop long. Clique sur Actualiser pour réessayer.':`Impossible de charger les objets : ${e.message}`);}
}
