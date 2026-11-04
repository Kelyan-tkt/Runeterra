// Moteur autonome : ne reçoit et ne renvoie que le champ users/{uid}.esports.
export const ESPORTS = Object.freeze({version:1,initialBoosters:3,maxBoosters:5,refillMs:30*60*1000,cardsPerBooster:5});
export const FINISHES = Object.freeze([
 Object.freeze({id:'base',label:'Classique',weight:80}),
 Object.freeze({id:'foil',label:'Holographique',weight:15}),
 Object.freeze({id:'prism',label:'Prismatique',weight:4}),
 Object.freeze({id:'prestige',label:'Prestige',weight:1})
]);
const fail=message=>{throw new Error(message);};
const isMap=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const integer=(value,label)=>{if(!Number.isSafeInteger(value)||value<0)fail(`${label} invalide. Aucune réinitialisation automatique n’a été effectuée.`);return value;};
const time=value=>{if(!Number.isSafeInteger(value)||value<0)fail('Horodatage esport invalide.');return value;};
const token=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9-]{0,127}$/.test(value);
export function esportsCardKey(edition,playerId,finishId){
 if(!token(edition)||!token(playerId)||!token(finishId))fail('Identifiant de carte esport invalide.');
 return `${edition}:${playerId}:${finishId}`;
}
export function parseEsportsKey(key){
 if(typeof key!=='string')return null;
 const parts=key.split(':');if(parts.length!==3||!parts.every(token))return null;
 return {edition:parts[0],playerId:parts[1],finishId:parts[2]};
}
export function normaliseEsports(raw,now=Date.now()){
 time(now);
 if(raw===null||raw===undefined)return {version:1,revision:0,boosters:ESPORTS.initialBoosters,lastRefill:now,cards:{},obtained:{},opened:0};
 if(!isMap(raw)||(raw.version!==undefined&&raw.version!==1))fail('Version de sauvegarde esport non reconnue. Aucune donnée n’a été remplacée.');
 const boosters=integer(raw.boosters,'Stock de boosters'),lastRefill=time(raw.lastRefill);
 if(!isMap(raw.cards))fail('Inventaire esport invalide. Aucune carte n’a été supprimée.');
 const cards=Object.fromEntries(Object.entries(raw.cards).map(([key,quantity])=>{integer(quantity,'Quantité de cartes');return [key,quantity];}));
 if(raw.obtained!==undefined&&!isMap(raw.obtained))fail('Dates d’obtention esport invalides.');
 const obtained={...(raw.obtained||{})};
 const result={...raw,version:1,revision:integer(raw.revision??0,'Révision'),boosters,lastRefill,cards,obtained,opened:integer(raw.opened??0,'Nombre d’ouvertures')};
 // Conserver aussi les éventuelles cartes d'anciennes éditions et les stocks bonus.
 if(result.boosters>=ESPORTS.maxBoosters){result.lastRefill=now;return result;}
 const elapsed=Math.max(0,now-result.lastRefill),gained=Math.floor(elapsed/ESPORTS.refillMs);
 if(gained>0){result.boosters=Math.min(ESPORTS.maxBoosters,result.boosters+gained);result.lastRefill=result.boosters===ESPORTS.maxBoosters?now:result.lastRefill+gained*ESPORTS.refillMs;}
 return result;
}
function sample(random){const value=random();if(!Number.isFinite(value)||value<0||value>=1)fail('Générateur de tirage invalide.');return value;}
export function openEsportsBooster(raw,catalog,{now=Date.now(),random=Math.random}={}){
 if(!catalog||catalog.schema!==1||!token(catalog.edition)||!Array.isArray(catalog.players)||!catalog.players.length)fail('Catalogue esport invalide ou vide.');
 const ids=new Set();
 for(const player of catalog.players){if(!player||!token(player.id)||ids.has(player.id)||typeof player.handle!=='string'||!player.handle.trim())fail('Catalogue esport : joueur invalide ou identifiant en double.');ids.add(player.id);}
 const state=normaliseEsports(raw,now);
 if(state.boosters<1)fail('Aucun booster esport disponible.');
 if(state.opened>=Number.MAX_SAFE_INTEGER||state.revision>=Number.MAX_SAFE_INTEGER)fail('Compteur esport trop élevé.');
 state.boosters--;state.opened++;state.revision++;
 const drawn=[],weight=FINISHES.reduce((sum,finish)=>sum+finish.weight,0);
 for(let i=0;i<ESPORTS.cardsPerBooster;i++){
  const player=catalog.players[Math.floor(sample(random)*catalog.players.length)];
  let roll=sample(random)*weight,finish=FINISHES[FINISHES.length-1];
  for(const candidate of FINISHES){roll-=candidate.weight;if(roll<0){finish=candidate;break;}}
  const key=esportsCardKey(catalog.edition,player.id,finish.id),before=state.cards[key]||0;
  if(before>=Number.MAX_SAFE_INTEGER)fail('Quantité de cartes trop élevée.');
  state.cards[key]=before+1;
  if(state.obtained[key]===undefined)state.obtained[key]=now;
  drawn.push({key,playerId:player.id,finishId:finish.id,isNew:before===0});
 }
 return {state,drawn};
}
