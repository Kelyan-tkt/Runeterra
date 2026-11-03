import { ASCENDED_CONFIG, LEGACY_ASCENDED_CHAMPIONS, ASCENDED_SKIN_OVERRIDES } from './ascended-config.js?v=ascended-2';
export { ASCENDED_CONFIG } from './ascended-config.js?v=ascended-2';
const H=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
let manifest={records:[]},generation=0,loading=null,refreshMedia=()=>{},cancelReveal=()=>{};
export function loadAscendedMedia(){
 if(!loading)loading=fetch(ASCENDED_CONFIG.manifest,{signal:AbortSignal.timeout(12000)}).then(r=>{if(!r.ok)throw new Error(`Catalogue vidéo : HTTP ${r.status}`);return r.json();}).then(data=>{if(!Array.isArray(data.records))throw new Error('Catalogue vidéo invalide.');manifest=data;generation++;return data;}).catch(error=>{loading=null;throw error;});
 return loading;
}
export const ascendedMediaVersion=()=>generation;
function safeSource(url){try{const u=new URL(url,typeof location==='undefined'?'https://site.invalid/':location.href);return u.protocol==='https:'||u.protocol==='http:'?String(url):'';}catch{return '';}}
export function buildAscendedCatalogue(champions,skins,card,owned={}){
 const rows=new Map(),all=Object.values(skins);
 const add=(skinId,record)=>{
  const skin=skins[skinId];if(!skin)return;
  const base=card(Number(skinId));if(!base?.img)return;
  const sources=record?[record.local,record.url].map(safeSource).filter(Boolean):[];
  const candidate={...base,rarity:'ascended',ascended:true,theme:themeFor(base.name),media:record?{file:record.file,page:record.page||'',sources:[...new Set(sources)]}:null};
  const old=rows.get(Number(skinId));
  if(!old||(!old.media&&candidate.media)||(record?.local&&!old.media?.sources?.[0]?.startsWith('./assets/')))rows.set(Number(skinId),candidate);
 };
 for(const record of manifest.records){
  const file=String(record.file||'');if(!/\.(webm|mp4)$/i.test(file)||/\b(old|unused|intro|static)\b/i.test(file))continue;
  const override=ASCENDED_SKIN_OVERRIDES[file];if(override){for(const id of override)add(id,record);continue;}
  const stem=norm(file.replace(/\.(webm|mp4)$/i,''));
  for(const c of champions){
   const aliases=[norm(c.id),norm(c.name)].filter(Boolean);let rest='';
   const prefix=aliases.find(x=>stem.startsWith(x));
   if(prefix)rest=stem.slice(prefix.length);else continue;
   const pos=rest.lastIndexOf('skin');if(pos<0||pos+4!==rest.length)continue;
   const token=rest.slice(0,pos);
   const eligible=all.filter(s=>Math.floor(Number(s.id)/1000)===Number(c.key));
   let matches;
   if(token==='original')matches=eligible.filter(s=>s.isBase);
   else matches=eligible.filter(s=>{
    if(s.isBase)return false;let name=norm(s.name);
    const without=aliases.reduce((value,a)=>value.split(a).join(''),name);
    return name===token||without===token;
   });
   if(matches.length===1)add(matches[0].id,record);
  }
 }
 // Les dix identifiants de la première version restent valides et ne sont jamais convertis.
 for(const c of champions)if(LEGACY_ASCENDED_CHAMPIONS.includes(c.id))add(Number(c.key)*1000,null);
 for(const [id,qty] of Object.entries(owned||{}))if(qty>0)add(Number(id),null);
 return [...rows.values()].sort((a,b)=>a.name.localeCompare(b.name,'fr')||a.id-b.id);
}
function themeFor(name){const n=norm(name);if(/ashe|anivia|lissandra/.test(n))return 'ice';if(/thresh|viego|hecarim/.test(n))return 'mist';if(/lux|leona|azir/.test(n))return 'sun';if(/jinx|brand/.test(n))return 'ember';if(/yasuo|janna/.test(n))return 'wind';return 'stars';}
export function awardAscendedBonus(state,catalogue,{channel='booster',enabled=ASCENDED_CONFIG.enabled,chance=channel==='recycle'?ASCENDED_CONFIG.recycleChance:ASCENDED_CONFIG.boosterChance,random=Math.random,now=Date.now()}={}){
 if(!enabled||!Number.isFinite(chance)||chance<=0||chance>1||!catalogue.length||random()>=chance)return null;
 const card=catalogue[Math.min(catalogue.length-1,Math.max(0,Math.floor(random()*catalogue.length)))],key=String(card.id),qty=state.ascendedCards?.[key]||0;
 if(!Number.isSafeInteger(qty)||qty<0)throw new Error('Inventaire Ascendant invalide.');
 state.ascendedCards={...(state.ascendedCards||{}),[key]:qty+1};state.ascendedObtained={...(state.ascendedObtained||{})};
 if(state.ascendedObtained[key]===undefined)state.ascendedObtained[key]=now;
 return {...card};
}
function mediaHTML(c,splash=false){
 return `<span class="asc-media asc-${H(c.theme||'stars')} ${splash?'asc-splash':''}" data-asc-media="${Number(c.id)}"><img class="asc-poster" loading="lazy" referrerpolicy="no-referrer" src="${H(splash?(c.splash||c.img):c.img)}" data-asc-fallback="${H(splash?(c.splashAlt||c.imgAlt||c.img):(c.imgAlt||c.img))}" alt="${H(c.name)} — ${H(c.skinName)}"><span class="asc-aura" aria-hidden="true"></span><span class="asc-particles" aria-hidden="true">${Array.from({length:8},(_,i)=>`<i style="--i:${i}"></i>`).join('')}</span><span class="asc-shine" aria-hidden="true"></span><span class="asc-media-state">${c.media?.sources?.length?'Animation vidéo':'Effets CSS'}</span></span>`;
}
export function ascendedCardHTML(c,qty=0,preview=false){
 return `<button type="button" class="asc-card ${preview?'asc-preview':''}" data-ascended-id="${Number(c.id)}" aria-label="${H(c.name)} ${H(c.skinName)}, Ascendante${preview?', aperçu non possédé':''}"><span class="asc-badge">Ascendante</span>${qty>1?`<span class="asc-qty">×${qty}</span>`:''}${mediaHTML(c)}<span class="asc-caption"><strong>${H(c.name)}</strong><small>${H(c.skinName)}</small>${preview?'<small>Aperçu · non possédée</small>':''}</span></button>`;
}
export function playAscendedReveal(el,c){
 return new Promise(resolve=>{
  const root=document.getElementById('reveal');if(!root||!el){resolve();return;}
  cancelReveal();const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches||document.documentElement.classList.contains('asc-motion-off');
  const overlay=document.createElement('div');overlay.className='asc-reveal-overlay';overlay.setAttribute('role','status');
  overlay.innerHTML=`<div class="asc-reveal-halo"></div><div class="asc-seal" aria-hidden="true">✧</div><p class="asc-reveal-title">ASCENDANTE</p><p class="asc-reveal-name">${H(c.name)} · ${H(c.skinName)}</p>`;
  root.appendChild(overlay);el.classList.add('asc-await');let done=false;const timers=[];
  const finish=()=>{if(done)return;done=true;timers.forEach(clearTimeout);overlay.remove();el.classList.remove('asc-await');resolve();};cancelReveal=finish;
  timers.push(setTimeout(()=>{el.classList.add('flipped','fx-ascended');overlay.classList.add('asc-unsealed');refreshMedia();},reduced?80:1000));
  timers.push(setTimeout(finish,reduced?350:2400));
 });
}
export function initAscended(api){
 const root=api.root,players=new Map();let owner=null,signature='',lastFocus=null,currentCard=null,frame=0,motion=true;
 try{motion=localStorage.getItem('runeterra-ascended-motion')!=='off';}catch{}
 const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');const canAnimate=()=>motion&&!reduced?.matches;
 const dialog=document.createElement('dialog');dialog.id='ascendedDialog';dialog.className='asc-dialog';document.body.appendChild(dialog);
 const stop=p=>{if(p.video)p.video.pause();};
 const observer=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(entries=>{for(const e of entries){const p=players.get(e.target);if(p)p.visible=e.isIntersecting;}schedule();},{threshold:.2}):null;
 function source(p,index){
  const sources=p.card.media?.sources||[];if(index>=sources.length){p.failed=true;p.video?.remove();p.video=null;p.el.classList.remove('asc-is-video');const s=p.el.querySelector('.asc-media-state');if(s)s.textContent='Vidéo indisponible · CSS';return;}
  const v=p.video||document.createElement('video');p.video=v;p.index=index;v.className='asc-video';v.muted=true;v.defaultMuted=true;v.loop=true;v.playsInline=true;v.controls=p.el.classList.contains('asc-splash');v.preload='metadata';v.setAttribute('aria-label',`${p.card.name} : illustration animée`);
  v.onloadeddata=()=>{p.el.classList.add('asc-is-video');const s=p.el.querySelector('.asc-media-state');if(s)s.textContent='Illustration animée';};
  v.onerror=()=>source(p,index+1);v.src=sources[index];if(!v.isConnected)p.el.appendChild(v);v.play()?.catch(()=>{});
 }
 function schedule(){if(frame)return;frame=requestAnimationFrame(()=>{frame=0;updatePlayers();});}
 function updatePlayers(){
  const visible=[];
  for(const [el,p] of players){if(!el.isConnected){stop(p);if(p.video){p.video.removeAttribute('src');p.video.load();}observer?.unobserve(el);players.delete(el);continue;}
   const ancestorHidden=el.closest('[hidden]')||el.closest('.flip:not(.flipped)');const splash=el.classList.contains('asc-splash');
   const reveal=document.getElementById('reveal');const revealing=reveal&&!reveal.hidden;
   const allowed=canAnimate()&&!document.hidden&&!ancestorHidden&&p.visible&&(!dialog.open||splash)&&(!revealing||splash||reveal.contains(el));
   if(!allowed||p.failed||!p.card.media?.sources?.length){stop(p);continue;}visible.push(p);
  }
  let thumbnails=0;const selected=new Set();
  for(const p of visible){const splash=p.el.classList.contains('asc-splash');if(splash||thumbnails++<ASCENDED_CONFIG.maxPlayingThumbnails)selected.add(p);}
  for(const p of players.values()){if(!selected.has(p)){stop(p);continue;}if(!p.video)source(p,0);else p.video.play()?.catch(()=>{});}
 }
 function hydrate(){
  const catalog=api.catalogue();for(const el of document.querySelectorAll('[data-asc-media]')){if(players.has(el))continue;const card=catalog.find(c=>Number(c.id)===Number(el.dataset.ascMedia))||api.resolveCard?.(Number(el.dataset.ascMedia));if(!card)continue;players.set(el,{el,card,video:null,visible:!observer,failed:false,index:0});observer?.observe(el);}
  schedule();
 }
 refreshMedia=hydrate;
 const mutations=new MutationObserver(()=>hydrate());mutations.observe(document.body,{childList:true,subtree:true});
 function close(){for(const [el,p] of players)if(dialog.contains(el)){stop(p);p.video?.removeAttribute('src');p.video?.load();observer?.unobserve(el);players.delete(el);}if(dialog.open)dialog.close();dialog.innerHTML='';currentCard=null;lastFocus?.focus?.();lastFocus=null;schedule();}
 function open(c,showcaseOwner=''){
  close();currentCard=c;lastFocus=document.activeElement;const qty=api.state()?.ascendedCards?.[c.id]||0;
  dialog.innerHTML=`<div class="asc-modal-head"><h2>${H(c.name)} · ${H(c.skinName)} · Ascendante</h2><button type="button" class="btn" data-asc-close autofocus>Fermer</button></div>${mediaHTML(c,true)}<p>${showcaseOwner?`Vitrine de ${H(showcaseOwner)}. `:''}${qty?`Dans ta collection : ${qty} exemplaire(s).`:'Tu ne possèdes pas cette variante.'}</p>${c.media?.page?`<p class="asc-muted">Animation : <a href="${H(c.media.page)}" target="_blank" rel="noopener noreferrer">source sur le LoL Wiki</a>. League of Legends © Riot Games.</p>`:'<p class="asc-muted">Illustration fixe avec effets CSS de remplacement.</p>'}`;
  if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');hydrate();
 }
 function syncMotion(){document.documentElement.classList.toggle('asc-motion-off',!canAnimate());schedule();}
 function render(){
  const uid=api.user()?.uid;if(uid!==owner){close();cancelReveal();owner=uid;signature='';}
  if(!uid){root.innerHTML='';return;}const f=api.filters();root.hidden=Boolean(f.rarity&&f.rarity!=='ascended');syncMotion();if(root.hidden)return;
  const s=api.state()||{},catalog=api.catalogue(),q=norm(f.query||''),qty=c=>s.ascendedCards?.[c.id]||0,time=c=>s.ascendedObtained?.[c.id]||0;
  let cards=catalog.filter(c=>(!q||norm(c.name+' '+c.skinName).includes(q))&&(!f.owned||qty(c)>0)&&(!f.dupes||qty(c)>1));
  cards.sort((a,b)=>f.sort==='recent'?time(b)-time(a)||a.name.localeCompare(b.name,'fr'):f.sort==='oldest'?time(a)-time(b)||a.name.localeCompare(b.name,'fr'):f.sort==='dupes'?qty(b)-qty(a)||a.name.localeCompare(b.name,'fr'):a.name.localeCompare(b.name,'fr')||a.id-b.id);
  const sig=JSON.stringify([uid,f,s.ascendedCards,s.ascendedObtained,generation,motion,reduced?.matches]);if(sig===signature){hydrate();return;}signature=sig;
  root.innerHTML=`<header class="asc-header"><div><p class="asc-kicker">Nouvelle rareté · variantes séparées</p><h2>Ascendantes <small>${catalog.filter(c=>qty(c)>0).length} / ${catalog.length}</small></h2><p>0,1 % par booster : une sixième carte en supplément. Recyclage : 0,1 % de bonus par carte fabriquée.</p><p class="asc-muted">${catalog.filter(c=>c.media?.sources?.length).length} variantes associées à une vidéo du catalogue. Lecture selon disponibilité du fichier ; effets CSS de secours. Les introductions, doublons et fichiers non identifiés ne sont pas transformés au hasard en cartes.</p><p class="asc-muted">Inventaire distinct : aucune carte normale n’est convertie. Ascendantes non échangeables, non recyclables et non équipables dans cette version.</p></div><label class="asc-motion"><input type="checkbox" data-asc-motion ${motion?'checked':''}> Animations${reduced?.matches?' (réduites par le système)':''}</label></header><div class="asc-grid">${cards.map(c=>ascendedCardHTML(c,qty(c),!qty(c))).join('')||'<p>Aucune Ascendante ne correspond aux filtres.</p>'}</div>`;hydrate();
 }
 document.addEventListener('click',e=>{const b=e.target.closest?.('[data-ascended-id]');if(!b||b.closest('.flip:not(.flipped)'))return;const c=api.catalogue().find(x=>x.id===Number(b.dataset.ascendedId))||api.resolveCard?.(Number(b.dataset.ascendedId));if(c&&api.user())open(c,b.closest('[data-showcase-owner]')?.dataset.showcaseOwner||'');});
 document.addEventListener('error',e=>{const img=e.target;if(img.tagName==='IMG'&&img.dataset.ascFallback&&!img.dataset.ascFailed){img.dataset.ascFailed='1';img.src=img.dataset.ascFallback;}},true);
 root.addEventListener('change',e=>{if(e.target.matches('[data-asc-motion]')){motion=e.target.checked;try{localStorage.setItem('runeterra-ascended-motion',motion?'on':'off');}catch{}signature='';syncMotion();render();}});
 dialog.addEventListener('click',e=>{if(e.target===dialog||e.target.closest('[data-asc-close]'))close();});dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('close',()=>{if(!dialog.open){for(const p of players.values())if(dialog.contains(p.el))stop(p);}});
 document.addEventListener('visibilitychange',schedule);reduced?.addEventListener?.('change',()=>{signature='';syncMotion();render();});
 return {render,refresh:hydrate,close(){cancelReveal();close();owner=null;signature='';root.innerHTML='';for(const p of players.values())stop(p);}};
}
