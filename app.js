import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
         updateProfile, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";
import { getFirestore, doc, runTransaction }
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
const DDRAGON = "https://ddragon.leagueoflegends.com";
const CD = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default";

// chance qu'un booster contienne au moins 1 carte de cette rareté (le reste = communes)
const RARITIES = {
  common:    { label: "Commune",    chance: 1 },
  rare:      { label: "Rare",       chance: 0.941 },
  epic:      { label: "Épique",     chance: 0.176 },
  legendary: { label: "Légendaire", chance: 0.02 },
  mythic:    { label: "Mythique",   chance: 0.0033 }
};
const RARITY_ORDER = ["mythic", "legendary", "epic", "rare", "common"];

let user = null, state = null;
let champions = [], champByKey = {}, skinsById = {}, skinList = [];
let pools = {}, skinsByChamp = {};
const $ = id => document.getElementById(id);

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

// ---------- Firestore ----------
const userRef = () => doc(db, "users", user.uid);

async function loadState() {
  state = await runTransaction(db, async tx => {
    const snap = await tx.get(userRef());
    let s = snap.exists() ? snap.data()
      : { boosters: MAX_BOOSTERS, lastRefill: Date.now(), cards: {} };
    s.cards = s.cards || {};
    s = applyRefill(s);
    tx.set(userRef(), s);
    return s;
  });
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
    imgAlt: cdUrl(s?.splashPath || s?.tilePath)
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
    while (seen.has(s.id) && guard++ < 200);
    seen.add(s.id);
    cards.push(skinCard(s.id));
  }
  return cards;
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
      tx.set(userRef(), s);
      return s;
    });

    $("result").innerHTML = drawn.map((c, i) => cardHTML(c, 0, i * 0.2)).join("");
  } catch (e) {
    alert(e.message);
  }
  render();
}

// ---------- Affichage ----------
const cardHTML = (c, qty = 0, delay = 0, locked = false) => `
  <div class="card ${c.rarity}${locked ? " locked" : ""}" style="animation-delay:${delay}s">
    <span class="badge">${RARITIES[c.rarity].label}</span>
    <img loading="lazy" referrerpolicy="no-referrer" alt="${c.name}" src="${c.img}"
         onerror="if(this.dataset.t!=='1'){this.dataset.t='1';this.src='${c.imgAlt}'}">
    <div class="info"><b>${c.name}</b><br>${c.skinName}${qty > 1 ? `<br>x${qty}` : ""}</div>
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
      <summary>${champ.name}<small>${ownedCount}/${skins.length}</small></summary>
      <div class="grid">${visible.map(s => cardHTML(skinCard(s.id), owned[s.id] || 0, 0, !owned[s.id])).join("")}</div>
    </details>`;
  }
  $("collection").innerHTML = html || "Aucun résultat.";
}

function render() {
  applyRefill(state);
  $("boosterCount").textContent = state.boosters;
  $("openBtn").disabled = state.boosters <= 0;

  const uniqueOwned = Object.keys(state.cards || {}).length;
  $("cardCount").textContent = `${uniqueOwned} / ${skinList.length} skins`;
  renderCollection();
}

function tickTimer() {
  if (!state) return;
  if (state.boosters >= MAX_BOOSTERS) { $("timer").textContent = "Stock plein"; return; }
  const left = REFILL_MS - (Date.now() - state.lastRefill);
  if (left <= 0) { render(); return; }
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  $("timer").textContent = `Prochain booster dans ${m}:${String(s).padStart(2, "0")}`;
}

setInterval(() => {
  if (!state) return;
  const before = state.boosters;
  applyRefill(state);
  if (state.boosters !== before) render();
  tickTimer();
}, 1000);

$("search").addEventListener("input", () => state && renderCollection());
$("onlyOwned").addEventListener("change", () => state && renderCollection());

// ---------- Onglets ----------
document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("active", x === b));
  $("tab-boosters").hidden = b.dataset.tab !== "boosters";
  $("tab-collection").hidden = b.dataset.tab !== "collection";
});

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
  if (!u) { state = null; return; }
  $("userName").textContent = u.displayName || "";
  try {
    if (!champions.length) await loadGameData();
    await loadState();
    render(); tickTimer();
  } catch (e) {
    console.error(e);
    alert("Erreur de chargement : " + e.message);
  }
});