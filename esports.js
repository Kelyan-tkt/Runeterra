import {doc,runTransaction,onSnapshot} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
import {ESPORTS,FINISHES,normaliseEsports,openEsportsBooster,esportsCardKey,parseEsportsKey} from './esports-engine.js?v=pro-2';
import {fetchPlayerPortrait} from './esports-portraits.js?v=pro-1';
const H=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const checkedHref=url=>{try{const u=new URL(url);return u.protocol==='https:'?H(u.href):'';}catch{return '';}};
export async function installEsports(api){
 const main=document.getElementById('gameView'),nav=main?.querySelector('nav');
 if(!main||!nav)throw new Error('Navigation du site introuvable.');
 const response=await fetch(new URL('./esports-catalog.json?v=pro-1',import.meta.url),{signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new Error('Catalogue esport introuvable.');const catalog=await response.json();
 if(catalog.schema!==1||!Array.isArray(catalog.players)||!catalog.players.length||!/^[a-z0-9][a-z0-9-]{0,127}$/.test(catalog.edition||''))throw new Error('Catalogue esport invalide.');
 const ids=new Set();for(const p of catalog.players){if(!/^[a-z0-9-]+$/.test(p.id)||ids.has(p.id)||!p.handle||!p.wikipedia)throw new Error('Joueur esport invalide ou identifiant dupliqué.');ids.add(p.id);}
 const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./esports.css?v=pro-1',import.meta.url).href;document.head.appendChild(link);
 const navButton=document.createElement('button');navButton.type='button';navButton.dataset.tab='esports';navButton.textContent='Esport';nav.appendChild(navButton);
 const root=document.createElement('section');root.id='tab-esports';root.hidden=true;main.appendChild(root);
 const reveal=document.createElement('dialog');reveal.className='pro-dialog';reveal.id='proReveal';document.body.appendChild(reveal);
 const detail=document.createElement('dialog');detail.className='pro-dialog';detail.id='proDetail';document.body.appendChild(detail);
 let uid=null,progress=null,busy=false,error='',unsubscribe=null,epoch=0,lastDraw=[],revealed=0,q='',role='',finish='',onlyOwned=false,detailKey='',initPending=null;
 const photos=new Map(),queued=new Set();let photoRunning=0;const photoQueue=[];
 const count=key=>progress?.cards?.[key]||0;
 function photoHTML(player){
  const photo=photos.get(player.id);return photo?`<img loading="lazy" referrerpolicy="no-referrer" src="${H(photo.url)}" alt="Portrait de ${H(player.handle)}" data-pro-photo-img>`:`<span class="pro-monogram" aria-label="Portrait non disponible">${H(player.handle.slice(0,2).toUpperCase())}</span>`;
 }
 function photoBox(player){return `<span class="pro-photo" data-pro-portrait="${H(player.id)}">${photoHTML(player)}</span>`;}
 function refreshPhotos(){for(const el of document.querySelectorAll('[data-pro-portrait]')){const player=catalog.players.find(p=>p.id===el.dataset.proPortrait);if(player&&photos.get(player.id))el.innerHTML=photoHTML(player);}if(detail.open&&detailKey)showDetail(detailKey);}
 function pumpPhotos(){while(photoRunning<2&&photoQueue.length){const player=photoQueue.shift();photoRunning++;fetchPlayerPortrait(player).then(photo=>{photos.set(player.id,photo);refreshPhotos();}).catch(()=>{photos.set(player.id,null);}).finally(()=>{photoRunning--;pumpPhotos();});}}
 function requestPhotos(){for(const el of document.querySelectorAll('#tab-esports [data-pro-portrait],.pro-dialog[open] [data-pro-portrait]')){const player=catalog.players.find(p=>p.id===el.dataset.proPortrait);if(player&&!queued.has(player.id)){queued.add(player.id);photoQueue.push(player);}}pumpPhotos();}
 function cardHTML(player,f,{isNew=false,revealIndex=null}={}){
  const key=esportsCardKey(catalog.edition,player.id,f.id),quantity=count(key);
  return `<button type="button" class="pro-card pro-${f.id}" ${revealIndex===null?`data-pro-card="${H(key)}"`:`data-pro-flip="${revealIndex}"`} aria-label="${H(player.handle)}, ${H(f.label)}"><span class="pro-finish">${H(f.label)}</span>${isNew?'<span class="pro-new">Nouveau</span>':''}${quantity>1?`<span class="pro-qty">×${quantity}</span>`:''}${photoBox(player)}<span class="pro-name">${H(player.handle)}</span><span class="pro-role">${H((player.roles||[]).join(' / ')||'Joueur pro')}</span><small>${H(catalog.title)}</small></button>`;
 }
 function render(){
  if(root.hidden)return;
  if(!api.user()){root.innerHTML='<p>Connecte-toi pour accéder à l’esport.</p>';return;}
  let view=null;try{view=progress?normaliseEsports(progress):null;}catch(e){error=e.message;}
  const ownedKeys=Object.keys(progress?.cards||{}).filter(k=>count(k)>0),playersOwned=new Set(ownedKeys.map(k=>parseEsportsKey(k)?.playerId).filter(Boolean));
  const filterPlayers=catalog.players.filter(p=>(!q||norm(p.handle).includes(norm(q)))&&(!role||(p.roles||[]).includes(role)));
  const list=[];for(const player of filterPlayers){const choices=finish?FINISHES.filter(f=>f.id===finish):FINISHES;
   if(finish){for(const f of choices)if(!onlyOwned||count(esportsCardKey(catalog.edition,player.id,f.id))>0)list.push({player,f});}
   else{const owned=FINISHES.filter(f=>count(esportsCardKey(catalog.edition,player.id,f.id))>0);if(onlyOwned&&!owned.length)continue;list.push({player,f:owned.at(-1)||FINISHES[0]});}}
  root.innerHTML=`<header class="pro-hero"><p>Nouvelle collection indépendante</p><h2>Collection Esport</h2><p>${H(catalog.description)}</p><small>Cartes de fan non officielles. Les finitions sont des variantes visuelles, pas une note du niveau du joueur.</small></header>
  <div class="pro-top"><div class="pro-pack"><span class="pro-pack-emblem" aria-hidden="true">✦</span><h3>Booster Esport</h3><p>Cinq cartes · ${H(catalog.title)}</p><p><b data-pro-stock>${view?.boosters??'…'} / ${ESPORTS.maxBoosters}</b> boosters</p><p data-pro-timer>Chargement…</p><button type="button" class="btn-play" data-pro-action="open" ${busy||!view||view.boosters<1?'disabled':''}>${busy?(!progress?'Chargement…':'Ouverture…'):'Ouvrir un booster esport'}</button></div>
  <div class="pro-info"><h3>Une collection à part</h3><p>Trois boosters de départ, puis un toutes les trente minutes, jusqu’à cinq en réserve. Ils ne consomment pas tes boosters de champions.</p><p>${playersOwned.size} joueurs obtenus · ${ownedKeys.length} variantes possédées · ${progress?.opened||0} boosters ouverts.</p><ul>${FINISHES.map(f=>`<li>${H(f.label)} : ${String(f.weight).replace('.',',')} % par carte</li>`).join('')}</ul><p>Choisis une carte pour consulter ses variantes et les crédits de sa photo.</p><p>Vitrine, échanges et recyclage esport ne sont pas inclus dans cette première version.</p>${lastDraw.length?'<button type="button" class="btn" data-pro-action="last">Revoir le dernier booster</button>':''}</div></div>
  <p class="pro-error" role="status" aria-live="polite">${H(error)}</p>${error&&!progress?`<button type="button" class="btn" data-pro-action="retry" ${busy?'disabled':''}>Réessayer le chargement</button>`:''}
  <div class="pro-filters"><input type="search" data-pro-search placeholder="Chercher un joueur…" value="${H(q)}"><select data-pro-role><option value="">Tous les rôles</option>${['Top','Jungle','Mid','ADC','Support'].map(r=>`<option ${role===r?'selected':''}>${r}</option>`).join('')}</select><select data-pro-finish><option value="">Toutes les finitions</option>${FINISHES.map(f=>`<option value="${f.id}" ${finish===f.id?'selected':''}>${H(f.label)}</option>`).join('')}</select><label><input type="checkbox" data-pro-owned ${onlyOwned?'checked':''}> Possédés seulement</label></div>
  <div class="pro-grid">${list.map(({player,f})=>cardHTML(player,f)).join('')||'<p>Aucun joueur ne correspond aux filtres.</p>'}</div><p class="pro-footnote">Portraits : Wikimedia Commons, uniquement si les métadonnées indiquent une licence admise et un auteur. Les crédits et la licence figurent dans la fiche. Sinon, le pseudo est affiché sans photo. Certaines photos sont anciennes ; elles n’indiquent pas une équipe actuelle.</p>`;
  tick();requestPhotos();
 }
 function tick(){const el=root.querySelector('[data-pro-timer]');if(!el||!progress)return;let v;try{v=normaliseEsports(progress);}catch{return;}
  const stock=root.querySelector('[data-pro-stock]');if(stock)stock.textContent=`${v.boosters} / ${ESPORTS.maxBoosters}`;
  el.textContent=v.boosters>=ESPORTS.maxBoosters?'Réserve pleine':`Prochain booster : ${Math.max(1,Math.ceil((ESPORTS.refillMs-(Date.now()-v.lastRefill))/60000))} min`;
  const b=root.querySelector('[data-pro-action="open"]');if(b)b.disabled=busy||v.boosters<1;
 }
 function showReveal(){
  reveal.innerHTML=`<header class="pro-dialog-head"><h2>Ton booster esport</h2><button type="button" class="btn" data-pro-close>Fermer</button></header><p data-pro-reveal-status>Clique sur une carte pour la révéler.</p><div class="pro-reveal-cards">${lastDraw.map((draw,i)=>{const player=catalog.players.find(p=>p.id===draw.playerId),f=FINISHES.find(f=>f.id===draw.finishId);return i<revealed?cardHTML(player,f,{isNew:draw.isNew,revealIndex:i}):`<button type="button" class="pro-back" data-pro-flip="${i}" aria-label="Révéler la carte ${i+1}"><span>R</span><small>ESPORT</small></button>`;}).join('')}</div><button type="button" class="btn-play" data-pro-all ${revealed===lastDraw.length?'hidden':''}>Tout révéler</button><p class="pro-footnote">Les cartes sont déjà sauvegardées : fermer cette fenêtre ne les fait pas perdre.</p>`;
  if(!reveal.open)reveal.showModal();requestPhotos();
 }
 function showDetail(key){
  detailKey=key;
  const parsed=parseEsportsKey(key),player=catalog.players.find(p=>p.id===parsed?.playerId),f=FINISHES.find(f=>f.id===parsed?.finishId);if(!player||!f)return;
  const photo=photos.get(player.id),wiki='https://en.wikipedia.org/wiki/'+encodeURIComponent(player.wikipedia.replaceAll(' ','_'));
  detail.innerHTML=`<header class="pro-dialog-head"><h2>${H(player.handle)}</h2><button type="button" class="btn" data-pro-close>Fermer</button></header><div class="pro-detail">${cardHTML(player,f)}<div><h3>Variantes de cette édition</h3><ul>${FINISHES.map(x=>`<li>${H(x.label)} : ${count(esportsCardKey(catalog.edition,player.id,x.id))} exemplaire(s)</li>`).join('')}</ul><p>Rôles de carrière : ${H((player.roles||[]).join(' / '))}.</p><p><a href="${checkedHref(wiki)}" target="_blank" rel="noopener noreferrer">Fiche du joueur et sources</a></p>${photo?`<p>Photo : ${H(photo.author)}.<br><a href="${checkedHref(photo.source)}" target="_blank" rel="noopener noreferrer">Fichier et historique sur Commons</a> · <a href="${checkedHref(photo.licenseUrl)}" target="_blank" rel="noopener noreferrer">${H(photo.license)}</a>.</p><p>Présentation recadrée dans la carte ; fichier source non modifié.</p>`:'<p>Aucun portrait avec métadonnées de licence admises n’a pu être chargé. Aucune photo non vérifiée n’est utilisée.</p>'}</div></div>`;
  if(!detail.open)detail.showModal();requestPhotos();
 }
 async function ensureAccount(){
  const actor=uid,token=epoch,ref=doc(api.db,'users',actor);
  const saved=await runTransaction(api.db,async tx=>{
   const snap=await tx.get(ref);
   if(!snap.exists())throw new Error('Compte introuvable.');
   if(api.user()?.uid!==actor||token!==epoch)throw new Error('Le compte a changé.');
   const raw=snap.data().esports;
   // Une sauvegarde invalide provoque une erreur, jamais une remise à zéro.
   const value=normaliseEsports(raw??null);
   if(raw===undefined||raw===null)tx.update(ref,{esports:value});
   return value;
  });
  if(token!==epoch||api.user()?.uid!==actor)return;
  if(!progress||(saved.opened||0)>=(progress.opened||0))progress=saved;
  unsubscribe?.();
  unsubscribe=onSnapshot(ref,snap=>{
   if(token!==epoch||api.user()?.uid!==actor||!snap.exists())return;
   const next=snap.data().esports;
   if(next===undefined||next===null){error='La sauvegarde esport a disparu. Aucune remise à zéro automatique.';progress=null;render();return;}
   try{
    const value=normaliseEsports(next);
    if(!progress||(value.opened||0)>=(progress.opened||0)){progress=value;if(!busy)render();}
   }catch(e){progress=null;error=e.message;render();}
  },e=>{if(token===epoch){error='Synchronisation esport : '+e.message;render();}});
  render();
 }
 function initialiseAccount(){
  if(!uid)return Promise.resolve();
  if(initPending)return initPending;
  const token=epoch;busy=true;error='';render();
  const pending=ensureAccount().catch(e=>{
   if(token===epoch)error=e.code==='permission-denied'?'La sauvegarde esport est refusée par les règles Firestore. Les autres inventaires ne sont pas modifiés.':e.message;
  }).finally(()=>{
   if(token===epoch){initPending=null;busy=false;render();}
  });
  initPending=pending;
  return pending;
 }
 async function openPack(){
  if(busy||!uid||!progress)return;const actor=uid,token=epoch;busy=true;error='';render();
  try{
   const ref=doc(api.db,'users',actor);
   const result=await runTransaction(api.db,async tx=>{const snap=await tx.get(ref);if(!snap.exists())throw new Error('Compte introuvable.');if(api.user()?.uid!==actor||token!==epoch)throw new Error('Le compte a changé.');const result=openEsportsBooster(snap.data().esports,catalog);tx.update(ref,{esports:result.state});return result;});
   if(token!==epoch||api.user()?.uid!==actor)return;
   if((result.state.opened||0)>=(progress?.opened||0))progress=result.state;
   lastDraw=result.drawn;revealed=0;showReveal();
  }catch(e){if(token===epoch)error=e.code==='permission-denied'?'La sauvegarde esport est refusée par les règles Firestore. Les autres inventaires ne sont pas modifiés.':e.message;}
  finally{if(token===epoch){busy=false;render();}}
 }
 function accountChanged(){
  epoch++;uid=api.user()?.uid||null;
  unsubscribe?.();unsubscribe=null;initPending=null;progress=null;busy=false;error='';
  lastDraw=[];revealed=0;detailKey='';root.innerHTML='';
  if(reveal.open)reveal.close();if(detail.open)detail.close();
  reveal.innerHTML='';detail.innerHTML='';
  render();if(uid&&!root.hidden)void initialiseAccount();
 }
 navButton.onclick=()=>{
  if(!api.user())return;
  for(const b of nav.querySelectorAll('button'))b.classList.toggle('active',b===navButton);
  for(const section of main.querySelectorAll(':scope > section'))section.hidden=section!==root;
  if(uid!==api.user()?.uid)accountChanged();
  render();if(!progress)void initialiseAccount();
 };
 nav.addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(b&&b!==navButton){if(reveal.open)reveal.close();if(detail.open)detail.close();}});
 root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;if(b.dataset.proAction==='open')void openPack();else if(b.dataset.proAction==='retry')void initialiseAccount();else if(b.dataset.proAction==='last'){revealed=lastDraw.length;showReveal();}else if(b.dataset.proCard)showDetail(b.dataset.proCard);});
 root.addEventListener('input',e=>{if(e.target.matches('[data-pro-search]')){const pos=e.target.selectionStart;q=e.target.value;render();const n=root.querySelector('[data-pro-search]');n.focus();n.setSelectionRange(pos,pos);}});
 root.addEventListener('change',e=>{if(e.target.matches('[data-pro-role]'))role=e.target.value;else if(e.target.matches('[data-pro-finish]'))finish=e.target.value;else if(e.target.matches('[data-pro-owned]'))onlyOwned=e.target.checked;render();});
 reveal.addEventListener('click',e=>{if(e.target.closest('[data-pro-close]')||e.target===reveal){reveal.close();return;}if(e.target.closest('[data-pro-all]')){revealed=lastDraw.length;showReveal();return;}const b=e.target.closest('[data-pro-flip]');if(b){if(Number(b.dataset.proFlip)>=revealed){revealed++;showReveal();}else{const draw=lastDraw[Number(b.dataset.proFlip)];showDetail(draw.key);}}});
 detail.addEventListener('click',e=>{if(e.target.closest('[data-pro-close]')||e.target===detail)detail.close();});
 document.addEventListener('error',e=>{const img=e.target;if(img.matches?.('[data-pro-photo-img]')){const player=catalog.players.find(p=>p.id===img.parentElement?.dataset.proPortrait);if(player){photos.set(player.id,null);img.parentElement.innerHTML=photoHTML(player);}}},true);
 const timer=setInterval(()=>{if(!root.hidden)tick();},1000);accountChanged();
 return {accountChanged};
}
