import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
         updateProfile, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import { getFirestore, doc, runTransaction, collection, query, where, onSnapshot,
         getDoc, setDoc, addDoc, updateDoc, deleteDoc }
  from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA40nyTJKIFw0_mvU7GY9mZEGkvmkzUNu0",
  authDomain: "runeterra-e36e9.firebaseapp.com",
  projectId: "runeterra-e36e9",
  storageBucket: "runeterra-e36e9.firebasestorage.app",
  messagingSenderId: "1047814914304",
  appId: "1:1047814914304:web:dd032ee8d23d038334b3e5",
  measurementId: "G-8LH5TWR3KE"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const MAX_BOOSTERS = 10;
const REFILL_MS = 10 * 60 * 1000;
const CARDS_PER_BOOSTER = 5;
const ALLOW_DUPES_IN_BOOSTER = true;
const DUPES_PER_CRAFT = 3;
const DDRAGON = "https://ddragon.leagueoflegends.com";
const CD = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default";

const RARITIES = {
  common:    { label: "Commune",    chance: 1,      color: "#8a8f98" },
  rare:      { label: "Rare",       chance: 0.941,  color: "#0397ab" },
  epic:      { label: "Épique",     chance: 0.176,  color: "#a335ee" },
  legendary: { label: "Légendaire", chance: 0.02,   color: "#ff8000" },
  mythic:    { label: "Mythique",   chance: 0.0033, color: "#e84057" }
};
const RARITY_ORDER = ["mythic", "legendary", "epic", "rare", "common"];
const CRAFT_WEIGHTS = { common: 70, rare: 24, epic: 4.5, legendary: 1.3, mythic: 0.2 };

// carte "de tête" d'un booster bonus (épique minimum garanti)
const BONUS_TOP = { epic: 85, legendary: 12.5, mythic: 2.5 };

const QUESTS = {
  daily: [
    { id: "open",    label: "Ouvrir 30 boosters",   target: 30 },
    { id: "trade",   label: "Faire 1 échange",       target: 1 },
    { id: "recycle", label: "Recycler 3 doublons",   target: 3 }
  ],
  weekly: [
    { id: "open",    label: "Ouvrir 100 boosters",   target: 100 },
    { id: "trade",   label: "Faire 10 échanges",     target: 10 },
    { id: "recycle", label: "Recycler 30 doublons",  target: 30 }
  ]
};

let user = null, state = null;
let champions = [], champByKey = {}, skinsById = {}, skinList = [];
let pools = {}, skinsByChamp = {};
let friendships = [], tradesIn = [], tradesOut = [], unsubs = [];
let tradesLoaded = { in: false, out: false }, syncingTrades = false;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const myName = () => auth.currentUser?.displayName || "";

function rarityOf(s) {
  if (s.isBase) return "common";
  switch (s.rarity) {
    case "kEpic": return "epic";
    case "kLegendary": return "legendary";
    case "kUltimate": case "kMythic": case "kTranscendent": return "mythic";
    default: return "rare";
  }
}

// ---------- Boosters (recharge) ----------
function applyRefill(s, now = Date.now()) {
  if (s.boosters >= MAX_BOOSTERS) {
    s.boosters = MAX_BOOSTERS; s.lastRefill = now; return s;
  }
  const gained = Math.floor((now - s.lastRefill) / REFILL_MS);
  if (gained > 0) {
    s.boosters = Math.min(MAX_BOOSTERS, s.boosters + gained);
    s.lastRefill = s.boosters >= MAX_BOOSTERS ? now : s.lastRefill + gained * REFILL_MS;
  }
  return s;
}

// ---------- Dates (heure de Paris) ----------
const dayKey = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit"
}).format(new Date());

function weekdayParis() {
  const [y, m, d] = dayKey().split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

function weekKey() {
  const [y, m, d] = dayKey().split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - weekdayParis());
  return dt.toISOString().slice(0, 10);
}

function parisSecondsToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  const g = t => +parts.find(p => p.type === t).value;
  return g("hour") * 3600 + g("minute") * 60 + g("second");
}

const untilDaily = () => 86400 - parisSecondsToday();
const untilWeekly = () => (6 - weekdayParis()) * 86400 + untilDaily();

function fmtDuration(sec) {
  const p = n => String(n).padStart(2, "0");
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600);
  const m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return `${d > 0 ? d + " j " : ""}${p(h)}:${p(m)}:${p(s)}`;
}

// ---------- Quêtes : données ----------
const freshQuest = () => ({ open: 0, trade: 0, recycle: 0, claimed: {} });

function ensureQuests(s) {
  s.quests ||= {};
  const q = s.quests;
  const dk = dayKey(), wk = weekKey();
  if (q.dayKey !== dk) { q.dayKey = dk; q.daily = freshQuest(); }
  if (q.weekKey !== wk) { q.weekKey = wk; q.weekly = freshQuest(); }
  q.daily ||= freshQuest();
  q.weekly ||= freshQuest();
  q.daily.claimed ||= {};
  q.weekly.claimed ||= {};
  return s;
}

function addProgress(s, key, n = 1) {
  ensureQuests(s);
  s.quests.daily[key] = (s.quests.daily[key] || 0) + n;
  s.quests.weekly[key] = (s.quests.weekly[key] || 0) + n;
}

// ---------- Firestore ----------
const userRef = () => doc(db, "users", user.uid);

async function loadState() {
  state = await runTransaction(db, async tx => {
    const snap = await tx.get(userRef());
    let s = snap.exists() ? snap.data()
      : { boosters: MAX_BOOSTERS, lastRefill: Date.now(), cards: {} };
    s.cards = s.cards || {};
    s = applyRefill(s);
    ensureQuests(s);
    tx.set(userRef(), s);
    return s;
  });
}

async function ensureUsernameDoc() {
  const u = auth.currentUser;
  const name = (u?.displayName || "").toLowerCase();
  if (!name) return;
  const ref = doc(db, "usernames", name);
  const snap = await getDoc(ref);
  if (!snap.exists()) await setDoc(ref, { uid: u.uid, name: u.displayName });
}

// ---------- Données du jeu ----------
const cdUrl = p => p ? `${CD}/${p.replace("/lol-game-data/assets/", "").toLowerCase()}` : "";

async function loadGameData() {
  const versions = await (await fetch(`${DDRAGON}/api/versions.json`)).json();
  const d = await (await fetch(`${DDRAGON}/cdn/${versions[0]}/data/fr_FR/champion.json`)).json();
  champions = Object.values(d.data);
  champions.forEach(c => champByKey[c.key] = c);

  const data = await (await fetch(`${CD}/v1/skins.json`)).json();
  skinsById = data;
  skinList = Object.values(data).filter(s =>
    s.id < 1000000 && champByKey[Math.floor(s.id / 1000)] && (s.loadScreenPath || s.splashPath));

  pools = {}; skinsByChamp = {};
  skinList.forEach(s => {
    (pools[rarityOf(s)] ||= []).push(s);
    (skinsByChamp[Math.floor(s.id / 1000)] ||= []).push(s);
  });
}

function skinCard(id) {
  const s = skinsById[id];
  const champ = champByKey[Math.floor(id / 1000)];
  return {
    id,
    name: champ?.name || "Inconnu",
    skinName: s?.isBase ? "Classique" : (s?.name || `Skin ${id}`),
    rarity: s ? rarityOf(s) : "common",
    img: cdUrl(s?.loadScreenPath || s?.splashPath),
    imgAlt: cdUrl(s?.splashPath || s?.tilePath),
    splash: cdUrl(s?.uncenteredSplashPath || s?.splashPath || s?.loadScreenPath),
    splashAlt: cdUrl(s?.splashPath || s?.loadScreenPath || s?.tilePath)
  };
}

function drawBooster(n) {
  const picks = [];
  for (const r of ["rare", "epic", "legendary", "mythic"]) {
    if (pools[r]?.length && Math.random() < RARITIES[r].chance) picks.push(r);
  }
  while (picks.length < n) picks.push("common");
  picks.sort((a, b) => RARITY_ORDER.indexOf(b) - RARITY_ORDER.indexOf(a));

  const cards = [], seen = new Set();
  for (const r of picks) {
    const pool = pools[r]?.length ? pools[r] : skinList;
    let s, guard = 0;
    do { s = pool[Math.floor(Math.random() * pool.length)]; }
    while (!ALLOW_DUPES_IN_BOOSTER && seen.has(s.id) && guard++ < 200);
    seen.add(s.id);
    cards.push(skinCard(s.id));
  }
  return cards;
}

function drawBonusBooster(n) {
  const total = Object.values(BONUS_TOP).reduce((a, b) => a + b, 0);
  let x = Math.random() * total, top = "epic";
  for (const [r, w] of Object.entries(BONUS_TOP)) { x -= w; if (x < 0) { top = r; break; } }
  const pool = pools[top]?.length ? pools[top] : (pools.epic?.length ? pools.epic : skinList);
  const topCard = skinCard(pool[Math.floor(Math.random() * pool.length)].id);
  return [...drawBooster(n - 1), topCard]
    .sort((a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity));
}

// ---------- Doublons ----------
const dupCount = cards => Object.values(cards || {}).reduce((a, q) => a + Math.max(0, q - 1), 0);

function pickCraftCard(owned) {
  const avail = Object.keys(CRAFT_WEIGHTS).filter(r => pools[r]?.some(s => !owned[s.id]));
  if (!avail.length) return null;
  const total = avail.reduce((a, r) => a + CRAFT_WEIGHTS[r], 0);
  let n = Math.random() * total, rarity = avail[0];
  for (const r of avail) { n -= CRAFT_WEIGHTS[r]; if (n < 0) { rarity = r; break; } }
  const cand = pools[rarity].filter(s => !owned[s.id]);
  return skinCard(cand[Math.floor(Math.random() * cand.length)].id);
}

async function craftCard() {
  if (rv) return;
  if (dupCount(state.cards) < DUPES_PER_CRAFT) {
    alert(`Il faut ${DUPES_PER_CRAFT} doublons pour faire un échange.`);
    return;
  }
  const card = pickCraftCard(state.cards || {});
  if (!card) { alert("Tu possèdes déjà toutes les cartes !"); return; }

  $("craftBtn").disabled = true;
  try {
    state = await runTransaction(db, async tx => {
      const snap = await tx.get(userRef());
      const s = snap.data();
      s.cards = s.cards || {};
      if (dupCount(s.cards) < DUPES_PER_CRAFT) throw new Error("Pas assez de doublons.");

      let need = DUPES_PER_CRAFT;
      const ids = Object.keys(s.cards).filter(k => s.cards[k] > 1)
        .sort((a, b) => s.cards[b] - s.cards[a]);
      for (const id of ids) {
        while (need > 0 && s.cards[id] > 1) { s.cards[id]--; need--; }
        if (need === 0) break;
      }
      s.cards[card.id] = (s.cards[card.id] || 0) + 1;
      addProgress(s, "recycle", DUPES_PER_CRAFT);
      tx.set(userRef(), s);
      return s;
    });
    $("result").innerHTML = "";
    startReveal([card]);
  } catch (e) {
    alert(e.message);
  }
  render();
}

// ---------- Ouverture ----------
async function openBooster() {
  $("openBtn").disabled = true;
  try {
    const drawn = drawBooster(CARDS_PER_BOOSTER);

    state = await runTransaction(db, async tx => {
      const snap = await tx.get(userRef());
      let s = applyRefill(snap.data());
      if (s.boosters <= 0) throw new Error("Aucun booster disponible");
      if (s.boosters === MAX_BOOSTERS) s.lastRefill = Date.now();
      s.boosters -= 1;
      s.cards = s.cards || {};
      drawn.forEach(c => { s.cards[c.id] = (s.cards[c.id] || 0) + 1; });
      addProgress(s, "open");
      tx.set(userRef(), s);
      return s;
    });

    $("result").innerHTML = "";
    startReveal(drawn);
  } catch (e) {
    alert(e.message);
  }
  render();
}

async function openBonusBooster() {
  if (rv) return;
  $("bonusBtn").disabled = true;
  try {
    const drawn = drawBonusBooster(CARDS_PER_BOOSTER);

    state = await runTransaction(db, async tx => {
      const snap = await tx.get(userRef());
      const s = snap.data();
      if ((s.bonusBoosters || 0) <= 0) throw new Error("Aucun booster bonus disponible.");
      s.bonusBoosters -= 1;
      s.cards = s.cards || {};
      drawn.forEach(c => { s.cards[c.id] = (s.cards[c.id] || 0) + 1; });
      tx.set(userRef(), s);
      return s;
    });

    $("result").innerHTML = "";
    startReveal(drawn);
  } catch (e) {
    alert(e.message);
  }
  render();
}

// ---------- Révélation carte par carte ----------
let rv = null;

function startReveal(cards) {
  cards.forEach(c => { const i = new Image(); i.referrerPolicy = "no-referrer"; i.src = c.img; });
  rv = { cards, next: 0, busy: false };
  $("revealRow").innerHTML = cards.map((c, i) => `
    <div class="flip r-${c.rarity}" data-i="${i}">
      <div class="flip-inner">
        <div class="flip-back"><span>R</span></div>
        <div class="flip-front">${cardHTML(c)}</div>
      </div>
    </div>`).join("");
  $("revealAll").hidden = cards.length < 2;
  $("revealClose").hidden = true;
  $("reveal").hidden = false;
  updateReveal();
}

function updateReveal() {
  if (!rv) return;
  document.querySelectorAll(".flip").forEach((el, i) => el.classList.toggle("next", i === rv.next));
  $("revealMsg").textContent = rv.next < rv.cards.length
    ? `Clique pour révéler la carte ${rv.next + 1} / ${rv.cards.length}`
    : "Terminé ! Clique sur une carte pour voir son splash art.";
}

function flipNext() {
  if (!rv || rv.next >= rv.cards.length) return;
  const i = rv.next++;
  const el = document.querySelector(`.flip[data-i="${i}"]`);
  const c = rv.cards[i];
  el.classList.add("flipped", `fx-${c.rarity}`);
  setTimeout(() => rarityEffect(el, c.rarity), 350);
  updateReveal();
  if (rv.next >= rv.cards.length) finishReveal();
}

function flipAll() {
  if (!rv || rv.busy) return;
  rv.busy = true;
  $("revealAll").hidden = true;
  const step = () => {
    if (!rv || rv.next >= rv.cards.length) return;
    flipNext();
    setTimeout(step, 450);
  };
  step();
}

function finishReveal() {
  $("revealAll").hidden = true;
  $("revealClose").hidden = false;
  $("result").innerHTML = rv.cards.map(c => cardHTML(c)).join("");
}

function closeReveal() {
  $("reveal").hidden = true;
  rv = null;
  render();
}

// ---------- Effets de rareté ----------
function screenFlash(color, opacity) {
  const f = $("flash");
  f.classList.remove("go");
  f.style.setProperty("--c", color);
  f.style.setProperty("--o", opacity);
  void f.offsetWidth;
  f.classList.add("go");
}

function shakeRow(cls) {
  const row = $("revealRow");
  row.classList.remove("shake1", "shake2");
  void row.offsetWidth;
  row.classList.add(cls);
  setTimeout(() => row.classList.remove(cls), 800);
}

function spawn(parent, cls, vars = {}, life = 1500) {
  const n = document.createElement("span");
  n.className = cls;
  Object.entries(vars).forEach(([k, v]) => n.style.setProperty(k, v));
  parent.appendChild(n);
  setTimeout(() => n.remove(), life);
  return n;
}

function mythicEmbers(el) {
  const id = setInterval(() => {
    if (!el.isConnected || $("reveal").hidden) { clearInterval(id); return; }
    spawn(el, "ember", {
      "--p": "#e84057",
      "--x": `${5 + Math.random() * 90}%`,
      "--d": "0s",
      "--h": `${120 + Math.random() * 120}px`
    }, 2000);
  }, 280);
}

function rarityEffect(el, rarity) {
  const color = RARITIES[rarity].color;

  if (rarity === "epic") {
    screenFlash(color, .3);
    shakeRow("shake1");
    spawn(el, "ring", { "--p": color }, 1200);
    setTimeout(() => spawn(el, "ring", { "--p": color }, 1200), 220);
    for (let i = 0; i < 22; i++) {
      spawn(el, "ember", {
        "--p": color,
        "--x": `${5 + Math.random() * 90}%`,
        "--d": `${Math.random() * 0.5}s`,
        "--h": `${160 + Math.random() * 140}px`
      }, 2400);
    }
  } else if (rarity === "legendary") {
    screenFlash(color, .6);
    shakeRow("shake2");
    spawn(el, "beam", {}, 1900);
    const gold = ["#ffd35a", "#ff8000", "#fff3b0"];
    for (let i = 0; i < 46; i++) {
      spawn($("reveal"), "confetti", {
        "--x": `${Math.random() * 100}vw`,
        "--d": `${Math.random() * 0.8}s`,
        "--t": `${1.8 + Math.random() * 1.2}s`,
        "--c": gold[i % 3],
        "--r": `${360 + Math.random() * 720}deg`
      }, 3600);
    }
  } else if (rarity === "mythic") {
    screenFlash(color, .85);
    shakeRow("shake2");
    mythicEmbers(el);
    for (let i = 0; i < 70; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 90 + Math.random() * 260;
      spawn(el, "particle", {
        "--dx": `${Math.cos(angle) * dist}px`,
        "--dy": `${Math.sin(angle) * dist}px`,
        "--p": Math.random() < .3 ? "#fff" : color
      }, 1200);
    }
  }
}

$("reveal").addEventListener("click", e => {
  if (e.target.closest("button")) return;
  const flipped = e.target.closest(".flip.flipped .card");
  if (flipped) { openLightbox(flipped.dataset.id); return; }
  if (rv && !rv.busy) flipNext();
});
$("revealAll").onclick = flipAll;
$("revealClose").onclick = closeReveal;

// ---------- Splash art en grand ----------
function openLightbox(id) {
  const c = skinCard(+id);
  const img = $("lbImg");
  img.dataset.t = "";
  img.onerror = () => {
    if (img.dataset.t !== "1") { img.dataset.t = "1"; img.src = c.splashAlt; }
  };
  img.src = c.splash;
  img.alt = `${c.name} - ${c.skinName}`;
  $("lbTitle").textContent = `${c.name} — ${c.skinName}`;
  const r = $("lbRarity");
  r.textContent = RARITIES[c.rarity].label;
  r.style.color = RARITIES[c.rarity].color;
  $("lightbox").hidden = false;
}

function closeLightbox() {
  $("lightbox").hidden = true;
  $("lbImg").src = "";
}

$("lightbox").addEventListener("click", closeLightbox);
document.addEventListener("keydown", e => { if (e.key === "Escape") closeLightbox(); });

document.addEventListener("click", e => {
  if (e.target.closest("#reveal") || e.target.closest("#lightbox")) return;
  const card = e.target.closest(".card");
  if (card && card.dataset.id) openLightbox(card.dataset.id);
});

// ---------- Affichage ----------
const cardHTML = (c, qty = 0, delay = 0, locked = false) => `
  <div class="card ${c.rarity}${locked ? " locked" : ""}" data-id="${c.id}" style="animation-delay:${delay}s">
    <span class="badge">${RARITIES[c.rarity].label}</span>
    <img loading="lazy" referrerpolicy="no-referrer" alt="${esc(c.name)}" src="${c.img}"
         onerror="if(this.dataset.t!=='1'){this.dataset.t='1';this.src='${c.imgAlt}'}">
    <div class="info"><b>${esc(c.name)}</b><br>${esc(c.skinName)}${qty > 1 ? `<br>x${qty}` : ""}</div>
  </div>`;

const norm = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function renderCollection() {
  const owned = state.cards || {};
  const q = norm($("search").value.trim());
  const only = $("onlyOwned").checked;
  const champs = Object.keys(skinsByChamp)
    .map(k => champByKey[k]).filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));

  let html = "";
  for (const champ of champs) {
    const skins = skinsByChamp[champ.key].slice().sort((a, b) => a.id - b.id);
    const ownedCount = skins.filter(s => owned[s.id]).length;
    const champMatch = q && norm(champ.name).includes(q);
    const visible = skins.filter(s => {
      if (only && !owned[s.id]) return false;
      if (!q || champMatch) return true;
      return norm(skinCard(s.id).skinName).includes(q);
    });
    if (!visible.length) continue;
    html += `<details class="champ" ${q || only ? "open" : ""}>
      <summary>${esc(champ.name)}<small>${ownedCount}/${skins.length}</small></summary>
      <div class="grid">${visible.map(s => cardHTML(skinCard(s.id), owned[s.id] || 0, 0, !owned[s.id])).join("")}</div>
    </details>`;
  }
  $("collection").innerHTML = html || "Aucun résultat.";
}

function render() {
  applyRefill(state);
  $("boosterCount").textContent = state.boosters;
  $("openBtn").disabled = state.boosters <= 0 || !!rv;

  const bonus = state.bonusBoosters || 0;
  $("bonusBox").hidden = bonus <= 0;
  $("bonusCount").textContent = bonus;
  $("bonusBtn").disabled = bonus <= 0 || !!rv;

  const uniqueOwned = Object.keys(state.cards || {}).length;
  $("cardCount").textContent = `${uniqueOwned} / ${skinList.length} skins`;

  const dups = dupCount(state.cards);
  $("dupCount").textContent = dups;
  $("craftBtn").disabled = dups < DUPES_PER_CRAFT || !!rv;

  renderCollection();
  renderQuests();
}

function tickTimer() {
  if (!state) return;
  if (state.boosters >= MAX_BOOSTERS) { $("timer").textContent = "Stock plein"; return; }
  const left = REFILL_MS - (Date.now() - state.lastRefill);
  if (left <= 0) { render(); return; }
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  $("timer").textContent = `Prochain booster dans ${m}:${String(s).padStart(2, "0")}`;
}

function tickQuestTimers() {
  if (!state) return;
  if (state.quests?.dayKey !== dayKey() || state.quests?.weekKey !== weekKey()) { render(); return; }
  $("dailyTimer").textContent = "Reset dans " + fmtDuration(untilDaily());
  $("weeklyTimer").textContent = "Reset dans " + fmtDuration(untilWeekly());
}

setInterval(() => {
  if (!state) return;
  const before = state.boosters;
  applyRefill(state);
  if (state.boosters !== before) {
    $("boosterCount").textContent = state.boosters;
    $("openBtn").disabled = state.boosters <= 0 || !!rv;
  }
  tickTimer();
  tickQuestTimers();
}, 1000);

$("search").addEventListener("input", () => state && renderCollection());
$("onlyOwned").addEventListener("change", () => state && renderCollection());
$("craftBtn").onclick = craftCard;
$("bonusBtn").onclick = openBonusBooster;

// ---------- Onglets ----------
document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("active", x === b));
  document.querySelectorAll("main > section").forEach(s => s.hidden = s.id !== `tab-${b.dataset.tab}`);
});

// ---------- Quêtes : affichage et récompenses ----------
function questRow(period, def, q) {
  const val = Math.min(q[def.id] || 0, def.target);
  const done = val >= def.target;
  const claimed = !!q.claimed?.[def.id];
  return `<li class="quest ${done ? "done" : ""}">
    <div class="q-main">
      <div class="q-label">${esc(def.label)}</div>
      <div class="bar"><span style="width:${(val / def.target) * 100}%"></span></div>
      <small>${val} / ${def.target}</small>
    </div>
    ${claimed
      ? `<span class="tstatus">Récupérée ✔</span>`
      : `<button class="btn-play small" data-q="${period}:${def.id}" ${done ? "" : "disabled"}>Récupérer</button>`}
  </li>`;
}

function renderQuests() {
  if (!state) return;
  ensureQuests(state);
  const q = state.quests;
  $("dailyQuests").innerHTML = QUESTS.daily.map(d => questRow("daily", d, q.daily)).join("");
  $("weeklyQuests").innerHTML = QUESTS.weekly.map(d => questRow("weekly", d, q.weekly)).join("");

  const claimable = ["daily", "weekly"].reduce((a, p) =>
    a + QUESTS[p].filter(d => (q[p][d.id] || 0) >= d.target && !q[p].claimed?.[d.id]).length, 0);
  $("questsBadge").textContent = claimable;
  $("questsBadge").hidden = claimable === 0;
  tickQuestTimers();
}

async function claimQuest(period, id) {
  try {
    state = await runTransaction(db, async tx => {
      const snap = await tx.get(userRef());
      const s = snap.data();
      ensureQuests(s);
      const q = s.quests[period];
      const def = QUESTS[period].find(x => x.id === id);
      if (q.claimed[id]) throw new Error("Récompense déjà récupérée.");
      if ((q[id] || 0) < def.target) throw new Error("Quête non terminée.");
      q.claimed[id] = true;
      s.bonusBoosters = (s.bonusBoosters || 0) + 1;
      tx.set(userRef(), s);
      return s;
    });
    render();
  } catch (e) {
    alert(e.message);
  }
}

$("tab-quests").addEventListener("click", e => {
  const b = e.target.closest("[data-q]");
  if (!b || b.disabled) return;
  const [period, id] = b.dataset.q.split(":");
  claimQuest(period, id);
});

// compte les échanges acceptés (une seule fois chacun), pour les deux joueurs
async function syncTradeQuests() {
  if (!user || !state || syncingTrades || !tradesLoaded.in || !tradesOut) return;
  if (!tradesLoaded.out) return;
  const accepted = [...tradesIn, ...tradesOut].filter(t => t.status === "accepted").map(t => t.id);
  const seen = state.quests?.seenTrades;
  if (seen && accepted.every(id => seen.includes(id))) return;

  syncingTrades = true;
  try {
    await runTransaction(db, async tx => {
      const snap = await tx.get(userRef());
      const s = snap.data();
      ensureQuests(s);
      const q = s.quests;
      if (!q.seenTrades) {
        q.seenTrades = accepted.slice();
      } else {
        for (const id of accepted) {
          if (!q.seenTrades.includes(id)) { q.seenTrades.push(id); addProgress(s, "trade"); }
        }
      }
      tx.set(userRef(), s);
    });
  } catch (e) {
    console.warn("quêtes (échanges) :", e.message);
  } finally {
    syncingTrades = false;
  }
}

// ---------- Amis ----------
const pairId = (a, b) => [a, b].sort().join("_");
const otherOf = f => f.users.find(u => u !== user.uid);
const otherName = f => f.names?.[otherOf(f)] || "?";

async function sendFriendRequest() {
  const msg = $("friendMsg");
  msg.textContent = "";
  const pseudo = $("friendInput").value.trim().toLowerCase();
  if (!pseudo) return;
  if (pseudo === myName().toLowerCase()) { msg.textContent = "C'est ton propre pseudo !"; return; }
  try {
    const u = await getDoc(doc(db, "usernames", pseudo));
    if (!u.exists()) {
      msg.textContent = "Joueur introuvable. Il doit se connecter une fois avec la dernière version du site.";
      return;
    }
    const other = u.data();
    const ref = doc(db, "friendships", pairId(user.uid, other.uid));
    const ex = await getDoc(ref);
    if (ex.exists()) {
      const f = ex.data();
      msg.textContent = f.status === "accepted" ? "Vous êtes déjà amis."
        : f.requester === user.uid ? "Demande déjà envoyée."
        : "Cette personne t'a déjà envoyé une demande : accepte-la ci-dessous.";
      return;
    }
    await setDoc(ref, {
      users: [user.uid, other.uid].sort(),
      names: { [user.uid]: myName(), [other.uid]: other.name },
      status: "pending",
      requester: user.uid
    });
    msg.textContent = "Demande envoyée !";
    $("friendInput").value = "";
  } catch (e) {
    msg.textContent = "Erreur : " + e.message;
  }
}
$("friendAdd").onclick = sendFriendRequest;

// ---------- Échanges ----------
let tradeFriend = null;

function optionList(entries) {
  return entries
    .map(([id, q]) => ({ c: skinCard(+id), q }))
    .sort((a, b) => RARITY_ORDER.indexOf(a.c.rarity) - RARITY_ORDER.indexOf(b.c.rarity)
      || a.c.name.localeCompare(b.c.name, "fr"))
    .map(({ c, q }) => `<option value="${c.id}">${esc(c.name)} — ${esc(c.skinName)} (${RARITIES[c.rarity].label}) · ${q - 1} doublon(s)</option>`)
    .join("");
}

function tradePreview() {
  const m = $("tradeMine").value, t = $("tradeTheirs").value;
  $("tradeMinePrev").innerHTML = m ? cardHTML(skinCard(+m)) : "";
  $("tradeTheirsPrev").innerHTML = t ? cardHTML(skinCard(+t)) : "";
}

async function openTrade(friendUid, friendName) {
  try {
    const snap = await getDoc(doc(db, "users", friendUid));
    const theirs = Object.entries(snap.data()?.cards || {}).filter(([, q]) => q >= 2);
    const mine = Object.entries(state.cards || {}).filter(([, q]) => q >= 2);
    if (!mine.length) { alert("Tu n'as aucun doublon à proposer."); return; }
    if (!theirs.length) { alert(`${friendName} n'a aucun doublon à échanger pour l'instant.`); return; }
    tradeFriend = { uid: friendUid, name: friendName };
    $("tradeWith").textContent = friendName;
    $("tradeMine").innerHTML = optionList(mine);
    $("tradeTheirs").innerHTML = optionList(theirs);
    $("tradeMsg").textContent = "";
    tradePreview();
    $("tradeModal").hidden = false;
  } catch (e) {
    alert("Impossible de charger la collection de ton ami : " + e.message);
  }
}

$("tradeMine").addEventListener("change", tradePreview);
$("tradeTheirs").addEventListener("change", tradePreview);
$("tradeCancel").onclick = () => { $("tradeModal").hidden = true; tradeFriend = null; };

$("tradeSend").onclick = async () => {
  if (!tradeFriend) return;
  const offerId = +$("tradeMine").value, wantId = +$("tradeTheirs").value;
  if (!offerId || !wantId) return;
  if (offerId === wantId) { $("tradeMsg").textContent = "Choisis deux cartes différentes."; return; }
  try {
    await addDoc(collection(db, "trades"), {
      from: user.uid, fromName: myName(),
      to: tradeFriend.uid, toName: tradeFriend.name,
      offerId, wantId, status: "pending", createdAt: Date.now()
    });
    $("tradeModal").hidden = true;
    tradeFriend = null;
    alert("Proposition envoyée !");
  } catch (e) {
    $("tradeMsg").textContent = "Erreur : " + e.message;
  }
};

async function acceptTrade(id) {
  const t = tradesIn.find(x => x.id === id);
  if (!t) return;
  const tradeRef = doc(db, "trades", id);
  const myRef = doc(db, "users", user.uid);
  const theirRef = doc(db, "users", t.from);
  try {
    await runTransaction(db, async tx => {
      const [tSnap, mine, theirs] = await Promise.all([tx.get(tradeRef), tx.get(myRef), tx.get(theirRef)]);
      const tr = tSnap.data();
      if (!tr || tr.status !== "pending") throw new Error("Cet échange n'est plus disponible.");
      const o = String(tr.offerId), w = String(tr.wantId);
      const mc = mine.data().cards || {}, tc = theirs.data().cards || {};
      if ((tc[o] || 0) < 2) throw new Error("Ton ami n'a plus ce doublon.");
      if ((mc[w] || 0) < 2) throw new Error("Tu n'as plus ce doublon.");
      tx.update(theirRef, { [`cards.${o}`]: tc[o] - 1, [`cards.${w}`]: (tc[w] || 0) + 1, lastTradeId: id });
      tx.update(myRef, { [`cards.${w}`]: mc[w] - 1, [`cards.${o}`]: (mc[o] || 0) + 1, lastTradeId: id });
      tx.update(tradeRef, { status: "accepted" });
    });
    alert("Échange réussi !");
  } catch (e) {
    alert(e.message);
  }
}

const setTradeStatus = (id, status) =>
  updateDoc(doc(db, "trades", id), { status }).catch(e => alert(e.message));

// ---------- Affichage social ----------
const mini = id => {
  const c = skinCard(id);
  return `<span class="mini"><img src="${c.img}" referrerpolicy="no-referrer" alt="">
    <span><b>${esc(c.name)}</b><br>${esc(c.skinName)}<br>
    <small style="color:${RARITIES[c.rarity].color}">${RARITIES[c.rarity].label}</small></span></span>`;
};
const STATUS = { pending: "En attente", accepted: "Accepté ✔", declined: "Refusé ✖" };
const emptyLi = txt => `<li class="empty">${txt}</li>`;

function renderSocial() {
  if (!user || !skinList.length) return;
  const me = user.uid;
  const accepted = friendships.filter(f => f.status === "accepted");
  const reqIn = friendships.filter(f => f.status === "pending" && f.requester !== me);
  const reqOut = friendships.filter(f => f.status === "pending" && f.requester === me);
  const inPending = tradesIn.filter(t => t.status === "pending").sort((a, b) => b.createdAt - a.createdAt);
  const outList = tradesOut.filter(t => t.status !== "cancelled").sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);

  const n = reqIn.length + inPending.length;
  $("friendsBadge").textContent = n;
  $("friendsBadge").hidden = n === 0;

  $("reqIn").innerHTML = reqIn.map(f => `<li><span>${esc(otherName(f))}</span><span>
    <button class="btn" data-act="acceptFriend" data-id="${f.id}">Accepter</button>
    <button class="btn" data-act="removeFriend" data-id="${f.id}">Refuser</button></span></li>`).join("")
    || emptyLi("Aucune demande reçue.");

  $("reqOut").innerHTML = reqOut.map(f => `<li><span>${esc(otherName(f))}</span>
    <button class="btn" data-act="removeFriend" data-id="${f.id}">Annuler</button></li>`).join("")
    || emptyLi("Aucune demande envoyée.");

  $("friendList").innerHTML = accepted.map(f => `<li><span>${esc(otherName(f))}</span><span>
    <button class="btn" data-act="trade" data-uid="${otherOf(f)}" data-name="${esc(otherName(f))}">Échanger</button>
    <button class="btn" data-act="removeFriend" data-id="${f.id}">Retirer</button></span></li>`).join("")
    || emptyLi("Aucun ami pour l'instant.");

  $("tradesIn").innerHTML = inPending.map(t => `<li>
    <div><div style="margin-bottom:6px"><b>${esc(t.fromName)}</b> te propose :</div>
    <div class="trade-line">${mini(t.offerId)}<span class="arrow">⇄</span>${mini(t.wantId)}</div>
    <small class="tstatus">Il donne la 1re carte, tu donnes la 2e.</small></div>
    <span><button class="btn" data-act="acceptTrade" data-id="${t.id}">Accepter</button>
    <button class="btn" data-act="declineTrade" data-id="${t.id}">Refuser</button></span></li>`).join("")
    || emptyLi("Aucun échange reçu.");

  $("tradesOut").innerHTML = outList.map(t => `<li>
    <div><div style="margin-bottom:6px">À <b>${esc(t.toName)}</b> · <span class="tstatus">${STATUS[t.status] || t.status}</span></div>
    <div class="trade-line">${mini(t.offerId)}<span class="arrow">⇄</span>${mini(t.wantId)}</div></div>
    ${t.status === "pending" ? `<button class="btn" data-act="cancelTrade" data-id="${t.id}">Annuler</button>` : ""}</li>`).join("")
    || emptyLi("Aucun échange envoyé.");
}

$("tab-friends").addEventListener("click", e => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const { act, id, uid, name } = b.dataset;
  if (act === "acceptFriend") updateDoc(doc(db, "friendships", id), { status: "accepted" }).catch(err => alert(err.message));
  else if (act === "removeFriend") deleteDoc(doc(db, "friendships", id)).catch(err => alert(err.message));
  else if (act === "trade") openTrade(uid, name);
  else if (act === "acceptTrade") acceptTrade(id);
  else if (act === "declineTrade") setTradeStatus(id, "declined");
  else if (act === "cancelTrade") setTradeStatus(id, "cancelled");
});

// ---------- Écoute en temps réel ----------
function stopListeners() {
  unsubs.forEach(u => u());
  unsubs = [];
  friendships = []; tradesIn = []; tradesOut = [];
  tradesLoaded = { in: false, out: false };
}

function startListeners() {
  stopListeners();
  const onErr = e => {
    console.error(e);
    $("friendMsg").textContent = "Erreur de synchronisation : " + e.message;
  };
  const docs = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

  unsubs.push(onSnapshot(userRef(), snap => {
    if (!snap.exists()) return;
    const s = snap.data();
    s.cards = s.cards || {};
    state = applyRefill(s);
    if (!rv) render();
  }, onErr));

  unsubs.push(onSnapshot(query(collection(db, "friendships"), where("users", "array-contains", user.uid)),
    snap => { friendships = docs(snap); renderSocial(); }, onErr));
  unsubs.push(onSnapshot(query(collection(db, "trades"), where("to", "==", user.uid)),
    snap => { tradesIn = docs(snap); tradesLoaded.in = true; renderSocial(); syncTradeQuests(); }, onErr));
  unsubs.push(onSnapshot(query(collection(db, "trades"), where("from", "==", user.uid)),
    snap => { tradesOut = docs(snap); tradesLoaded.out = true; renderSocial(); syncTradeQuests(); }, onErr));
}

// ---------- Auth pseudo + mot de passe ----------
const toEmail = name => `${name.trim().toLowerCase()}@runeterra.app`;

function readForm() {
  const name = $("username").value.trim();
  const pass = $("password").value;
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(name)) {
    $("authError").textContent = "Pseudo : 3 à 20 caractères (lettres, chiffres, _).";
    return null;
  }
  if (pass.length < 6) {
    $("authError").textContent = "Mot de passe : 6 caractères minimum.";
    return null;
  }
  return { name, pass };
}

const authMessages = {
  "auth/email-already-in-use": "Ce pseudo est déjà pris.",
  "auth/invalid-credential": "Pseudo ou mot de passe incorrect.",
  "auth/weak-password": "Mot de passe trop faible.",
  "auth/operation-not-allowed": "Active Email/Mot de passe dans Firebase."
};

$("registerBtn").onclick = async () => {
  $("authError").textContent = "";
  const f = readForm(); if (!f) return;
  try {
    const cred = await createUserWithEmailAndPassword(auth, toEmail(f.name), f.pass);
    await updateProfile(cred.user, { displayName: f.name });
    $("userName").textContent = f.name;
    await ensureUsernameDoc().catch(e => console.warn("usernames:", e.message));
  } catch (e) {
    $("authError").textContent = authMessages[e.code] || e.code;
  }
};

$("loginBtn").onclick = async () => {
  $("authError").textContent = "";
  const f = readForm(); if (!f) return;
  try {
    await signInWithEmailAndPassword(auth, toEmail(f.name), f.pass);
  } catch (e) {
    $("authError").textContent = authMessages[e.code] || e.code;
  }
};

$("logoutBtn").onclick = () => signOut(auth);
$("openBtn").onclick = openBooster;

onAuthStateChanged(auth, async u => {
  user = u;
  $("loginView").hidden = !!u;
  $("gameView").hidden = !u;
  $("userBox").hidden = !u;
  if (!u) {
    stopListeners();
    state = null;
    $("reveal").hidden = true;
    $("tradeModal").hidden = true;
    rv = null;
    return;
  }
  $("userName").textContent = u.displayName || "";
  try {
    if (!champions.length) await loadGameData();
    await loadState();
    await ensureUsernameDoc().catch(e => console.warn("usernames:", e.message));
    render(); tickTimer();
    startListeners();
  } catch (e) {
    console.error(e);
    alert("Erreur de chargement : " + e.message);
  }
});