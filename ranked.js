import { doc, runTransaction } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

// Chasse aux boss : prototype d'entraînement uniquement.
// Aucun point, récompense, reset hebdomadaire ou recherche de joueurs.
// Interface conservée : initRanked({ db, user, champions, card, week }).
const ROLES = ["Top", "Jungle", "Mid", "ADC", "Support"];
const POOL = {
  Top:["Garen","Darius","Fiora","Camille","Ornn","Malphite","Sett","Shen","Renekton","Aatrox","Jax","Gwen","Teemo","Nasus","Riven","Poppy","Tryndamere","Irelia","Yorick","Sion"],
  Jungle:["Warwick","Vi","LeeSin","MasterYi","Amumu","Sejuani","Volibear","Khazix","Rengar","Evelynn","Nocturne","Nunu","Hecarim","Udyr","Gragas","Briar","Lillia","Kayn","Kindred","Viego"],
  Mid:["Ahri","Lux","Annie","Viktor","Syndra","Orianna","Zed","Yasuo","Yone","Veigar","Katarina","Akali","Azir","Vex","Malzahar","Zoe","Leblanc","Taliyah","Anivia","AurelionSol"],
  ADC:["Ashe","Caitlyn","Jinx","Ezreal","MissFortune","Jhin","Lucian","Vayne","Kaisa","Tristana","Xayah","Sivir","Varus","Draven","Aphelios","KogMaw","Kalista","Samira","Nilah","Smolder"],
  Support:["Braum","Leona","Nautilus","Thresh","Lulu","Soraka","Sona","Nami","Janna","Yuumi","Rakan","Milio","Renata","Blitzcrank","Karma","Alistar","Taric","Zilean","Bard","Senna"]
};
const ROLE_TEXT = [
  "Front solide : réduit tous les dégâts subis par le groupe de 12 %.",
  "Exploitation : augmente de 15 % les dégâts d'Assaut pendant la surchauffe.",
  "Attaques magiques : 9 dégâts par seconde de base.",
  "Tir soutenu : 12 dégâts par seconde de base.",
  "Soutien : augmente le soin de 150 à 180 PV."
];
const DPS = [5,7,9,12,4];
const C = {
  maxTime:60, teamHP:1000, bossHP:2700, normalTime:3,
  armorTime:2, warningTime:2.5, exposedTime:3,
  normalHit:28, normalInterval:1.2, heavyHit:360,
  shieldDuration:1.1, shieldCooldown:8, shieldReduction:0.8,
  healAmount:180, healCooldown:18, assaultDamage:220, assaultCooldown:12,
  armorMultiplier:0.25, exposedMultiplier:1.6, exposedAssaultMultiplier:2.4
};
const H = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clone = x => JSON.parse(JSON.stringify(x));
const freshFight = () => ({
  time:0,hp:C.teamHP,boss:C.bossHP,phase:"normal",phaseTime:0,
  basicTimer:0,attackTimer:0,shield:0,cd:{shield:0,heal:0,assault:0},
  stats:{blocked:0,missed:0,goodAssaults:0,badAssaults:0,healed:0,damage:0},
  events:[],eventId:0,result:null
});
function event(f,text,kind="info") {
  f.events.unshift({id:++f.eventId,text,kind});f.events=f.events.slice(0,8);
}
function bossMultiplier(f) {
  return f.phase==="armor"?C.armorMultiplier:f.phase==="exposed"?C.exposedMultiplier:1;
}
function damageBoss(f,amount,text="",kind="hit") {
  const actual=Math.min(f.boss,Math.round(amount));
  f.boss-=actual;f.stats.damage+=actual;
  if(text)event(f,`${text} : −${actual} PV au Gardien.`,kind);
  if(f.boss<=0)f.result="win";
  return actual;
}
function damageTeam(f,amount,heavy=false) {
  const protectedNow=f.shield>0;
  const actual=Math.round(amount*.88*(protectedNow?1-C.shieldReduction:1));
  f.hp=Math.max(0,f.hp-actual);
  if(heavy){
    if(protectedNow){f.stats.blocked++;event(f,`Frappe bloquée ! Seulement ${actual} dégâts subis.`,"good");}
    else{f.stats.missed++;event(f,`Frappe lourde : −${actual} PV. Protège-toi juste avant l'impact.`,"bad");}
  }
  if(f.hp<=0)f.result="loss";
  return actual;
}
function useAbility(f,ability) {
  if(f.result || !(ability in f.cd) || f.cd[ability]>.001)return false;
  if(ability==="shield"){
    f.cd.shield=C.shieldCooldown;f.shield=C.shieldDuration;
    event(f,"Protection active pendant 1,1 seconde.","shield");return true;
  }
  if(ability==="heal"){
    if(f.hp>=C.teamHP)return false;
    const amount=Math.min(C.healAmount,C.teamHP-f.hp);
    f.hp+=amount;f.stats.healed+=amount;f.cd.heal=C.healCooldown;
    event(f,`Soin : +${amount} PV.`,"heal");return true;
  }
  f.cd.assault=C.assaultCooldown;
  const exposed=f.phase==="exposed";
  const mult=exposed?C.exposedAssaultMultiplier*1.15:bossMultiplier(f);
  if(exposed)f.stats.goodAssaults++;
  if(f.phase==="armor")f.stats.badAssaults++;
  damageBoss(f,C.assaultDamage*mult,exposed?"Assaut sur point faible !":f.phase==="armor"?"Assaut freiné par la carapace":"Assaut",exposed?"good":"hit");
  return true;
}
function tickFight(f,dt) {
  if(f.result)return;
  dt=Math.max(0,Math.min(dt,C.maxTime-f.time));
  f.time+=dt;f.phaseTime+=dt;
  f.shield=Math.max(0,f.shield-dt);
  Object.keys(f.cd).forEach(k=>f.cd[k]=Math.max(0,f.cd[k]-dt));
  f.attackTimer+=dt;
  while(f.attackTimer>=.5 && !f.result){
    f.attackTimer-=.5;
    damageBoss(f,DPS.reduce((a,b)=>a+b,0)*.5*bossMultiplier(f));
  }
  if(f.result)return;
  if(f.phase==="normal" || f.phase==="armor"){
    f.basicTimer+=dt;
    while(f.basicTimer>=C.normalInterval && !f.result){f.basicTimer-=C.normalInterval;damageTeam(f,C.normalHit);}
  }
  if(f.result)return;
  const duration={normal:C.normalTime,armor:C.armorTime,warning:C.warningTime,exposed:C.exposedTime}[f.phase];
  if(f.phaseTime+1e-8>=duration){
    f.phaseTime=0;f.basicTimer=0;
    if(f.phase==="normal"){
      f.phase="armor";event(f,"Carapace renforcée : garde ton Assaut, dégâts reçus par le boss réduits de 75 %.","info");
    }else if(f.phase==="armor"){
      f.phase="warning";event(f,"Frappe lourde dans 2,5 secondes : attends le dernier instant pour Protéger.","warn");
    }else if(f.phase==="warning"){
      damageTeam(f,C.heavyHit,true);f.phase="exposed";
      if(!f.result)event(f,"Surchauffe pendant 3 secondes : c'est le moment d'utiliser Assaut !","good");
    }else{f.phase="normal";event(f,"Le Gardien reprend ses attaques normales.","info");}
  }
  if(f.time+1e-8>=C.maxTime && !f.result){f.result="timeout";event(f,"Temps écoulé : le Gardien est toujours debout.","bad");}
}
const PHASES = {
  normal:["Attaques normales","Les champions attaquent seuls. Garde Protéger pour la frappe lourde."],
  armor:["Carapace renforcée","Le Gardien absorbe 75 % des dégâts. Économise Assaut."],
  warning:["Frappe lourde imminente","La protection dure seulement 1,1 seconde : attends la fin du compte à rebours."],
  exposed:["Surchauffe : point faible ouvert !","Utilise Assaut : 607 dégâts environ avec le bonus du Jungler."]
};

const BOSS_SVG = `<svg viewBox="0 0 320 320" role="img" aria-label="Gardien hextech, golem mécanique">
<defs><linearGradient id="hbSteel" x2="0" y2="1"><stop stop-color="#718da3"/><stop offset="1" stop-color="#1e344b"/></linearGradient><radialGradient id="hbCore"><stop stop-color="#fff"/><stop offset=".4" stop-color="#76ecff"/><stop offset="1" stop-color="#098cae"/></radialGradient></defs>
<ellipse cx="160" cy="290" rx="105" ry="17" fill="#000" opacity=".35"/>
<g class="hb-body" stroke="#0d1c2b" stroke-width="5" stroke-linejoin="round">
<path d="M109 224L145 224L140 281L105 281Z M175 224L211 224L215 281L180 281Z" fill="url(#hbSteel)"/>
<g class="hb-arm left"><path d="M94 110L57 118L38 186L68 203L103 155Z" fill="url(#hbSteel)"/><path d="M36 181L75 190L72 226L31 217Z" fill="#8499a6"/></g>
<g class="hb-arm right"><path d="M226 110L263 118L282 186L252 203L217 155Z" fill="url(#hbSteel)"/><path d="M245 184L290 175L300 220L250 231Z" fill="#8499a6"/></g>
<path d="M101 98L219 98L240 155L211 235L109 235L80 155Z" fill="url(#hbSteel)"/>
<path d="M119 42L201 42L213 96L107 96Z" fill="#829dab"/>
<path d="M127 60L150 66L145 76L125 73Z M193 60L170 66L175 76L195 73Z" fill="#8bf5ff" stroke="none"/>
<circle cx="160" cy="159" r="43" fill="#122336" stroke="#a7becb"/>
<circle class="hb-core" cx="160" cy="159" r="30" fill="url(#hbCore)" stroke="#59dbff"/>
<path d="M160 137L173 158L159 182L147 158Z" fill="#d9ffff" stroke="none"/>
<path class="hb-armor" d="M116 125L160 140L204 125L208 194L160 213L112 194Z" fill="#4399e5" fill-opacity=".7" stroke="#95d9ff"/>
</g></svg>`;

export function initRanked(api) {
  const root=document.getElementById("rankedRoot");
  if(!root)throw new Error("Il manque rankedRoot dans index.html.");
  let cards={},team=[0,0,0,0,0],savedTeam=[],fight=null,paused=false,busy=false;
  let note="",frame=0,last=0,acc=0,paintClock=0,sequence=0,owner=null,ready=false;
  let seenEvent=0,previousPhase="",hitUntil=0,healUntil=0,teamHitUntil=0,previousHP=0,previousBoss=0;
  const $=id=>root.querySelector(`#${id}`);
  const champ=id=>api.champions().find(c=>Number(c.key)===Math.floor(Number(id)/1000));
  function validate(input,owned){
    const seen=new Set();
    return ROLES.map((role,i)=>{
      const id=Number(input?.[i])||0,c=champ(id);
      if(!c || !POOL[role].includes(c.id) || !(owned[id]>0) || seen.has(c.id))return 0;
      seen.add(c.id);return id;
    });
  }
  function styles(){
    if(document.getElementById("hex-boss-style-v1"))return;
    const el=document.createElement("style");el.id="hex-boss-style-v1";
    el.textContent=`
#rankedRoot{color:#e6edf7}#rankedRoot *{box-sizing:border-box}
.hb-head,.hb-actions,.hb-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.hb-head{margin:12px 0}.hb-head h2{margin:0 auto 0 0}.hb-tag{background:#243a45;border:1px solid #568b92;border-radius:99px;padding:7px 12px;font-size:13px}
.hb-box{padding:16px;background:#141f2f;border:1px solid #364c64;border-radius:14px;margin:14px 0;line-height:1.65}.hb-box h3{margin:0 0 6px}.hb-picks{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}.hb-pick{padding:12px;background:#172337;border:1px solid #344b68;border-radius:12px;min-width:0}.hb-pick select{display:block;width:100%;background:#0c1624;color:#fff;border:1px solid #4c6580;border-radius:8px;padding:9px;margin:8px 0;font-size:16px}.hb-pick small{display:block;color:#b7c9db;font-size:12px}
.hb-stage{position:relative;overflow:hidden;border:1px solid #3f546d;border-radius:18px;background:radial-gradient(ellipse at 72% 40%,#214665 0%,#152431 40%,#090f1c 85%);min-height:350px;display:grid;grid-template-columns:1fr 1.15fr;align-items:center;padding:20px;gap:10px}.hb-squad{display:flex;justify-content:center;flex-wrap:wrap;gap:12px;position:relative;z-index:1}.hb-hero{width:76px;text-align:center;font-size:12px;position:relative;animation:hbFloat 2.8s ease-in-out infinite}.hb-hero:nth-child(2n){animation-delay:-1s}.hb-hero img{display:block;width:64px;height:82px;object-fit:cover;object-position:top;margin:auto;border:2px solid #4dbdff;border-radius:10px;background:#1f3445}.hb-hero span{display:block}.hb-hero small{color:#93b4d4;font-size:10px}.hb-projectile{position:absolute;top:48%;left:85%;width:28px;height:5px;border-radius:50%;background:#84ecff;box-shadow:0 0 10px #58e6ff;animation:hbBolt 1.1s linear infinite;pointer-events:none}
.hb-boss{position:relative;text-align:center}.hb-boss svg{width:min(100%,340px);overflow:visible}.hb-body{transform-origin:160px 200px;animation:hbBreathe 2.4s ease-in-out infinite}.hb-arm.right{transform-origin:230px 115px;transition:transform .2s}.hb-armor{opacity:0;transition:opacity .3s}.hb-stage[data-phase="armor"] .hb-armor{opacity:1}.hb-stage[data-phase="warning"] .hb-arm.right{transform:rotate(-105deg)}.hb-stage[data-phase="warning"] .hb-core{filter:drop-shadow(0 0 15px #ff5d5d)}.hb-stage[data-phase="exposed"] .hb-core{fill:#ffb43c;stroke:#ffe088;filter:drop-shadow(0 0 18px #ff8b25)}
.hb-stage.shielded .hb-squad{border-radius:30px;box-shadow:0 0 0 3px #7ae0ff,0 0 30px #75dfff66}.hb-stage.boss-hit .hb-boss{filter:brightness(1.8)}.hb-stage.team-hit .hb-squad{filter:sepia(.8) saturate(4)}.hb-stage.healing .hb-squad{filter:drop-shadow(0 0 15px #54ff99)}
.hb-bars{display:grid;grid-template-columns:1fr 1fr;gap:15px;margin:14px 0}.hb-bar{height:16px;background:#101622;border-radius:99px;overflow:hidden;margin-top:6px}.hb-bar>span{display:block;height:100%;background:#3fdba2;transition:width .08s linear}.hb-bar.boss>span{background:#f46c79}.hb-intent{padding:14px;border:1px solid #55728f;border-radius:14px;background:#19283b;min-height:94px}.hb-intent[data-phase="warning"]{border-color:#ff7b7b;background:#3d1f29}.hb-intent[data-phase="exposed"]{border-color:#ffc25e;background:#3c2d17}.hb-intent h3{margin:0 0 6px}.hb-intent p{margin:0}.hb-count{font-size:24px;font-weight:bold;font-variant-numeric:tabular-nums}
.hb-skills{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:16px 0}.hb-skill{display:flex;flex-direction:column;justify-content:center;gap:7px;min-height:130px;padding:14px;border:2px solid #45627f;border-radius:14px;background:#182a3b;color:#f1f6ff;text-align:center;cursor:pointer;font:inherit;touch-action:manipulation}.hb-skill b{font-size:18px}.hb-skill small{font-size:12px;line-height:1.4}.hb-skill span{font-variant-numeric:tabular-nums;color:#ffe2a5}.hb-skill:disabled{opacity:.45;cursor:not-allowed}.hb-skill.recommended:not(:disabled){border-color:#ffd666;box-shadow:0 0 18px #ffd66644}.hb-actions button{min-height:42px}.hb-message{min-height:28px;color:#ffd582;margin:8px 0}.hb-log{max-height:190px;overflow:auto;padding:12px;background:#0e1826;border-radius:12px;line-height:1.7;font-size:13px}.hb-log .good{color:#7ce6b5}.hb-log .bad,.hb-log .warn{color:#ff9c9c}.hb-log .heal{color:#6deca3}.hb-log .shield{color:#8cddff}.hb-result{text-align:center;padding:24px;background:#1e3044;border:1px solid #bf9e52;border-radius:16px}.hb-result h3{font-size:28px;margin:0 0 12px}.hb-overlay{position:absolute;inset:0;background:#050d19d9;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;z-index:5;padding:20px;text-align:center}.hb-overlay[hidden]{display:none}.hb-paused *{animation-play-state:paused!important}.hb-feedback{position:absolute;top:18%;left:50%;transform:translateX(-50%);padding:8px 12px;background:#091421ce;color:#ffde8b;border-radius:10px;font-weight:700;pointer-events:none;z-index:2}
@keyframes hbFloat{50%{transform:translateY(-4px)}}@keyframes hbBreathe{50%{transform:translateY(-5px)}}@keyframes hbBolt{0%{transform:translateX(0);opacity:0}20%{opacity:1}100%{transform:translateX(115px);opacity:0}}
@media(max-width:600px){.hb-stage{padding:12px;min-height:300px;grid-template-columns:.9fr 1.1fr}.hb-squad{gap:8px}.hb-hero{width:51px;font-size:10px}.hb-hero img{width:45px;height:60px}.hb-skills{gap:6px}.hb-skill{padding:9px 5px;min-height:150px}.hb-skill b{font-size:14px}.hb-skill small{font-size:11px}.hb-bars{gap:10px;font-size:13px}.hb-projectile{width:18px}.hb-feedback{font-size:12px;max-width:95%;width:max-content}}
@media(prefers-reduced-motion:reduce){.hb-hero,.hb-body,.hb-projectile{animation:none}.hb-bar>span{transition:none}}
`;
    document.head.appendChild(el);
  }
  styles();
  function visible(){const sec=root.closest("section");return !document.hidden && (!sec || !sec.hidden) && root.getClientRects().length>0;}
  function stop(){cancelAnimationFrame(frame);frame=0;last=0;acc=0;}
  async function load(){
    const user=api.user();if(!user)throw new Error("Connecte-toi d'abord.");
    const out=await runTransaction(api.db,async tx=>{
      const snap=await tx.get(doc(api.db,"users",user.uid));
      if(!snap.exists())throw new Error("Compte introuvable.");
      return snap.data();
    });
    if(api.user()?.uid!==user.uid)throw new Error("Le compte a changé.");
    return out;
  }
  async function save(){
    const user=api.user();if(!user)throw new Error("Connecte-toi d'abord.");
    const choice=[...team];
    const s=await runTransaction(api.db,async tx=>{
      const ref=doc(api.db,"users",user.uid),snap=await tx.get(ref);
      if(!snap.exists())throw new Error("Compte introuvable.");
      const data=snap.data(),valid=validate(choice,data.cards||{});
      if(!valid.every(Boolean))throw new Error("Choisis cinq champions différents, possédés et compatibles avec les rôles.");
      // Ne touche jamais à ranked : les anciens points et récompenses sont conservés.
      tx.update(ref,{bossTraining:{team:valid}});
      return {...data,bossTraining:{team:valid}};
    });
    if(api.user()?.uid!==user.uid)throw new Error("Le compte a changé.");
    cards=s.cards||{};savedTeam=[...s.bossTraining.team];team=[...savedTeam];owner=user.uid;
  }
  async function open(){
    if(busy)return;
    if(fight && owner===api.user()?.uid){if(!fight.result){paused=true;stop();}renderFight();return;}
    const n=++sequence;busy=true;root.innerHTML="<p>Chargement de Chasse aux boss…</p>";
    try{
      const s=await load();if(n!==sequence)return;
      cards=s.cards||{};team=validate(s.bossTraining?.team||s.ranked?.team||[],cards);
      savedTeam=team.every(Boolean)?[...team]:[];
      owner=api.user().uid;ready=true;note="";
    }catch(e){if(n===sequence)note=e.message;}
    finally{if(n===sequence){busy=false;renderLobby();}}
  }
  function renderLobby(){
    if(!ready){root.innerHTML=`<p>${H(note||"Connecte-toi pour jouer.")}</p><button class="btn" data-action="reload">Réessayer</button>`;return;}
    root.innerHTML=`<div class="hb-head"><h2>Chasse aux boss</h2><span class="hb-tag">PvE · entraînement · 60 secondes maximum</span></div>
<div class="hb-box"><h3>Le Gardien hextech</h3>Ton équipe attaque automatiquement. Tu contrôles seulement trois actions :<br>🛡️ <b>Protéger</b> au dernier moment avant la frappe lourde.<br>💚 <b>Soigner</b> lorsque le groupe a perdu des PV.<br>⚡ <b>Assaut</b> quand le cœur du Gardien devient orange.<br>Pas de points ni de récompenses dans ce prototype. Les anciens rangs restent inchangés.</div>
<h3>Choisis ton équipe</h3><div class="hb-picks">${ROLES.map((role,i)=>{
      const list=Object.keys(cards).filter(id=>cards[id]>0 && POOL[role].includes(champ(id)?.id)).map(Number).sort((a,b)=>api.card(a).name.localeCompare(api.card(b).name,"fr"));
      return `<label class="hb-pick"><b>${role}</b><select data-role="${i}" ${busy?"disabled":""}><option value="0">Choisir une carte</option>${list.map(id=>{const c=api.card(id);return `<option value="${id}" ${team[i]===id?"selected":""}>${H(c.name)} — ${H(c.skinName)}</option>`;}).join("")}</select><small>${H(ROLE_TEXT[i])}</small></label>`;
    }).join("")}</div><p>Les champions et les skins servent à personnaliser ton équipe. À rôle égal, les statistiques sont identiques : aucune rareté ne donne d'avantage.</p>
<div class="hb-actions"><button class="btn" data-action="save" ${busy?"disabled":""}>Enregistrer l'équipe</button><button class="btn-play" data-action="start" ${busy?"disabled":""}>Affronter le Gardien</button></div><p class="hb-message" role="status">${H(note)}</p>
<details class="hb-box"><summary>Comprendre le combat</summary><p>Le groupe partage 1 000 PV. Les cinq champions participent jusqu'à la fin : pas de mort individuelle ni de réapparition. Le Gardien possède 2 700 PV.</p><p>Carapace bleue : garde Assaut. Arme levée et compte à rebours rouge : prépare Protéger. Cœur orange après l'impact : utilise Assaut. Chaque action affiche sa durée et sa recharge.</p><p>Clavier : 1 = Protéger, 2 = Soigner, 3 = Assaut, Espace = Pause. Les boutons fonctionnent aussi au toucher.</p><p>Le combat se met en pause si tu quittes la page ou l'onglet. Fermer ou recharger la page efface le combat, sans pénalité.</p></details>`;
  }
  function skillHTML(key,title,description){return `<button type="button" class="hb-skill" id="hb-${key}" data-ability="${key}"><b>${title}</b><small>${description}</small><span data-cooldown>Prêt</span></button>`;}
  function renderFight(){
    if(!fight)return;
    if(fight.result){renderResult();return;}
    root.innerHTML=`<div class="hb-head"><h2>Gardien hextech</h2><span class="hb-tag">Entraînement · aucun point</span><b id="hb-time"></b></div>
<div class="hb-bars"><div>Ton équipe <b id="hb-hp-text"></b><div class="hb-bar"><span id="hb-hp"></span></div></div><div>Le Gardien <b id="hb-boss-text"></b><div class="hb-bar boss"><span id="hb-boss-hp"></span></div></div></div>
<div class="hb-stage" id="hb-stage"><div class="hb-squad">${savedTeam.map((id,i)=>{const c=api.card(id);return `<div class="hb-hero"><img src="${H(c.img)}" alt="${H(c.name)}"><span>${H(c.name)}</span><small>${ROLES[i]}</small></div>`;}).join("")}<span class="hb-projectile"></span></div><div class="hb-boss">${BOSS_SVG}</div><div class="hb-feedback" id="hb-feedback" hidden></div><div class="hb-overlay" id="hb-pause" hidden><h3>Combat en pause</h3><p>Le temps et les recharges sont arrêtés.</p><button class="btn-play" data-action="resume">Reprendre</button><button class="btn" data-action="leave">Quitter sans pénalité</button></div></div>
<div class="hb-intent" id="hb-intent"><h3 id="hb-phase"></h3><p id="hb-advice"></p><span class="hb-count" id="hb-count"></span></div>
<div class="hb-skills">${skillHTML("shield","🛡️ Protéger · 1","−80 % de dégâts pendant 1,1 s. Recharge : 8 s.")}${skillHTML("heal","💚 Soigner · 2","Rend jusqu'à 180 PV au groupe. Recharge : 18 s.")}${skillHTML("assault","⚡ Assaut · 3","220 dégâts de base ; environ 607 en surchauffe. Recharge : 12 s.")}</div>
<div class="hb-actions"><button class="btn" data-action="pause">Pause / aide</button><button class="btn" data-action="leave">Quitter sans pénalité</button></div><p id="hb-note" class="hb-message" role="status"></p><details><summary>Journal du combat</summary><div class="hb-log" id="hb-log"></div></details>`;
    seenEvent=-1;previousPhase="";previousHP=fight.hp;previousBoss=fight.boss;paint();
  }
  function paint(){
    if(!fight || fight.result || !$("hb-stage"))return;
    const f=fight,now=performance.now(),stage=$("hb-stage");
    $("hb-time").textContent=`${Math.max(0,C.maxTime-f.time).toFixed(1)} s`;
    $("hb-hp-text").textContent=`${Math.ceil(f.hp)} / ${C.teamHP}`;
    $("hb-boss-text").textContent=`${Math.ceil(f.boss)} / ${C.bossHP}`;
    $("hb-hp").style.width=`${100*f.hp/C.teamHP}%`;
    $("hb-boss-hp").style.width=`${100*f.boss/C.bossHP}%`;
    if(f.hp<previousHP)teamHitUntil=now+180;
    if(f.hp>previousHP)healUntil=now+350;
    if(previousBoss-f.boss>40)hitUntil=now+250;
    previousHP=f.hp;previousBoss=f.boss;
    stage.dataset.phase=f.phase;stage.classList.toggle("shielded",f.shield>0);
    stage.classList.toggle("boss-hit",now<hitUntil);stage.classList.toggle("team-hit",now<teamHitUntil);stage.classList.toggle("healing",now<healUntil);stage.classList.toggle("hb-paused",paused);
    $("hb-pause").hidden=!paused;
    if(previousPhase!==f.phase){
      $("hb-phase").textContent=PHASES[f.phase][0];$("hb-advice").textContent=PHASES[f.phase][1];$("hb-intent").dataset.phase=f.phase;previousPhase=f.phase;
    }
    const remain={normal:C.normalTime,armor:C.armorTime,warning:C.warningTime,exposed:C.exposedTime}[f.phase]-f.phaseTime;
    $("hb-count").textContent=f.phase==="warning"?`Impact dans ${Math.max(0,remain).toFixed(1)} s`:f.phase==="exposed"?`Ouverture : ${Math.max(0,remain).toFixed(1)} s`:"";
    Object.keys(f.cd).forEach(k=>{
      const b=$(`hb-${k}`),cd=f.cd[k];
      b.disabled=paused || cd>.001 || (k==="heal" && f.hp>=C.teamHP);
      b.querySelector("[data-cooldown]").textContent=cd>.001?`Recharge : ${cd.toFixed(1)} s`:k==="heal"&&f.hp>=C.teamHP?"Équipe en pleine santé":"Prêt";
      b.classList.toggle("recommended",!paused && cd<=.001 && ((k==="shield"&&f.phase==="warning"&&remain<=.8)||(k==="assault"&&f.phase==="exposed")||(k==="heal"&&C.teamHP-f.hp>=C.healAmount)));
    });
    if(seenEvent!==f.eventId){
      $("hb-log").innerHTML=f.events.map(e=>`<div class="${e.kind}">${H(e.text)}</div>`).join("");
      const e=f.events[0];if(e){$("hb-feedback").textContent=e.text;$("hb-feedback").hidden=false;}
      seenEvent=f.eventId;
    }
    $("hb-note").textContent=note;
  }
  function renderResult(){
    stop();const f=fight,s=f.stats;
    root.innerHTML=`<div class="hb-result"><h3>${f.result==="win"?"🏆 Gardien vaincu !":f.result==="timeout"?"⏱️ Temps écoulé":"Ton équipe est vaincue"}</h3><p>${f.time.toFixed(1)} secondes · Boss : ${f.boss} PV restants · Équipe : ${f.hp} PV restants.</p><p>Entraînement uniquement : aucun point ni booster gagné ou perdu.</p></div>
<div class="hb-box"><h3>Ce que tu as réussi</h3><p>🛡️ ${s.blocked} frappe(s) lourde(s) bloquée(s) / ${s.blocked+s.missed}.<br>⚡ ${s.goodAssaults} Assaut(s) pendant la surchauffe.<br>💚 ${s.healed} PV rendus.<br>🔵 ${s.badAssaults} Assaut(s) gaspillé(s) contre la carapace.</p><h3>Pour le prochain essai</h3><p>${s.missed?"Attends environ 0,5 seconde avant l'impact pour Protéger : trop tôt, le bouclier expire.":"Tu as bien géré les frappes lourdes."}<br>${s.goodAssaults<2?"Garde Assaut pour le cœur orange : le bonus de dégâts est important.":"Continue à réserver Assaut aux ouvertures."}<br>${s.badAssaults?"Évite Assaut quand la carapace bleue est affichée.":"Utilise le soin lorsque tu as perdu au moins 180 PV pour ne pas le gaspiller."}</p></div>
<div class="hb-actions"><button class="btn-play" data-action="replay">Rejouer avec cette équipe</button><button class="btn" data-action="lobby">Modifier mon équipe</button></div>`;
  }
  function begin(){
    fight=freshFight();paused=false;note="";last=0;acc=0;paintClock=0;event(fight,"Le Gardien arrive. Tes champions attaquent automatiquement.");
    renderFight();startLoop();
  }
  function startLoop(){stop();if(fight&&!fight.result&&!paused)frame=requestAnimationFrame(loop);}
  function loop(now){
    frame=0;
    if(!fight || fight.result || paused)return;
    if(api.user()?.uid!==owner){controller.close();return;}
    if(!visible()){pause();return;}
    if(!last)last=now;
    acc+=Math.min(.15,Math.max(0,(now-last)/1000));last=now;
    while(acc>=.02 && !fight.result){tickFight(fight,.02);acc-=.02;}
    if(fight.result){renderResult();return;}
    if(now-paintClock>65){paint();paintClock=now;}
    frame=requestAnimationFrame(loop);
  }
  function pause(){if(!fight || fight.result)return;paused=true;stop();paint();}
  function resume(){if(!fight || fight.result || !visible())return;paused=false;note="";paint();startLoop();}
  function ability(key){
    if(!fight || fight.result || paused || !visible())return;
    if(api.user()?.uid!==owner){controller.close();return;}
    const ok=useAbility(fight,key);if(!ok)return;
    note="";
    if(fight.result)renderResult();else paint();
  }
  root.addEventListener("change",e=>{const s=e.target.closest("[data-role]");if(s&&!busy)team[Number(s.dataset.role)]=Number(s.value);});
  root.addEventListener("click",async e=>{
    const skill=e.target.closest("[data-ability]");if(skill&&!skill.disabled){ability(skill.dataset.ability);return;}
    const b=e.target.closest("[data-action]");if(!b || b.disabled || busy)return;
    const a=b.dataset.action;
    if(a==="reload"){await open();return;}
    if(a==="pause"){pause();return;}
    if(a==="resume"){resume();return;}
    if(a==="leave"){
      pause();if(!confirm("Quitter cet entraînement ? Aucun point ne sera perdu."))return;
      stop();fight=null;paused=false;note="";renderLobby();return;
    }
    if(a==="lobby"){stop();fight=null;note="";renderLobby();return;}
    const n=sequence;busy=true;note="";
    if(!fight)renderLobby();
    try{
      if(a==="save" || a==="start"){await save();if(n!==sequence)return;if(a==="start")begin();else note="Équipe enregistrée.";}
      if(a==="replay"){await save();if(n!==sequence)return;begin();}
    }catch(err){note=err.message;console.error("Chasse aux boss",err);if(fight?.result)fight=null;}
    finally{if(n===sequence){busy=false;if(!fight)renderLobby();}}
  });
  document.addEventListener("visibilitychange",()=>{if(document.hidden)pause();});
  document.addEventListener("keydown",e=>{
    if(!fight || fight.result || !visible() || e.repeat || e.ctrlKey || e.altKey || e.metaKey)return;
    if(e.target instanceof Element && e.target.closest("input,select,textarea,[contenteditable=true]"))return;
    if(e.code==="Space"){e.preventDefault();if(paused)resume();else pause();return;}
    const key=({Digit1:"shield",Numpad1:"shield",Digit2:"heal",Numpad2:"heal",Digit3:"assault",Numpad3:"assault"})[e.code];
    if(key){e.preventDefault();ability(key);}
  });
  const controller={open,close(){sequence++;stop();fight=null;ready=false;owner=null;busy=false;paused=false;cards={};team=[0,0,0,0,0];savedTeam=[];root.innerHTML="<p>Connecte-toi pour jouer.</p>";}};
  return controller;
}
