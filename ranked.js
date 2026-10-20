import { doc, runTransaction } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

// Arène tactique PvE. Interface conservée : initRanked({db,user,champions,card,week}).
const ROLES = ["Top", "Jungle", "Mid", "ADC", "Support"];
const LANES = ["Top", "Mid", "Bot"];
const HOME = [0, 1, 1, 2, 2];
const LIMIT = 24;
const VERSION = 2;
const RANKS = [
  ["Fer",0,1,0],["Bronze",100,2,0],["Argent",250,3,0],
  ["Or",450,4,1],["Platine",700,5,1],["Émeraude",1000,6,2],
  ["Diamant",1400,8,2],["Maître",1900,10,3],
  ["Grand Maître",2500,12,4],["Challenger",3200,15,5]
];
const POOL = {
  Top: ["Garen","Darius","Fiora","Camille","Ornn","Malphite","Sett","Shen","Renekton","Aatrox","Jax","Gwen","Teemo","Nasus","Riven","Poppy","Tryndamere","Irelia","Yorick","Sion"],
  Jungle: ["Warwick","Vi","LeeSin","MasterYi","Amumu","Sejuani","Volibear","Khazix","Rengar","Evelynn","Nocturne","Nunu","Hecarim","Udyr","Gragas","Briar","Lillia","Kayn","Kindred","Viego"],
  Mid: ["Ahri","Lux","Annie","Viktor","Syndra","Orianna","Zed","Yasuo","Yone","Veigar","Katarina","Akali","Azir","Vex","Malzahar","Zoe","Leblanc","Taliyah","Anivia","AurelionSol"],
  ADC: ["Ashe","Caitlyn","Jinx","Ezreal","MissFortune","Jhin","Lucian","Vayne","Kaisa","Tristana","Xayah","Sivir","Varus","Draven","Aphelios","KogMaw","Kalista","Samira","Nilah","Smolder"],
  Support: ["Braum","Leona","Nautilus","Thresh","Lulu","Soraka","Sona","Nami","Janna","Yuumi","Rakan","Milio","Renata","Blitzcrank","Karma","Alistar","Taric","Zilean","Bard","Senna"]
};
const SKILLS = [
  ["Rempart", "Protège un allié de sa voie : les dégâts de champions qu'il reçoit sont redirigés vers le Top et réduits de moitié. Le Top se protège aussi. Recharge : 3 manches."],
  ["Gank", "Rejoint la voie d'un ennemi et lui inflige 80 dégâts de base. La voie et la cible sont choisies par toi. Recharge : 3 manches."],
  ["Onde", "Inflige 38 dégâts de base à chaque champion ennemi de sa voie et 80 à la vague ennemie. Recharge : 3 manches."],
  ["Tir précis", "Inflige 85 dégâts de base à un champion de sa voie. Recharge : 3 manches."],
  ["Bouclier", "Absorbe les 75 prochains dégâts reçus par un allié de sa voie pendant cette manche. Recharge : 3 manches."]
];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const copy = o => JSON.parse(JSON.stringify(o));
const clamp = (n,a,b) => Math.min(b,Math.max(a,n));
const rankOf = p => RANKS.reduce((n,r,i) => p >= r[1] ? i : n, 0);
const emptySeason = (week,team=[]) => ({version:VERSION,week,points:0,best:0,wins:0,losses:0,draws:0,games:0,team});
const stat = (u,n) => Math.round(n * u.power);
const laneUnits = (m,side,lane) => m.units[side].filter(u => u.hp > 0 && u.lane === lane);
const weakest = list => [...list].sort((a,b) => a.hp-b.hp || a.i-b.i)[0];
function unit(id,i,power,name,img) {
  const max = Math.round(([310,245,225,220,235][i])*power);
  return {id,i,name,img,role:ROLES[i],lane:HOME[i],hp:max,max,power,cd:0,respawn:0};
}
function baseMatch(a,b,level,training,user,week) {
  return {user,week,training,level,round:1,units:[a,b],waves:[[100,100,100],[100,100,100]],
    front:[0,0,0],towers:[[210,210,210],[210,210,210]],nexus:[360,360],
    plans:[],intents:[],history:[],done:false,result:null,settled:false};
}
function options(m,side,i) {
  const u = m.units[side][i];
  if (u.hp <= 0) return [];
  const foes = laneUnits(m,1-side,u.lane);
  const allies = laneUnits(m,side,u.lane);
  const out = [{a:"clear",t:0},{a:"guard",t:0}];
  foes.forEach(t => out.push({a:"strike",t:t.i}));
  LANES.forEach((_,l) => { if (l !== u.lane) out.push({a:"move",t:l}); });
  if (u.cd === 0) {
    if (i === 0 || i === 4) allies.forEach(t => out.push({a:"skill",t:t.i}));
    else if (i === 1) m.units[1-side].filter(t=>t.hp>0).forEach(t=>out.push({a:"skill",t:t.i}));
    else if (i === 2) out.push({a:"skill",t:0});
    else foes.forEach(t => out.push({a:"skill",t:t.i}));
  }
  return out;
}
function validOrder(m,side,i,p) {
  return !!p && options(m,side,i).some(x=>x.a===p.a && x.t===Number(p.t));
}
function botPlans(m) {
  return m.units[1].map((u,i) => {
    if (u.hp<=0) return null;
    const foes=laneUnits(m,0,u.lane), allies=laneUnits(m,1,u.lane);
    const target=weakest(foes);
    if (u.cd===0) {
      if (i===4) {
        const friend=weakest(allies);
        if (friend && foes.length) return {a:"skill",t:friend.i};
      }
      if (i===0 && foes.length) return {a:"skill",t:weakest(allies).i};
      if (i===1) {
        const gank=weakest(m.units[0].filter(x=>x.hp>0));
        if (gank) return {a:"skill",t:gank.i};
      }
      if (i===2 && (foes.length || m.waves[0][u.lane]>0)) return {a:"skill",t:0};
      if (i===3 && target) return {a:"skill",t:target.i};
    }
    // Les premiers bots privilégient les champions ; les autres lisent les vagues.
    if (m.level>=2 && m.waves[0][u.lane]>0 && (m.round+i)%3!==0) return {a:"clear",t:0};
    if (target) return {a:"strike",t:target.i};
    if (m.waves[0][u.lane]>0) return {a:"clear",t:0};
    if (i===1) {
      const threatened=m.front.indexOf(2);
      if (threatened>=0 && threatened!==u.lane) return {a:"move",t:threatened};
    }
    return {a:"guard",t:0};
  });
}
function orderText(m,side,i,p) {
  if (!p) return "Choisir un ordre";
  const u=m.units[side][i];
  const enemy=m.units[1-side][Number(p.t)];
  const friend=m.units[side][Number(p.t)];
  if (p.a==="clear") return `Nettoyer les sbires · ${stat(u,65)} dégâts à la vague ${LANES[u.lane]}`;
  if (p.a==="guard") return "Défendre · +20 PV, dégâts reçus divisés par 2";
  if (p.a==="move") return `Rotation vers ${LANES[p.t]} · aucune attaque cette manche`;
  if (p.a==="strike") return `Attaquer ${enemy?.name || "?"} · ${stat(u,44)} dégâts bruts`;
  if (i===0) return `Rempart sur ${friend?.name || "?"} · redirection et protection`;
  if (i===1) return `Gank sur ${enemy?.name || "?"} · ${stat(u,80)} dégâts bruts`;
  if (i===2) return `Onde ${LANES[u.lane]} · ${stat(u,38)} par champion + ${stat(u,80)} aux sbires`;
  if (i===3) return `Tir précis sur ${enemy?.name || "?"} · ${stat(u,85)} dégâts bruts`;
  return `Bouclier sur ${friend?.name || "?"} · absorbe ${stat(u,75)} dégâts`;
}
function score(m,side) {
  return m.nexus[side]+m.towers[side].reduce((a,b)=>a+b,0);
}
function resolveRound(original,plans) {
  const m=copy(original), log=[], orders=[plans,m.intents];
  const shields=[Array(5).fill(0),Array(5).fill(0)];
  const guards=[Array(5).fill(false),Array(5).fill(false)];
  const protect=[Array(5).fill(-1),Array(5).fill(-1)];
  const damage=[Array(5).fill(0),Array(5).fill(0)];
  const alive=m.units.map(team=>team.map(u=>u.hp>0));
  const newCD=[Array(5).fill(false),Array(5).fill(false)];
  const deaths=[Array(5).fill(false),Array(5).fill(false)];
  const each=fn=>[0,1].forEach(s=>m.units[s].forEach((u,i)=>{
    if(alive[s][i] && orders[s][i]) fn(s,u,i,orders[s][i]);
  }));
  each((s,u,i,p)=>{
    if(p.a==="move") {u.lane=Number(p.t);log.push(`${u.name} rejoint ${LANES[u.lane]}.`);}
    if(p.a==="skill" && i===1) {
      const t=m.units[1-s][p.t];
      if(t?.hp>0) {u.lane=t.lane;log.push(`${u.name} prépare son gank ${LANES[u.lane]}.`);}
    }
  });
  // Les protections sont posées après les déplacements, avant les attaques.
  each((s,u,i,p)=>{
    if(p.a==="guard") {guards[s][i]=true;u.hp=Math.min(u.max,u.hp+20);}
    if(p.a!=="skill" || u.cd>0) return;
    newCD[s][i]=true;u.cd=3;
    if(i===0 || i===4) {
      const t=m.units[s][p.t];
      if(!t || t.hp<=0 || t.lane!==u.lane) {log.push(`${u.name} : protection impossible, la cible a changé de voie.`);return;}
      if(i===0) {protect[s][t.i]=i;guards[s][i]=true;}
      else shields[s][t.i]+=stat(u,75);
      log.push(`${u.name} utilise ${SKILLS[i][0]} sur ${t.name}.`);
    }
  });
  function hit(s,target,amount,source) {
    if(!target || !alive[s][target.i]) return;
    let i=target.i;
    if(protect[s][i]>=0 && protect[s][i]!==i) {
      i=protect[s][i];
      log.push(`${m.units[s][i].name} intercepte l'attaque sur ${target.name}.`);
    }
    let n=Math.round(amount*(guards[s][i]?0.5:1));
    const absorbed=Math.min(n,shields[s][i]);
    shields[s][i]-=absorbed;n-=absorbed;
    damage[s][i]+=n;
    log.push(`${source} → ${m.units[s][i].name} : ${n} dégâts${absorbed?` (${absorbed} absorbés)`:""}.`);
  }
  each((s,u,i,p)=>{
    const foe=1-s,l=u.lane;
    if(p.a==="clear") {m.waves[foe][l]=Math.max(0,m.waves[foe][l]-stat(u,65));log.push(`${u.name} nettoie la vague ${LANES[l]}.`);}
    if(p.a==="strike" || (p.a==="skill" && (i===1 || i===3))) {
      const t=m.units[foe][p.t];
      if(!t || !alive[foe][t.i] || t.lane!==u.lane) {log.push(`${u.name} : cible hors de sa voie, attaque perdue.`);return;}
      hit(foe,t,stat(u,p.a==="strike"?44:i===1?80:85),u.name);
    }
    if(p.a==="skill" && i===2) {
      m.units[foe].filter(t=>alive[foe][t.i] && t.lane===l).forEach(t=>hit(foe,t,stat(u,38),u.name));
      m.waves[foe][l]=Math.max(0,m.waves[foe][l]-stat(u,80));
      log.push(`${u.name} lance Onde ${LANES[l]}.`);
    }
  });
  // Dégâts simultanés : les cinq champions vivants au début peuvent agir.
  [0,1].forEach(s=>m.units[s].forEach((u,i)=>{
    u.hp=Math.max(0,u.hp-damage[s][i]);
    if(alive[s][i] && u.hp===0) {u.respawn=2;deaths[s][i]=true;log.push(`${u.name} est vaincu (retour dans 2 manches).`);}
  }));
  LANES.forEach((name,l)=>{
    // Les deux vagues s'usent simultanément.
    const a=m.waves[0][l],b=m.waves[1][l];
    if(a>0 && b>0) {m.waves[0][l]=Math.max(0,a-25);m.waves[1][l]=Math.max(0,b-25);}
    const p=m.waves[0][l]>0,e=m.waves[1][l]>0;
    if(p!==e) m.front[l]=clamp(m.front[l]+(p?1:-1),-2,2);
    [0,1].forEach(s=>{
      const enemy=1-s;
      const reaches=s===0?m.front[l]===2:m.front[l]===-2;
      const attackers=laneUnits(m,s,l),defenders=laneUnits(m,enemy,l);
      if(!reaches || m.waves[s][l]<=0 || !attackers.length) return;
      if(defenders.length) {
        m.waves[s][l]=Math.max(0,m.waves[s][l]-35);
        log.push(`${name} : les défenseurs bloquent le siège et retirent 35 PV aux sbires.`);
        return;
      }
      const siege=35+attackers.reduce((n,u)=>n+stat(u,u.i===3?30:18),0);
      if(m.towers[enemy][l]>0) {
        m.towers[enemy][l]=Math.max(0,m.towers[enemy][l]-siege);
        log.push(`${name} : ${siege} dégâts à la tourelle ${enemy===1?"bot":"alliée"}.`);
      } else {
        m.nexus[enemy]=Math.max(0,m.nexus[enemy]-siege);
        log.push(`${name} : ${siege} dégâts au Nexus ${enemy===1?"bot":"allié"} !`);
      }
      m.waves[s][l]=Math.max(0,m.waves[s][l]-20);
    });
  });
  [0,1].forEach(s=>m.units[s].forEach((u,i)=>{
    if(!newCD[s][i] && u.cd>0) u.cd--;
    if(u.hp===0 && !deaths[s][i]) {
      u.respawn--;
      if(u.respawn<=0) {u.hp=u.max;u.lane=HOME[i];log.push(`${u.name} réapparaît ${LANES[u.lane]}.`);}
    }
  }));
  if(m.nexus[0]===0 || m.nexus[1]===0) {
    m.done=true;
    m.result=m.nexus[0]===m.nexus[1]?"draw":m.nexus[1]===0?"win":"loss";
  } else if(m.round>=LIMIT) {
    m.done=true;
    m.result=score(m,0)===score(m,1)?"draw":score(m,0)>score(m,1)?"win":"loss";
    log.push(`Limite atteinte : bâtiments alliés ${score(m,0)} / bots ${score(m,1)}. Le plus haut total gagne.`);
  }
  m.round++;
  if(!m.done && (m.round-1)%3===0) {
    m.waves=[[100,100,100],[100,100,100]];
    log.push("Une nouvelle vague de 100 PV arrive sur chaque voie.");
  }
  m.history=[...m.history,{round:original.round,log}].slice(-LIMIT);
  return {m,log};
}

export function initRanked(api) {
  const root=document.getElementById("rankedRoot");
  if(!root) throw new Error("Il manque rankedRoot dans index.html.");
  let season=null,cards={},draft=[],battle=null,busy=false,notice="",epoch=0;
  const champion=id=>api.champions().find(c=>Number(c.key)===Math.floor(Number(id)/1000));
  const fullTeam=(team,owned=null)=>{
    const seen=new Set();
    return ROLES.map((r,i)=>{
      const id=Number(team?.[i])||0,c=champion(id);
      if(!c || !POOL[r].includes(c.id) || (owned && !(owned[id]>0)) || seen.has(c.id)) return 0;
      seen.add(c.id);return id;
    });
  };
  function ensure(s,week) {
    let r=s.ranked;
    // Nouveau système : les anciens points du prototype ne sont pas réutilisés.
    if(!r || r.version!==VERSION) {r=emptySeason(week,r?.team||[]);s.ranked=r;return r;}
    if(r.week!==week) {
      let reward=r.lastReward||null;
      if(r.games>0) {
        const rank=RANKS[rankOf(r.best)];
        s.boosters=(s.boosters||0)+rank[2];
        s.bonusBoosters=(s.bonusBoosters||0)+rank[3];
        reward={week:r.week,name:rank[0],normal:rank[2],bonus:rank[3]};
      }
      r={...emptySeason(week,r.team),lastReward:reward};s.ranked=r;
    }
    return r;
  }
  async function write(change=()=>{}) {
    const user=api.user();
    if(!user) throw new Error("Connecte-toi d'abord.");
    const week=api.week();
    const out=await runTransaction(api.db,async tx=>{
      const ref=doc(api.db,"users",user.uid),snap=await tx.get(ref);
      if(!snap.exists()) throw new Error("Compte introuvable.");
      const s=snap.data(),r=ensure(s,week);
      change(r,s);
      tx.update(ref,{ranked:r,boosters:s.boosters||0,bonusBoosters:s.bonusBoosters||0});
      return s;
    });
    if(api.user()?.uid!==user.uid) throw new Error("Le compte a changé.");
    season=out.ranked;cards=out.cards||{};
    return out;
  }
  function injectStyle() {
    if(document.getElementById("ranked-pve-style")) return;
    const style=document.createElement("style");style.id="ranked-pve-style";
    style.textContent=`
#rankedRoot{color:#ecf2fa;--pve-blue:#46baff;--pve-red:#fb7583}
#rankedRoot *{box-sizing:border-box}#rankedRoot button,#rankedRoot select{font:inherit}
#rankedRoot button{cursor:pointer}#rankedRoot button:disabled{opacity:.4;cursor:not-allowed}
.pve-head,.pve-buttons{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:12px 0}.pve-head h2{margin:0 auto 0 0}
.pve-pill{border:1px solid #8b7849;background:#302a1d;padding:8px 12px;border-radius:99px}
.pve-help,.pve-message{background:#182435;border:1px solid #364a64;padding:14px;border-radius:12px;line-height:1.6;margin:12px 0}
.pve-picks{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}
.pve-picks label{display:flex;flex-direction:column;gap:8px;background:#172130;padding:12px;border-radius:12px}
#rankedRoot select{width:100%;min-width:0;background:#0d1622;color:#fff;padding:10px;border:1px solid #46576c;border-radius:8px}
.pve-map{display:grid;gap:10px}.pve-lane{display:grid;grid-template-columns:minmax(0,1fr) minmax(130px,.8fr) minmax(0,1fr);gap:8px;background:linear-gradient(110deg,#183348,#19372d,#3e2431);padding:12px;border:1px solid #40574d;border-radius:14px}
.pve-side{display:flex;gap:8px;flex-wrap:wrap;align-content:start}.pve-enemy{justify-content:flex-end}
.pve-avatar{width:75px;text-align:center;font-size:11px}.pve-avatar img{width:42px;height:42px;border:2px solid var(--pve-blue);border-radius:50%;object-fit:cover;object-position:top}
.pve-enemy img{border-color:var(--pve-red)}.pve-avatar progress{width:100%;height:8px;accent-color:#45d899}.pve-avatar small{display:block}
.pve-center{text-align:center;font-size:12px}.pve-center strong{font-size:16px}.pve-front{height:12px;background:#0c121c;border-radius:8px;margin:8px 0;position:relative}.pve-front span{position:absolute;width:14px;height:14px;top:-1px;background:#f6d273;border-radius:50%;transform:translateX(-50%)}
.pve-nexus{display:flex;justify-content:space-between;gap:10px;margin:10px 0;padding:12px;background:#131c29;border-radius:12px}
.pve-intents{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:6px}.pve-intent{padding:10px;border-left:3px solid #fb7583;background:#261d2b;font-size:13px}
.pve-orders{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:10px;margin:14px 0}.pve-order{padding:13px;background:#141f2e;border:1px solid #3a4c63;border-radius:12px}.pve-order h4{margin:0 0 8px}.pve-order p{font-size:12px;line-height:1.5;color:#b9cde0}.pve-order.dead{opacity:.65}.pve-order.changed{border-color:#64ceae}
.pve-log{max-height:350px;overflow:auto;padding:12px;background:#0d1420;border:1px solid #33455f;border-radius:12px;font-size:13px;line-height:1.7}.pve-log div{padding:3px 0;border-bottom:1px solid #ffffff09}
.pve-forecast{padding:12px;border:1px solid #648b6d;border-radius:12px;background:#13271f}.pve-result{font-size:20px;padding:16px;background:#322b1e;border:1px solid #b89b55;border-radius:12px}
.pve-flash{animation:pveFlash .55s ease}@keyframes pveFlash{50%{filter:brightness(1.6)}}
@media(max-width:600px){.pve-lane{grid-template-columns:minmax(0,1fr) 105px minmax(0,1fr);padding:8px;gap:4px}.pve-avatar{width:54px;font-size:10px}.pve-avatar img{width:32px;height:32px}.pve-center{font-size:10px}.pve-orders{grid-template-columns:1fr}}
`;
    document.head.appendChild(style);
  }
  injectStyle();
  async function open() {
    if(busy) return;
    if(battle && !battle.done && battle.user===api.user()?.uid && battle.week===api.week()) {render();return;}
    const n=++epoch;busy=true;root.innerHTML="<p>Chargement de l'arène PvE…</p>";
    try {await write();if(n!==epoch)return;draft=fullTeam(season.team,cards);battle=null;notice="";}
    catch(e){if(n===epoch)notice=e.message;}
    finally{if(n===epoch){busy=false;render();}}
  }
  function renderLobby() {
    if(!season){root.innerHTML=`<p>${esc(notice||"Connecte-toi pour jouer.")}</p><button class="btn" data-action="reload">Réessayer</button>`;return;}
    const r=rankOf(season.points),last=season.lastReward;
    root.innerHTML=`<div class="pve-head"><h2>Arène tactique · PvE</h2><span class="pve-pill">${RANKS[r][0]} · ${season.points} points</span></div>
<p>${season.wins} victoire(s) · ${season.losses} défaite(s) · ${season.draws||0} nul(s). Bots : +${r*4}% PV et dégâts.</p>
<div class="pve-help">Compose cinq rôles, lis les intentions des bots et prépare tes ordres. Les bâtiments sont attaqués automatiquement quand une vague alliée arrive devant eux avec un champion vivant et sans défenseur ennemi sur la voie. Aucun bouton « siège ».<br>24 manches maximum ; ensuite, le total PV des tourelles + du Nexus départage. Égalité : aucun point.<br>Classé : +30 / −15 points, minimum 0. Entraînement : aucun point. Reset lundi à minuit (Paris), à la prochaine ouverture ; récompense selon le meilleur rang, au moins un match joué.</div>
${last?`<p class="pve-message">Dernière récompense : ${esc(last.name)} · ${last.normal} boosters + ${last.bonus} bonus.</p>`:""}
<h3>Équipe · un champion différent par rôle</h3><div class="pve-picks">${ROLES.map((role,i)=>{
const list=Object.keys(cards).filter(id=>cards[id]>0 && POOL[role].includes(champion(id)?.id)).map(Number).sort((a,b)=>api.card(a).name.localeCompare(api.card(b).name,"fr"));
return `<label>${role}<select data-pick="${i}" ${busy?"disabled":""}><option value="0">Choisir une carte</option>${list.map(id=>{const c=api.card(id);return `<option value="${id}" ${draft[i]===id?"selected":""}>${esc(c.name)} — ${esc(c.skinName)}</option>`;}).join("")}</select><small>${list.length} carte(s) éligible(s)</small></label>`;
}).join("")}</div><p class="hint">Positions définies par une liste dans ce fichier, pas exhaustives. Les skins sont visuels : aucune rareté ne donne de bonus de combat.</p>
<div class="pve-buttons"><button class="btn" data-action="save" ${busy?"disabled":""}>Enregistrer l'équipe</button><button class="btn-play" data-action="train" ${busy?"disabled":""}>Entraînement</button><button class="btn" data-action="start" ${busy?"disabled":""}>Défi classé PvE</button></div>
<p role="status">${esc(notice)}</p><details><summary>Récompenses hebdomadaires</summary>${RANKS.map(([name,p,n,b])=>`<p>${name} (${p} points) : ${n} boosters + ${b} bonus.</p>`).join("")}</details>`;
  }
  function avatar(u) {
    return `<div class="pve-avatar" title="${esc(u.role)}"><img src="${esc(u.img)}" alt=""><small>${esc(u.name)}</small><progress max="${u.max}" value="${u.hp}"></progress><small>${u.hp}/${u.max}</small></div>`;
  }
  function mapHTML(m) {
    return `<div class="pve-nexus"><span>Ton Nexus : ${m.nexus[0]} PV</span><span>Nexus des bots : ${m.nexus[1]} PV</span></div><div class="pve-map">${LANES.map((name,l)=>`<div class="pve-lane"><div class="pve-side">${laneUnits(m,0,l).map(avatar).join("")||"Voie vide"}</div><div class="pve-center"><strong>${name}</strong><br>Tourelles : ${m.towers[0][l]} / ${m.towers[1][l]} PV<br>Sbires : ${m.waves[0][l]} / ${m.waves[1][l]} PV<div class="pve-front" title="Le front avance vers les bots à droite"><span style="left:${10+(m.front[l]+2)*20}%"></span></div><small>Toi ← front → Bots</small></div><div class="pve-side pve-enemy">${laneUnits(m,1,l).map(avatar).join("")||"Voie vide"}</div></div>`).join("")}</div>`;
  }
  const allReady=()=>battle.units[0].every((u,i)=>u.hp<=0 || validOrder(battle,0,i,battle.plans[i]));
  function forecastHTML() {
    if(!allReady()) return "<p>Choisis un ordre pour chaque champion vivant pour obtenir l'aperçu exact.</p>";
    const {m,log}=resolveRound(battle,battle.plans);
    return `<div class="pve-forecast"><b>Prévision exacte de cette manche</b><p>PV des bâtiments : toi ${score(battle,0)} → ${score(m,0)} ; bots ${score(battle,1)} → ${score(m,1)}.</p><p>${m.units[0].map((u,i)=>`${esc(u.name)} : ${battle.units[0][i].hp} → ${u.hp} PV`).join(" · ")}</p><details><summary>Voir les événements prévus</summary>${log.map(x=>`<div>${esc(x)}</div>`).join("")}</details></div>`;
  }
  function renderBattle() {
    const m=battle;
    const labels={win:"Victoire !",loss:"Défaite",draw:"Match nul"};
    root.innerHTML=`<div class="pve-head"><h2>${m.training?"Entraînement":"Défi PvE classé"}</h2><span>Manche ${Math.min(m.round,LIMIT)} / ${LIMIT}</span></div>
${mapHTML(m)}
${m.done?`<div class="pve-result">${labels[m.result]} ${m.training?"— aucun point":m.settled?`— ${m.result==="win"?"+30":m.result==="loss"?"−15 (minimum 0)":"0"} points`:"— résultat non enregistré"}</div><p>${esc(notice)}</p><div class="pve-buttons"><button class="btn-play" data-action="back" ${busy?"disabled":""}>Retour à mon équipe</button>${!m.training&&!m.settled?`<button class="btn" data-action="settle" ${busy?"disabled":""}>Réessayer l'enregistrement</button>`:""}</div>`:
`<h3>Plan des bots — déjà décidé</h3><div class="pve-intents">${m.units[1].map((u,i)=>`<div class="pve-intent"><b>${esc(u.name)} · ${u.role}</b><br>${u.hp>0?esc(orderText(m,1,i,m.intents[i])):`Vaincu : retour dans ${u.respawn} manche(s)`}</div>`).join("")}</div>
<div class="pve-help">1. Choisis un ordre pour chaque allié. 2. Consulte la prévision. 3. Résous la manche.<br>Déplacements → protections → dégâts simultanés → vagues → bâtiments.<br>Une attaque ciblée échoue si la cible change de voie. Le Gank suit sa cible. Les protections ne suivent pas un allié qui quitte la voie. Les morts réapparaissent après deux manches complètes, à leur position de départ.</div>
<div class="pve-orders">${m.units[0].map((u,i)=>`<div class="pve-order ${u.hp<=0?"dead":""} ${m.plans[i]?"changed":""}"><h4>${u.role} · ${esc(u.name)} · ${LANES[u.lane]}</h4><p>${esc(SKILLS[i][0])} : ${esc(SKILLS[i][1])}<br>${u.cd?`Indisponible pour encore ${u.cd} manche(s).`:"Disponible maintenant."}</p>${u.hp>0?`<select data-order="${i}" ${busy?"disabled":""}><option value="">Choisir un ordre…</option>${options(m,0,i).map(p=>{const value=`${p.a}:${p.t}`,selected=m.plans[i]?.a===p.a&&m.plans[i]?.t===p.t;return `<option value="${value}" ${selected?"selected":""}>${esc(orderText(m,0,i,p))}</option>`;}).join("")}</select>`:`<p>Vaincu · retour dans ${u.respawn} manche(s).</p>`}</div>`).join("")}</div>
${forecastHTML()}<div class="pve-buttons"><button class="btn-play" data-action="resolve" ${!allReady()||busy?"disabled":""}>${m.units[0].every(u=>u.hp<=0)?"Attendre la manche suivante":"Résoudre la manche"}</button><button class="btn" data-action="erase" ${busy?"disabled":""}>Effacer mes ordres</button><button class="btn" data-action="abandon" ${busy?"disabled":""}>Abandonner</button></div><p role="status">${esc(notice)}</p>`}
<details ${m.done?"open":""}><summary>Historique des manches</summary><div class="pve-log">${[...m.history].reverse().map(h=>`<h4>Manche ${h.round}</h4>${h.log.map(x=>`<div>${esc(x)}</div>`).join("")}`).join("")||"Le combat n'a pas encore commencé."}</div></details>`;
  }
  function render(){if(battle)renderBattle();else renderLobby();}
  async function saveTeam() {
    const team=[...draft];
    await write((r,s)=>{
      const valid=fullTeam(team,s.cards||{});
      if(!valid.every(Boolean)) throw new Error("Choisis cinq champions différents, possédés et compatibles avec les rôles.");
      r.team=valid;
    });
  }
  function createBattle(training) {
    const level=rankOf(season.points),power=1+level*.04;
    const botIds=ROLES.map((role,i)=>{
      const list=api.champions().filter(c=>POOL[role].includes(c.id)).sort((a,b)=>Number(a.key)-Number(b.key));
      if(!list.length) throw new Error(`Pas de champion disponible pour ${role}.`);
      return Number(list[(level*3+season.games+i)%list.length].key)*1000;
    });
    const make=(id,i,p)=>{const c=api.card(id),ch=champion(id);return unit(id,i,p,ch.name,c.img);};
    battle=baseMatch(season.team.map((id,i)=>make(id,i,1)),botIds.map((id,i)=>make(id,i,power)),level,training,api.user().uid,season.week);
    battle.token=globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    battle.intents=botPlans(battle);notice="";
  }
  async function settle() {
    if(!battle?.done || battle.training || battle.settled) return;
    const current=battle;
    await write(r=>{
      if(api.user()?.uid!==current.user || r.week!==current.week) throw new Error("La semaine ou le compte a changé : aucun point attribué.");
      // Une seule rencontre classée active par compte. Empêche le double versement
      // du même résultat lors d'un nouvel essai après une coupure réseau.
      const ticket=r.active;
      if(ticket?.id!==current.token) throw new Error("Ce défi n'est plus actif sur ce compte.");
      if(ticket.settled) return;
      ticket.settled=true;ticket.result=current.result;
      r.points=Math.max(0,r.points+(current.result==="win"?30:current.result==="loss"?-15:0));
      r.best=Math.max(r.best,r.points);r.games++;
      if(current.result==="win")r.wins++;
      else if(current.result==="loss")r.losses++;
      else r.draws=(r.draws||0)+1;
    });
    if(battle===current){current.settled=true;notice="Résultat enregistré.";}
  }
  root.addEventListener("change",e=>{
    if(busy)return;
    const pick=e.target.closest("[data-pick]");
    if(pick){draft[Number(pick.dataset.pick)]=Number(pick.value);return;}
    const order=e.target.closest("[data-order]");
    if(order && battle && !battle.done){
      const i=Number(order.dataset.order),[a,t]=order.value.split(":");
      battle.plans[i]=a?{a,t:Number(t)}:null;
      render();
    }
  });
  root.addEventListener("click",async e=>{
    const b=e.target.closest("[data-action]");
    if(!b || b.disabled || busy)return;
    const action=b.dataset.action;
    if(action==="reload"){await open();return;}
    if(action==="erase" && battle){battle.plans=[];render();return;}
    if(action==="back"){battle=null;draft=fullTeam(season.team,cards);notice="";render();return;}
    if(action==="abandon" && !confirm("Abandonner ? Un défi classé compte comme une défaite."))return;
    busy=true;notice="";render();
    const generation=epoch;
    try {
      if(action==="save"){await saveTeam();notice="Équipe enregistrée.";}
      if(action==="start" || action==="train"){
        await saveTeam();if(generation!==epoch)return;
        if(action==="start" && season.active && !season.active.settled){
          throw new Error("Un défi a été interrompu. Clique sur « Clôturer le défi interrompu » ci-dessous avant de relancer.");
        }
        createBattle(action==="train");
        if(action==="start"){
          const token=battle.token;
          try {await write(r=>{
            if(r.active && !r.active.settled) throw new Error("Un défi est déjà actif sur un autre onglet.");
            r.active={id:token,settled:false};
          });}catch(err){battle=null;throw err;}
        }
      }
      if(action==="resolve" && battle && !battle.done && allReady()){
        if(api.week()!==battle.week)throw new Error("La semaine a changé. Retourne à l'équipe pour commencer la nouvelle saison.");
        battle=resolveRound(battle,battle.plans).m;
        battle.plans=[];
        if(battle.done){if(!battle.training)await settle();}
        else battle.intents=botPlans(battle);
      }
      if(action==="abandon" && battle && !battle.done){battle.done=true;battle.result="loss";if(!battle.training)await settle();}
      if(action==="settle")await settle();
      if(action==="clear-ticket"){
        await write(r=>{
          if(r.active && !r.active.settled){
            r.active.settled=true;r.active.result="loss";
            r.points=Math.max(0,r.points-15);r.losses++;r.games++;
          }
        });notice="Défi interrompu clôturé : −15 points (minimum 0).";
      }
    }catch(err){notice=err.message;console.error("Arène PvE",err);}
    finally{
      if(generation===epoch){
        busy=false;render();
        if(!battle && season?.active && !season.active.settled){root.insertAdjacentHTML("beforeend",`<button class="btn" data-action="clear-ticket">Clôturer le défi interrompu (défaite)</button>`);}
        if(action==="resolve")root.querySelector(".pve-map")?.classList.add("pve-flash");
      }
    }
  });
  return {open,close(){epoch++;battle=null;season=null;cards={};busy=false;root.innerHTML="<p>Connecte-toi pour jouer.</p>";}};
}
