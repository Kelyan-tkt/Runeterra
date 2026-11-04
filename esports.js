import {doc,runTransaction,onSnapshot} from 'https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js';
import {ESPORTS,FINISHES,normaliseEsports,openEsportsBooster,esportsCardKey,parseEsportsKey} from './esports-engine.js?v=panda-1';
import {fetchPlayerPortrait,permittedPortrait} from './esports-portraits.js?v=panda-1';
const H=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=x=>String(x??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const href=x=>{try{const u=new URL(x);return u.protocol==='https:'?H(u.href):'';}catch{return '';}};
const FALLBACK='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="290" viewBox="0 0 180 290"><defs><linearGradient id="b" x2="0" y2="1"><stop stop-color="#1e3446"/><stop offset="1" stop-color="#07121e"/></linearGradient></defs><path fill="url(#b)" d="M0 0h180v290H0z"/><circle cx="90" cy="91" r="35" fill="#577082"/><path d="M26 230v-26a64 64 0 0 1 128 0v26" fill="#3c5365"/><text x="90" y="267" text-anchor="middle" fill="#bccbd6" font-family="sans-serif" font-size="12">Portrait indisponible</text></svg>');

function playerNationality(code){
 const value=String(code||'').toUpperCase();
 if(!/^[A-Z]{2}$/.test(value))return 'Non renseignée';
 try{return new Intl.DisplayNames(['fr'],{type:'region'}).of(value)||value;}catch{return value;}
}
function playerDate(value){
 if(typeof value!=='number'||!Number.isFinite(value)||value<=0)return 'Non renseignée';
 const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleDateString('fr-FR'):'Non renseignée';
}
const FINISH_DESCRIPTION={base:'Portrait naturel et cadre classique.',foil:'Reflets cyan, lumière holographique et contraste doux.',prism:'Cadrage rapproché, profondeur et reflets prismatiques.',prestige:'Cadrage premium, éclairage doré et liseré lumineux.'};

export async function installEsports(api){
 const main=document.getElementById('gameView'),nav=main?.querySelector('nav'),boosters=document.getElementById('tab-boosters'),original=boosters?.querySelector('.booster-layout');
 if(!main||!nav||!original)throw new Error('La page booster existante est introuvable.');
 const response=await fetch(new URL('./esports-catalog.json?v=panda-1',import.meta.url),{signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('Catalogue esport : HTTP '+response.status);const catalog=await response.json();
 if(catalog.schema!==1||!Array.isArray(catalog.players)||!catalog.players.length||!/^[a-z0-9][a-z0-9-]{0,127}$/.test(catalog.edition||''))throw new Error('Catalogue esport invalide.');
 const byId=new Map();for(const p of catalog.players){if(!/^[a-z0-9][a-z0-9-]{0,127}$/.test(p.id)||byId.has(p.id)||!p.handle||!Array.isArray(p.roles))throw new Error('Catalogue : identifiant dupliqué ou joueur invalide.');byId.set(p.id,p);}
 const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./esports.css?v=player-sheet-1',import.meta.url);document.head.appendChild(link);
 const switcher=document.createElement('div');switcher.className='pro-switch';switcher.innerHTML='<button type="button" class="ttab active" data-pro-mode="normal">Champions et skins</button><button type="button" class="ttab" data-pro-mode="esports">Joueurs professionnels</button>';boosters.prepend(switcher);
 // Copie de la vraie mise en page du site, pas une seconde maquette.
 const pack=original.cloneNode(true);pack.classList.add('pro-booster-layout');pack.hidden=true;
 for(const el of pack.querySelectorAll('[id]')){el.dataset.proPart=el.id;el.removeAttribute('id');}
 const part=name=>pack.querySelector(`[data-pro-part="${name}"]`);
 part('bonusBox')?.remove();pack.querySelector('.pity')?.remove();
 const aside=pack.querySelector('.odds-box');aside.querySelector('h3').textContent='Finitions par carte';part('oddsList').innerHTML=FINISHES.map(f=>`<li><span style="color:${f.color}">● ${H(f.label)}</span><b>${f.weight} %</b></li>`).join('');
 aside.insertAdjacentHTML('beforeend',`<p class="hint">${catalog.players.filter(p=>p.boosterEligible!==false&&!p.archived).length.toLocaleString('fr-FR')} joueurs admissibles aux boosters. Cinq cartes par booster, tirées uniformément dans cette sélection. Les variantes sont cosmétiques.</p><p class="hint">${catalog.players.filter(p=>permittedPortrait(p.photo)).length} portraits renseignés avant chargement. Les liens peuvent être indisponibles. Les anciennes fiches archivées ne sont plus tirées.</p>`);
 pack.querySelector('.boosters-title').innerHTML='Boosters esport : <span data-pro-stock>…</span> / 10';part('openBtn').textContent='Ouvrir un booster esport';part('chest').setAttribute('aria-label','Ouvrir un booster esport');boosters.appendChild(pack);
 const status=document.createElement('p');status.className='hint pro-status';status.setAttribute('role','status');pack.querySelector('.booster-main').appendChild(status);
 const collectButton=document.createElement('button');collectButton.type='button';collectButton.className='btn';collectButton.textContent='Voir la collection des joueurs';pack.querySelector('.booster-main').appendChild(collectButton);
 const navButton=document.createElement('button');navButton.type='button';navButton.dataset.tab='esports';navButton.textContent='Joueurs pro';nav.appendChild(navButton);
 const root=document.createElement('section');root.id='tab-esports';root.hidden=true;main.appendChild(root);
 const detail=document.createElement('dialog');detail.className='pro-detail-dialog';document.body.appendChild(detail);
 let uid=null,epoch=0,progress=null,busy=false,pending=null,unsub=null,mode='normal',error='',q='',role='',onlyOwned=false,onlyPhoto=true,page=0,detailKey='',lastDraw=[];
 const photos=new Map(),requested=new Set(),queue=[];let running=0;
 for(const p of catalog.players)if(permittedPortrait(p.photo))photos.set(p.id,p.photo);
 const quantity=key=>progress?.cards?.[key]||0;
 const photo=p=>photos.get(p.id)||null;
 const image=p=>photo(p)?.local||photo(p)?.url||FALLBACK;
 function drawCard(draw){const p=byId.get(draw.playerId),f=FINISHES.find(x=>x.id===draw.finishId);return p&&f?{id:draw.key,proKey:draw.key,esports:true,playerId:p.id,name:p.handle,skinName:f.label,rarity:f.rarity,img:image(p),isNewAtOpen:draw.isNew,finishId:f.id}:null;}
 function renderCard(card,standalone=false){
  const p=byId.get(card.playerId),f=FINISHES.find(x=>x.id===card.finishId);if(!p||!f)return '';
  const markup=`<div class="card ${f.rarity} pro-player-card" data-pro-key="${H(card.proKey)}" data-pro-finish="${f.id}"><span class="badge">${H(f.label)}</span><span class="pro-portrait"><img loading="lazy" referrerpolicy="no-referrer" src="${H(image(p))}" alt="Portrait de ${H(p.handle)}" data-pro-photo-id="${p.id}"><span class="pro-portrait-fx" aria-hidden="true"></span></span><div class="info"><b>${H(p.handle)}</b><br>${H((p.roles||[]).join(' / ')||'Joueur pro')}</div></div>`;
  if(!card.isNewAtOpen)return markup;
  const badge='<span class="opening-new-badge">Nouveau</span>';
  return standalone?`<div class="opening-result-card">${markup}${badge}</div>`:markup+badge;
 }
 function updateImages(id){const p=byId.get(id);for(const el of document.querySelectorAll('img[data-pro-photo-id]'))if(el.dataset.proPhotoId===id&&el.getAttribute('src')!==image(p)){delete el.dataset.proFailed;el.src=image(p);}}
 function pump(){while(running<2&&queue.length){const p=queue.shift();running++;fetchPlayerPortrait(p).then(value=>{if(value){photos.set(p.id,value);updateImages(p.id);if(detail.open&&parseEsportsKey(detailKey)?.playerId===p.id)showCard(detailKey);}}).catch(()=>{}).finally(()=>{running--;pump();});}}
 function requestVisible(){for(const el of document.querySelectorAll('#tab-esports:not([hidden]) [data-pro-photo-id],#reveal:not([hidden]) [data-pro-photo-id],.pro-detail-dialog[open] [data-pro-photo-id]')){const p=byId.get(el.dataset.proPhotoId);if(p&&!photo(p)&&!requested.has(p.id)){requested.add(p.id);queue.push(p);}}pump();}
 function tick(){
  if(!uid)return;let value=null;try{if(progress)value=normaliseEsports(progress);}catch(e){error=e.message;}
  const count=value?.boosters;pack.querySelector('[data-pro-stock]').textContent=count??'…';part('chestCount').textContent='x'+(count??0);
  part('timer').textContent=!value?'Chargement…':count>=10?'Stock plein':`Prochain booster dans ${Math.floor(Math.max(0,ESPORTS.refillMs-Date.now()+value.lastRefill)/60000)}:${String(Math.floor(Math.max(0,ESPORTS.refillMs-Date.now()+value.lastRefill)%60000/1000)).padStart(2,'0')}`;
  part('openBtn').disabled=busy||!value||count<1||api.isRevealing();part('chest').classList.toggle('empty',!value||count<1);part('chest').setAttribute('aria-disabled',String(part('openBtn').disabled));status.textContent=error||'';
 }
 function renderCollection(){
  if(root.hidden)return;if(!uid){root.innerHTML='<p>Connecte-toi pour consulter les joueurs.</p>';return;}
  const matching=catalog.players.filter(p=>(!p.archived||FINISHES.some(f=>quantity(esportsCardKey(catalog.edition,p.id,f.id))>0))&&(!q||norm(p.handle+' '+(p.region||'')).includes(norm(q)))&&(!role||p.roles.includes(role))&&(!onlyPhoto||photo(p))&&(!onlyOwned||FINISHES.some(f=>quantity(esportsCardKey(catalog.edition,p.id,f.id))>0)));
  const pages=Math.max(1,Math.ceil(matching.length/60));page=Math.min(page,pages-1);const list=matching.slice(page*60,(page+1)*60);
  const owned=catalog.players.filter(p=>FINISHES.some(f=>quantity(esportsCardKey(catalog.edition,p.id,f.id))>0)).length;
  root.innerHTML=`<h2>Collection des joueurs <span class="count">(${owned} / ${catalog.players.length})</span></h2><div class="gallery-bar panel"><input type="search" data-pro-search placeholder="Rechercher un joueur…" value="${H(q)}"><select data-pro-role><option value="">Tous les rôles</option>${['Top','Jungle','Mid','ADC','Support'].map(r=>`<option ${role===r?'selected':''}>${r}</option>`).join('')}</select><label><input type="checkbox" data-pro-owned ${onlyOwned?'checked':''}> Possédés seulement</label><label><input type="checkbox" data-pro-photo ${onlyPhoto?'checked':''}> Avec portrait</label></div>
  <p class="hint">${matching.length.toLocaleString('fr-FR')} joueurs correspondants · ${H(catalog.title)}. Actifs et anciens selon les sources ; ce catalogue n’est pas un registre exhaustif. <button type="button" class="btn" data-pro-go-boosters>Ouvrir des boosters</button></p>
  <div class="champ-grid">${list.map(p=>{const obtained=FINISHES.filter(f=>quantity(esportsCardKey(catalog.edition,p.id,f.id))>0);const f=obtained.at(-1)||FINISHES[0];return `<button type="button" class="tile ${f.rarity}${obtained.length?'':' locked'} pro-player-tile" data-pro-finish="${f.id}" data-pro-player="${p.id}"><span class="badge">${H(f.label)}</span><img loading="lazy" referrerpolicy="no-referrer" src="${H(image(p))}" alt="${H(p.handle)}" data-pro-photo-id="${p.id}"><div class="tinfo"><b>${H(p.handle)}</b><small>${obtained.length} / ${FINISHES.length} variantes · ${H(p.roles.join(' / ')||'Joueur pro')}</small><div class="bar"><span style="width:${obtained.length/FINISHES.length*100}%"></span></div></div></button>`;}).join('')||'<p class="hint">Aucun joueur ne correspond.</p>'}</div><div class="pro-pages"><button class="btn" data-pro-page="-1" ${page===0?'disabled':''}>Précédent</button><span>${page+1} / ${pages}</span><button class="btn" data-pro-page="1" ${page+1>=pages?'disabled':''}>Suivant</button></div>
  <details class="pro-sources"><summary>Sources et état du catalogue</summary><p>${H(catalog.description||'')}</p><p>${H(catalog.importStatus?.message||'Catalogue local : importer l’annuaire pour élargir la sélection.')}</p><p>${H(catalog.attribution?.text||'Données : Wikipédia et contributeurs ; voir les sources du catalogue.')}</p>${catalog.attribution?.url?`<a href="${href(catalog.attribution.url)}" target="_blank" rel="noopener noreferrer">Source des données</a>`:''}<p>Les fiches archivées restent visibles si tu possèdes leurs cartes. Décoche « Avec portrait » pour voir aussi les cartes sans photo. Les photos ont leur propre attribution. Aucune photo ne signifie pas que le joueur n’existe pas : sa fiche et ses cartes restent disponibles.</p></details>`;
  requestVisible();
 }
 function render(){tick();renderCollection();}
 function showCard(key){
  const parsed=parseEsportsKey(key),p=byId.get(parsed?.playerId),f=FINISHES.find(x=>x.id===parsed?.finishId);
  if(!p||!f||parsed.edition!==catalog.edition)return;
  detailKey=key;
  const portrait=photo(p),card=drawCard({key,playerId:p.id,finishId:f.id,isNew:false});
  const ownedVariants=FINISHES.filter(x=>quantity(esportsCardKey(catalog.edition,p.id,x.id))>0).length;
  const total=FINISHES.reduce((sum,x)=>sum+quantity(esportsCardKey(catalog.edition,p.id,x.id)),0);
  const obtained=playerDate(progress?.obtained?.[key]);
  const facts=[
   ['Pseudo',p.handle],
   ['Nationalité',playerNationality(p.nationality)],
   ['Rôle(s) renseigné(s)',p.roles?.length?p.roles.join(' / '):'Non renseignés'],
   ['Édition de la carte',catalog.title||catalog.edition],
   ['Finition sélectionnée',f.label],
   ['Tes exemplaires de cette finition',String(quantity(key))],
   ['Variantes obtenues',`${ownedVariants} / ${FINISHES.length}`],
   ['Tes exemplaires, toutes finitions',String(total)],
   ['Première obtention de cette finition',obtained],
   ['Distribution',p.archived?'Fiche archivée : hors des nouveaux boosters':p.boosterEligible===false?'Hors des nouveaux boosters':'Admissible aux boosters'],
   ...(Number.isSafeInteger(p.pandascoreId)?[['Référence PandaScore',String(p.pandascoreId)]]:[])
  ];
  const wiki=p.wikipedia?'https://en.wikipedia.org/wiki/'+encodeURIComponent(p.wikipedia.replaceAll(' ','_')):'';
  const sourceLink=wiki||p.sourceUrl||'';
  const credits=portrait?.provider==='pandascore'
   ? '<p>Portrait fourni par <a href="https://www.pandascore.co/" target="_blank" rel="noopener noreferrer">PandaScore</a>. Photographe non renseigné dans cet import. Les conditions du fournisseur et les droits à l’image s’appliquent : cette photo n’est pas présentée comme libre de droits.</p>'
   :portrait?`<p>Photo : ${H(portrait.author||'Auteur non renseigné')} · <a href="${href(portrait.source)}" target="_blank" rel="noopener noreferrer">fichier source</a> · <a href="${href(portrait.licenseUrl)}" target="_blank" rel="noopener noreferrer">${H(portrait.license||'Conditions de la source')}</a>.</p><p>${H(portrait.credit||'')}</p>`
   :'<p>Aucun portrait disponible : une illustration de remplacement est affichée.</p>';
  detail.innerHTML=`<div class="pro-detail-head"><div><p class="pro-sheet-kicker">Fiche joueur · collection esport</p><h2>${H(p.handle)}</h2></div><button type="button" class="btn" data-pro-close>Fermer</button></div>
  <div class="pro-player-sheet"><div><div class="pro-detail-stage"><button type="button" class="v-arrow" data-pro-step="-1" aria-label="Variante précédente">‹</button>${renderCard(card)}<button type="button" class="v-arrow" data-pro-step="1" aria-label="Variante suivante">›</button></div><p class="pro-finish-description">${H(FINISH_DESCRIPTION[f.id]||'')}</p></div>
  <section class="pro-player-information" aria-label="Informations du joueur"><h3>Informations et collection</h3><dl class="pro-facts">${facts.map(([label,value])=>`<div><dt>${H(label)}</dt><dd>${H(value)}</dd></div>`).join('')}</dl><p class="hint pro-data-limit">Les rôles sont ceux renseignés dans le catalogue, pas une confirmation d’un effectif actuel. Nom complet, date de naissance et équipe actuelle ne sont pas fournis dans cet import.</p>${sourceLink?`<a class="btn" href="${href(sourceLink)}" target="_blank" rel="noopener noreferrer">Consulter la source</a>`:''}</section></div>
  <div class="pro-variants" role="group" aria-label="Choisir une finition">${FINISHES.map(variant=>`<button type="button" class="btn ${variant.id===f.id?'active':''}" data-pro-variant="${variant.id}" aria-pressed="${variant.id===f.id?'true':'false'}">${H(variant.label)} · ${quantity(esportsCardKey(catalog.edition,p.id,variant.id))}</button>`).join('')}</div>
  <details class="pro-sources"><summary>Portrait, rendu et crédits</summary><p>Les quatre finitions utilisent le même portrait source. Les différences sont des cadrages, filtres et effets graphiques : ce ne sont pas quatre prises de vue différentes.</p>${credits}</details>`;
  if(!detail.open)detail.showModal();requestVisible();
 }
 function chooseMode(value){mode=value;original.hidden=mode!=='normal';pack.hidden=mode!=='esports';for(const b of switcher.querySelectorAll('button'))b.classList.toggle('active',b.dataset.proMode===mode);if(mode==='esports'&&uid&&!progress)void initialise();tick();}
 async function ensure(){
  const actor=uid,token=epoch,ref=doc(api.db,'users',actor);
  const saved=await runTransaction(api.db,async tx=>{const snap=await tx.get(ref);if(!snap.exists())throw new Error('Compte introuvable.');if(api.user()?.uid!==actor||epoch!==token)throw new Error('Le compte a changé.');const raw=snap.data().esports,value=normaliseEsports(raw??null);if(!raw||raw.version!==2)tx.update(ref,{esports:value});return value;});
  if(token!==epoch||api.user()?.uid!==actor)return;progress=saved;unsub?.();unsub=onSnapshot(ref,snap=>{if(epoch!==token||api.user()?.uid!==actor||!snap.exists())return;try{const raw=snap.data().esports;if(!raw)throw new Error('Sauvegarde esport absente.');const value=normaliseEsports(raw);if(!progress||value.opened>=progress.opened){progress=value;render();}}catch(e){error=e.message;render();}},e=>{if(token===epoch){error=e.message;render();}});render();
 }
 function initialise(){if(!uid)return Promise.resolve();if(pending)return pending;const token=epoch;busy=true;error='';render();const operation=ensure().catch(e=>{if(token===epoch)error=e.message;}).finally(()=>{if(token===epoch){pending=null;busy=false;render();}});pending=operation;return operation;}
 async function openPack(){
  if(busy||!uid||!progress)return;const lock=api.acquireOpening();if(!lock)return;
  const actor=uid,token=epoch;busy=true;error='';part('chest').classList.add('opening');setTimeout(()=>part('chest').classList.remove('opening'),900);tick();
  try{
   const ref=doc(api.db,'users',actor);const result=await runTransaction(api.db,async tx=>{const snap=await tx.get(ref);if(!snap.exists())throw new Error('Compte introuvable.');if(epoch!==token||api.user()?.uid!==actor)throw new Error('Le compte a changé.');const next=openEsportsBooster(snap.data().esports,catalog);tx.update(ref,{esports:next.state});return next;});
   if(token!==epoch||api.user()?.uid!==actor)return;progress=result.state;lastDraw=result.drawn;
   api.openReveal(lastDraw.map(drawCard).filter(Boolean),{renderCard,onResults:markup=>{part('result').innerHTML=markup;},onClose:()=>{tick();requestVisible();}});requestVisible();
  }catch(e){if(token===epoch)error=e.code==='permission-denied'?'Firestore refuse la sauvegarde esport. Aucun autre inventaire n’est modifié.':e.message;}
  finally{api.releaseOpening(lock);if(token===epoch){busy=false;render();}}
 }
 function accountChanged(){epoch++;uid=api.user()?.uid||null;unsub?.();unsub=null;pending=null;progress=null;busy=false;error='';lastDraw=[];detailKey='';part('result').innerHTML='';root.innerHTML='';if(detail.open)detail.close();detail.innerHTML='';if(uid&&(mode==='esports'||!root.hidden))void initialise();render();}
 switcher.addEventListener('click',e=>{const b=e.target.closest('[data-pro-mode]');if(b)chooseMode(b.dataset.proMode);});
 part('openBtn').onclick=openPack;part('chest').onclick=()=>{if(!part('openBtn').disabled)void openPack();};part('chest').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(!part('openBtn').disabled)void openPack();}});
 const showCollection=()=>{api.navigate('esports');if(!progress)void initialise();renderCollection();};navButton.onclick=showCollection;collectButton.onclick=showCollection;
 nav.addEventListener('click',e=>{const b=e.target.closest('button[data-tab]');if(b){if(detail.open)detail.close();if(b.dataset.tab==='boosters')tick();}});
 root.addEventListener('input',e=>{if(e.target.matches('[data-pro-search]')){const pos=e.target.selectionStart;q=e.target.value;page=0;renderCollection();const el=root.querySelector('[data-pro-search]');el.focus();el.setSelectionRange(pos,pos);}});
 root.addEventListener('change',e=>{if(e.target.matches('[data-pro-role]'))role=e.target.value;else if(e.target.matches('[data-pro-owned]'))onlyOwned=e.target.checked;else if(e.target.matches('[data-pro-photo]'))onlyPhoto=e.target.checked;page=0;renderCollection();});
 root.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled)return;if(b.dataset.proPlayer){const p=byId.get(b.dataset.proPlayer),f=FINISHES.filter(x=>quantity(esportsCardKey(catalog.edition,p.id,x.id))>0).at(-1)||FINISHES[0];showCard(esportsCardKey(catalog.edition,p.id,f.id));}else if(b.dataset.proPage){page+=Number(b.dataset.proPage);renderCollection();}else if(b.hasAttribute('data-pro-go-boosters')){api.navigate('boosters');chooseMode('esports');}});
 detail.addEventListener('click',e=>{const b=e.target.closest('button');if(e.target===detail||b?.hasAttribute('data-pro-close')){detail.close();return;}if(!b)return;const parsed=parseEsportsKey(detailKey);if(!parsed)return;const i=FINISHES.findIndex(f=>f.id===parsed.finishId),f=b.dataset.proVariant||FINISHES[(i+Number(b.dataset.proStep||0)+4)%4].id;showCard(esportsCardKey(catalog.edition,parsed.playerId,f));});
 document.addEventListener('error',e=>{const img=e.target,id=img.dataset?.proPhotoId;if(!id)return;const p=byId.get(id),value=p&&photo(p);if(!img.dataset.proFailed&&value?.url&&img.getAttribute('src')!==value.url){img.dataset.proFailed='1';img.src=value.url;}else if(img.getAttribute('src')!==FALLBACK){img.dataset.proFailed='1';img.src=FALLBACK;}},true);
 setInterval(()=>{if(!boosters.hidden&&mode==='esports')tick();},1000);accountChanged();
 return {accountChanged,showCard,renderCard};
}
