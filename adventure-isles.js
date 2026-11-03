import { RELICS, ENEMIES, emptyProgress, intent } from './adventure-isles-engine.js?v=isles-1';
export { transition } from './adventure-isles-engine.js?v=isles-1';
const H=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Math.round(n).toLocaleString('fr-FR');
export function initIslesAdventure(api){
 const root=api.root;let owner=null,progress=emptyProgress(),busy=false,error='',epoch=0;
 const button=(label,type,id='',disabled=false)=>`<button type="button" class="btn exp-button" data-exp-type="${H(type)}" data-exp-id="${H(id)}" ${busy||disabled?'disabled':''}>${label}</button>`;
 const portrait=id=>{const p=api.portrait(id);return p?`<img class="exp-portrait" loading="lazy" src="${H(p.img)}" data-fallback="${H(p.imgAlt || p.img)}" alt="${H(p.name)}">`:'';};
 const card=u=>`<article class="exp-unit"><img loading="lazy" src="${H(u.img)}" data-fallback="${H(u.imgAlt || u.img)}" alt="${H(u.name)}"><div><strong>${H(u.name)}</strong><small>${fmt(u.hp)} PV · ${fmt(u.ad)} AD · ${fmt(u.ap)} AP</small></div></article>`;
 const relicCard=x=>`<h4>${H(x.name)}</h4><p>${H(x.text)}</p>`;
 function render(){
  if(!owner||api.user()?.uid!==owner){root.innerHTML='<p>Connecte-toi pour jouer.</p>';return;}
  const ctx=api.context(),r=progress.run;
  const active=r&&!['won','lost','abandoned'].includes(r.stage);
  const missing=active&&r.team.some(u=>!ctx.owned.includes(u.id));
  let content='';
  if(!r||!active){
   const title=r?.stage==='won'?'Les chaînes sont brisées !':r?.stage==='lost'?'La Brume vous a vaincu':r?.stage==='abandoned'?'Expédition abandonnée':'Une nouvelle traversée';
   content=`<div class="exp-panel"><h3>${title}</h3><p>Un parcours à choix, trois champions, des reliques et des PV conservés entre les combats. Les combats se jouent au tour par tour : rien ne s’écoule lorsque tu quittes la page.</p>
   ${r?`<p>Dernier parcours : ${r.cleared.length} rencontre(s) gagnée(s) · ${r.totalTurns} tours.</p>`:''}
   <p>Victoires du chapitre : ${progress.records.wins}${progress.records.bestTurns?` · Meilleur parcours : ${progress.records.bestTurns} tours`:''}.</p>
   ${!ctx.unlocked?'<p class="exp-warning">Termine les quatre rencontres des Îles obscures sur la carte de la campagne pour accéder à cette suite.</p>':''}
   <h4>Équipe du prochain départ</h4><div class="exp-team">${ctx.team.map(card).join('')||'<p>Aucune carte sélectionnée.</p>'}</div>
   <p>Il faut trois champions différents. Les statistiques de niveau 9, les bonus de rareté et les objets actuels de l’Aventure sont copiés au départ. Les achats faits ensuite n’affectent pas ce parcours.</p>
   <div class="exp-actions">${button(r?'Recommencer le chapitre':'Commencer le chapitre','start','',!ctx.unlocked||ctx.team.length!==3||new Set(ctx.team.map(u=>Math.floor(u.id/1000))).size!==3)}${button('Équipe & boutique','team')}</div></div>`;
  }else{
   const names=['Relique','Maokai','Embranchement','Événement','Camp','Thresh'];
   const step=r.stage==='relic'?(r.next==='Maokai'?0:4):r.stage==='battle'?(r.battle.id==='Maokai'?1:r.battle.id==='Thresh'?5:2):({crossroads:2,event:3,camp:4}[r.stage]??0);
   content=`<ol class="exp-steps">${names.map((n,i)=>`<li class="${i===step?'current':i<step?'passed':''}" ${i===step?'aria-current="step"':''}>${i+1}. ${n}</li>`).join('')}</ol>
   <div class="exp-panel"><div class="exp-status"><span>PV du groupe : <strong>${fmt(r.hp)} / ${fmt(r.maxHP)}</strong></span><span>${fmt(r.coins)} pièces d’expédition</span></div><div class="exp-hp"><span style="width:${Math.max(0,Math.min(100,r.hp/r.maxHP*100))}%"></span></div><div class="exp-team exp-team-small">${r.team.map(card).join('')}</div></div>`;
   if(missing)content+='<p class="exp-warning">Une carte du parcours n’est plus dans ta collection. Les actions sont suspendues : récupère cette carte ou abandonne l’expédition.</p>';
   if(r.stage==='relic')content+=`<div class="exp-panel"><h3>Choisis une bénédiction de relique</h3><p>Un seul choix parmi ces trois propositions. Maximum : trois reliques différentes. Les effets ci-dessous sont adaptés au mini-jeu, pas ceux des objets officiels.</p><div class="exp-grid">${r.choices.map(id=>{const x=RELICS.find(z=>z.id===id);return `<article class="exp-choice">${relicCard(x)}${button('Choisir cette relique','relic',id,missing)}</article>`;}).join('')}</div></div>`;
   if(r.stage==='crossroads')content+=`<div class="exp-panel"><h3>Deux routes dans la Brume</h3><p>Choisis un seul adversaire. Les pièces ne servent qu’au camp de cette expédition.</p><div class="exp-grid">${['Kalista','Hecarim'].map(id=>`<article class="exp-choice">${portrait(id)}<h4>${id}</h4><p>${H(ENEMIES[id].text)}</p>${button(`Prendre la route de ${id}`,'route',id,missing)}</article>`).join('')}</div></div>`;
   if(r.stage==='event')content+=`<div class="exp-panel"><h3>Des âmes dans la Brume noire</h3>${portrait('Senna')}<p>Senna guide des âmes vers un refuge. Deux possibilités s’offrent à votre groupe.</p><div class="exp-grid"><article class="exp-choice"><h4>Aider Senna</h4><p>Récupère 18 % des PV maximum, sans gagner de pièces.</p>${button('Libérer les âmes','event','rescue',missing)}</article><article class="exp-choice"><h4>Explorer la Brume</h4><p>Perds 12 % des PV maximum et gagne 140 pièces d’expédition. Ce choix peut provoquer une défaite.</p>${button('Prendre le risque','event','risk',missing)}</article></div></div>`;
   if(r.stage==='camp')content+=`<div class="exp-panel"><h3>Le refuge des Sentinelles</h3><p>Prépare le dernier combat. Les pièces restantes disparaissent à la fin du parcours ; ton or de campagne ne sera jamais dépensé ici.</p><div class="exp-grid"><article class="exp-choice"><h4>Repos au refuge</h4><p>100 pièces : récupère 25 % des PV maximum.</p>${button('Se reposer · 100','camp','heal',missing||r.coins<100||r.hp>=r.maxHP)}</article><article class="exp-choice"><h4>Une nouvelle relique</h4><p>150 pièces : choisis une relique parmi trois. ${r.relics.length} / 3 emplacements occupés.</p>${button('Choisir une relique · 150','camp','relic',missing||r.coins<150||r.relics.length>=3)}</article></div><div class="exp-actions">${button('Affronter Thresh','camp','boss',missing)}</div></div>`;
   if(r.stage==='battle'){
    const b=r.battle,e=ENEMIES[b.id],phase=intent(b);
    const intention=phase==='warning'?'Frappe lourde ce tour : Protéger réduit les dégâts de 80 %.':phase==='exposed'?'Point faible ouvert : tes attaques infligent +60 % de dégâts et l’attaque ennemie est affaiblie.':'Attaque normale : prépare ta prochaine action.';
    content+=`<div class="exp-panel exp-battle" data-phase="${phase}"><div class="exp-enemy">${portrait(b.id)}<div><h3>${H(e.name)} · tour ${b.turn}</h3><p>${H(e.text)}</p><p>${fmt(b.hp)} / ${fmt(e.hp)} PV · Dégâts ${e.type==='physical'?'physiques':'magiques'}</p></div></div><div class="exp-hp exp-hp-enemy"><span style="width:${Math.max(0,b.hp/e.hp*100)}%"></span></div><p class="exp-intent">${intention}</p><div class="exp-skills">
    ${button('Attaquer<br><small>Attaque normale du groupe</small>','combat','attack',missing)}
    ${button(`Assaut<br><small>${b.cd?`Recharge : ${b.cd} action(s)`:'×1,8 dégâts · recharge 3 actions'}</small>`,'combat','burst',missing||b.cd>0)}
    ${button('Protéger<br><small>−80 % de dégâts directs et petite riposte</small>','combat','guard',missing)}
    ${button(`Ralliement<br><small>Soin · ${b.heals} utilisation(s) restante(s)</small>`,'combat','heal',missing||b.heals===0||r.hp>=r.maxHP)}
    </div><p class="exp-muted">Chaque action valide joue un tour complet. Le boss annonce son action avant ton choix. Les effets secondaires sont décrits ci-dessus. Limite : 80 tours par combat.</p></div>`;
   }
   content+=`<div class="exp-panel"><h3>Reliques du parcours · ${r.relics.length} / 3</h3><div class="exp-grid">${r.relics.map(id=>`<article class="exp-choice">${relicCard(RELICS.find(x=>x.id===id))}${id==='guardian'&&r.guardianUsed?'<small>Résurrection déjà utilisée.</small>':''}</article>`).join('')||'<p>Aucune relique pour le moment.</p>'}</div></div><div class="exp-actions">${button('Actualiser la sauvegarde','refresh')}${button('Abandonner l’expédition','abandon')}</div>`;
  }
  root.innerHTML=`<header class="exp-hero"><p class="exp-kicker">Aventure · chapitre supplémentaire</p><h2 data-exp-heading tabindex="-1">Les Îles obscures</h2><p>Une traversée de la Brume noire. Un parcours original, non officiel.</p><p class="exp-muted">Version 1 : progression sauvegardée, sans récompense de collection ni fragments d’Ascension.</p></header>
   <p class="exp-message" role="status" aria-live="polite">${busy?'Sauvegarde de ton action…':H(error)}</p>${content}
   ${r?`<details class="exp-panel" ${active?'open':''}><summary>Journal du parcours</summary><ol class="exp-log">${r.log.map(t=>`<li>${H(t)}</li>`).join('')}</ol></details>`:''}`;
 }
 async function execute(type,id){
  if(busy)return;
  if(type==='team'){api.teamPage();return;}
  if(type==='abandon'&&!globalThis.confirm('Abandonner ce parcours ? Ses reliques et ses pièces seront perdues, mais pas ta collection ni ton or de campagne.'))return;
  const uid=owner,token=epoch;busy=true;error='';render();
  try{
   let next;
   if(type==='refresh')next=await api.reload();
   else next=await api.commit({type,id:type==='start'?(globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`):id},progress.revision);
   if(token!==epoch||api.user()?.uid!==uid)return;
   progress=next||emptyProgress();
  }catch(e){
   if(token!==epoch||api.user()?.uid!==uid)return;
   error=e.code==='permission-denied'?'Firestore refuse la sauvegarde. Les règles doivent autoriser le champ advExpedition pour le compte connecté. Aucune progression locale de remplacement n’a été utilisée.':e.message;
   if(e.code==='expedition/conflict'){try{progress=await api.reload()||emptyProgress();}catch{}}
  }finally{
   if(token===epoch&&api.user()?.uid===uid){busy=false;render();root.querySelector('[data-exp-heading]')?.focus({preventScroll:true});}
  }
 }
 root.addEventListener('error',e=>{const img=e.target;if(img.tagName==='IMG'&&img.dataset.fallback&&!img.dataset.failed){img.dataset.failed='1';img.src=img.dataset.fallback;}},true);
 root.addEventListener('click',e=>{const b=e.target.closest('[data-exp-type]');if(b&&!b.disabled&&root.contains(b))void execute(b.dataset.expType,b.dataset.expId);});
 return {
  open(){const uid=api.user()?.uid;if(owner!==uid){epoch++;busy=false;error='';owner=uid;progress=api.progress()||emptyProgress();}else if(!busy)progress=api.progress()||emptyProgress();render();},
  sync(){if(root.hidden)return;const uid=api.user()?.uid;if(uid!==owner){this.open();return;}const next=api.progress();if(!busy&&next&&(next.revision||0)>=(progress.revision||0)){progress=next;render();}},
  close(){epoch++;owner=null;busy=false;progress=emptyProgress();error='';root.innerHTML='<p>Connecte-toi pour jouer.</p>';}
 };
}
