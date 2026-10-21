import { doc, runTransaction } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import {
  rolesForChampion,
  loadBossItems
} from "./boss-support.js?v=1";

import {
  bossRankIcon,
  upgradeBossGold,
  publishBossRank,
  initBossLeaderboard
} from "./boss-leaderboard.js?v=1";
import { bossArtwork } from "./boss-appearances.js?v=1";
// Chasse aux boss : saisons PvE, économie indépendante de l’Aventure.
const ROLES = ["Top", "Jungle", "Mid", "ADC", "Support"];
const POOL = {
  Top: ["Garen", "Darius", "Fiora", "Camille", "Ornn", "Malphite", "Sett", "Shen", "Renekton", "Aatrox", "Jax", "Gwen", "Teemo", "Nasus", "Riven", "Poppy", "Tryndamere", "Irelia", "Yorick", "Sion"],
  Jungle: ["Warwick", "Vi", "LeeSin", "MasterYi", "Amumu", "Sejuani", "Volibear", "Khazix", "Rengar", "Evelynn", "Nocturne", "Nunu", "Hecarim", "Udyr", "Gragas", "Briar", "Lillia", "Kayn", "Kindred", "Viego"],
  Mid: ["Ahri", "Lux", "Annie", "Viktor", "Syndra", "Orianna", "Zed", "Yasuo", "Yone", "Veigar", "Katarina", "Akali", "Azir", "Vex", "Malzahar", "Zoe", "Leblanc", "Taliyah", "Anivia", "AurelionSol"],
  ADC: ["Ashe", "Caitlyn", "Jinx", "Ezreal", "MissFortune", "Jhin", "Lucian", "Vayne", "Kaisa", "Tristana", "Xayah", "Sivir", "Varus", "Draven", "Aphelios", "KogMaw", "Kalista", "Samira", "Nilah", "Smolder"],
  Support: ["Braum", "Leona", "Nautilus", "Thresh", "Lulu", "Soraka", "Sona", "Nami", "Janna", "Yuumi", "Rakan", "Milio", "Renata", "Blitzcrank", "Karma", "Alistar", "Taric", "Zilean", "Bard", "Senna"]
};

const BOSS = [
  { id: 'hextech', name: 'Gardien hextech', hp: 2350, heavy: 580, hit: 45, warning: 2.5, exposed: 3, type: 'physical', points: 25, gold: 900, bonus: 0, hue: 0, desc: 'Le combat de départ : protège la frappe lourde, puis attaque le cœur orange.' },
  { id: 'stone', name: 'Sentinelle de pierre', hp: 2900, heavy: 760, hit: 50, warning: 2.5, exposed: 3, type: 'physical', points: 40, gold: 1100, bonus: 0, hue: 35, desc: 'Une frappe physique plus forte. Armure et PV sont utiles.' },
  { id: 'ember', name: 'Golem de braise', hp: 3500, heavy: 430, hit: 52, warning: 2.3, exposed: 3, type: 'magic', echo: 1.5, points: 60, gold: 1400, bonus: 1, hue: 155, desc: 'Deux frappes magiques séparées de 1,5 s : le bouclier ne couvre pas les deux. Prévois un soin.' },
  { id: 'mist', name: 'Araignée des brumes', hp: 4100, heavy: 560, hit: 52, warning: 2.3, exposed: 3, type: 'magic', dot: 20, points: 90, gold: 1700, bonus: 1, hue: 260, desc: 'Poison magique : 20 dégâts bruts par seconde, en plus des frappes. Résistance magique et soin.' },
  { id: 'ice', name: 'Colosse de glace', hp: 4800, heavy: 700, hit: 56, warning: 1.7, exposed: 1.8, type: 'physical', points: 130, gold: 2100, bonus: 1, hue: 310, desc: 'L’avertissement et la surchauffe sont plus courts. Les boutons restent les mêmes.' },
  { id: 'dragon', name: 'Dragon des ruines', hp: 5600, heavy: 810, hit: 60, warning: 2.4, exposed: 2.5, type: 'physical', alternate: true, points: 180, gold: 2600, bonus: 1, hue: 95, desc: 'Alterne frappe lente et coup rapide : lis le compte à rebours, ne te fie pas à un rythme fixe.' },
  { id: 'void', name: 'Gardien du Néant', hp: 6500, heavy: 900, hit: 66, warning: 1.8, exposed: 2.1, type: 'magic', armor: .15, points: 240, gold: 3200, bonus: 2, hue: 235, desc: 'Carapace absorbant 85 % des dégâts et puissantes attaques magiques. Réserve Assaut à la surchauffe.' },
  { id: 'sovereign', name: 'Souverain des profondeurs', hp: 7600, heavy: 610, hit: 70, warning: 1.7, exposed: 2.5, type: 'magic', echo: 1.5, dot: 18, points: 320, gold: 4000, bonus: 2, hue: 280, desc: 'Double frappe et poison : équipe-toi avant de l’affronter.' },
  { id: 'sun', name: 'Titan solaire', hp: 9000, heavy: 1150, hit: 78, warning: 1.5, exposed: 1.8, type: 'physical', alternate: true, points: 400, gold: 5000, bonus: 2, hue: 125, desc: 'Frappe physique dévastatrice et ouvertures courtes. Armure et dégâts élevés sont nécessaires.' },
  { id: 'abyss', name: 'Roi de l’abîme', hp: 10500, heavy: 740, hit: 85, warning: 1.5, exposed: 2, type: 'magic', echo: 1.5, dot: 24, armor: .15, points: 500, gold: 6000, bonus: 3, hue: 245, desc: 'Boss final : double frappe, poison et carapace renforcée. Prépare un équipement complet.' }
];// Multiplie uniquement l'or des boss, sans modifier les points ni les boosters.
BOSS.forEach(boss => {
  boss.gold *= 3;
});
const RANKS = [['Fer', 0, 1, 0], ['Bronze', 25, 2, 0], ['Argent', 65, 3, 0], ['Or', 125, 4, 1], ['Platine', 215, 5, 1], ['Émeraude', 345, 6, 2], ['Diamant', 525, 8, 2], ['Maître', 765, 10, 3], ['Grand Maître', 1085, 12, 4], ['Challenger', 1485, 15, 5]];
const H = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = x => JSON.parse(JSON.stringify(x));
const rankOf = n => RANKS.reduce((r, x, i) => n >= x[1] ? i : r, 0);
const dayParis = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const ITEM_LABEL = { hp: 'PV', ad: 'AD', ap: 'AP', armor: 'Armure', mr: 'RM' };
function newSeason(week) { return { version: 1, week, points: 0, gold: 1000, builds: {}, cleared: {}, daily: { day: dayParis(), wins: {} }, active: null }; }
function seasonState(data, week) {
  let r = data.bossSeason;
  if (!r || r.version !== 1) { r = newSeason(week); data.bossSeason = r; }
  else if (r.week !== week) {
    const archives = data.bossArchives || {};
    if (!archives[r.week]) {
      const rank = RANKS[rankOf(r.points)], played = Object.keys(r.cleared || {}).length > 0;
      const receipt = { week: r.week, points: r.points, rank: rank[0], normal: played ? rank[2] : 0, bonus: played ? rank[3] : 0 };
      archives[r.week] = receipt;
      data.boosters = (data.boosters || 0) + receipt.normal;
      data.bonusBoosters = (data.bonusBoosters || 0) + receipt.bonus;
      data.bossLastReward = receipt;
    }
    // Un historique borné évite de faire grossir indéfiniment le compte.
    data.bossArchives = Object.fromEntries(Object.entries(archives).sort(([a], [b]) => a.localeCompare(b)).slice(-12));
    r = newSeason(week); data.bossSeason = r;
  }
  if (r.daily?.day !== dayParis()) r.daily = { day: dayParis(), wins: {} };
  return r;
}
function victoryRewards(data, r, boss, fight) {
  if (fight.week !== r.week) return { expired: true, points: 0, gold: 0, bonus: 0 };
  if (r.active?.id !== fight.token) throw new Error('Ce combat a été remplacé par un autre. Aucune récompense.');
  if (r.active.status === 'done') return r.active.receipt;
  const first = !r.cleared[boss.id];
  const paidRepeats = r.daily.wins[boss.id] || 0;
  const reward = { points: first ? boss.points : 0, gold: first ? boss.gold : paidRepeats < 3 ? Math.floor(boss.gold * .2) : 0, bonus: first ? boss.bonus : 0, first };
  if (first) r.cleared[boss.id] = true;
  else if (paidRepeats < 3) r.daily.wins[boss.id] = paidRepeats + 1;
  r.points += reward.points; r.gold += reward.gold;
  data.bonusBoosters = (data.bonusBoosters || 0) + reward.bonus;
  r.active = { ...r.active, status: 'done', receipt: reward };
  return reward;
}
function cardStats(champ, build = []) {
  const s = champ.stats || {}, info = champ.info || {}, g = (a, b) => (s[a] || 0) + (s[b] || 0) * 8;
  const u = {
    hp: g('hp', 'hpperlevel'), ad: g('attackdamage', 'attackdamageperlevel'), ap: (info.magic || 0) * 10,
    armor: g('armor', 'armorperlevel'), mr: g('spellblock', 'spellblockperlevel'),
    as: Math.max(.4, (s.attackspeed || .65) * (1 + (s.attackspeedperlevel || 2) * .08)), magic: (info.magic || 0) >= 6
  };
  build.forEach(it => Object.entries(it.stats || {}).forEach(([k, v]) => { if (k in u && Number.isFinite(v)) u[k] += v; }));
  u.hp = Math.max(1, u.hp); u.as = Math.max(.1, u.as);
  u.dps = (u.magic ? u.ap * .9 + u.ad * .4 : u.ad) * u.as / 10;
  return u;
}
function groupStats(units) {
  const sum = k => units.reduce((n, u) => n + u[k], 0), avg = k => sum(k) / 5;
  return {
    maxHP: Math.round(avg('hp')), dps: sum('dps'), armor: avg('armor'), mr: avg('mr'),
    assault: Math.round(170 + sum('ad') * .12 + sum('ap') * .3), heal: Math.round(100 + avg('hp') * .07 + sum('ap') * .12)
  };
}
function freshFight(boss, group) {
  return {
    cfg: clone(boss), group: clone(group), time: 0, hp: group.maxHP, boss: boss.hp, phase: 'normal', phaseTime: 0, cycle: 0,
    basicTimer: 0, attackTimer: 0, poisonTimer: 0, echoIn: 0, shield: 0, cd: { shield: 0, heal: 0, assault: 0 },
    stats: { blocked: 0, missed: 0, goodAssaults: 0, badAssaults: 0, healed: 0, damage: 0 }, events: [], eventId: 0, result: null
  };
}
function event(f, text, kind = 'info') { f.events.unshift({ id: ++f.eventId, text, kind }); f.events = f.events.slice(0, 10); }
function warningDuration(f) { return f.cfg.alternate && f.cycle % 2 === 1 ? 1.1 : f.cfg.warning; }
function phaseDuration(f) { return { normal: 3, armor: 2, warning: warningDuration(f), exposed: f.cfg.exposed }[f.phase]; }
function bossMultiplier(f) { return f.phase === 'armor' ? (f.cfg.armor ?? .25) : f.phase === 'exposed' ? 1.6 : 1; }
function damageBoss(f, amount, text = '', kind = 'hit') {
  const n = Math.min(f.boss, Math.max(0, amount)); f.boss -= n; f.stats.damage += n;
  if (text) event(f, `${text} : −${Math.round(n)} PV.`, kind);
  if (f.boss <= .001) { f.boss = 0; f.result = 'win'; } return n;
}
function damageTeam(f, amount, heavy = false) {
  const defense = f.cfg.type === 'physical' ? f.group.armor : f.group.mr;
  const shielded = f.shield > 0;
  const n = amount * (100 / (100 + Math.max(0, defense))) * .88 * (shielded ? .2 : 1);
  f.hp = Math.max(0, f.hp - n);
  if (heavy) {
    if (shielded) { f.stats.blocked++; event(f, `Frappe protégée : −${Math.round(n)} PV.`, 'good'); }
    else { f.stats.missed++; event(f, `Frappe subie : −${Math.round(n)} PV.`, 'bad'); }
  }
  if (f.hp <= .001) { f.hp = 0; f.result = 'loss'; } return n;
}
function useAbility(f, a) {
  if (f.result || !(a in f.cd) || f.cd[a] > .001) return false;
  if (a === 'shield') { f.cd.shield = 8; f.shield = 1.1; event(f, 'Protection active pendant 1,1 s.', 'shield'); return true; }
  if (a === 'heal') {
    if (f.hp >= f.group.maxHP) return false;
    const n = Math.min(f.group.heal, f.group.maxHP - f.hp); f.hp += n; f.stats.healed += n; f.cd.heal = 18;
    event(f, `Soin : +${Math.round(n)} PV.`, 'heal'); return true;
  }
  f.cd.assault = 12;
  const exposed = f.phase === 'exposed';
  if (exposed) f.stats.goodAssaults++;
  if (f.phase === 'armor') f.stats.badAssaults++;
  damageBoss(f, f.group.assault * (exposed ? 2.4 * 1.15 : bossMultiplier(f)), exposed ? 'Assaut sur point faible' : 'Assaut', exposed ? 'good' : 'hit'); return true;
}
function tickFight(f, dt) {
  if (f.result) return;
  dt = Math.max(0, Math.min(dt, 60 - f.time)); f.time += dt; f.phaseTime += dt; f.shield = Math.max(0, f.shield - dt);
  Object.keys(f.cd).forEach(k => f.cd[k] = Math.max(0, f.cd[k] - dt));
  f.attackTimer += dt;
  while (f.attackTimer >= .2 && !f.result) { f.attackTimer -= .2; damageBoss(f, f.group.dps * .2 * bossMultiplier(f)); }
  if (f.result) return;
  if (f.echoIn > 0) { f.echoIn -= dt; if (f.echoIn <= 0) { damageTeam(f, f.cfg.heavy, true); event(f, 'La seconde frappe vient de tomber.', 'warn'); } }
  if (f.result) return;
  if (f.cfg.dot) { f.poisonTimer += dt; while (f.poisonTimer >= 1 && !f.result) { f.poisonTimer--; damageTeam(f, f.cfg.dot); } }
  if (f.phase === 'normal' || f.phase === 'armor') {
    f.basicTimer += dt; while (f.basicTimer >= 1.2 && !f.result) { f.basicTimer -= 1.2; damageTeam(f, f.cfg.hit); }
  }
  if (f.result) return;
  if (f.phaseTime + 1e-8 >= phaseDuration(f)) {
    f.phaseTime = 0; f.basicTimer = 0;
    if (f.phase === 'normal') { f.phase = 'armor'; event(f, 'Carapace : conserve Assaut.', 'info'); }
    else if (f.phase === 'armor') { f.phase = 'warning'; event(f, `Impact dans ${warningDuration(f).toFixed(1)} s${f.cfg.echo ? ' puis une seconde frappe 1,5 s après' : ''}.`, 'warn'); }
    else if (f.phase === 'warning') {
      const raw = f.cfg.alternate && f.cycle % 2 === 1 ? f.cfg.heavy * .65 : f.cfg.heavy;
      damageTeam(f, raw, true); f.phase = 'exposed';
      if (f.cfg.echo && !f.result) f.echoIn = f.cfg.echo;
      if (!f.result) event(f, 'Cœur ouvert : utilise Assaut !', 'good');
    } else { f.phase = 'normal'; f.cycle++; event(f, 'Le boss reprend son cycle.'); }
  }
  if (f.time + 1e-8 >= 60 && !f.result) { f.result = 'timeout'; event(f, 'Temps écoulé. Améliore ton équipement ou ton timing.', 'bad'); }
}
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


function seasonPatch(s) { return { bossSeason: s.bossSeason, bossArchives: s.bossArchives || {}, bossLastReward: s.bossLastReward || null, boosters: s.boosters || 0, bonusBoosters: s.bonusBoosters || 0 }; }
export async function syncBossWeek(db, uid, week) {
  return runTransaction(db, async tx => {
    const ref = doc(db, 'users', uid), snap = await tx.get(ref);
    if (!snap.exists()) return null;
    const s = snap.data(); seasonState(s, week); tx.update(ref, seasonPatch(s)); return s.bossSeason;
  });
}
export function initRanked(api) {
  const root = document.getElementById('rankedRoot');
  if (!root) throw new Error('Il manque rankedRoot dans index.html.');
  function styles() {
    if (document.getElementById("hex-boss-season-style-v1")) return;
    const el = document.createElement("style"); el.id = "hex-boss-season-style-v1";
    el.textContent = `
.bs-boss-grid,.bs-shop{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:12px}.bs-boss-grid .hb-box,.bs-shop .hb-box{margin:0}.bs-boss-grid,.bs-shop{margin:14px 0}.bs-equipped{display:flex;gap:10px;flex-wrap:wrap}.bs-equipped small{display:block}.bs-shop img,.bs-equipped img{object-fit:cover;vertical-align:middle;border-radius:6px;margin-right:8px}#bs-search{padding:10px;border-radius:8px;background:#0c1624;color:white;border:1px solid #4c6580;font-size:16px}#bs-filter{max-width:250px;padding:10px;background:#0c1624;color:white;font-size:16px}#bs-target{padding:10px;background:#0c1624;color:white;max-width:100%;font-size:16px}

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
  let data = {}, season = null, cards = {}, team = [], savedTeam = [], fight = null, owner = null, busy = false, ready = false, paused = false;
  let note = '', frame = 0, last = 0, acc = 0, paintClock = 0, sequence = 0, view = 'bosses', shopTarget = 0, shopQuery = '', shopFilter = '';
  let seenEvent = -1, previousPhase = '', previousHP = 0, previousBoss = 0, hitUntil = 0, healUntil = 0, teamHitUntil = 0;
  const $ = id => root.querySelector(`#${id}`);
  const champ = id => api.champions().find(c => Number(c.key) === Math.floor(Number(id) / 1000));
  let bossCatalogue = [];
  let bossCatalogueError = "";

  const itemList = () => bossCatalogue;

  async function refreshBossItems(force = false) {
    bossCatalogueError = "";

    try {
      bossCatalogue = await loadBossItems(
        () => api.items?.() || [],
        force
      );
    } catch (error) {
      bossCatalogueError = error.message;
      console.error("Boutique de Chasse aux boss :", error);
    }
  }
  const itemText = it => Object.entries(it.stats || {}).map(([k, v]) => `+${v} ${ITEM_LABEL[k] || k}`).join(' · ');
  function validate(input, owned) {
    const seen = new Set(); return ROLES.map((r, i) => {
      const id = Number(input?.[i]) || 0, c = champ(id);
      if (!c || !rolesForChampion(c).includes(r) || !(owned[id] > 0) || seen.has(c.id)) return 0;
      seen.add(c.id); return id;
    });
  }
  async function write(change = () => null) {
    const user = api.user(); if (!user) throw new Error('Connecte-toi d’abord.');
    const week = api.week();
    const out = await runTransaction(api.db, async tx => {
      const ref = doc(api.db, 'users', user.uid), snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('Compte introuvable.');
      const s = snap.data();
      const r = seasonState(s, week);

      // Compensation unique pour les premières victoires déjà obtenues cette semaine.
      upgradeBossGold(r, BOSS);

      const result = change(r, s);
      const patch = seasonPatch(s);
      if (s.bossTraining) patch.bossTraining = s.bossTraining;
      tx.update(ref, patch);

      // Document public contenant uniquement les informations du classement.
      publishBossRank(tx, api.db, user, s);

      return { s, result };
    });
    if (api.user()?.uid !== user.uid) throw new Error('Le compte a changé.');
    data = out.s; season = data.bossSeason; cards = data.cards || {}; owner = user.uid;
    return out.result;
  }
  function statRows(ids = savedTeam) { return ids.map(id => cardStats(champ(id), season.builds[String(id)] || [])); }
  function statText(u) { return `❤ ${Math.round(u.hp)} · AD ${Math.round(u.ad)} · AP ${Math.round(u.ap)} · Armure ${Math.round(u.armor)} · RM ${Math.round(u.mr)} · ${u.as.toFixed(2)} att./s · ${u.dps.toFixed(1)} DPS`; }
  function visible() { const s = root.closest('section'); return !document.hidden && (!s || !s.hidden) && root.getClientRects().length > 0; }
  function stop() { cancelAnimationFrame(frame); frame = 0; last = 0; acc = 0; }
  async function open() {
    if (busy) return;
    if (fight && owner === api.user()?.uid) { if (!fight.result) { paused = true; stop(); } renderFight(); return; }
    const n = ++sequence; busy = true; root.innerHTML = '<p>Chargement de la saison de Chasse aux boss…</p>';
    try { await write(); await refreshBossItems(); if (n !== sequence) return; team = validate(data.bossTraining?.team || data.ranked?.team || [], cards); savedTeam = team.every(Boolean) ? [...team] : []; ready = true; note = ''; }
    catch (e) { if (n === sequence) note = e.message; }
    finally { if (n === sequence) { busy = false; renderLobby(); } }
  }
  function header() {
    const rank = RANKS[rankOf(season.points)], reward = data.bossLastReward;
    return `<div class="hb-head"><h2>Chasse aux boss</h2><span class="hb-tag">
  ${bossRankIcon(season.points, 32)}
  ${rank[0]} · ${season.points} points
</span><span class="hb-tag">🪙 ${season.gold} or</span></div><p>Semaine du ${H(season.week)} · remise à zéro lundi à 00 h, Paris, appliquée à ta prochaine connexion ou ouverture du mode.</p>
${reward ? `<p class="hb-box">Récompense versée pour la semaine du ${H(reward.week)} : ${H(reward.rank)} (${reward.points} points) → ${reward.normal} boosters + ${reward.bonus} amélioré(s).</p>` : ''}
<div class="hb-actions"><button class="btn" data-action="bosses" ${busy ? 'disabled' : ''}>Les boss</button><button class="btn" data-action="equipment" ${busy ? 'disabled' : ''}>Équipe & boutique</button><button class="btn" data-action="refresh" ${busy ? 'disabled' : ''}>Actualiser</button></div>`;
  }
  function renderLobby() {
    if (!ready) { root.innerHTML = `<p>${H(note || 'Connecte-toi pour jouer.')}</p><button class="btn" data-action="reload">Réessayer</button>`; return; }
    root.innerHTML = header() + (view === 'equipment' ? equipmentHTML() : bossesHTML()) + `<p class="hb-message" role="status">${H(note)}</p>`;
  }
  function bossesHTML() {
    const progress = null;

    return `
    <div class="hb-box">
      <h3>Chasse aux boss</h3>

      <p>
        Chaque boss peut être vaincu une fois par semaine.
        Les récompenses sont publiées dans Firestore.
      </p>

      <div class="bs-bosses">
        ${BOSSES.map((boss, i) => {
      const entry = progress?.bosses?.[boss.id];
      const done = entry?.defeated === true;

      return `
            <article class="hb-box bs-boss" data-boss-id="${H(boss.id)}">
              ${bossArtwork(boss.id)}

              <h3>
                ${i + 1}. ${H(boss.name)}
                ${done ? '<span class="bs-done">✓ Vaincu</span>' : ''}
              </h3>

              <p>${H(boss.description)}</p>

              <div class="bs-rewards">
                <p><b>Récompense :</b> ${H(boss.rewardText)}</p>
              </div>

              ${done
          ? `<p class="bs-status">Boss déjà vaincu cette semaine.</p>`
          : `<button
                      class="btn-play"
                      data-action="fight-boss"
                      data-boss-id="${H(boss.id)}"
                    >
                      Affronter ${H(boss.name)}
                    </button>`
        }
            </article>
          `;
    }).join('')}
      </div>
    </div>
  `;
  }
  function equipmentHTML() {
    const list = itemList(), valid = savedTeam.filter(id => cards[id] > 0 && champ(id));
    if (!valid.includes(shopTarget)) shopTarget = valid[0] || 0;
    const rows = valid.length === 5 ? statRows(valid) : [];
    const group = rows.length ? groupStats(rows) : null;
    const target = shopTarget ? api.card(shopTarget) : null, build = season.builds[String(shopTarget)] || [];
    const filtered = list.filter(it => (!shopFilter || it.stats[shopFilter]) && (!shopQuery || it.name.toLocaleLowerCase('fr').includes(shopQuery.toLocaleLowerCase('fr'))));
    return `<h3>Équipe enregistrée · statistiques au niveau 9</h3><div class="hb-picks">${ROLES.map((role, i) => {
      const eligible = Object.keys(cards).filter(id => cards[id] > 0 && rolesForChampion(champ(id)).includes(role)).map(Number).sort((a, b) => api.card(a).name.localeCompare(api.card(b).name, 'fr'));
      return `<label class="hb-pick"><b>${role}</b><select data-role="${i}" ${busy ? 'disabled' : ''}><option value="0">Choisir une carte</option>${eligible.map(id => { const c = api.card(id); return `<option value="${id}" ${team[i] === id ? 'selected' : ''}>${H(c.name)} — ${H(c.skinName)}</option>`; }).join('')}</select>${rows[i] ? `<small>${H(statText(rows[i]))}</small>` : ''}</label>`;
    }).join('')}</div><div class="hb-actions"><button class="btn-play" data-action="save" ${busy ? 'disabled' : ''}>Enregistrer les cinq choix</button></div>
<p>Les statistiques affichées sont celles de l’équipe enregistrée, objets compris. Change tes choix puis enregistre avant de comparer. Même champion, mêmes statistiques quel que soit le skin ; pas de bonus de rareté.</p>
${group ? `<div class="hb-box">Groupe : ${group.maxHP} PV · ${group.dps.toFixed(1)} DPS de base · Assaut ${group.assault} dégâts, ${Math.round(group.assault * 2.4 * 1.15)} en surchauffe · Soin ${group.heal} PV.<br>PV du groupe = moyenne des PV des cinq cartes ; armure et RM moyennes réduisent les dégâts du type correspondant. Le Top réduit encore les dégâts de 12 %. Les valeurs AD/AP et vitesse d’attaque alimentent les attaques automatiques. Les objets et les statistiques sont adaptés au mini-jeu, pas au moteur exact de LoL.</div>` : ''}
<h3>Boutique de Chasse aux boss</h3><p>Or et équipements séparés de l’Aventure. Trois objets différents par carte. Achat direct : pas de recettes. Seules les statistiques affichées fonctionnent, pas les passifs des objets. Revente : 70 % du prix payé. Tout cet équipement expire lundi.</p>
<label>Équiper : <select id="bs-target" ${busy ? 'disabled' : ''}>${valid.map(id => `<option value="${id}" ${id === shopTarget ? 'selected' : ''}>${H(api.card(id).name)} — ${H(api.card(id).skinName)}</option>`).join('')}</select></label>
<div class="bs-equipped">${build.map((it, k) => `<div class="hb-box"><img src="${H(it.img)}" alt="" width="36" height="36"> ${H(it.name)}<small>${H(itemText(it))}</small><button class="btn" data-action="sell" data-index="${k}" data-target="${shopTarget}" ${busy ? 'disabled' : ''}>Revendre ${Math.floor(it.cost * .7)} or</button></div>`).join('') || '<p>Aucun objet équipé sur cette carte.</p>'}</div>
<div class="hb-actions"><input id="bs-search" type="search" placeholder="Rechercher un objet…" value="${H(shopQuery)}"><select id="bs-filter"><option value="">Toutes les statistiques</option>${Object.entries(ITEM_LABEL).map(([k, l]) => `<option value="${k}" ${shopFilter === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
${!list.length ? `
  <p class="hb-message">
    ${H(
      bossCatalogueError ||
      "Aucun objet disponible. Clique sur Actualiser pour recharger la boutique."
    )}
  </p>
` : ''}
<div class="bs-shop">${filtered.map(it => `<article class="hb-box"><img loading="lazy" src="${H(it.img)}" alt="" width="42" height="42"><b>${H(it.name)}</b><p>${H(itemText(it))}</p><button class="btn" data-action="buy" data-item="${H(it.id)}" data-target="${shopTarget}" ${busy || !target || season.gold < it.cost || build.length >= 3 || build.some(x => x.id === it.id) ? 'disabled' : ''}>Acheter · ${it.cost} or</button></article>`).join('')}</div>`;
  }
  async function save() {
    const chosen = [...team]; await write((r, s) => { const v = validate(chosen, s.cards || {}); if (!v.every(Boolean)) throw new Error('Choisis cinq champions différents, possédés et compatibles avec les rôles.'); s.bossTraining = { team: v }; });
    savedTeam = [...data.bossTraining.team]; team = [...savedTeam];
  }
  async function startBoss(index) {
    const boss = BOSS[index]; if (!boss) throw new Error('Boss inconnu.');
    const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await write((r, s) => {
      const v = validate(s.bossTraining?.team, s.cards || {});
      if (!v.every(Boolean)) throw new Error('Enregistre une équipe valide ; une carte a peut-être été échangée.');
      if (index > 0 && !r.cleared[BOSS[index - 1].id]) throw new Error('Vaincs le boss précédent.');
      r.active = { id: token, boss: boss.id, status: 'pending' };
    });
    savedTeam = [...data.bossTraining.team]; team = [...savedTeam];
    const group = groupStats(statRows()); fight = freshFight(boss, group);
    fight.token = token; fight.week = season.week; fight.user = owner; fight.team = [...savedTeam]; fight.receipt = null; fight.paid = false;
    paused = false; note = ''; paintClock = 0; event(fight, `${boss.name} arrive. ${boss.desc}`);
    renderFight(); startLoop();
  }
  async function settle() {
    const f = fight; if (!f || f.result !== 'win' || f.paid) return;
    const receipt = await write((r, s) => {
      if (api.user()?.uid !== f.user) throw new Error('Le compte a changé.');
      if (f.week === r.week && !validate(f.team, s.cards || {}).every(Boolean)) throw new Error('Tu ne possèdes plus toutes les cartes de ce combat. Aucune récompense.');
      return victoryRewards(s, r, f.cfg, f);
    });
    if (fight === f) { f.receipt = receipt; f.paid = true; note = receipt.expired ? 'Combat terminé après le changement de semaine : aucune récompense de boss.' : 'Récompenses enregistrées.'; }
  }
  async function finish() {
    stop(); if (!fight) return;
    if (fight.result === 'win' && !fight.paid) {
      busy = true; renderResult(); const n = sequence;
      try { await settle(); } catch (e) { note = e.message; console.error('Récompense boss', e); }
      finally { if (n === sequence) { busy = false; renderResult(); } }
    } else renderResult();
  }
  function renderResult() {
    stop(); if (!fight) return;
    const f = fight, s = f.stats, r = f.receipt;
    root.innerHTML = `<div class="hb-result"><h3>${f.result === 'win' ? '🏆 Boss vaincu !' : f.result === 'timeout' ? '⏱️ Temps écoulé' : 'Ton équipe est vaincue'}</h3><p>${H(f.cfg.name)} · ${f.time.toFixed(1)} s · Boss ${Math.ceil(f.boss)} PV · Équipe ${Math.ceil(f.hp)} PV.</p>
${f.result === 'win' ? busy ? '<p>Enregistrement des récompenses…</p>' : r ? `<p>${r.expired ? 'La semaine a changé.' : `+${r.points} points · +${r.gold} or · +${r.bonus} booster(s) amélioré(s).`}</p>` : '<p>La victoire n’a pas encore été enregistrée. Réessaie avant de quitter.</p>' : '<p>Aucun point ni or perdu.</p>'}</div>
<div class="hb-box"><p>🛡️ ${s.blocked}/${s.blocked + s.missed} frappe(s) lourde(s) protégée(s).<br>⚡ ${s.goodAssaults} Assaut(s) sur point faible ; ${s.badAssaults} contre la carapace.<br>💚 ${Math.round(s.healed)} PV rendus.</p><p>${s.missed ? 'Protège-toi dans la dernière seconde avant l’impact.' : ''} ${s.badAssaults ? 'Garde Assaut pour le cœur orange.' : ''} ${f.result === 'timeout' ? 'Augmente tes dégâts avec les objets AD/AP.' : ''} ${f.result === 'loss' ? 'PV et résistances peuvent t’aider, sans remplacer le bon timing.' : ''}</p></div>
<p class="hb-message" role="status">${H(note)}</p><div class="hb-actions">${f.result === 'win' && !f.paid ? `<button class="btn-play" data-action="retry" ${busy ? 'disabled' : ''}>Réessayer l’enregistrement</button>` : ''}<button class="btn-play" data-action="lobby" ${busy ? 'disabled' : ''}>Retour aux boss</button><button class="btn" data-action="equipment" ${busy ? 'disabled' : ''}>Améliorer mon équipe</button></div>`;
  }
  function skillHTML(k, title, description) { return `<button type="button" class="hb-skill" id="hb-${k}" data-ability="${k}"><b>${title}</b><small>${description}</small><span data-cooldown>Prêt</span></button>`; }
  function renderFight() {
    if (!fight) return; if (fight.result) { renderResult(); return; }
    const f = fight, g = f.group;
    root.innerHTML = `<div class="hb-head"><h2>${H(f.cfg.name)}</h2><span class="hb-tag">${RANKS[rankOf(season.points)][0]} · défi PvE</span><b id="hb-time"></b></div><p>${H(f.cfg.desc)}</p>
<div class="hb-bars"><div>Ton équipe <b id="hb-hp-text"></b><div class="hb-bar"><span id="hb-hp"></span></div></div><div>Le boss <b id="hb-boss-text"></b><div class="hb-bar boss"><span id="hb-boss-hp"></span></div></div></div>
<div class="hb-stage" id="hb-stage"><div class="hb-squad">${savedTeam.map((id, i) => { const c = api.card(id); return `<div class="hb-hero"><img src="${H(c.img)}" alt="${H(c.name)}"><span>${H(c.name)}</span><small>${ROLES[i]}</small></div>`; }).join('')}<span class="hb-projectile"></span></div><div class="hb-boss">${bossArtwork(f.cfg.id)}</div><div class="hb-feedback" id="hb-feedback" hidden></div><div class="hb-overlay" id="hb-pause" hidden><h3>Combat en pause</h3><p>Le temps et les recharges sont arrêtés.</p><button class="btn-play" data-action="resume">Reprendre</button><button class="btn" data-action="leave">Quitter sans pénalité</button></div></div>
<div class="hb-intent" id="hb-intent"><h3 id="hb-phase"></h3><p id="hb-advice"></p><span class="hb-count" id="hb-count"></span></div>
<div class="hb-skills">${skillHTML('shield', '🛡️ Protéger · 1', '−80 % de dégâts pendant 1,1 s. Recharge : 8 s.')}${skillHTML('heal', '💚 Soigner · 2', `Rend jusqu’à ${g.heal} PV. Recharge : 18 s.`)}${skillHTML('assault', '⚡ Assaut · 3', `${g.assault} dégâts de base ; ${Math.round(g.assault * 2.4 * 1.15)} en surchauffe. Recharge : 12 s.`)}</div>
<div class="hb-actions"><button class="btn" data-action="pause">Pause</button><button class="btn" data-action="leave">Quitter sans pénalité</button></div><p class="hb-message" id="hb-note" role="status"></p><details><summary>Journal du combat</summary><div class="hb-log" id="hb-log"></div></details>`;
    seenEvent = -1; previousPhase = ''; previousHP = f.hp; previousBoss = f.boss; paint();
  }
  function paint() {
    if (!fight || fight.result || !$('hb-stage')) return;
    const f = fight, now = performance.now(), stage = $('hb-stage'), g = f.group;
    $('hb-time').textContent = `${Math.max(0, 60 - f.time).toFixed(1)} s`;
    $('hb-hp-text').textContent = `${Math.ceil(f.hp)} / ${g.maxHP}`; $('hb-boss-text').textContent = `${Math.ceil(f.boss)} / ${f.cfg.hp}`;
    $('hb-hp').style.width = `${100 * f.hp / g.maxHP}%`; $('hb-boss-hp').style.width = `${100 * f.boss / f.cfg.hp}%`;
    if (f.hp < previousHP) teamHitUntil = now + 150; if (f.hp > previousHP) healUntil = now + 300; if (previousBoss - f.boss > 50) hitUntil = now + 220;
    previousHP = f.hp; previousBoss = f.boss;
    stage.dataset.phase = f.phase; stage.classList.toggle('shielded', f.shield > 0); stage.classList.toggle('boss-hit', now < hitUntil); stage.classList.toggle('team-hit', now < teamHitUntil); stage.classList.toggle('healing', now < healUntil); stage.classList.toggle('hb-paused', paused); $('hb-pause').hidden = !paused;
    if (previousPhase !== f.phase) {
      const text = { normal: ['Attaques normales', 'Tes champions attaquent seuls. Prépare-toi à la prochaine frappe.'], armor: ['Carapace renforcée', `Le boss absorbe ${Math.round((1 - (f.cfg.armor ?? .25)) * 100)} % des dégâts : garde Assaut.`], warning: ['Frappe imminente', 'Attends la dernière seconde pour Protéger.'], exposed: ['Cœur ouvert !', 'Utilise Assaut pendant la surchauffe.'] }[f.phase];
      $('hb-phase').textContent = text[0]; $('hb-advice').textContent = text[1]; $('hb-intent').dataset.phase = f.phase; previousPhase = f.phase;
    }
    const remain = Math.max(0, phaseDuration(f) - f.phaseTime);
    $('hb-count').textContent = f.echoIn > 0 ? `Seconde frappe dans ${f.echoIn.toFixed(1)} s` : (f.phase === 'warning' ? `Impact dans ${remain.toFixed(1)} s` : f.phase === 'exposed' ? `Ouverture : ${remain.toFixed(1)} s` : '');
    Object.keys(f.cd).forEach(k => { const b = $(`hb-${k}`), cd = f.cd[k]; b.disabled = paused || busy || cd > .001 || (k === 'heal' && f.hp >= g.maxHP); b.querySelector('[data-cooldown]').textContent = cd > .001 ? `Recharge : ${cd.toFixed(1)} s` : k === 'heal' && f.hp >= g.maxHP ? 'PV au maximum' : 'Prêt'; b.classList.toggle('recommended', !paused && cd <= .001 && ((k === 'shield' && ((f.phase === 'warning' && remain <= .8) || (f.echoIn > 0 && f.echoIn <= .8))) || (k === 'heal' && g.maxHP - f.hp >= g.heal) || (k === 'assault' && f.phase === 'exposed'))); });
    if (seenEvent !== f.eventId) { $('hb-log').innerHTML = f.events.map(e => `<div class="${e.kind}">${H(e.text)}</div>`).join(''); const e = f.events[0]; if (e) { $('hb-feedback').textContent = e.text; $('hb-feedback').hidden = false; } seenEvent = f.eventId; }
    $('hb-note').textContent = note;
  }
  function loop(now) {
    frame = 0; if (!fight || fight.result || paused) return;
    if (api.user()?.uid !== owner) { controller.close(); return; }
    if (!visible()) { pause(); return; }
    if (!last) last = now; acc += Math.min(.15, Math.max(0, (now - last) / 1000)); last = now;
    while (acc >= .02 && !fight.result) { tickFight(fight, .02); acc -= .02; }
    if (fight.result) { void finish(); return; }
    if (now - paintClock > 65) { paint(); paintClock = now; } frame = requestAnimationFrame(loop);
  }
  function startLoop() { stop(); if (fight && !fight.result && !paused) frame = requestAnimationFrame(loop); }
  function pause() { if (!fight || fight.result) return; paused = true; stop(); paint(); }
  function resume() { if (!fight || fight.result || !visible()) return; paused = false; paint(); startLoop(); }
  function ability(k) { if (busy || paused || !fight || fight.result || !visible()) return; if (api.user()?.uid !== owner) { controller.close(); return; } if (useAbility(fight, k)) { if (fight.result) void finish(); else paint(); } }
  root.addEventListener('change', e => {
    if (busy) return; const p = e.target.closest('[data-role]'); if (p) { team[Number(p.dataset.role)] = Number(p.value); return; }
    if (e.target.id === 'bs-target') { shopTarget = Number(e.target.value); renderLobby(); }
    if (e.target.id === 'bs-filter') { shopFilter = e.target.value; renderLobby(); }
  });
  root.addEventListener('input', e => { if (e.target.id === 'bs-search') { const pos = e.target.selectionStart; shopQuery = e.target.value; renderLobby(); const input = $('bs-search'); input.focus(); input.setSelectionRange(pos, pos); } });
  root.addEventListener('click', async e => {
    const skill = e.target.closest('[data-ability]'); if (skill && !skill.disabled) { ability(skill.dataset.ability); return; }
    const b = e.target.closest('[data-action]'); if (!b || b.disabled || busy) return; const a = b.dataset.action;
    if (a === 'reload') { await open(); return; } if (a === 'pause') { pause(); return; } if (a === 'resume') { resume(); return; }
    if (a === 'leave') {
      pause(); if (!confirm('Quitter ce combat ? Aucun point ni or perdu, mais aucune récompense.')) return;
      stop(); fight = null; paused = false; note = ''; renderLobby(); return;
    }
    if (a === 'bosses') { view = 'bosses'; renderLobby(); return; }
    if ((a === 'equipment' || a === 'lobby') && fight?.result === 'win' && !fight.paid) {
      if (!confirm('La victoire n’a pas été enregistrée. Quitter peut te faire perdre cette récompense. Continuer ?')) return;
    }
    const n = sequence; busy = true; note = ''; if (!fight) renderLobby();
    try {
      if (a === 'refresh') {
        await refreshBossItems(true);
      }
      if (a === 'refresh' || a === 'lobby' || a === 'equipment') {
        await write(); if (n !== sequence) return; fight = null; view = a === 'equipment' ? 'equipment' : a === 'lobby' ? 'bosses' : view;
        team = validate(data.bossTraining?.team || team, cards); savedTeam = team.every(Boolean) ? [...team] : [];
      }
      if (a === 'save') { await save(); note = 'Équipe enregistrée.'; }
      if (a === 'fight') await startBoss(Number(b.dataset.boss));
      if (a === 'retry') await settle();
      if (a === 'buy') {
        const target = Number(b.dataset.target), it = itemList().find(x => x.id === b.dataset.item);
        if (!it) throw new Error('Objet indisponible.');
        await write((r, s) => {
          if (!(s.cards?.[target] > 0)) throw new Error('Tu ne possèdes plus cette carte.');
          if (!validate(s.bossTraining?.team, s.cards || {}).includes(target)) throw new Error('Cette carte ne fait plus partie de l’équipe.');
          const build = r.builds[String(target)] || [];
          if (build.length >= 3 || build.some(x => x.id === it.id)) throw new Error('Trois objets maximum, sans exemplaire identique sur la même carte.');
          if (r.gold < it.cost) throw new Error('Pas assez d’or.'); r.gold -= it.cost; r.builds[String(target)] = [...build, clone(it)];
        }); note = `${it.name} acheté.`;
      }
      if (a === 'sell') {
        const target = String(b.dataset.target), index = Number(b.dataset.index), expected = season.builds[target]?.[index];
        if (!expected) throw new Error('Objet introuvable.');
        await write(r => { const build = r.builds[target] || [], it = build[index]; if (!it || it.id !== expected.id) throw new Error('L’équipement a changé. Actualise.'); build.splice(index, 1); r.gold += Math.floor(it.cost * .7); }); note = 'Objet revendu.';
      }
    } catch (err) { note = err.message; console.error('Chasse aux boss', err); }
    finally { if (n === sequence) { busy = false; if (fight) { if (fight.result) renderResult(); else paint(); } else renderLobby(); } }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  document.addEventListener('keydown', e => {
    if (!fight || fight.result || !visible() || e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.target instanceof Element && e.target.closest('input,select,textarea,[contenteditable=true]')) return;
    if (e.code === 'Space') { e.preventDefault(); if (paused) resume(); else pause(); return; }
    const k = ({ Digit1: 'shield', Numpad1: 'shield', Digit2: 'heal', Numpad2: 'heal', Digit3: 'assault', Numpad3: 'assault' })[e.code]; if (k) { e.preventDefault(); ability(k); }
  });
  const rankingUI = initBossLeaderboard({
    db: api.db,
    user: api.user,
    week: api.week,
    root,
    onOpen: pause
  });

  const controller = {
    open,

    close() {
      // Ferme et vide le classement à la déconnexion.
      rankingUI.close();

      // Invalide les opérations d'affichage encore en cours.
      sequence++;

      // Arrête l'animation et le combat.
      stop();
      fight = null;

      // Réinitialise l'interface et les données locales.
      ready = false;
      owner = null;
      busy = false;
      paused = false;

      data = {};
      season = null;
      cards = {};

      team = [];
      savedTeam = [];

      root.innerHTML = "<p>Connecte-toi pour jouer.</p>";
    }
  };

  return controller;
}
