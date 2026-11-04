import {collection,query,where,onSnapshot} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
const H=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const score=x=>Number.isFinite(Number(x))?Math.max(0,Math.floor(Number(x))):0;
const labels={
 general:['Souverain des collections','Grand collectionneur','Élite des collections'],
 mythic:['Monarque mythique','Gardien des mythiques','Chasseur mythique d’élite'],
 ranked:['Souverain de l’arène','Champion de l’arène','Élite de l’arène']
};
export const PODIUM_TITLES=Object.freeze(Object.entries(labels).flatMap(([family,names])=>names.map((label,i)=>Object.freeze({id:`podium_${family}_${i+1}`,label,family,place:i+1,podium:true}))));
export function collectionRanking(players,key){
 return players.filter(p=>score(p[key])>0).map(p=>({...p,[key]:score(p[key]),total:score(p.total)}))
  .sort((a,b)=>b[key]-a[key]||b.total-a.total||String(a.name).localeCompare(String(b.name),'fr')||String(a.uid).localeCompare(String(b.uid)))
  .map((p,i)=>({...p,position:i+1}));
}
export function bossPodiumRanking(players,currentWeek){
 const sorted=players.filter(p=>p.mode==='boss-season-v1'&&p.week===currentWeek&&score(p.points)>0)
  .map(p=>({...p,points:score(p.points)})).sort((a,b)=>b.points-a.points||String(a.name).localeCompare(String(b.name),'fr')||String(a.uid).localeCompare(String(b.uid)));
 let previous=null,position=0;
 return sorted.map((p,i)=>{if(p.points!==previous)position=i+1;previous=p.points;return {...p,position};});
}
let positions={general:new Map(),mythic:new Map(),ranked:new Map()},byUid=new Map();
let session=null,collectionRows=[],rankedRows=[],collectionReady=false,rankedReady=false,currentWeek='',epoch=0,stopCollection=null,stopRanked=null,timer=null;
function weekNow(){try{return String(session?.week?.()||'');}catch{return '';}}
export function podiumPlayers(){return collectionReady?collectionRows.slice():null;}
export function podiumRankedPlayers(){return rankedReady&&weekNow()===currentWeek?rankedRows.slice():null;}
const changeListeners=new Set();
export function subscribePodiumChanges(callback){changeListeners.add(callback);return()=>changeListeners.delete(callback);}
export function podiumPlayer(uid){return byUid.get(uid)||null;}
export function podiumPosition(uid,family){
 if(!uid||!session||session.user?.()?.uid!==session.uid)return 0;
 if(family==='ranked'){
  if(!rankedReady||weekNow()!==currentWeek)return 0;
  return positions.ranked.get(uid)||0;
 }
 if(!collectionReady||!['general','mythic'].includes(family))return 0;
 return positions[family].get(uid)||0;
}
export function podiumTitleAvailable(id,uid){const title=PODIUM_TITLES.find(t=>t.id===id);return Boolean(title&&podiumPosition(uid,title.family)===title.place);}
export function activePodiumTitle(uid,id){return podiumTitleAvailable(id,uid)?PODIUM_TITLES.find(t=>t.id===id):null;}
export function applyPodiumEffect(element,uid,id){
 if(!element)return;
 for(const cls of [...element.classList])if(cls==='podium-fx'||cls.startsWith('podium-family-')||cls.startsWith('podium-place-'))element.classList.remove(cls);
 const title=activePodiumTitle(uid,id);
 if(title)element.classList.add('podium-fx',`podium-family-${title.family}`,`podium-place-${title.place}`);
}
function identityInner(player){
 const selected=podiumPlayer(player.uid)?.profile?.title??player.profile?.title??'';
 const title=activePodiumTitle(player.uid,selected);
 const fx=title?` podium-fx podium-family-${title.family} podium-place-${title.place}`:'';
 return `<span class="r-name${fx}">${H(player.name)}</span>${title?`<small class="podium-rank-title${fx}">${H(title.label)}</small>`:''}`;
}
export function podiumIdentityHTML(player){return `<span class="podium-identity" data-podium-identity="${H(player.uid)}" data-podium-name="${H(player.name)}">${identityInner(player)}</span>`;}
export function refreshPodiumIdentities(){
 if(typeof document==='undefined')return;
 for(const el of document.querySelectorAll('[data-podium-identity]')){
  const html=identityInner({uid:el.dataset.podiumIdentity,name:el.dataset.podiumName||''});
  if(el.innerHTML!==html)el.innerHTML=html;
 }
}
function notify(){refreshPodiumIdentities();for(const callback of changeListeners){try{callback();}catch(e){console.warn('Affichage podium :',e.message);}}try{session?.onChange?.();}catch(e){console.warn('Affichage des titres de podium :',e.message);}}
function subscribeRanked(){
 stopRanked?.();stopRanked=null;rankedRows=[];positions.ranked.clear();rankedReady=false;currentWeek=weekNow();notify();
 const token=epoch,week=currentWeek;if(!session||!week)return;
 stopRanked=onSnapshot(query(collection(session.db,'rankedPlayers'),where('week','==',week)),snap=>{
  if(token!==epoch||week!==currentWeek)return;
  rankedRows=snap.docs.map(d=>({...d.data(),uid:d.id}));positions.ranked=new Map(bossPodiumRanking(rankedRows,currentWeek).map(p=>[p.uid,p.position]));rankedReady=true;notify();
 },error=>{if(token===epoch&&week===currentWeek){rankedRows=[];positions.ranked.clear();rankedReady=false;console.warn('Podium ranked :',error.message);notify();}});
}
export function stopPodiumTracking(){
 epoch++;stopCollection?.();stopRanked?.();stopCollection=stopRanked=null;
 if(timer!==null)clearInterval(timer);timer=null;
 byUid.clear();for(const map of Object.values(positions))map.clear();
 session=null;collectionRows=[];rankedRows=[];collectionReady=rankedReady=false;currentWeek='';
 refreshPodiumIdentities();
}
export function startPodiumTracking(api){
 const uid=api.user?.()?.uid;if(!uid){stopPodiumTracking();return;}
 if(session?.uid===uid&&session.db===api.db){session={...api,uid};if(weekNow()!==currentWeek)subscribeRanked();return;}
 stopPodiumTracking();session={...api,uid};const token=epoch;
 stopCollection=onSnapshot(collection(api.db,'leaderboard'),snap=>{
  if(token!==epoch||session?.user?.()?.uid!==uid)return;
  collectionRows=snap.docs.map(d=>({...d.data(),uid:d.id}));byUid=new Map(collectionRows.map(p=>[p.uid,p]));positions.general=new Map(collectionRanking(collectionRows,'unique').map(p=>[p.uid,p.position]));positions.mythic=new Map(collectionRanking(collectionRows,'mythic').map(p=>[p.uid,p.position]));collectionReady=true;notify();
 },error=>{if(token===epoch){collectionRows=[];byUid.clear();positions.general.clear();positions.mythic.clear();collectionReady=false;console.warn('Podiums de collection :',error.message);notify();}});
 subscribeRanked();
 timer=setInterval(()=>{if(!session)return;if(session.user?.()?.uid!==uid){stopPodiumTracking();return;}if(weekNow()!==currentWeek)subscribeRanked();},5000);
}
