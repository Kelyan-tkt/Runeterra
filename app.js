import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
         updateProfile, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import { getFirestore, initializeFirestore, doc, runTransaction, collection, query, where,
         onSnapshot, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, deleteField }
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

// Mets true UNIQUEMENT si des joueurs ont leurs requêtes Firestore bloquées (ERR_BLOCKED_BY_CLIENT)
const USE_LONG_POLLING = false;
const db = USE_LONG_POLLING
  ? initializeFirestore(app, { experimentalForceLongPolling: true })
  : getFirestore(app);

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
const PITY_MAX = 200;
const MAX_SPINS = 5;
const SPIN_REFILL_MS = 20 * 60 * 1000;
const WHEEL = [
  { type: "booster", icon: "📦", color: "#0397ab" },
  { type: "nothing", icon: "💨", color: "#2b303b" },
  { type: "bonus",   icon: "🌟", color: "#ff8000" },
  { type: "nothing", icon: "💨", color: "#383e4c" },
  { type: "respin",  icon: "🔁", color: "#a335ee" },
  { type: "nothing", icon: "💨", color: "#2b303b" },
  { type: "booster", icon: "📦", color: "#0397ab" },
  { type: "nothing", icon: "💨", color: "#383e4c" },
  { type: "nothing", icon: "💨", color: "#2b303b" },
  { type: "nothing", icon: "💨", color: "#383e4c" }
];
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
let tradesLoaded = { in: false, out: false }, syncingTrades = false, fixingObt = false;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const myName = () => auth.currentUser?.displayName || "";
const rIdx = r => RARITY_ORDER.indexOf(r);

const BLOCK_MSG = "Ton navigateur bloque la connexion à la base de données (ERR_BLOCKED_BY_CLIENT). "
  + "Désactive ton bloqueur de pubs ou le bouclier de ton navigateur pour ce site, ou essaie un autre navigateur, puis recharge la page.";
function showNetWarn(msg = BLOCK_MSG) {
  const b = $("netWarn");
  if (!b) { console.warn(msg); return; }
  b.textContent = msg;
  b.hidden = false;
}
const looksBlocked = e => e?.code === "unavailable" || /offline|blocked|unavailable|network/i.test(e?.message || "");

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
      if (s.boosters >= MAX_BOOSTERS) { s.lastRefill = now; return s; }
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

// ---------- Dates d'obtention des cartes ----------
function ensureObtained(s) {
  s.obtained ||= {};
  const legacy = !s.obtainedInit;
  for (const id of Object.keys(s.cards || {})) {
    if (s.obtained[id] === undefined) s.obtained[id] = legacy ? 0 : Date.now();
  }
  s.obtainedInit = true;
}

async function fixObtained() {
  if (!user || !state || fixingObt) return;
  const missing = Object.keys(state.cards || {}).some(id => state.obtained?.[id] === undefined);
  if (!missing && state.obtainedInit) return;
  fixingObt = true;
  try {
    await runTransaction(db, async tx => {
      const snap = await tx.get(userRef());
      const s = snap.data();
      s.cards ||= {};
      ensureObtained(s);
      tx.set(userRef(), s);
    });
  } catch (e) {
    console.warn("dates d'obtention :", e.message);
  } finally {
    fixingObt = false;
  }
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
    ensureSpins(s);
    ensureQuests(s);
    ensureObtained(s);
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
  ddVersion = versions[0];
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
    try {
    const itd = await (await fetch(`${DDRAGON}/cdn/${ddVersion}/data/fr_FR/item.json`)).json();
    shopItems = buildShop(itd.data);
  } catch (e) {
    console.warn("objets :", e.message);
  }
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

function drawBooster(n, forceMythic = false) {
  const picks = [];
  for (const r of ["rare", "epic", "legendary", "mythic"]) {
    if (!pools[r]?.length) continue;
    if (Math.random() < RARITIES[r].chance || (forceMythic && r === "mythic")) picks.push(r);
  }
  while (picks.length < n) picks.push("common");
  picks.sort((a, b) => rIdx(b) - rIdx(a));

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

function drawBonusBooster(n, forceMythic = false) {
  let top = "epic";
  if (forceMythic) {
    top = "mythic";
  } else {
    const total = Object.values(BONUS_TOP).reduce((a, b) => a + b, 0);
    let x = Math.random() * total;
    for (const [r, w] of Object.entries(BONUS_TOP)) { x -= w; if (x < 0) { top = r; break; } }
  }
  const pool = pools[top]?.length ? pools[top] : (pools.epic?.length ? pools.epic : skinList);
  const topCard = skinCard(pool[Math.floor(Math.random() * pool.length)].id);
  return [...drawBooster(n - 1), topCard].sort((a, b) => rIdx(b.rarity) - rIdx(a.rarity));
}

// ---------- Doublons / recyclage ----------
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
// une carte de recyclage = une carte tirée au hasard dans un booster normal
function drawRecycleCard() {
  const b = drawBooster(CARDS_PER_BOOSTER);
  return b[Math.floor(Math.random() * b.length)];
}

let recSel = {}, recFilter = "";

function recycleRows() {
  const res = reservedMap();
  return Object.entries(state.cards || {})
    .map(([id, q]) => ({ c: skinCard(+id), avail: q - 1 - (res[id] || 0) }))
    .filter(r => r.avail >= 1)
    .sort((a, b) => rIdx(a.c.rarity) - rIdx(b.c.rarity) || a.c.name.localeCompare(b.c.name, "fr"));
}

function renderRecycleList() {
  const all = recycleRows();
  const counts = {};
  all.forEach(r => { counts[r.c.rarity] = (counts[r.c.rarity] || 0) + r.avail; });

  document.querySelectorAll("#recFilter button").forEach(b => {
    const r = b.dataset.r;
    const label = r ? RARITIES[r].label : "Toutes";
    const n = r ? (counts[r] || 0) : Object.values(counts).reduce((a, x) => a + x, 0);
    b.textContent = `${label} (${n})`;
    b.disabled = !!r && n === 0;
    b.classList.toggle("active", r === recFilter);
  });

  const rows = all.filter(r => !recFilter || r.c.rarity === recFilter);
  $("recycleList").innerHTML = rows.map(({ c, avail }) => `
    <li data-id="${c.id}" data-avail="${avail}">
      ${mini(c.id)}
      <span class="stepper">
        <button class="btn" data-d="-1">−</button><b data-n>0</b><button class="btn" data-d="1">+</button>
        <small>/ ${avail}</small>
      </span>
    </li>`).join("") || `<li class="empty">Aucun doublon de cette rareté.</li>`;
  updateRecycleUI();
}

function openRecycle() {
  if (rv) return;
  if (dupCount(state.cards) < DUPES_PER_CRAFT) {
    alert(`Il faut ${DUPES_PER_CRAFT} doublons pour recycler.`);
    return;
  }
    recSel = {};
  const rows = recycleRows();
  recFilter = ["common", "rare", "epic", "legendary", "mythic"]
    .find(r => rows.some(x => x.c.rarity === r)) || "";
  $("recNeed").textContent = DUPES_PER_CRAFT;
  renderRecycleList();
  $("recycleModal").hidden = false;
}

function updateRecycleUI() {
  const total = Object.values(recSel).reduce((a, b) => a + b, 0);
  $("recycleList").querySelectorAll("li[data-id]").forEach(li => {
    const id = li.dataset.id, avail = +li.dataset.avail, n = recSel[id] || 0;
    li.querySelector("[data-n]").textContent = n;
    li.querySelector('[data-d="-1"]').disabled = n <= 0;
    li.querySelector('[data-d="1"]').disabled = n >= avail;
  });
  const k = Math.floor(total / DUPES_PER_CRAFT), rest = total % DUPES_PER_CRAFT;
  $("recycleCount").textContent =
    `${total} doublon${total > 1 ? "s" : ""} sélectionné${total > 1 ? "s" : ""} → ${k} carte${k > 1 ? "s" : ""}`
    + (rest ? ` (encore ${DUPES_PER_CRAFT - rest} pour une carte de plus)` : "");
  $("recycleGo").textContent = k ? `Recycler (${k} carte${k > 1 ? "s" : ""})` : "Recycler";
  $("recycleGo").disabled = !total || rest !== 0;
  updateBulkBtn();
}

$("recycleList").addEventListener("click", e => {
  const b = e.target.closest("button[data-d]");
  if (!b || b.disabled) return;
  const id = b.closest("li").dataset.id;
  recSel[id] = Math.max(0, (recSel[id] || 0) + +b.dataset.d);
  updateRecycleUI();
});

$("recFilter").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b || b.disabled) return;
  recFilter = b.dataset.r;
  recSel = {};
  renderRecycleList();
});

$("recycleAuto").onclick = () => {
  const rows = recycleRows()
    .filter(r => !recFilter || r.c.rarity === recFilter)
    .sort((a, b) => rIdx(b.c.rarity) - rIdx(a.c.rarity));
  const sel = {};
  let need = DUPES_PER_CRAFT;
  for (const r of rows) {
    if (need <= 0) break;
    const take = Math.min(r.avail, need);
    sel[r.c.id] = take;
    need -= take;
  }
  if (need > 0) {
    const label = recFilter ? RARITIES[recFilter].label.toLowerCase() : "";
    alert(`Pas assez de doublons${label ? " de rareté « " + label + " »" : ""} (il en faut ${DUPES_PER_CRAFT}).`);
    return;
  }
  recSel = sel;
  updateRecycleUI();
};

$("recycleCancel").onclick = () => { $("recycleModal").hidden = true; };

$("recycleGo").onclick = () => {
  const risky = Object.entries(recSel).some(([id, n]) =>
    n > 0 && ["legendary", "mythic"].includes(skinCard(+id).rarity));
  if (risky && !confirm("Tu vas recycler une carte légendaire ou mythique. Continuer ?")) return;
  recycleCards();
};

// applique un recyclage : retire les doublons choisis, ajoute les nouvelles cartes
async function applyRecycle(sel, newCards) {
  const need = Object.values(sel).reduce((a, b) => a + b, 0);
  state = await runTransaction(db, async tx => {
    const snap = await tx.get(userRef());
    const s = snap.data();
    s.cards = s.cards || {};
    for (const [id, n] of Object.entries(sel)) {
      if (n > 0 && (s.cards[id] || 0) - 1 < n) throw new Error("Doublons insuffisants.");
    }
    for (const [id, n] of Object.entries(sel)) if (n > 0) s.cards[id] -= n;
    newCards.forEach(c => { s.cards[c.id] = (s.cards[c.id] || 0) + 1; });
    ensureObtained(s);
    addProgress(s, "recycle", need);
    tx.set(userRef(), s);
    return s;
  });
}

async function recycleCards() {
  const sel = { ...recSel };
  const total = Object.values(sel).reduce((a, b) => a + b, 0);
  if (!total || total % DUPES_PER_CRAFT) return;
  const newCards = Array.from({ length: total / DUPES_PER_CRAFT }, drawRecycleCard);

  $("recycleGo").disabled = true;
  $("recycleAll").disabled = true;
  try {
    await applyRecycle(sel, newCards);
    $("recycleModal").hidden = true;
    $("result").innerHTML = "";
    startReveal(newCards);
  } catch (e) {
    alert(e.message);
    renderRecycleList();
  }
  render();
}

$("recycleGo").onclick = () => {
  if ($("recycleGo").disabled) return;
  const risky = Object.entries(recSel).some(([id, n]) =>
    n > 0 && ["legendary", "mythic"].includes(skinCard(+id).rarity));
  if (risky && !confirm("Tu vas recycler une carte légendaire ou mythique. Continuer ?")) return;
  recycleCards();
};

// ----- Tout recycler -----
function bulkPlan() {
  const rows = recycleRows()
    .filter(r => !recFilter || r.c.rarity === recFilter)
    .sort((a, b) => rIdx(b.c.rarity) - rIdx(a.c.rarity));      // les plus communes d'abord
  const dupes = rows.reduce((a, r) => a + r.avail, 0);
  const k = Math.floor(dupes / DUPES_PER_CRAFT);
  return { rows, dupes, k };
}

function updateBulkBtn() {
  const { k } = bulkPlan();
  const b = $("recycleAll");
  b.textContent = k ? `Tout recycler (${k} carte${k > 1 ? "s" : ""})` : "Tout recycler";
  b.disabled = k === 0;
}

function recycleAll() {
  const { rows, k } = bulkPlan();
  if (!k) {
    alert(`Pas assez de doublons${recFilter ? " de cette rareté" : ""} (il en faut ${DUPES_PER_CRAFT}).`);
    return;
  }
  let left = k * DUPES_PER_CRAFT;
  const sel = {};
  for (const r of rows) {
    if (left <= 0) break;
    const take = Math.min(r.avail, left);
    sel[r.c.id] = take;
    left -= take;
  }
  recSel = sel;
  renderRecycleList();
}

$("recycleAll").onclick = recycleAll;

// ---------- Ouverture ----------
async function openBooster() {
  $("openBtn").disabled = true;
  try {
    let drawn;
    state = await runTransaction(db, async tx => {
      const snap = await tx.get(userRef());
      let s = applyRefill(snap.data());
      if (s.boosters <= 0) throw new Error("Aucun booster disponible");
      if (s.boosters >= MAX_BOOSTERS) s.lastRefill = Date.now();
      s.boosters -= 1;
      s.cards = s.cards || {};
      drawn = drawBooster(CARDS_PER_BOOSTER, (s.mythicPity || 0) >= PITY_MAX);
      drawn.forEach(c => { s.cards[c.id] = (s.cards[c.id] || 0) + 1; });
      s.mythicPity = drawn.some(c => c.rarity === "mythic") ? 0 : (s.mythicPity || 0) + 1;
      ensureObtained(s);
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
    let drawn;
    state = await runTransaction(db, async tx => {
      const snap = await tx.get(userRef());
      const s = snap.data();
      if ((s.bonusBoosters || 0) <= 0) throw new Error("Aucun booster bonus disponible.");
      s.bonusBoosters -= 1;
      s.cards = s.cards || {};
      drawn = drawBonusBooster(CARDS_PER_BOOSTER, (s.mythicPity || 0) >= PITY_MAX);
      drawn.forEach(c => { s.cards[c.id] = (s.cards[c.id] || 0) + 1; });
      s.mythicPity = drawn.some(c => c.rarity === "mythic") ? 0 : (s.mythicPity || 0) + 1;
      ensureObtained(s);
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
  const row = $("revealRow");
  row.classList.toggle("many", cards.length > 8 && cards.length <= 20);
  row.classList.toggle("huge", cards.length > 20);
  row.scrollTop = 0;
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

document.addEventListener("click", e => {
  if (e.target.closest("#reveal") || e.target.closest("#lightbox")) return;
  const card = e.target.closest(".card");
  if (card && card.dataset.id) openLightbox(card.dataset.id);
});

// ---------- Affichage des cartes ----------
const cardHTML = (c, qty = 0, delay = 0, locked = false) => `
  <div class="card ${c.rarity}${locked ? " locked" : ""}" data-id="${c.id}" style="animation-delay:${delay}s">
    <span class="badge">${RARITIES[c.rarity].label}</span>
    ${qty > 1 ? `<span class="qty">×${qty}</span>` : ""}
    <img loading="lazy" referrerpolicy="no-referrer" alt="${esc(c.name)}" src="${c.img}"
         onerror="if(this.dataset.t!=='1'){this.dataset.t='1';this.src='${c.imgAlt}'}">
    <div class="info"><b>${esc(c.name)}</b><br>${esc(c.skinName)}</div>
  </div>`;

const norm = s => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

// ---------- Galerie des champions ----------
function renderCollection() {
  const owned = state.cards || {};
  const obt = state.obtained || {};
  const q = norm($("search").value.trim());
  const rf = $("filterRarity").value;
  const onlyOwned = $("onlyOwned").checked;
  const onlyDupes = $("onlyDupes").checked;
  const filtersActive = !!rf || onlyDupes;
  const BIG = 9e15;
  const rows = [];

  for (const key of Object.keys(skinsByChamp)) {
    const champ = champByKey[key];
    if (!champ) continue;
    const skins = skinsByChamp[key].slice().sort((a, b) => a.id - b.id);
    const champMatch = q && norm(champ.name).includes(q);

    const matches = skins.filter(s => {
      const c = owned[s.id] || 0;
      if (onlyOwned && !c) return false;
      if (onlyDupes && c < 2) return false;
      if (rf && rarityOf(s) !== rf) return false;
      if (q && !champMatch && !norm(s.isBase ? "classique" : (s.name || "")).includes(q)) return false;
      return true;
    });
    if (!matches.length) continue;

    const ownedSkins = skins.filter(s => owned[s.id]);
    const ownedTimes = ownedSkins.map(s => obt[s.id] ?? 0);
    const ownedMatches = matches.filter(s => owned[s.id]);
    const bestPool = ownedMatches.length ? ownedMatches : ownedSkins;
    const best = bestPool.length ? Math.min(...bestPool.map(s => rIdx(rarityOf(s)))) : 99;

    const rep = filtersActive
      ? matches.slice().sort((a, b) => rIdx(rarityOf(a)) - rIdx(rarityOf(b)) || a.id - b.id)[0]
      : (skins.find(s => s.isBase) || skins[0]);

    rows.push({
      key, champ, skins, rep,
      ownedCount: ownedSkins.length,
      dupes: skins.reduce((a, s) => a + Math.max(0, (owned[s.id] || 0) - 1), 0),
      last: ownedTimes.length ? Math.max(...ownedTimes) : -1,
      first: ownedTimes.length ? Math.min(...ownedTimes) : BIG,
      best
    });
  }

  const byName = (a, b) => a.champ.name.localeCompare(b.champ.name, "fr");
  const sorters = {
    name: byName,
    recent: (a, b) => b.last - a.last || byName(a, b),
    oldest: (a, b) => a.first - b.first || byName(a, b),
    rarity: (a, b) => a.best - b.best || byName(a, b),
    dupes: (a, b) => b.dupes - a.dupes || byName(a, b)
  };
  rows.sort(sorters[$("sortBy").value] || byName);

  $("collection").innerHTML = rows.map(r => {
    const c = skinCard(r.rep.id);
    const qty = owned[r.rep.id] || 0;
    const pct = Math.round((r.ownedCount / r.skins.length) * 100);
    return `<button class="tile ${c.rarity}${qty ? "" : " locked"}" data-champ="${r.key}" data-skin="${r.rep.id}">
      <span class="badge">${RARITIES[c.rarity].label}</span>
      ${qty > 1 ? `<span class="qty">×${qty}</span>` : ""}
      <img loading="lazy" referrerpolicy="no-referrer" alt="${esc(c.name)}" src="${c.img}"
           onerror="if(this.dataset.t!=='1'){this.dataset.t='1';this.src='${c.imgAlt}'}">
      <div class="tinfo">
        <b>${esc(r.champ.name)}</b>
        <small>${r.ownedCount} / ${r.skins.length} skins${r.dupes ? ` · ${r.dupes} doublon${r.dupes > 1 ? "s" : ""}` : ""}</small>
        <div class="bar"><span style="width:${pct}%"></span></div>
      </div>
    </button>`;
  }).join("") || `<p class="hint">Aucun champion ne correspond.</p>`;
}

["search", "sortBy", "filterRarity", "onlyDupes", "onlyOwned"].forEach(id =>
  $(id).addEventListener(id === "search" ? "input" : "change", () => state && renderCollection()));

$("collection").addEventListener("click", e => {
  const t = e.target.closest(".tile");
  if (t) openViewer(t.dataset.champ, t.dataset.skin);
});

// ---------- Visionneuse de skins ----------
let vw = null;

function openViewer(champKey, startId) {
  const ids = skinsByChamp[champKey].slice().sort((a, b) => a.id - b.id).map(s => s.id);
  vw = { champKey, ids, i: Math.max(0, ids.indexOf(+startId)) };
  $("vChamp").textContent = champByKey[champKey].name;
  $("viewer").hidden = false;
  renderViewer();
}

function closeViewer() {
  $("viewer").hidden = true;
  vw = null;
}

function renderViewer() {
  if (!vw) return;
  const id = vw.ids[vw.i];
  const c = skinCard(id);
  const qty = state.cards?.[id] || 0;
  const ts = state.obtained?.[id];

  const img = $("vImg");
  img.dataset.t = "";
  img.onerror = () => { if (img.dataset.t !== "1") { img.dataset.t = "1"; img.src = c.splashAlt; } };
  img.style.animation = "none"; void img.offsetWidth; img.style.animation = "";
  img.src = c.splash;
  img.alt = `${c.name} - ${c.skinName}`;

  $("vFrame").className = `rar-${c.rarity}${qty ? "" : " locked"}`;
  $("vQty").hidden = qty < 2;
  $("vQty").textContent = `×${qty}`;
  $("vLock").hidden = !!qty;
  $("vCount").textContent = `Skin ${vw.i + 1} / ${vw.ids.length}`;

  const when = !qty ? "Non obtenue"
    : (ts ? `Obtenue le ${new Date(ts).toLocaleDateString("fr-FR")}` : "Obtenue (date inconnue)")
      + (qty > 1 ? ` · ${qty} exemplaires` : "");
  $("vTitle").innerHTML = `<b>${esc(c.skinName)}</b>
    <span style="color:${RARITIES[c.rarity].color}">· ${RARITIES[c.rarity].label}</span><br><small>${when}</small>`;

  $("vStrip").innerHTML = vw.ids.map((sid, k) => {
    const sc = skinCard(sid), q2 = state.cards?.[sid] || 0;
    return `<button class="thumb ${sc.rarity}${k === vw.i ? " active" : ""}${q2 ? "" : " locked"}" data-k="${k}" title="${esc(sc.skinName)}">
      <img loading="lazy" referrerpolicy="no-referrer" src="${sc.img}" alt="">
      ${q2 > 1 ? `<span class="qty">×${q2}</span>` : ""}</button>`;
  }).join("");
  $("vStrip").querySelector(".active")?.scrollIntoView({ inline: "center", block: "nearest" });
}

function viewerStep(d) {
  if (!vw) return;
  vw.i = (vw.i + d + vw.ids.length) % vw.ids.length;
  renderViewer();
}

$("vPrev").onclick = () => viewerStep(-1);
$("vNext").onclick = () => viewerStep(1);
$("vClose").onclick = closeViewer;
$("vStrip").addEventListener("click", e => {
  const b = e.target.closest("[data-k]");
  if (b && vw) { vw.i = +b.dataset.k; renderViewer(); }
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    if (!$("lightbox").hidden) closeLightbox();
    else if (!$("viewer").hidden) closeViewer();
    else if (!$("recycleModal").hidden) $("recycleModal").hidden = true;
    else if (!$("tradeModal").hidden) { $("tradeModal").hidden = true; tradeFriend = null; }
  } else if (!$("viewer").hidden && $("lightbox").hidden) {
    if (e.key === "ArrowLeft") viewerStep(-1);
    if (e.key === "ArrowRight") viewerStep(1);
  }
});

// ---------- Rendu général ----------
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
  tickSpins();
  syncLeaderboard();
  renderOdds();
  renderAdventure();
  if (!$("tab-profile").hidden && $("pBack").hidden) renderProfile(myStats(), true);
  if (vw && !$("viewer").hidden) renderViewer();
}

function tickTimer() {
  if (!state) return;
  if (state.boosters >= MAX_BOOSTERS) { $("timer").textContent = "Stock plein"; return; }
  const left = REFILL_MS - (Date.now() - state.lastRefill);
  if (left <= 0) { render(); return; }
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  $("timer").textContent = `Prochain booster dans ${m}:${String(s).padStart(2, "0")}`;
}
function renderOdds() {
  if (!state) return;
  $("oddsList").innerHTML = RARITY_ORDER.map(r => {
    const ch = RARITIES[r].chance;
    const val = r === "common" ? "le reste"
      : (ch * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " %";
    return `<li><span><span style="color:${RARITIES[r].color}">●</span> ${RARITIES[r].label}</span><b>${val}</b></li>`;
  }).join("");

  const n = state.mythicPity || 0;
  $("pityTxt").textContent = `${Math.min(n, PITY_MAX)} / ${PITY_MAX}`;
  $("pityBar").style.width = `${Math.min(100, (n / PITY_MAX) * 100)}%`;
  $("pityNote").textContent = n >= PITY_MAX
    ? "Ton prochain booster contient un mythique !"
    : `Un mythique est garanti après ${PITY_MAX} boosters sans mythique.`;
}

function tickQuestTimers() {
  if (!state) return;
  if (state.quests?.dayKey !== dayKey() || state.quests?.weekKey !== weekKey()) { render(); return; }
  $("dailyTimer").textContent = "Reset dans " + fmtDuration(untilDaily());
  $("weeklyTimer").textContent = "Reset dans " + fmtDuration(untilWeekly());
}

setInterval(() => {
  if (!state) return;
  try {
    const before = state.boosters;
    applyRefill(state);
    if (state.boosters !== before) {
      $("boosterCount").textContent = state.boosters;
      $("openBtn").disabled = state.boosters <= 0 || !!rv;
    }
    tickTimer();
    tickQuestTimers();
    tickSpins();
  } catch (e) { console.error(e); }
}, 1000);

$("craftBtn").onclick = openRecycle;
$("bonusBtn").onclick = openBonusBooster;

// ---------- Onglets ----------
document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("active", x === b));
  document.querySelectorAll("main > section").forEach(s => s.hidden = s.id !== `tab-${b.dataset.tab}`);
  if (b.dataset.tab === "friends") refreshSocial();
  if (b.dataset.tab === "ranking") loadRanking();
  if (b.dataset.tab === "profile") showProfile();
  if (b.dataset.tab === "ranked") openRankedMode();
});
// ---------- Mini-jeu : roulette ----------
let spinning = false, wheelRot = 0;

function ensureSpins(s) {
  if (typeof s.spins !== "number") s.spins = MAX_SPINS;
  if (typeof s.lastSpin !== "number") s.lastSpin = Date.now();
  return s;
}

function applySpinRefill(s, now = Date.now()) {
  ensureSpins(s);
  if (s.spins >= MAX_SPINS) { s.lastSpin = now; return s; }
  const gained = Math.floor((now - s.lastSpin) / SPIN_REFILL_MS);
  if (gained > 0) {
    s.spins = Math.min(MAX_SPINS, s.spins + gained);
    s.lastSpin = s.spins >= MAX_SPINS ? now : s.lastSpin + gained * SPIN_REFILL_MS;
  }
  return s;
}

function buildWheel() {
  const step = 360 / WHEEL.length;
  const stops = WHEEL.map((w, i) => `${w.color} ${i * step}deg ${(i + 1) * step}deg`).join(",");
  const el = $("wheel");
  el.style.background = `conic-gradient(${stops})`;
  el.innerHTML = WHEEL.map((w, i) =>
    `<span class="seg" style="transform:rotate(${(i + .5) * step}deg) translateY(-108px)">${w.icon}</span>`).join("");
}
buildWheel();

const SPIN_MSG = {
  booster: "📦 Tu gagnes 1 booster !",
  bonus:   "🌟 Tu gagnes 1 booster amélioré !",
  respin:  "🔁 Relance ! Tu récupères 1 lancer.",
  nothing: "💨 Perdu, retente ta chance."
};

async function spinWheel() {
  if (spinning || rv || !state) return;
  applySpinRefill(state);
  if (state.spins <= 0) return;

  spinning = true;
  $("spinBtn").disabled = true;
  $("spinResult").textContent = "";
  const idx = Math.floor(Math.random() * WHEEL.length);
  const seg = WHEEL[idx];

  try {
    const next = await runTransaction(db, async tx => {
      const snap = await tx.get(userRef());
      const s = snap.data();
      applySpinRefill(s);
      if (s.spins <= 0) throw new Error("Aucun lancer disponible.");
      if (s.spins >= MAX_SPINS) s.lastSpin = Date.now();
      s.spins -= 1;
      if (seg.type === "booster") s.boosters = (s.boosters || 0) + 1;
      else if (seg.type === "bonus") s.bonusBoosters = (s.bonusBoosters || 0) + 1;
      else if (seg.type === "respin") s.spins += 1;
      tx.set(userRef(), s);
      return s;
    });

    const center = (idx + .5) * (360 / WHEEL.length);
    const jitter = (Math.random() - .5) * 24;
    const target = Math.floor(wheelRot / 360) * 360 + 360 * 6 + (360 - center) + jitter;
    const w = $("wheel");
    w.style.transition = "transform 4.5s cubic-bezier(.12,.6,.1,1)";
    w.style.transform = `rotate(${target}deg)`;
    wheelRot = target;
    await new Promise(r => setTimeout(r, 4700));

    state = next;
    $("spinResult").textContent = SPIN_MSG[seg.type];
  } catch (e) {
    alert(e.message);
  }
  spinning = false;
  render();
  tickSpins();
}

function tickSpins() {
  if (!state || spinning) return;
  applySpinRefill(state);
  $("spinCount").textContent = state.spins;
  $("spinBtn").disabled = state.spins <= 0 || !!rv;
  if (state.spins >= MAX_SPINS) { $("spinTimer").textContent = "Stock plein"; return; }
  const left = Math.max(0, SPIN_REFILL_MS - (Date.now() - state.lastSpin));
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  $("spinTimer").textContent = `Prochain lancer dans ${m}:${String(s).padStart(2, "0")}`;
}

$("spinBtn").onclick = spinWheel;

// ---------- Classement ----------
let lbSig = "";

const SHOWCASE_MAX = 6;

function cleanProfile(p, cards) {
  p = p || {};
  const own = id => (id && cards[id] > 0 && skinsById[id] ? +id : 0);
  return {
    bg: own(p.bg),
    avatar: own(p.avatar),
    color: /^#[0-9a-f]{6}$/i.test(p.color || "") ? p.color : "",
    bio: String(p.bio || "").slice(0, 100),
    title: String(p.title || "")
  };
}

function myStats() {
  const cards = state.cards || {};
  const ids = Object.keys(cards).filter(id => cards[id] > 0);
  const st = {
    name: myName(),
    unique: ids.length,
    total: ids.reduce((a, id) => a + cards[id], 0),
    mythic: ids.filter(id => skinsById[id] && rarityOf(skinsById[id]) === "mythic").length,
    showcase: (state.showcase || []).filter(id => cards[id] > 0).slice(0, SHOWCASE_MAX)
  };
  const pf = cleanProfile(state.profile, cards);
  const t = TITLES.find(x => x.id === pf.title);
  if (!t || !t.ok(st)) pf.title = "";
  st.profile = pf;
  return st;
}

async function syncLeaderboard() {
  if (!user || !state || !skinList.length) return;
  const st = myStats();
  const sig = `${user.uid}|${JSON.stringify(st)}`;
  if (sig === lbSig) return;
  lbSig = sig;
  try {
    await setDoc(doc(db, "leaderboard", user.uid), { ...st, updatedAt: Date.now() });
  } catch (e) {
    lbSig = "";
    console.warn("classement :", e.message);
  }
  
}
$("tab-ranking").addEventListener("click", e => {
  const li = e.target.closest("li[data-uid]");
  if (li) showProfile(li.dataset.uid);
});

// ---------- Profil et vitrine ----------
let scSel = [];

function goTab(tab) {
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("active", x.dataset.tab === tab));
  document.querySelectorAll("main > section").forEach(s => s.hidden = s.id !== `tab-${tab}`);
}

function renderProfile(p, mine) {
  const pr = p.profile || {};
  const total = skinList.length;
  const pct = total ? Math.round((p.unique / total) * 100) : 0;
  const sec = $("tab-profile");

  sec.style.setProperty("--accent", /^#[0-9a-f]{6}$/i.test(pr.color || "") ? pr.color : "#ffd35a");
  sec.style.backgroundImage = pr.bg && skinsById[pr.bg]
    ? `linear-gradient(rgba(10,12,18,.72), rgba(10,12,18,.94)), url("${skinCard(+pr.bg).splash}")`
    : "";

  const av = pr.avatar && skinsById[pr.avatar] ? skinCard(+pr.avatar) : null;
  $("pAvatar").innerHTML = av
    ? `<img referrerpolicy="no-referrer" alt="" src="${av.img}"
         onerror="if(this.dataset.t!=='1'){this.dataset.t='1';this.src='${av.imgAlt}'}">`
    : esc((p.name || "?")[0].toUpperCase());

  $("pName").textContent = p.name;
  const t = TITLES.find(x => x.id === pr.title);
  $("pTitle").textContent = t ? t.label : "";
  $("pBio").textContent = pr.bio || "";

  $("pStats").innerHTML = `
    <div class="stat"><b>${p.unique}</b><small>/ ${total} skins (${pct}%)</small></div>
    <div class="stat"><b>${p.total}</b><small>cartes au total</small></div>
    <div class="stat"><b>${p.mythic}</b><small>mythiques</small></div>`;

  const ids = (p.showcase || []).filter(id => skinsById[id]);
  let html = ids.map(id => cardHTML(skinCard(+id))).join("");
  if (mine) for (let i = ids.length; i < SHOWCASE_MAX; i++) html += `<div class="slot">＋</div>`;
  $("pShowcase").innerHTML = html || `<p class="hint">Aucune carte en vitrine.</p>`;
  $("pEdit").hidden = !mine;
  $("pCustom").hidden = !mine;
  $("pBack").hidden = mine;
}

async function showProfile(uid) {
  if (!user || !state) return;
  const target = uid || user.uid;
  const mine = target === user.uid;
  let p;
  if (mine) {
    p = myStats();
  } else {
    try {
      const snap = await getDoc(doc(db, "leaderboard", target));
      if (!snap.exists()) { alert("Ce joueur n'a pas encore de profil."); return; }
      p = snap.data();
    } catch (e) { alert(e.message); return; }
  }
  renderProfile(p, mine);
  goTab("profile");
}

function renderShowcasePicker() {
  const q = norm($("scSearch").value.trim());
  const owned = Object.keys(state.cards || {}).filter(id => state.cards[id] > 0).map(id => skinCard(+id));
  const list = owned
    .filter(c => !q || norm(c.name).includes(q) || norm(c.skinName).includes(q))
    .sort((a, b) => rIdx(a.rarity) - rIdx(b.rarity) || a.name.localeCompare(b.name, "fr"));
  $("scList").innerHTML = list.slice(0, 150).map(c => `
    <button class="pick ${c.rarity}${scSel.includes(c.id) ? " sel" : ""}" data-id="${c.id}">
      <img loading="lazy" referrerpolicy="no-referrer" alt="" src="${c.img}"
           onerror="if(this.dataset.t!=='1'){this.dataset.t='1';this.src='${c.imgAlt}'}">
      <span><b>${esc(c.name)}</b><br>${esc(c.skinName)}<br>
      <small style="color:${RARITIES[c.rarity].color}">${RARITIES[c.rarity].label}</small></span>
    </button>`).join("")
    + (list.length > 150 ? `<p class="hint">Affine ta recherche pour voir les ${list.length - 150} autres.</p>` : "")
    || `<p class="hint">Aucun résultat.</p>`;
  $("scCount").textContent = `${scSel.length} / ${SHOWCASE_MAX}`;
}

function openShowcaseEdit() {
  if (!state) return;
  scSel = (state.showcase || []).filter(id => state.cards?.[id] > 0).slice(0, SHOWCASE_MAX);
  $("scSearch").value = "";
  renderShowcasePicker();
  $("showcaseModal").hidden = false;
}

$("pEdit").onclick = openShowcaseEdit;
$("pBack").onclick = () => showProfile();
$("pShowcase").addEventListener("click", e => { if (e.target.closest(".slot")) openShowcaseEdit(); });
$("scSearch").addEventListener("input", renderShowcasePicker);
$("scCancel").onclick = () => { $("showcaseModal").hidden = true; };
$("scClear").onclick = () => { scSel = []; renderShowcasePicker(); };

$("scList").addEventListener("click", e => {
  const b = e.target.closest(".pick");
  if (!b) return;
  const id = +b.dataset.id;
  const i = scSel.indexOf(id);
  if (i >= 0) scSel.splice(i, 1);
  else if (scSel.length < SHOWCASE_MAX) scSel.push(id);
  else { alert(`Maximum ${SHOWCASE_MAX} cartes en vitrine.`); return; }
  b.classList.toggle("sel", i < 0);
  $("scCount").textContent = `${scSel.length} / ${SHOWCASE_MAX}`;
});

$("scSave").onclick = async () => {
  try {
    await updateDoc(userRef(), { showcase: scSel });
    state.showcase = scSel.slice();
    $("showcaseModal").hidden = true;
    showProfile();
    syncLeaderboard();
  } catch (e) {
    alert(e.message);
  }
};

async function loadRanking() {
  $("rankCards").innerHTML = `<li class="empty">Chargement…</li>`;
  $("rankMythic").innerHTML = `<li class="empty">Chargement…</li>`;
  try {
    await syncLeaderboard();
    const snap = await getDocs(collection(db, "leaderboard"));
    const players = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
    const medals = ["🥇", "🥈", "🥉"];
        const avatarHTML = p => {
      const id = p.profile?.avatar;
      if (id && skinsById[id]) {
        const c = skinCard(+id);
        return `<img class="r-av" loading="lazy" referrerpolicy="no-referrer" alt="" src="${c.img}"
          onerror="if(this.dataset.t!=='1'){this.dataset.t='1';this.src='${c.imgAlt}'}">`;
      }
      return `<span class="r-av r-ph">${esc((p.name || "?")[0].toUpperCase())}</span>`;
    };
    const fill = (el, key) => {
      const list = players
        .filter(p => (p[key] || 0) > 0)
        .sort((a, b) => (b[key] - a[key]) || ((b.total || 0) - (a.total || 0))
          || String(a.name).localeCompare(String(b.name), "fr"))
        .slice(0, 50);
      el.innerHTML = list.map((p, i) => `<li data-uid="${p.uid}" class="${p.uid === user.uid ? "me" : ""}">
        <span class="r-left"><span class="r-pos">${i < 3 ? medals[i] : (i + 1) + "."}</span>${avatarHTML(p)}<span class="r-name">${esc(p.name)}</span></span>
        <b>${p[key]}</b></li>`).join("")
        || `<li class="empty">Personne pour l'instant.</li>`;
    };
    fill($("rankCards"), "unique");
    fill($("rankMythic"), "mythic");
  } catch (e) {
    console.error(e);
    $("rankCards").innerHTML = `<li class="empty">Erreur : ${esc(e.message)}</li>`;
    $("rankMythic").innerHTML = "";
  }
}

$("rankRefresh").onclick = loadRanking;

// ---------- Personnalisation du profil ----------
const TITLES = [
  { id: "novice",     label: "Novice",                 ok: () => true },
  { id: "collector",  label: "Collectionneur",         ok: s => s.unique >= 100 },
  { id: "master",     label: "Maître collectionneur",  ok: s => s.unique >= 500 },
  { id: "mythhunter", label: "Chasseur de mythiques",  ok: s => s.mythic >= 1 },
  { id: "mythlord",   label: "Seigneur mythique",      ok: s => s.mythic >= 10 },
  { id: "hoarder",    label: "Accumulateur",           ok: s => s.total >= 1000 }
];
const PF_COLORS = ["#ffd35a", "#0397ab", "#a335ee", "#e84057", "#3fbf6f", "#4a90e2", "#ff6fae"];
let pfDraft = null, pickCb = null;

const cardLabel = id => { const c = skinCard(+id); return `${c.name} — ${c.skinName}`; };

function renderCardPicker() {
  const q = norm($("pickSearch").value.trim());
  const list = Object.keys(state.cards || {}).filter(id => state.cards[id] > 0).map(id => skinCard(+id))
    .filter(c => !q || norm(c.name).includes(q) || norm(c.skinName).includes(q))
    .sort((a, b) => rIdx(a.rarity) - rIdx(b.rarity) || a.name.localeCompare(b.name, "fr"));
  $("pickList").innerHTML = list.slice(0, 150).map(c => `
    <button class="pick ${c.rarity}" data-id="${c.id}">
      <img loading="lazy" referrerpolicy="no-referrer" alt="" src="${c.img}"
           onerror="if(this.dataset.t!=='1'){this.dataset.t='1';this.src='${c.imgAlt}'}">
      <span><b>${esc(c.name)}</b><br>${esc(c.skinName)}<br>
      <small style="color:${RARITIES[c.rarity].color}">${RARITIES[c.rarity].label}</small></span>
    </button>`).join("")
    + (list.length > 150 ? `<p class="hint">Affine ta recherche pour voir les ${list.length - 150} autres.</p>` : "")
    || `<p class="hint">Aucun résultat.</p>`;
}

function openCardPicker(title, cb) {
  pickCb = cb;
  $("pickTitle").textContent = title;
  $("pickSearch").value = "";
  renderCardPicker();
  $("pickModal").hidden = false;
}

$("pickSearch").addEventListener("input", renderCardPicker);
$("pickCancel").onclick = () => { $("pickModal").hidden = true; pickCb = null; };
$("pickList").addEventListener("click", e => {
  const b = e.target.closest(".pick");
  if (!b) return;
  const cb = pickCb;
  $("pickModal").hidden = true;
  pickCb = null;
  if (cb) cb(+b.dataset.id);
});

function previewProfile() {
  renderProfile({ ...myStats(), profile: pfDraft }, true);
}

function updatePfNames() {
  $("pfBgName").textContent = pfDraft.bg ? cardLabel(pfDraft.bg) : "aucun";
  $("pfAvName").textContent = pfDraft.avatar ? cardLabel(pfDraft.avatar) : "aucun";
  previewProfile();
}

function openCustomize() {
  if (!state) return;
  const st = myStats();
  pfDraft = { ...st.profile };
  $("pfBio").value = pfDraft.bio;
  $("pfTitle").innerHTML = `<option value="">Aucun</option>` + TITLES.filter(t => t.ok(st))
    .map(t => `<option value="${t.id}"${t.id === pfDraft.title ? " selected" : ""}>${esc(t.label)}</option>`).join("");
  const cur = pfDraft.color || PF_COLORS[0];
  $("pfColors").innerHTML = PF_COLORS.map(c =>
    `<button type="button" class="swatch${c === cur ? " sel" : ""}" data-c="${c}" style="background:${c}"></button>`).join("");
  updatePfNames();
  $("pfModal").hidden = false;
}

$("pCustom").onclick = openCustomize;
$("pfColors").addEventListener("click", e => {
  const b = e.target.closest(".swatch");
  if (!b) return;
  pfDraft.color = b.dataset.c;
  $("pfColors").querySelectorAll(".swatch").forEach(x => x.classList.toggle("sel", x === b));
  previewProfile();
});
$("pfTitle").addEventListener("change", () => { pfDraft.title = $("pfTitle").value; previewProfile(); });
$("pfBio").addEventListener("input", () => { pfDraft.bio = $("pfBio").value.slice(0, 100); previewProfile(); });
$("pfBgBtn").onclick = () => openCardPicker("Choisis ton fond (splash art)", id => { pfDraft.bg = id; updatePfNames(); });
$("pfBgClear").onclick = () => { pfDraft.bg = 0; updatePfNames(); };
$("pfAvBtn").onclick = () => openCardPicker("Choisis ton avatar", id => { pfDraft.avatar = id; updatePfNames(); });
$("pfAvClear").onclick = () => { pfDraft.avatar = 0; updatePfNames(); };
$("pfCancel").onclick = () => { $("pfModal").hidden = true; showProfile(); };

$("pfSave").onclick = async () => {
  pfDraft.bio = $("pfBio").value.trim().slice(0, 100);
  pfDraft.title = $("pfTitle").value;
  try {
    await updateDoc(userRef(), { profile: pfDraft });
    state.profile = { ...pfDraft };
    $("pfModal").hidden = true;
    showProfile();
    syncLeaderboard();
  } catch (e) {
    alert(e.message);
  }
};


// ---------- Aventure PVE ----------
let ddVersion = "", shopItems = [], mapRegion = null, mapVB = [0, 0, 1000, 640], mapAnim = 0;
let advSel = 0, battleTimer = null;
const shopF = { q: "", stat: "" };

const LVL = 9, TEAM_SIZE = 3, BUILD_SLOTS = 3, SELL_RATE = 0.7;
const RARITY_MULT = { common: 1, rare: 1.05, epic: 1.12, legendary: 1.2, mythic: 1.3 };
const ITEM_STATS = {
  FlatHPPoolMod:         { key: "hp",    label: "PV" },
  FlatPhysicalDamageMod: { key: "ad",    label: "AD" },
  FlatMagicDamageMod:    { key: "ap",    label: "AP" },
  FlatArmorMod:          { key: "armor", label: "Armure" },
  FlatSpellBlockMod:     { key: "mr",    label: "RM" }
};
const STAT_LABEL = { hp: "PV", ad: "AD", ap: "AP", armor: "Armure", mr: "RM" };
const BATTLE_NAMES = ["Éclaireurs", "Garde locale", "Troupes d'élite", "Champion de la région"];
const BATTLE_BOOSTERS = [0, 1, 1, 2];

const REGIONS = [
  { id: "freljord", lines: ["Freljord"], tier: 1, color: "#7fb8d6", label: [370, 85],
    path: "M110 30 L610 30 L640 110 L520 150 L300 140 L150 130 Z",
    desc: "Terres glacées, tribus et bêtes du nord.",
    champs: ["Ashe", "Sejuani", "Tryndamere", "Anivia", "Braum", "Lissandra", "Volibear", "Olaf", "Gragas", "Udyr"] },
  { id: "demacia", lines: ["Demacia"], tier: 1, color: "#b8a24a", label: [180, 255],
    path: "M70 165 L285 160 L295 335 L180 350 L70 315 Z",
    desc: "Royaume de la justice et de l'honneur.",
    champs: ["Garen", "Lux", "JarvanIV", "Galio", "Fiora", "Quinn", "Sona", "Poppy", "XinZhao", "Vayne"] },
  { id: "noxus", lines: ["Noxus"], tier: 1, color: "#a8323e", label: [400, 255],
    path: "M305 165 L485 175 L495 270 L450 345 L315 335 Z",
    desc: "Empire conquérant, la force fait loi.",
    champs: ["Darius", "Draven", "Katarina", "Swain", "Talon", "Vladimir", "Sion", "Riven", "Samira"] },
  { id: "piltover", lines: ["Piltover", "& Zaun"], tier: 2, color: "#3fa58f", label: [585, 245],
    path: "M505 170 L650 180 L675 290 L590 345 L520 300 Z",
    desc: "La cité du progrès et ses bas-fonds.",
    champs: ["Caitlyn", "Vi", "Jayce", "Ezreal", "Heimerdinger", "Camille", "Ekko", "Jinx", "Warwick", "Blitzcrank", "Viktor"] },
  { id: "ionia", lines: ["Ionia"], tier: 1, color: "#d98ab0", label: [815, 245],
    path: "M700 150 L910 140 L940 300 L860 360 L730 340 L700 250 Z",
    desc: "Terre d'équilibre entre esprit et nature.",
    champs: ["Ahri", "Yasuo", "Yone", "Irelia", "Karma", "LeeSin", "Jhin", "Shen", "Zed", "Akali", "MasterYi"] },
  { id: "void", lines: ["Le Vide"], tier: 4, color: "#5b2a86", label: [885, 75],
    path: "M800 25 L955 25 L965 115 L860 125 Z",
    desc: "Une menace venue d'au-delà de Runeterra.",
    champs: ["Khazix", "Chogath", "Velkoz", "KogMaw", "RekSai", "Kaisa", "Malzahar", "Belveth"] },
  { id: "bandle", lines: ["Bandle", "City"], fs: 15, tier: 2, color: "#e6a0d4", label: [58, 120],
    path: "M15 95 L75 90 L105 140 L60 165 L15 150 Z",
    desc: "Cité magique des yordles.",
    champs: ["Teemo", "Tristana", "Veigar", "Lulu", "Rumble", "Corki", "Yuumi"] },
  { id: "targon", lines: ["Targon"], tier: 3, color: "#8a6fd1", label: [375, 430],
    path: "M300 370 L430 360 L470 470 L360 500 L290 450 Z",
    desc: "La montagne sacrée qui touche les étoiles.",
    champs: ["Leona", "Diana", "Pantheon", "AurelionSol", "Taric", "Soraka", "Zoe", "Aphelios"] },
  { id: "shadowisles", lines: ["Îles", "obscures"], tier: 3, color: "#4fa089", label: [140, 480],
    path: "M40 400 L230 390 L250 520 L140 590 L50 540 Z",
    desc: "Archipel hanté par la Brume Noire.",
    champs: ["Thresh", "Kalista", "Hecarim", "Karthus", "Yorick", "Maokai", "Viego", "Gwen", "Fiddlesticks"] },
  { id: "shurima", lines: ["Shurima"], tier: 2, color: "#d9a441", label: [430, 575],
    path: "M290 520 L560 500 L600 610 L380 625 L270 600 Z",
    desc: "Le désert des empereurs déchus.",
    champs: ["Azir", "Sivir", "Nasus", "Renekton", "Amumu", "Rammus", "Taliyah", "Xerath", "Skarner"] },
  { id: "bilgewater", lines: ["Bilgewater"], fs: 18, tier: 2, color: "#4a7fb0", label: [705, 445],
    path: "M620 380 L780 375 L800 480 L700 520 L610 470 Z",
    desc: "Port de pirates, de monstres et de marins.",
    champs: ["MissFortune", "Gangplank", "Graves", "TwistedFate", "Pyke", "Nautilus", "Illaoi", "Fizz", "TahmKench"] },
  { id: "ixtal", lines: ["Ixtal"], tier: 3, color: "#4aa05a", label: [890, 495],
    path: "M830 395 L950 390 L960 560 L870 610 L820 540 Z",
    desc: "Jungle des mages élémentaires.",
    champs: ["Qiyana", "Neeko", "Malphite", "Nidalee", "Zyra", "Rengar", "Milio"] }
];

const champById = id => champions.find(c => norm(c.id) === norm(id));
const advOf = s => {
  const a = (s.adv ||= {});
  a.gold ??= 1000; a.cleared ||= {}; a.builds ||= {}; a.team ||= [];
  return a;
};
const advView = () => {
  const a = state?.adv || {};
  return { gold: a.gold ?? 1000, cleared: a.cleared || {}, builds: a.builds || {}, team: a.team || [] };
};

async function mutateAdv(fn) {
  state = await runTransaction(db, async tx => {
    const snap = await tx.get(userRef());
    const s = snap.data();
    s.cards = s.cards || {};
    fn(advOf(s), s);
    tx.set(userRef(), s);
    return s;
  });
}

function buildShop(data) {
  const seen = new Set();
  return Object.entries(data).map(([id, it]) => {
    const stats = {};
    for (const [k, def] of Object.entries(ITEM_STATS)) if (it.stats?.[k] > 0) stats[def.key] = Math.round(it.stats[k]);
    return { id, name: it.name, cost: it.gold?.total || 0, stats, it };
  }).filter(x => {
    const it = x.it;
    if (!Object.keys(x.stats).length || !it.gold?.purchasable || x.cost < 800) return false;
    if (!it.maps?.["11"] || it.requiredChampion || it.requiredAlly || it.hideFromAll || it.inStore === false) return false;
    if (it.into?.length || seen.has(x.name)) return false;
    seen.add(x.name);
    return true;
  }).sort((a, b) => a.cost - b.cost);
}

// ----- Unités et combat -----
function baseUnit(champ, level, mult) {
  const st = champ.stats || {}, inf = champ.info || {};
  const g = (b, p) => ((st[b] || 0) + (st[p] || 0) * (level - 1)) * mult;
  return {
    hp: g("hp", "hpperlevel"),
    ad: g("attackdamage", "attackdamageperlevel"),
    ap: (inf.magic || 0) * 10 * (level / 9) * mult,
    armor: g("armor", "armorperlevel"),
    mr: g("spellblock", "spellblockperlevel"),
    as: Math.max(0.4, (st.attackspeed || 0.65) * (1 + ((st.attackspeedperlevel || 2) / 100) * (level - 1))),
    magic: (inf.magic || 0) >= 6
  };
}

function playerUnit(skinId) {
  const c = skinCard(+skinId), champ = champByKey[Math.floor(skinId / 1000)];
  const u = baseUnit(champ, LVL, RARITY_MULT[c.rarity] || 1);
  (advView().builds[skinId] || []).forEach(iid => {
    const it = shopItems.find(x => x.id === String(iid));
    if (it) for (const [k, v] of Object.entries(it.stats)) u[k] += v;
  });
  return Object.assign(u, { name: c.name, img: c.img, imgAlt: c.imgAlt, side: 0, id: +skinId });
}

function battlesOf(reg) {
  return BATTLE_NAMES.map((name, i) => ({
    idx: i, name,
    level: Math.min(18, 5 + reg.tier * 2 + i * 2),
    mult: +(0.8 + reg.tier * 0.05 + i * 0.08).toFixed(2),
    gold: 150 + reg.tier * 100 + i * 120,
    boosters: BATTLE_BOOSTERS[i]
  }));
}

function enemyChamps(reg, b) {
  const list = reg.champs.map(champById).filter(Boolean);
  return [0, 1, 2].map(k => list[(b.idx * 2 + k) % list.length]);
}

function enemyTeam(reg, b) {
  return enemyChamps(reg, b).map(c => {
    const sc = skinCard(+c.key * 1000);
    return Object.assign(baseUnit(c, b.level, b.mult), { name: c.name, img: sc.img, imgAlt: sc.imgAlt, side: 1 });
  });
}

function simulate(U) {
  U.forEach(u => { u.cur = u.hp; u.cd = 0; u.ult = 0; });
  const frames = [], dt = 0.5;
  const power = u => (u.magic ? u.ap * 0.9 + u.ad * 0.4 : u.ad);
  const hurt = (a, d, m) => {
    const r = Math.max(0, a.magic ? d.mr : d.armor);
    d.cur = Math.max(0, d.cur - (power(a) * m * 100) / (100 + r));
  };
  let win = false;
  for (let s = 0; s <= 240; s++) {
    const log = [];
    for (const u of U) {
      if (u.cur <= 0) continue;
      const foes = U.filter(x => x.side !== u.side && x.cur > 0);
      if (!foes.length) continue;
      u.cd += dt * u.as;
      u.ult += dt;
      const kill = x => { log.push(`${x.name} est vaincu`); foes.splice(foes.indexOf(x), 1); };
      if (u.ult >= 10) {
        u.ult -= 10;
        const t = foes.reduce((m, x) => (x.cur < m.cur ? x : m));
        hurt(u, t, 2.5);
        log.push(`⚡ ${u.name} lance son ultime`);
        if (t.cur <= 0) kill(t);
      }
      while (u.cd >= 1 && foes.length) {
        u.cd -= 1;
        hurt(u, foes[0], 1);
        if (foes[0].cur <= 0) kill(foes[0]);
      }
    }
    frames.push({ t: s * dt, hp: U.map(u => Math.round(u.cur)), log });
    const pAlive = U.some(u => u.side === 0 && u.cur > 0), eAlive = U.some(u => u.side === 1 && u.cur > 0);
    if (!pAlive || !eAlive) { win = pAlive; break; }
  }
  return { frames, win };
}

// ----- Carte interactive -----
function buildMap() {
  $("runeMap").innerHTML = REGIONS.map(r => `
    <g class="reg" data-id="${r.id}">
      <path d="${r.path}" fill="${r.color}"/>
      <text x="${r.label[0]}" y="${r.label[1]}" font-size="${r.fs || 20}">
        ${r.lines.map((l, i) => `<tspan x="${r.label[0]}" dy="${i ? 22 : 0}">${esc(l)}</tspan>`).join("")}
        <tspan class="reg-prog" x="${r.label[0]}" dy="22" data-prog="${r.id}"></tspan>
      </text>
    </g>`).join("");
}
buildMap();

function renderMap() {
  const a = advView();
  REGIONS.forEach(r => {
    const n = battlesOf(r).filter(b => a.cleared[`${r.id}_${b.idx}`]).length;
    const el = document.querySelector(`[data-prog="${r.id}"]`);
    if (el) el.textContent = `${n}/${BATTLE_NAMES.length}`;
    document.querySelector(`.reg[data-id="${r.id}"]`)?.classList.toggle("done", n === BATTLE_NAMES.length);
  });
}

function zoomTo(vb) {
  const from = mapVB.slice(), t0 = performance.now(), dur = 600;
  cancelAnimationFrame(mapAnim);
  const step = now => {
    const k = Math.min(1, (now - t0) / dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    mapVB = from.map((v, i) => v + (vb[i] - v) * e);
    $("runeMap").setAttribute("viewBox", mapVB.join(" "));
    if (k < 1) mapAnim = requestAnimationFrame(step);
  };
  mapAnim = requestAnimationFrame(step);
}

function regionViewBox(id) {
  const b = document.querySelector(`.reg[data-id="${id}"] path`).getBBox();
  const pad = 40, ar = 1000 / 640;
  let w = b.width + pad * 2, h = b.height + pad * 2;
  if (w / h < ar) w = h * ar; else h = w / ar;
  return [b.x + b.width / 2 - w / 2, b.y + b.height / 2 - h / 2, w, h];
}

function openRegion(id) {
  mapRegion = id;
  $("mapWrap").classList.add("zoomed");
  $("mapBack").hidden = false;
  $("regionPanel").hidden = false;
  renderRegionPanel();
  zoomTo(regionViewBox(id));
}

function closeRegion() {
  mapRegion = null;
  $("mapWrap").classList.remove("zoomed");
  $("mapBack").hidden = true;
  $("regionPanel").hidden = true;
    zoomTo([0, 0, 1000, 640]);
}

function renderRegionPanel() {
  const reg = REGIONS.find(r => r.id === mapRegion);
  if (!reg) return;
  const a = advView();
  $("regionPanel").innerHTML = `<h3>${esc(reg.lines.join(" "))}</h3><p class="hint">${esc(reg.desc)}</p>`
    + battlesOf(reg).map(b => {
      const done = a.cleared[`${reg.id}_${b.idx}`];
      const locked = b.idx > 0 && !a.cleared[`${reg.id}_${b.idx - 1}`];
      const foes = enemyChamps(reg, b).map(c => {
        const sc = skinCard(+c.key * 1000);
        return `<img referrerpolicy="no-referrer" alt="${esc(c.name)}" title="${esc(c.name)}" src="${sc.img}"
          onerror="if(this.dataset.t!=='1'){this.dataset.t='1';this.src='${sc.imgAlt}'}">`;
      }).join("");
      return `<div class="brow${locked ? " lock" : ""}">
        <div><b>${esc(b.name)}</b> ${done ? "✔" : ""}
          <small>Niveau ${b.level} · 🪙 ${b.gold}${!done && b.boosters ? ` · 📦 ${b.boosters} (1re victoire)` : ""}</small>
          <div class="eic">${foes}</div></div>
        <button class="btn-play small" data-b="${b.idx}"${locked ? " disabled" : ""}>Combattre</button>
      </div>`;
    }).join("");
}

$("runeMap").addEventListener("click", e => {
  const g = e.target.closest(".reg");
  if (g && !mapRegion) openRegion(g.dataset.id);
});
$("mapBack").onclick = closeRegion;
$("regionPanel").addEventListener("click", e => {
  const b = e.target.closest("[data-b]");
  if (b && !b.disabled) startBattle(mapRegion, +b.dataset.b);
});

// ----- Équipe et boutique -----
const itemImg = id => `${DDRAGON}/cdn/${ddVersion}/img/item/${id}.png`;
const itemById = id => shopItems.find(x => x.id === String(id));
const statsTxt = s => Object.entries(s).map(([k, v]) => `+${v} ${STAT_LABEL[k]}`).join(" · ");

function validTeam() {
  return advView().team.filter(id => state.cards?.[id] > 0 && skinsById[id]).slice(0, TEAM_SIZE);
}

function renderAdvTeam() {
  if (!state || !skinList.length) return;
  const a = advView(), team = validTeam();
  if (!team.includes(advSel)) advSel = team[0] || 0;

  let html = "";
  for (let i = 0; i < TEAM_SIZE; i++) {
    const id = team[i];
    if (!id) { html += `<div class="aslot"><button class="aempty" data-act="pick" data-i="${i}">＋ Choisir une carte</button></div>`; continue; }
    const c = skinCard(id), u = playerUnit(id), build = a.builds[id] || [];
    const slots = Array.from({ length: BUILD_SLOTS }, (_, k) => {
      const it = itemById(build[k]);
      return it
        ? `<button class="aitem" data-act="sell" data-id="${id}" data-k="${k}" title="Revendre ${esc(it.name)} (${Math.floor(it.cost * SELL_RATE)} or)"><img src="${itemImg(it.id)}" alt=""></button>`
        : `<span class="aitem"></span>`;
    }).join("");
    html += `<div class="aslot${id === advSel ? " sel" : ""}" data-act="select" data-id="${id}">
      <img referrerpolicy="no-referrer" alt="" src="${c.img}" onerror="if(this.dataset.t!=='1'){this.dataset.t='1';this.src='${c.imgAlt}'}">
      <div class="ainfo">
        <b>${esc(c.name)}</b><small>${esc(c.skinName)} · <span style="color:${RARITIES[c.rarity].color}">${RARITIES[c.rarity].label}</span></small>
        <small>❤ ${Math.round(u.hp)} · ⚔ ${Math.round(u.ad)} · ✨ ${Math.round(u.ap)}<br>🛡 ${Math.round(u.armor)} · 🔮 ${Math.round(u.mr)}</small>
        <div class="abuild">${slots}</div>
        <div class="abtns">
          <button class="btn" data-act="pick" data-i="${i}">Changer</button>
          <button class="btn" data-act="remove" data-id="${id}">Retirer</button>
        </div>
      </div></div>`;
  }
  $("advSlots").innerHTML = html;
  renderShop();
}

function renderShop() {
  const a = advView();
  const labels = [["", "Tous"], ...Object.entries(STAT_LABEL)];
  $("shopChips").innerHTML = labels.map(([k, l]) =>
    `<button type="button" class="tchip${shopF.stat === k ? " on" : ""}" data-s="${k}">${l}</button>`).join("");

  const target = advSel ? skinCard(advSel) : null;
  const build = target ? (a.builds[advSel] || []) : [];
  $("shopTarget").textContent = target
    ? `Objets pour ${target.name} (${build.length}/${BUILD_SLOTS}). Clique sur un objet équipé pour le revendre à ${SELL_RATE * 100} %.`
    : "Choisis d'abord une carte dans ton équipe.";

  if (!shopItems.length) { $("shopGrid").innerHTML = `<p class="hint">Objets indisponibles.</p>`; return; }
  const q = norm(shopF.q.trim());
  const list = shopItems.filter(x => (!shopF.stat || x.stats[shopF.stat]) && (!q || norm(x.name).includes(q))).slice(0, 80);
  $("shopGrid").innerHTML = list.map(x => `
    <div class="sitem"><img loading="lazy" src="${itemImg(x.id)}" alt="">
      <div class="sinfo"><b>${esc(x.name)}</b><small>${statsTxt(x.stats)}</small></div>
      <button class="btn" data-buy="${x.id}"${!target || build.length >= BUILD_SLOTS || a.gold < x.cost ? " disabled" : ""}>🪙 ${x.cost}</button>
    </div>`).join("") || `<p class="hint">Aucun objet.</p>`;
}

$("shopSearch").addEventListener("input", () => { shopF.q = $("shopSearch").value; renderShop(); });
$("shopChips").addEventListener("click", e => {
  const b = e.target.closest("[data-s]");
  if (b) { shopF.stat = b.dataset.s; renderShop(); }
});

$("shopGrid").addEventListener("click", async e => {
  const b = e.target.closest("[data-buy]");
  if (!b || b.disabled || !advSel) return;
  const it = itemById(b.dataset.buy), id = advSel;
  try {
    await mutateAdv((a, s) => {
      if (!(s.cards[id] > 0)) throw new Error("Tu ne possèdes plus cette carte.");
      const bl = (a.builds[id] ||= []);
      if (bl.length >= BUILD_SLOTS) throw new Error("Cette carte porte déjà 3 objets.");
      if (a.gold < it.cost) throw new Error("Pas assez d'or.");
      a.gold -= it.cost;
      bl.push(it.id);
    });
    render();
  } catch (err) { alert(err.message); }
});

$("advSlots").addEventListener("click", async e => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const act = b.dataset.act, id = +b.dataset.id;
  if (act === "select") { advSel = id; renderAdvTeam(); return; }
  if (act === "pick") {
    const i = +b.dataset.i;
    openCardPicker("Choisis une carte pour ton équipe", async newId => {
      try {
        await mutateAdv(a => {
          const t = validTeamOf(a);
          if (t.includes(newId)) throw new Error("Cette carte est déjà dans l'équipe.");
          t[Math.min(i, t.length)] = newId;
          a.team = t.slice(0, TEAM_SIZE);
        });
        advSel = newId;
        render();
      } catch (err) { alert(err.message); }
    });
    return;
  }
  if (act === "remove") {
    try {
      await mutateAdv(a => { a.team = validTeamOf(a).filter(x => x !== id); });
      render();
    } catch (err) { alert(err.message); }
    return;
  }
  if (act === "sell") {
    const k = +b.dataset.k;
    try {
      await mutateAdv(a => {
        const bl = a.builds[id] || [];
        const it = itemById(bl[k]);
        if (!it) return;
        bl.splice(k, 1);
        a.gold += Math.floor(it.cost * SELL_RATE);
      });
      render();
    } catch (err) { alert(err.message); }
  }
});

function validTeamOf(a) {
  return (a.team || []).filter(x => x && skinsById[x]);
}

// ----- Combat animé -----
let battleBusy = false;

function unitHTML(u, i) {
  return `<div class="bunit" data-u="${i}">
    <img referrerpolicy="no-referrer" alt="" src="${u.img}" onerror="if(this.dataset.t!=='1'){this.dataset.t='1';this.src='${u.imgAlt}'}">
    <b>${esc(u.name)}</b>
    <div class="hpbar"><span></span></div>
    <small data-hp>${Math.round(u.hp)} / ${Math.round(u.hp)}</small>
  </div>`;
}

async function startBattle(regId, idx) {
  if (battleBusy || !state) return;
  const team = validTeam();
  if (!team.length) {
    alert("Compose d'abord ton équipe dans l'onglet « Équipe & boutique ».");
    return;
  }
  const reg = REGIONS.find(r => r.id === regId), b = battlesOf(reg)[idx];
  const U = [...team.map(playerUnit), ...enemyTeam(reg, b)];
  const { frames, win } = simulate(U);
  const key = `${regId}_${idx}`;
  battleBusy = true;

  let first = false, gold = 0;
  try {
    if (win) {
      await mutateAdv((a, s) => {
        first = !a.cleared[key];
        gold = b.gold;
        a.gold += gold;
        if (first) {
          a.cleared[key] = true;
          if (b.boosters) s.boosters = (s.boosters || 0) + b.boosters;
        }
      });
    }
  } catch (err) {
    battleBusy = false;
    alert(err.message);
    return;
  }

  $("battleTitle").textContent = `${reg.lines.join(" ")} — ${b.name}`;
  $("bTeamP").innerHTML = U.map((u, i) => (u.side === 0 ? unitHTML(u, i) : "")).join("");
  $("bTeamE").innerHTML = U.map((u, i) => (u.side === 1 ? unitHTML(u, i) : "")).join("");
  $("bLog").innerHTML = "";
  $("bResult").hidden = true;
  $("battleModal").hidden = false;

  let f = 0;
  const paint = fr => {
    U.forEach((u, i) => {
      const el = document.querySelector(`.bunit[data-u="${i}"]`);
      if (!el) return;
      const hp = fr.hp[i];
      el.querySelector(".hpbar span").style.width = `${(hp / u.hp) * 100}%`;
      el.querySelector("[data-hp]").textContent = `${hp} / ${Math.round(u.hp)}`;
      el.classList.toggle("dead", hp <= 0);
    });
    $("bClock").textContent = `${fr.t.toFixed(0)} s`;
    if (fr.log.length) $("bLog").innerHTML = fr.log.slice(-3).map(esc).join("<br>") + "<br>" + $("bLog").innerHTML;
  };
  const finish = () => {
    clearInterval(battleTimer);
    paint(frames[frames.length - 1]);
    $("bResTitle").textContent = win ? "Victoire !" : "Défaite";
    $("bResText").innerHTML = win
      ? `+${gold} or${first && b.boosters ? ` · +${b.boosters} booster${b.boosters > 1 ? "s" : ""} 🎉` : ""}`
      : "Améliore tes objets ou change d'équipe, puis réessaie.";
    $("bResult").hidden = false;
    $("bSkip").hidden = true;
    battleBusy = false;
    render();
  };
  $("bSkip").hidden = false;
  $("bSkip").onclick = finish;
  paint(frames[0]);
  battleTimer = setInterval(() => {
    f++;
    if (f >= frames.length) { finish(); return; }
    paint(frames[f]);
  }, 140);
}

$("bClose").onclick = () => { $("battleModal").hidden = true; clearInterval(battleTimer); battleBusy = false; render(); };

// ----- Onglets de l'Aventure -----
function showAdv(v) {
  $("advMapView").hidden = v !== "map";
  $("advTeamView").hidden = v !== "team";
  $("advMapBtn").classList.toggle("active", v === "map");
  $("advTeamBtn").classList.toggle("active", v === "team");
  if (v === "team") renderAdvTeam();
}
$("advMapBtn").onclick = () => showAdv("map");
$("advTeamBtn").onclick = () => showAdv("team");

function renderAdventure() {
  if (!state || !skinList.length) return;
  $("advGold").textContent = advView().gold;
  renderMap();
  if (mapRegion) renderRegionPanel();
  if (!$("advTeamView").hidden) renderAdvTeam();
}

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

async function syncTradeQuests() {
  if (!user || !state || syncingTrades || !tradesLoaded.in || !tradesLoaded.out) return;
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
      refreshSocial();
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
    refreshSocial();
  } catch (e) {
    msg.textContent = "Erreur : " + e.message;
  }
}
$("friendAdd").onclick = sendFriendRequest;

// ---------- Échanges (même rareté uniquement) ----------
// copies réservées par mes propositions d'échange en attente
function reservedMap() {
  const r = {};
  tradesOut.filter(t => t.status === "pending").forEach(t => {
    r[t.offerId] = (r[t.offerId] || 0) + 1;
  });
  return r;
}

// mes cartes réellement disponibles (possédées moins réservées)
function availCards(res = reservedMap()) {
  const out = {};
  for (const [id, q] of Object.entries(state.cards || {})) {
    const a = q - (res[id] || 0);
    if (a > 0) out[id] = a;
  }
  return out;
}

const availQty = id => (state.cards?.[id] || 0) - (reservedMap()[id] || 0);
let tradeFriend = null, tradeData = null, tradeTab = "mine";
const tradeSel = { mine: 0, theirs: 0 };
const tradeFilt = { q: "", rarity: "", dupes: false, missing: false };
const RAR_LETTER = { mythic: "M", legendary: "L", epic: "E", rare: "R", common: "C" };

function closeTrade() {
  $("tradeModal").hidden = true;
  tradeFriend = null;
  tradeData = null;
}

function renderTrade() {
  if (!tradeFriend || !tradeData) return;
  const tab = tradeTab, other = tab === "mine" ? "theirs" : "mine";
  const res = reservedMap();
  const src = tab === "mine" ? availCards(res) : tradeData.theirs;
  const oth = tab === "mine" ? tradeData.theirs : (state.cards || {});
  const lock = tradeSel[other] ? skinCard(tradeSel[other]).rarity : "";
  const rar = lock || tradeFilt.rarity;
  const q = norm(tradeFilt.q.trim());
  const dupLabel = tab === "mine" ? "Mes doubles" : "Ses doubles";
  const missLabel = tab === "mine" ? "Il lui manque" : "Il me manque";

  $("tradeTabMine").classList.toggle("active", tab === "mine");
  $("tradeTabTheirs").classList.toggle("active", tab === "theirs");
  $("tradeTabMine").textContent = "Mes cartes" + (tradeSel.mine ? " ✓" : "");
  $("tradeTabTheirs").textContent = `Cartes de ${tradeFriend.name}` + (tradeSel.theirs ? " ✓" : "");

  const chip = (attrs, label, on, dis) =>
    `<button type="button" class="tchip${on ? " on" : ""}" ${attrs}${dis ? " disabled" : ""}>${label}</button>`;
  $("tradeChips").innerHTML =
    chip('data-f="dupes"', dupLabel, tradeFilt.dupes, false) +
    chip('data-f="missing"', missLabel, tradeFilt.missing, false) +
    chip('data-r=""', "Toutes", !rar, !!lock) +
    RARITY_ORDER.map(r =>
      chip(`data-r="${r}" title="${RARITIES[r].label}"`, RAR_LETTER[r], rar === r, !!lock && lock !== r)).join("");

  $("tradeLock").hidden = !lock;
  if (lock) $("tradeLockTxt").textContent = `Rareté imposée : ${RARITIES[lock].label} (échange entre cartes de même rareté)`;

  const list = Object.keys(src).filter(id => src[id] > 0).map(id => skinCard(+id))
    .filter(c => (!rar || c.rarity === rar)
      && (!q || norm(c.name).includes(q) || norm(c.skinName).includes(q))
      && (!tradeFilt.dupes || src[c.id] >= 2)
      && (!tradeFilt.missing || !(oth[c.id] > 0)))
    .sort((a, b) => rIdx(a.rarity) - rIdx(b.rarity) || a.name.localeCompare(b.name, "fr"));

  $("tradeGrid").innerHTML = list.slice(0, 300).map(c => `
    <button type="button" class="tcard${tradeSel[tab] === c.id ? " sel" : ""}" data-id="${c.id}" style="--rc:${RARITIES[c.rarity].color}">
      <span class="tbadge">${RAR_LETTER[c.rarity]}</span>
      <img loading="lazy" referrerpolicy="no-referrer" alt="" src="${c.img}"
           onerror="if(this.dataset.t!=='1'){this.dataset.t='1';this.src='${c.imgAlt}'}">
      <b>${esc(c.name)}</b>
      <small>${esc(c.skinName)}</small>
      ${oth[c.id] > 0 ? "" : `<span class="tmiss">${missLabel}</span>`}
            <span class="tqty">×${src[c.id]} dispo${tab === "mine" && res[c.id] ? ` · ${res[c.id]} réservée${res[c.id] > 1 ? "s" : ""}` : ""}</span>
    </button>`).join("")
    + (list.length > 300 ? `<p class="hint">Affine ta recherche pour voir les ${list.length - 300} autres.</p>` : "")
    || `<p class="hint">Aucune carte ne correspond.</p>`;

  const side = id => (id ? mini(id) : `<span class="hint">—</span>`);
  $("tradeSummary").innerHTML =
    `<div><small>Tu donnes</small>${side(tradeSel.mine)}</div><span class="arrow">⇄</span>` +
    `<div><small>Tu reçois</small>${side(tradeSel.theirs)}</div>`;

  const same = tradeSel.mine && tradeSel.mine === tradeSel.theirs;
  $("tradeMsg").textContent = same ? "Choisis deux cartes différentes." : "";
  $("tradeSend").disabled = !(tradeSel.mine && tradeSel.theirs) || same;
}

function setTradeTab(t) {
  tradeTab = t;
  tradeFilt.q = "";
  $("tradeSearch").value = "";
  renderTrade();
  $("tradeGrid").scrollTop = 0;
}

async function openTrade(friendUid, friendName) {
  try {
    const snap = await getDoc(doc(db, "users", friendUid));
    const theirs = {};
    Object.entries(snap.data()?.cards || {}).forEach(([id, q]) => { if (q > 0) theirs[id] = q; });
    const mineCount = Object.keys(state.cards || {}).filter(id => state.cards[id] > 0).length;
    if (!mineCount) { alert("Tu n'as aucune carte à proposer."); return; }
    if (!Object.keys(theirs).length) { alert(`${friendName} n'a aucune carte à échanger.`); return; }

    tradeFriend = { uid: friendUid, name: friendName };
    tradeData = { theirs };
    tradeSel.mine = 0; tradeSel.theirs = 0;
    Object.assign(tradeFilt, { q: "", rarity: "", dupes: false, missing: false });
    tradeTab = "mine";
    $("tradeWith").textContent = friendName;
    $("tradeSearch").value = "";
    renderTrade();
    $("tradeModal").hidden = false;
    $("tradeGrid").scrollTop = 0;
  } catch (e) {
    alert("Impossible de charger la collection de ton ami : " + e.message);
  }
}

$("tradeTabMine").onclick = () => setTradeTab("mine");
$("tradeTabTheirs").onclick = () => setTradeTab("theirs");
$("tradeSearch").addEventListener("input", () => { tradeFilt.q = $("tradeSearch").value; renderTrade(); });
$("tradeReset").onclick = () => { tradeSel.mine = 0; tradeSel.theirs = 0; renderTrade(); };
$("tradeCancel").onclick = closeTrade;

$("tradeChips").addEventListener("click", e => {
  const b = e.target.closest(".tchip");
  if (!b || b.disabled) return;
  if (b.dataset.f) tradeFilt[b.dataset.f] = !tradeFilt[b.dataset.f];
  else tradeFilt.rarity = b.dataset.r;
  renderTrade();
});

$("tradeGrid").addEventListener("click", e => {
  const b = e.target.closest(".tcard");
  if (!b) return;
  const id = +b.dataset.id;
  const other = tradeTab === "mine" ? "theirs" : "mine";
  tradeSel[tradeTab] = tradeSel[tradeTab] === id ? 0 : id;
  if (tradeSel[tradeTab] && !tradeSel[other]) setTradeTab(other);   // passe à l'autre onglet
  else renderTrade();
});

$("tradeSend").onclick = async () => {
  if (!tradeFriend) return;
  const offerId = tradeSel.mine, wantId = tradeSel.theirs;
  if (!offerId || !wantId) { $("tradeMsg").textContent = "Choisis une carte à donner et une carte à recevoir."; return; }
  if (offerId === wantId) { $("tradeMsg").textContent = "Choisis deux cartes différentes."; return; }
  if (skinCard(offerId).rarity !== skinCard(wantId).rarity) {
    $("tradeMsg").textContent = "Les deux cartes doivent avoir la même rareté.";
    return;
  }
    if (availQty(offerId) < 1) {
    $("tradeMsg").textContent = "Cette carte est déjà proposée dans un autre échange en attente.";
    renderTrade();
    return;
  }
  $("tradeSend").disabled = true;
  try {
    await addDoc(collection(db, "trades"), {
      from: user.uid, fromName: myName(),
      to: tradeFriend.uid, toName: tradeFriend.name,
      offerId, wantId, status: "pending", createdAt: Date.now()
    });
    closeTrade();
    alert("Proposition envoyée !");
    await refreshSocial();
  } catch (e) {
    $("tradeMsg").textContent = "Erreur : " + e.message;
    $("tradeSend").disabled = false;
  }
};

async function acceptTrade(id) {
  const t = tradesIn.find(x => x.id === id);
  if (!t) return;
  if (skinCard(t.offerId).rarity !== skinCard(t.wantId).rarity) {
    alert("Cet échange est refusé : les deux cartes n'ont pas la même rareté.");
    return;
  }
  if (availQty(t.wantId) < 1) {
    alert("La carte demandée est réservée dans une de tes propositions en attente. Annule-la d'abord.");
    return;
  }
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
      if ((tc[o] || 0) < 1) throw new Error("Ton ami n'a plus cette carte.");
      if ((mc[w] || 0) < 1) throw new Error("Tu n'as plus cette carte.");
      const dec = n => (n - 1 <= 0 ? deleteField() : n - 1);
      tx.update(theirRef, { [`cards.${o}`]: dec(tc[o]), [`cards.${w}`]: (tc[w] || 0) + 1, lastTradeId: id });
      const myUp = { [`cards.${w}`]: dec(mc[w]), [`cards.${o}`]: (mc[o] || 0) + 1, lastTradeId: id };
      if (!(mc[o] > 0)) myUp[`obtained.${o}`] = Date.now();
      tx.update(myRef, myUp);
      tx.update(tradeRef, { status: "accepted" });
    });
    alert("Échange réussi !");
    refreshSocial();
  } catch (e) {
    alert(e.message);
  }
}

const setTradeStatus = (id, status) =>
  updateDoc(doc(db, "trades", id), { status }).then(refreshSocial).catch(e => alert(e.message));

// ---------- Affichage social ----------
function mini(id) {
  const c = skinCard(id);
  return `<span class="mini"><img src="${c.img}" referrerpolicy="no-referrer" alt="">
    <span><b>${esc(c.name)}</b><br>${esc(c.skinName)}<br>
    <small style="color:${RARITIES[c.rarity].color}">${RARITIES[c.rarity].label}</small></span></span>`;
}
const STATUS = { pending: "En attente", accepted: "Accepté ✔", declined: "Refusé ✖" };
const emptyLi = txt => `<li class="empty">${txt}</li>`;

function renderSocial() {
  if (!user) return;
  const me = user.uid;
  const accepted = friendships.filter(f => f.status === "accepted");
  const reqIn = friendships.filter(f => f.status === "pending" && f.requester !== me);
  const reqOut = friendships.filter(f => f.status === "pending" && f.requester === me);
  const inPending = tradesIn.filter(t => t.status === "pending").sort((a, b) => b.createdAt - a.createdAt);
  const outList = tradesOut.filter(t => t.status !== "cancelled").sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);

  const n = reqIn.length + inPending.length;
  $("friendsBadge").textContent = n;
  $("friendsBadge").hidden = n === 0;

  // amis et demandes : ne dépendent pas des données de skins
  $("reqIn").innerHTML = reqIn.map(f => `<li><span>${esc(otherName(f))}</span><span>
    <button class="btn" data-act="acceptFriend" data-id="${f.id}">Accepter</button>
    <button class="btn" data-act="removeFriend" data-id="${f.id}">Refuser</button></span></li>`).join("")
    || emptyLi("Aucune demande reçue.");

  $("reqOut").innerHTML = reqOut.map(f => `<li><span>${esc(otherName(f))}</span>
    <button class="btn" data-act="removeFriend" data-id="${f.id}">Annuler</button></li>`).join("")
    || emptyLi("Aucune demande envoyée.");

  $("friendList").innerHTML = accepted.map(f => `<li><span>${esc(otherName(f))}</span><span>
    <button class="btn" data-act="profile" data-uid="${otherOf(f)}">Profil</button>
    <button class="btn" data-act="trade" data-uid="${otherOf(f)}" data-name="${esc(otherName(f))}">Échanger</button>
    <button class="btn" data-act="removeFriend" data-id="${f.id}">Retirer</button></span></li>`).join("")
    || emptyLi("Aucun ami pour l'instant.");

  // échanges : nécessitent les données de skins
  if (!skinList.length) return;
  try {
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
  } catch (e) {
    console.error("affichage des échanges :", e);
  }
}

$("tab-friends").addEventListener("click", e => {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const { act, id, uid, name } = b.dataset;
  if (act === "acceptFriend") updateDoc(doc(db, "friendships", id), { status: "accepted" }).then(refreshSocial).catch(err => alert(err.message));
  else if (act === "removeFriend") deleteDoc(doc(db, "friendships", id)).then(refreshSocial).catch(err => alert(err.message));
  else if (act === "trade") openTrade(uid, name);
  else if (act === "acceptTrade") acceptTrade(id);
  else if (act === "declineTrade") setTradeStatus(id, "declined");
  else if (act === "cancelTrade") setTradeStatus(id, "cancelled");
  else if (act === "profile") showProfile(uid);
});

// ---------- Synchronisation des amis et échanges ----------
const docsOf = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

// lecture ponctuelle (secours si l'écoute en temps réel est bloquée)
async function refreshSocial() {
  if (!user) return;
  try {
    const [f, ti, to] = await Promise.all([
      getDocs(query(collection(db, "friendships"), where("users", "array-contains", user.uid))),
      getDocs(query(collection(db, "trades"), where("to", "==", user.uid))),
      getDocs(query(collection(db, "trades"), where("from", "==", user.uid)))
    ]);
    friendships = docsOf(f);
    tradesIn = docsOf(ti);
    tradesOut = docsOf(to);
    renderSocial();
  } catch (e) {
    console.warn("refreshSocial :", e.message);
    if (looksBlocked(e)) showNetWarn();
  }
}

// écoute avec nouvelle tentative automatique en cas d'erreur
function listen(makeQuery, onData, label) {
  let stopped = false, unsub = null, timer = null;
  const start = () => {
    if (stopped) return;
    try {
      unsub = onSnapshot(makeQuery(), onData, e => {
        console.error(label, e);
        if (looksBlocked(e)) showNetWarn();
        $("friendMsg").textContent = `Synchronisation interrompue (${e.code || "erreur"}), nouvelle tentative…`;
        timer = setTimeout(start, 8000);
      });
    } catch (e) {
      console.error(label, e);
      timer = setTimeout(start, 8000);
    }
  };
  start();
  return () => { stopped = true; if (unsub) unsub(); clearTimeout(timer); };
}

function stopListeners() {
  unsubs.forEach(u => u());
  unsubs = [];
  friendships = []; tradesIn = []; tradesOut = [];
  tradesLoaded = { in: false, out: false };
}

function startListeners() {
  stopListeners();

  unsubs.push(listen(() => userRef(), snap => {
    if (!snap.exists()) return;
    const s = snap.data();
    s.cards = s.cards || {};
    state = applyRefill(s);
    try { if (!rv && !spinning) render(); } catch (e) { console.error("Erreur d'affichage :", e); }
    fixObtained();
  }, "compte"));

  unsubs.push(listen(
    () => query(collection(db, "friendships"), where("users", "array-contains", user.uid)),
    snap => { friendships = docsOf(snap); $("friendMsg").textContent = ""; renderSocial(); },
    "amis"));

  unsubs.push(listen(
    () => query(collection(db, "trades"), where("to", "==", user.uid)),
    snap => { tradesIn = docsOf(snap); tradesLoaded.in = true; renderSocial(); syncTradeQuests(); },
    "échanges reçus"));

  unsubs.push(listen(
    () => query(collection(db, "trades"), where("from", "==", user.uid)),
    snap => { tradesOut = docsOf(snap); tradesLoaded.out = true; renderSocial(); syncTradeQuests(); },
    "échanges envoyés"));

  refreshSocial();
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
    $("recycleModal").hidden = true;
    $("viewer").hidden = true;
    rankedModule?.close();
    vw = null;
    rv = null;
    lbSig = "";
    return;
  }
  $("userName").textContent = u.displayName || "";
  try {
    if (!champions.length) await loadGameData();
    await loadState();
    await ensureUsernameDoc().catch(e => console.warn("usernames:", e.message));
    startListeners();                       // les amis démarrent avant l'affichage
    try { render(); tickTimer(); }
    catch (e) { console.error("Erreur d'affichage :", e); }
  } catch (e) {
    console.error(e);
    if (looksBlocked(e)) showNetWarn();
    else alert("Erreur de chargement : " + e.message);
  }
});
// ---------- Chargement indépendant de l'arène ----------
let rankedModule = null;
let rankedLoading = null;

async function openRankedMode() {
  const root = $("rankedRoot");
  if (!root) return;

  if (!user || !state || !champions.length) {
    root.textContent = "Attends la fin du chargement de ton compte.";
    return;
  }

  try {
    if (!rankedModule) {
      if (!rankedLoading) {
        rankedLoading = import("./ranked.js?v=pve-4")
          .then(module => module.initRanked({
            db,
            user: () => user,
            champions: () => champions,
            card: id => skinCard(Number(id)),
            week: () => weekKey()
          }))
          .catch(error => {
            rankedLoading = null;
            throw error;
          });
      }

      rankedModule = await rankedLoading;
    }

    await rankedModule.open();
  } catch (error) {
    console.error("Arène classée :", error);
    root.textContent = "Impossible de charger l'arène : " + error.message;
  }
}