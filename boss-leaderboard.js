import {doc,collection,query,where,getDocs} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

// Badges vectoriels originaux, pas les logos officiels de Riot.
const RANKS=[['Fer',0,'#9faaa8','#525d60'],['Bronze',25,'#e8ae76','#895330'],['Argent',65,'#e8f5ff','#809bb6'],['Or',125,'#ffe892','#c8952d'],['Platine',215,'#8bf4f2','#238c9f'],['Émeraude',345,'#92ffc2','#1c9b68'],['Diamant',525,'#bcecff','#5875df'],['Maître',765,'#e9b5ff','#8c44c5'],['Grand Maître',1085,'#ffb9be','#c52e53'],['Challenger',1485,'#fff1a6','#3272d4']];
const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const score=x=>Number.isFinite(Number(x))?Math.max(0,Math.floor(Number(x))):0;
const indexOf=p=>RANKS.reduce((n,r,i)=>score(p)>=r[1]?i:n,0);
let iconId=0;
export function bossRankIcon(points,size=36){
 const i=indexOf(points),[name,,light,dark]=RANKS[i],id=`boss-rank-${++iconId}`;
 const feathers=2+Math.floor(i/2),crown=i>=7;
 let wings='';
 for(let k=0;k<feathers;k++){
  const y=39+k*8,x=9-k;
  wings+=`<path d="M37 ${y+8} L${x} ${y-10} L${x+5} ${y+6} L38 ${y+15}Z M63 ${y+8} L${100-x} ${y-10} L${95-x} ${y+6} L62 ${y+15}Z" fill="url(#${id})" stroke="${dark}" stroke-width="1.5"/>`;
 }
 return `<svg class="boss-rank-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 110" width="${Number(size)||36}" height="${Math.round((Number(size)||36)*1.1)}" role="img" aria-label="${safe(name)}"><title>${safe(name)}</title><defs><linearGradient id="${id}" x2=".8" y2="1"><stop stop-color="${light}"/><stop offset="1" stop-color="${dark}"/></linearGradient></defs>${wings}<path d="M26 27L50 15L74 27L71 68L50 94L29 68Z" fill="#101d30" stroke="url(#${id})" stroke-width="5"/><path d="M50 28L64 49L50 77L36 49Z" fill="url(#${id})" stroke="${light}" stroke-width="2"/><path d="M50 28L50 77L36 49Z" fill="${light}" opacity=".35"/>${crown?`<path d="M29 23L25 6L42 16L50 2L58 16L75 6L71 23Z" fill="url(#${id})" stroke="${light}" stroke-width="1.5"/>`:''}<circle cx="50" cy="86" r="3" fill="${light}"/></svg>`;
}
export function upgradeBossGold(season,bosses){
 if(Number(season.goldRewardsVersion)>=3)return 0;
 // Les valeurs de BOSS doivent déjà avoir été multipliées par 3.
 const extra=bosses.filter(b=>season.cleared?.[b.id]).reduce((n,b)=>n+Math.round(b.gold*2/3),0);
 season.gold=(Number(season.gold)||0)+extra;
 season.goldRewardsVersion=3;
 return extra;
}
export function publishBossRank(tx,db,user,data){
 const s=data.bossSeason;if(!s||!user?.uid)return;
 const points=score(s.points);
 tx.set(doc(db,'rankedPlayers',user.uid),{
  mode:'boss-season-v1',week:s.week,name:String(user.displayName||'Joueur'),
  points,rank:RANKS[indexOf(points)][0],bosses:Object.values(s.cleared||{}).filter(Boolean).length,
  updatedAt:Date.now()
 });
}
const instances=new WeakMap();
export function initBossLeaderboard({db,user,week,root,onOpen=()=>{}}){
 if(instances.has(root))return instances.get(root);
 const bar=document.createElement('div'),panel=document.createElement('div');
 bar.className='boss-ranking-toolbar';panel.className='boss-ranking-panel';panel.hidden=true;
 bar.innerHTML='<button type="button" class="btn" data-show-boss-rank>🏆 Classement des chasseurs</button>';
 root.before(bar,panel);
 if(!document.getElementById('boss-ranking-style')){
  const style=document.createElement('style');style.id='boss-ranking-style';
  style.textContent=`.boss-ranking-toolbar{margin:12px 0}.boss-ranking-panel{padding:16px;margin:12px 0;border:1px solid #45627f;border-radius:14px;background:#131f30;color:#eaf1fc}.boss-ranking-panel[hidden]{display:none}.boss-ranking-table-wrap{overflow-x:auto}.boss-ranking-table{width:100%;border-collapse:collapse;min-width:470px}.boss-ranking-table th,.boss-ranking-table td{padding:10px 8px;text-align:left;border-bottom:1px solid #ffffff18}.boss-ranking-table tr.mine{background:#c9a24b24}.boss-ranking-cell{display:flex;align-items:center;gap:8px}.boss-rank-icon{display:inline-block;vertical-align:middle;flex-shrink:0}.boss-ranking-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.boss-ranking-name{overflow-wrap:anywhere}.boss-ranking-hint{opacity:.8;font-size:13px;line-height:1.5}`;
  document.head.appendChild(style);
 }
 let generation=0;
 async function load(){
  const n=++generation,me=user()?.uid,current=week();
  if(!me){panel.innerHTML='<p>Connecte-toi pour consulter le classement.</p>';return;}
  panel.innerHTML='<p>Chargement du classement hebdomadaire…</p>';
  try{
   const snap=await getDocs(query(collection(db,'rankedPlayers'),where('week','==',current)));
   if(n!==generation||user()?.uid!==me)return;
   const players=snap.docs.map(d=>({...d.data(),uid:d.id})).filter(p=>p.mode==='boss-season-v1').map(p=>({...p,points:score(p.points),bosses:score(p.bosses)})).sort((a,b)=>b.points-a.points||String(a.name).localeCompare(String(b.name),'fr')||a.uid.localeCompare(b.uid));
   let previous=null,position=0;
   players.forEach((p,i)=>{if(previous!==p.points)position=i+1;p.position=position;previous=p.points;});
   const own=players.find(p=>p.uid===me),list=players.slice(0,100);
   panel.innerHTML=`<div class="boss-ranking-actions"><h3 style="margin:0 auto 0 0">Classement PvE · semaine du ${safe(current)}</h3><button class="btn" data-boss-rank-refresh>Actualiser</button><button class="btn" data-boss-rank-close>Fermer</button></div><p>${players.length} joueur(s)${own?` · Ta place : ${own.position}${own.position===1?'er':'e'} · ${own.points} points`:" · Ouvre Chasse aux boss pour publier ton score."}</p><div class="boss-ranking-table-wrap"><table class="boss-ranking-table"><thead><tr><th>Place</th><th>Joueur</th><th>Rang</th><th>Points</th><th>Boss</th></tr></thead><tbody>${list.map(p=>`<tr class="${p.uid===me?'mine':''}"><td>${p.position}</td><td class="boss-ranking-name">${safe(p.name)}</td><td><span class="boss-ranking-cell">${bossRankIcon(p.points,34)}${RANKS[indexOf(p.points)][0]}</span></td><td>${p.points}</td><td>${p.bosses}</td></tr>`).join('')||'<tr><td colspan="5">Aucun score publié pour cette semaine.</td></tr>'}</tbody></table></div><p class="boss-ranking-hint">100 premières lignes affichées. Les égalités de points partagent la même place. Les scores sont publiés à l’ouverture et lors des actions dans Chasse aux boss. Les anciennes semaines ne sont pas mélangées à celle-ci.</p>`;
  }catch(e){if(n!==generation)return;panel.innerHTML=`<p>Classement indisponible : ${safe(e.message)}</p><button class="btn" data-boss-rank-refresh>Réessayer</button><button class="btn" data-boss-rank-close>Fermer</button>`;}
 }
 function close(){generation++;panel.hidden=true;panel.innerHTML='';}
 bar.addEventListener('click',()=>{if(panel.hidden){onOpen();panel.hidden=false;void load();}else close();});
 panel.addEventListener('click',e=>{if(e.target.closest('[data-boss-rank-close]'))close();else if(e.target.closest('[data-boss-rank-refresh]'))void load();});
 const controller={close,refresh:load};instances.set(root,controller);return controller;
}
