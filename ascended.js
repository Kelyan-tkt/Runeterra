import { ASCENDED_CONFIG, ASCENDED_CATALOG } from './ascended-config.js?v=ascended-1';
export { ASCENDED_CONFIG } from './ascended-config.js?v=ascended-1';
const H=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export function makeAscendedCatalogue(champions,card){
 return ASCENDED_CATALOG.flatMap(spec=>{
  const champion=champions.find(c=>norm(c.id)===norm(spec.champion));
  if(!champion)return [];
  const base=card(Number(champion.key)*1000);
  if(!base?.img)return [];
  return [{...base,rarity:'ascended',ascended:true,skinName:'Classique · Ascendante',theme:spec.theme,video:spec.video}];
 });
}
export function awardAscendedBonus(state,catalogue,{enabled=ASCENDED_CONFIG.enabled,chance=ASCENDED_CONFIG.chance,random=Math.random,now=Date.now()}={}){
 if(!enabled)return null;
 if(!Number.isFinite(chance)||chance<=0||chance>1||!catalogue.length)return null;
 if(random()>=chance)return null;
 const index=Math.min(catalogue.length-1,Math.max(0,Math.floor(random()*catalogue.length)));
 const card=catalogue[index],key=String(card.id);
 const current=state.ascendedCards?.[key]||0;
 if(!Number.isSafeInteger(current)||current<0)throw new Error('Inventaire Ascendant invalide.');
 state.ascendedCards={...(state.ascendedCards||{}),[key]:current+1};
 state.ascendedObtained={...(state.ascendedObtained||{})};
 if(state.ascendedObtained[key]===undefined)state.ascendedObtained[key]=now;
 return {...card};
}
export function ascendedCardHTML(card,qty=0,preview=false){
 const theme=ASCENDED_CATALOG.some(x=>x.theme===card.theme)?card.theme:'stars';
 return `<button type="button" class="asc-card asc-${theme}${preview?' asc-preview':''}" data-ascended-id="${Number(card.id)}" aria-label="${H(card.name)} Ascendante${preview?', aperçu non possédé':''}">
 <span class="asc-badge">Ascendante</span>${qty>1?`<span class="asc-qty">×${qty}</span>`:''}
 <span class="asc-art"><img loading="lazy" referrerpolicy="no-referrer" src="${H(card.img)}" data-asc-fallback="${H(card.imgAlt||card.img)}" alt="${H(card.name)}"><span class="asc-aura" aria-hidden="true"></span><span class="asc-particles" aria-hidden="true">${Array.from({length:8},(_,i)=>`<i style="--i:${i}"></i>`).join('')}</span><span class="asc-shine" aria-hidden="true"></span></span>
 <span class="asc-caption"><strong>${H(card.name)}</strong><small>${preview?'Aperçu · non possédée':H(card.skinName)}</small></span></button>`;
}
export function initAscended(api){
 const root=api.root;let owner=null,signature='',currentCard=null,lastFocus=null;
 let motion=true;try{motion=localStorage.getItem('runeterra-ascended-motion')!=='off';}catch{}
 const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
 const dialog=document.createElement('dialog');dialog.id='ascendedDialog';dialog.className='asc-dialog';document.body.appendChild(dialog);
 const canAnimate=()=>motion&&!reduced?.matches;
 function stopMedia(){for(const video of dialog.querySelectorAll('video')){video.pause();video.removeAttribute('src');video.load();}}
 function close(){stopMedia();if(dialog.open)dialog.close();dialog.innerHTML='';currentCard=null;lastFocus?.focus?.();lastFocus=null;}
 function syncMotion(){document.documentElement.classList.toggle('asc-motion-off',!canAnimate());}
 function open(card){
  close();lastFocus=document.activeElement;currentCard=card;
  const owned=(api.state()?.ascendedCards?.[card.id]||0)>0;
  const video=canAnimate()&&typeof card.video==='string'&&card.video.trim()?card.video:'';
  dialog.innerHTML=`<div class="asc-modal-head"><h2>${H(card.name)} · Ascendante</h2><button type="button" class="btn" data-asc-close autofocus>Fermer</button></div><div class="asc-modal-art asc-${H(card.theme)}"><img class="asc-poster" src="${H(card.splash||card.img)}" data-asc-fallback="${H(card.splashAlt||card.imgAlt||card.img)}" alt="${H(card.name)}">${video?`<video class="asc-video" src="${H(video)}" poster="${H(card.splash||card.img)}" autoplay muted loop playsinline controls preload="metadata" aria-label="Illustration animée de ${H(card.name)}"></video>`:''}<span class="asc-aura" aria-hidden="true"></span><span class="asc-shine" aria-hidden="true"></span></div><p>${owned?'Cette variante est dans ta collection.':'Aperçu uniquement : cette variante n’est pas dans ta collection.'}</p><p class="asc-muted" data-asc-render-note>${video?'Illustration animée.':'Illustration fixe avec effets CSS ; le personnage lui-même n’est pas animé.'}</p>`;
  if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');
  const vid=dialog.querySelector('video');if(vid){vid.muted=true;vid.play()?.catch(()=>{});vid.addEventListener('error',()=>{vid.remove();const note=dialog.querySelector('[data-asc-render-note]');if(note)note.textContent='Vidéo indisponible : illustration fixe avec effets CSS.';},{once:true});}
 }
 function render(){
  const uid=api.user()?.uid;if(uid!==owner){close();owner=uid;signature='';}
  if(!uid){root.innerHTML='';return;}
  const filter=api.filters();root.hidden=Boolean(filter.rarity&&filter.rarity!=='ascended');if(root.hidden)return;
  syncMotion();const state=api.state()||{},catalogue=api.catalogue();
  const q=norm(filter.query||'');let cards=catalogue.filter(c=>(!q||norm(c.name+' '+c.skinName).includes(q))&&(!filter.owned||(state.ascendedCards?.[c.id]||0)>0)&&(!filter.dupes||(state.ascendedCards?.[c.id]||0)>1));
  const quantity=c=>state.ascendedCards?.[c.id]||0,time=c=>state.ascendedObtained?.[c.id]||0;
  cards.sort((a,b)=>filter.sort==='recent'?time(b)-time(a)||a.name.localeCompare(b.name,'fr'):filter.sort==='oldest'?time(a)-time(b)||a.name.localeCompare(b.name,'fr'):filter.sort==='dupes'?quantity(b)-quantity(a)||a.name.localeCompare(b.name,'fr'):a.name.localeCompare(b.name,'fr'));
  const sig=JSON.stringify([uid,filter,state.ascendedCards,state.ascendedObtained,motion,reduced?.matches]);if(sig===signature)return;signature=sig;
  const unique=catalogue.filter(c=>quantity(c)>0).length;
  root.innerHTML=`<header class="asc-header"><div><p class="asc-kicker">Nouvelle rareté · variantes séparées</p><h2>Ascendantes <small>${unique} / ${catalogue.length}</small></h2><p>${ASCENDED_CONFIG.enabled?`Bonus indépendant dans les boosters : ${(ASCENDED_CONFIG.chance*100).toLocaleString('fr-FR')} %. Les cinq cartes habituelles restent inchangées.`:'Catalogue et aperçus disponibles. Tirage bonus désactivé en attendant la validation de son taux.'}</p><p class="asc-muted">Ces variantes ne remplacent pas tes cartes habituelles. Échanges, recyclage et équipement des Ascendantes ne sont pas activés dans cette première version.</p></div><label class="asc-motion"><input type="checkbox" data-asc-motion ${motion?'checked':''}> Effets animés${reduced?.matches?' (réduits par le réglage système)':''}</label></header><div class="asc-grid">${cards.map(c=>ascendedCardHTML(c,quantity(c),!quantity(c))).join('')||'<p>Aucune Ascendante ne correspond aux filtres.</p>'}</div>`;
 }
 document.addEventListener('click',e=>{
  const b=e.target.closest?.('[data-ascended-id]');if(!b)return;
  if(b.closest('.flip:not(.flipped)'))return;
  const card=api.catalogue().find(c=>Number(c.id)===Number(b.dataset.ascendedId));if(card&&api.user())open(card);
 });
 root.addEventListener('change',e=>{if(e.target.matches('[data-asc-motion]')){motion=e.target.checked;try{localStorage.setItem('runeterra-ascended-motion',motion?'on':'off');}catch{}signature='';syncMotion();render();}});
 dialog.addEventListener('click',e=>{if(e.target.closest('[data-asc-close]')||e.target===dialog)close();});
 dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 dialog.addEventListener('close',()=>{if(!dialog.open){stopMedia();currentCard=null;}});
 document.addEventListener('error',e=>{const img=e.target;if(img.tagName==='IMG'&&img.dataset.ascFallback&&!img.dataset.ascFailed){img.dataset.ascFailed='1';img.src=img.dataset.ascFallback;}},true);
 document.addEventListener('visibilitychange',()=>{for(const v of dialog.querySelectorAll('video')){if(document.hidden)v.pause();else if(canAnimate())v.play()?.catch(()=>{});}});
 reduced?.addEventListener?.('change',()=>{signature='';syncMotion();if(dialog.open&&currentCard){const card=currentCard;open(card);}render();});
 return {render,close(){close();owner=null;signature='';root.innerHTML='';}};
}
