export const ESPORTS=Object.freeze({version:2,initialBoosters:10,maxBoosters:10,refillMs:10*60*1000,cardsPerBooster:5});
export const FINISHES=Object.freeze([
 Object.freeze({id:'base',label:'Classique',weight:80,rarity:'common',color:'#8a8f98'}),
 Object.freeze({id:'foil',label:'Holographique',weight:15,rarity:'rare',color:'#0397ab'}),
 Object.freeze({id:'prism',label:'Prismatique',weight:4,rarity:'epic',color:'#a335ee'}),
 Object.freeze({id:'prestige',label:'Prestige',weight:1,rarity:'legendary',color:'#ff8000'})
]);
const fail=m=>{throw new Error(m);};
const map=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const int=(x,label)=>{if(!Number.isSafeInteger(x)||x<0)fail(`${label} invalide. Aucune réinitialisation automatique.`);return x;};
const token=x=>typeof x==='string'&&/^[a-z0-9][a-z0-9-]{0,127}$/.test(x);
export function esportsCardKey(edition,playerId,finishId){if(![edition,playerId,finishId].every(token))fail('Identifiant de carte esport invalide.');return `${edition}:${playerId}:${finishId}`;}
export function parseEsportsKey(key){if(typeof key!=='string')return null;const p=key.split(':');return p.length===3&&p.every(token)?{edition:p[0],playerId:p[1],finishId:p[2]}:null;}
export function normaliseEsports(raw,now=Date.now()){
 int(now,'Date');
 if(raw===undefined||raw===null)return {version:2,revision:0,boosters:10,lastRefill:now,cards:{},obtained:{},opened:0};
 if(!map(raw)||![undefined,1,2].includes(raw.version))fail('Sauvegarde esport non reconnue ; aucune donnée remplacée.');
 if(!map(raw.cards)||(raw.obtained!==undefined&&!map(raw.obtained)))fail('Inventaire esport invalide ; aucune carte supprimée.');
 const r={...raw,version:2,revision:int(raw.revision??0,'Révision'),boosters:int(raw.boosters,'Stock'),lastRefill:int(raw.lastRefill,'Date de recharge'),opened:int(raw.opened??0,'Ouvertures'),cards:Object.fromEntries(Object.entries(raw.cards).map(([k,v])=>[k,int(v,'Quantité')])),obtained:{...(raw.obtained||{})}};
 // Migration de cadence seulement : conserver les cartes, compteurs et stocks existants.
 if(raw.version!==2){
  const earned=Math.floor(Math.max(0,now-r.lastRefill)/(30*60*1000));
  if(r.boosters<5)r.boosters=Math.min(5,r.boosters+earned);
  r.lastRefill=now;return r;
 }
 if(r.boosters>=10){r.lastRefill=now;return r;}
 const earned=Math.floor(Math.max(0,now-r.lastRefill)/ESPORTS.refillMs);
 if(earned>0){r.boosters=Math.min(10,r.boosters+earned);r.lastRefill=r.boosters===10?now:r.lastRefill+earned*ESPORTS.refillMs;}
 return r;
}
const sample=random=>{const x=random();if(!Number.isFinite(x)||x<0||x>=1)fail('Tirage aléatoire invalide.');return x;};
export function openEsportsBooster(raw,catalog,{now=Date.now(),random=Math.random}={}){
 if(!catalog||catalog.schema!==1||!token(catalog.edition)||!Array.isArray(catalog.players)||!catalog.players.length)fail('Catalogue esport vide ou invalide.');
 const ids=new Set();for(const p of catalog.players){if(!p||!token(p.id)||ids.has(p.id)||!p.handle)fail('Identifiant joueur invalide ou dupliqué.');ids.add(p.id);}
 const pool=catalog.players.filter(p=>p.boosterEligible!==false&&!p.archived);if(!pool.length)fail('Aucun joueur admissible dans les boosters de ce catalogue.');
 const state=normaliseEsports(raw,now);if(state.boosters<1)fail('Aucun booster esport disponible.');
 if(state.opened>=Number.MAX_SAFE_INTEGER||state.revision>=Number.MAX_SAFE_INTEGER)fail('Compteur esport trop élevé.');
 state.boosters--;state.opened++;state.revision++;const drawn=[];
 for(let i=0;i<5;i++){
  const p=pool[Math.floor(sample(random)*pool.length)];let x=sample(random)*100,f=FINISHES.at(-1);
  for(const candidate of FINISHES){x-=candidate.weight;if(x<0){f=candidate;break;}}
  const key=esportsCardKey(catalog.edition,p.id,f.id),before=state.cards[key]||0;if(before>=Number.MAX_SAFE_INTEGER)fail('Quantité de cartes trop élevée.');
  state.cards[key]=before+1;if(state.obtained[key]===undefined)state.obtained[key]=now;
  drawn.push({key,playerId:p.id,finishId:f.id,isNew:before===0});
 }
 return {state,drawn};
}
