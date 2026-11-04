// Node.js 20+ ; exécution locale uniquement. Ne jamais mettre le jeton dans ce fichier.
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const clone=value=>JSON.parse(JSON.stringify(value));
const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const roleNames={top:'Top',jungle:'Jungle',jun:'Jungle',jungler:'Jungle',mid:'Mid',middle:'Mid',adc:'ADC',adcarry:'ADC',bot:'ADC',bottom:'ADC',support:'Support',sup:'Support'};
const validId=id=>typeof id==='string'&&/^[a-z0-9][a-z0-9-]{0,127}$/.test(id);
function imageUrl(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password)return '';u.searchParams.delete('token');u.searchParams.delete('access_token');return u.href;}catch{return '';}}
function hasPortrait(photo){
 if(!photo||!imageUrl(photo.url))return false;
 if(photo.provider==='pandascore')return photo.source==='https://www.pandascore.co/';
 return /^https:\/\/(upload\.wikimedia\.org\/|commons\.wikimedia\.org\/wiki\/Special:FilePath\/)/i.test(photo.url)&&/^https:\/\/commons\.wikimedia\.org\//i.test(photo.source||'')&&Boolean(photo.author)&&/^(CC BY(?:-SA)? [\d.]+|CC0(?: [\d.]+)?|Public domain)$/i.test(photo.license||'');
}
export function buildPandaCatalogue(previous,records,now=new Date().toISOString()){
 if(!previous||previous.schema!==1||!validId(previous.edition)||!Array.isArray(previous.players))throw new Error('Le catalogue existant est invalide : aucun remplacement.');
 const result=clone(previous),players=result.players,ids=new Set();
 for(const p of players){if(!validId(p.id)||ids.has(p.id)||!p.handle||!Array.isArray(p.roles))throw new Error('Identifiants du catalogue existant invalides ou en double.');ids.add(p.id);p.archived=true;p.boosterEligible=false;}
 const upstream=new Map();
 for(const item of records){if(!Number.isSafeInteger(item?.id)||item.id<1||typeof item.name!=='string'||!item.name.trim())continue;upstream.set(item.id,item);}
 if(upstream.size===0)throw new Error('PandaScore n’a renvoyé aucun joueur valide : catalogue inchangé.');
 let created=0,matched=0;
 for(const item of upstream.values()){
  const direct=players.filter(p=>Number(p.pandascoreId)===item.id);
  if(direct.length>1)throw new Error('Un identifiant PandaScore est attribué à plusieurs cartes. Aucun remplacement.');
  let p=direct[0];
  if(!p){const matches=players.filter(p=>!p.pandascoreId&&norm(p.handle)===norm(item.name));if(matches.length===1)p=matches[0];}
  if(!p){const id='ps-'+item.id;if(ids.has(id))throw new Error('Collision d’identifiants : '+id);p={id,handle:item.name.trim(),roles:[]};players.push(p);ids.add(id);created++;}else matched++;
  p.pandascoreId=item.id;p.provider='pandascore';p.archived=false;
  p.providerName=item.name.trim();p.providerSlug=String(item.slug||'');
  const role=roleNames[norm(item.role||item.position||'')];p.roles=[...new Set([...(p.roles||[]),...(role?[role]:[])])];
  if(typeof item.nationality==='string')p.nationality=item.nationality;
  p.sourceUrl='https://www.pandascore.co/';
  const url=imageUrl(item.image_url);
  if(url)p.photo={provider:'pandascore',url,source:'https://www.pandascore.co/',credit:'Portrait transmis par PandaScore. Photographe et droits : voir les conditions du fournisseur.',license:'Conditions du fournisseur',licenseUrl:'https://www.pandascore.co/'};
  // Aucune équipe actuelle déduite d'un champ obsolète, aucune photo inventée.
  p.boosterEligible=hasPortrait(p.photo);
 }
 const active=players.filter(p=>!p.archived),eligible=active.filter(p=>p.boosterEligible),archived=players.filter(p=>p.archived);
 if(eligible.length===0)throw new Error('Aucun portrait utilisable dans les données reçues. Le catalogue existant ne sera pas remplacé.');
 result.players=players.sort((a,b)=>a.handle.localeCompare(b.handle,'fr')||a.id.localeCompare(b.id));
 result.description='Joueurs référencés par PandaScore, actifs ou anciens selon la couverture du fournisseur. Les portraits disponibles servent aux boosters ; les cartes déjà distribuées restent conservées. Ce n’est pas une liste garantie exhaustive de tous les professionnels.';
 result.sources=[...new Set([...(result.sources||[]),'https://developers.pandascore.co/reference/get_lol_players'])];
 result.importStatus={provider:'pandascore',updatedAt:now,complete:false,providerPaginationComplete:true,total:players.length,providerPlayers:active.length,eligiblePlayers:eligible.length,archivedPlayers:archived.length,added:created,matched,
  message:`Import PandaScore paginé : ${active.length} joueurs, ${eligible.length} avec portrait admis au tirage. ${archived.length} anciennes fiches conservées mais retirées des boosters. L’import ne garantit pas l’exhaustivité mondiale ni les droits de chaque portrait.`};
 result.attribution={text:'Données et portraits PandaScore selon les conditions du fournisseur. Les portraits Wikimedia conservés gardent leurs propres crédits et licences. Les anciennes fiches conservent leurs liens de source.',url:'https://www.pandascore.co/'};
 return result;
}
export async function fetchPandaPlayers(token,{fetchImpl=fetch,sleep=wait,delayMs=4000,onPage=()=>{}}={}){
 if(!token||typeof token!=='string')throw new Error('Jeton PandaScore absent. Définis PANDASCORE_TOKEN localement.');
 const players=new Map();
 for(let page=1;page<=500;page++){
  if(page>1)await sleep(delayMs);
  const url=new URL('https://api.pandascore.co/lol/players');url.searchParams.set('page',String(page));url.searchParams.set('per_page','100');url.searchParams.set('sort','id');url.searchParams.set('token',token);
  let response;
  for(let attempt=0;attempt<5;attempt++){
   try{response=await fetchImpl(url,{headers:{Accept:'application/json'},signal:AbortSignal.timeout(30000)});}catch{if(attempt===4)throw new Error('Connexion à PandaScore impossible. Aucun catalogue remplacé.');await sleep(4000*(attempt+1));continue;}
   if(response.status===401)throw new Error('PandaScore : jeton refusé (401). Vérifie PANDASCORE_TOKEN.');
   if(response.status===403)throw new Error('PandaScore : accès refusé (403). Vérifie les droits de ton compte.');
   if(response.status===429||response.status>=500){if(attempt===4)throw new Error('PandaScore temporairement indisponible ou limite atteinte. Réessaie plus tard.');const seconds=Number(response.headers?.get('Retry-After'));await sleep(Math.min(90000,Math.max(4000,Number.isFinite(seconds)&&seconds>0?seconds*1000:5000*(attempt+1))));continue;}
   if(!response.ok)throw new Error('PandaScore : erreur HTTP '+response.status+'. Aucun catalogue remplacé.');
   break;
  }
  if(!response?.ok)throw new Error('Import incomplet : aucun catalogue remplacé.');
  let rows;try{rows=await response.json();}catch{throw new Error('Réponse JSON PandaScore invalide.');}
  if(!Array.isArray(rows))throw new Error('Format de réponse PandaScore inattendu.');
  let added=0;
  for(const p of rows)if(Number.isSafeInteger(p?.id)&&p.id>0){if(!players.has(p.id))added++;players.set(p.id,p);}
  onPage(page,players.size);
  if(rows.length<100)return [...players.values()];
  if(added===0)throw new Error('La pagination répète les mêmes joueurs : catalogue non remplacé.');
 }
 throw new Error('Limite de pagination atteinte : import incomplet, catalogue non remplacé.');
}
async function main(){
 const token=process.env.PANDASCORE_TOKEN?.trim();
 if(!token)throw new Error('Définis PANDASCORE_TOKEN dans ton terminal. Ne publie jamais ce jeton.');
 const file=new URL('./esports-catalog.json',import.meta.url),original=await fs.readFile(file,'utf8');
 let previous;try{previous=JSON.parse(original);}catch{throw new Error('esports-catalog.json invalide.');}
 console.log('Import PandaScore en cours. Le jeton ne sera pas écrit dans les fichiers.');
 const records=await fetchPandaPlayers(token,{onPage:(page,count)=>console.log(`Page ${page} : ${count} joueurs reçus.`)});
 const result=buildPandaCatalogue(previous,records);
 const output=JSON.stringify(result,null,2)+'\n';
 if(output.includes(token))throw new Error('Protection : une donnée contient le jeton. Aucun fichier remplacé.');
 const current=await fs.readFile(file,'utf8');if(current!==original)throw new Error('Le catalogue a été modifié pendant l’import : aucun remplacement.');
 const hash=createHash('sha256').update(original).digest('hex').slice(0,10),stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const backup=new URL(`./esports-catalog.backup-${stamp}-${hash}.json`,import.meta.url),temporary=new URL('./.esports-catalog-panda.tmp',import.meta.url);
 await fs.writeFile(backup,original,{flag:'wx'});
 try{await fs.writeFile(temporary,output,{flag:'wx'});await fs.rename(temporary,file);}catch(error){await fs.unlink(temporary).catch(()=>{});throw new Error('Écriture impossible. Le catalogue précédent et sa sauvegarde sont conservés.');}
 console.log(`Terminé : ${result.importStatus.providerPlayers} joueurs PandaScore, ${result.importStatus.eligiblePlayers} joueurs tirables avec portrait, ${result.importStatus.archivedPlayers} anciennes fiches archivées. Sauvegarde créée à côté du catalogue.`);
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)main().catch(error=>{console.error(error.message);process.exitCode=1;});
