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
  common:    { label: "Commune",    chance: 1,      color: "#8a8f98" },
  rare:      { label: "Rare",       chance: 0.941,  color: "#0397ab" },
  epic:      { label: "Épique",     chance: 0.176,  color: "#a335ee" },
  legendary: { label: "Légendaire", chance: 0.02,   color: "#ff8000" },
  mythic:    { label: "Mythique",   chance: 0.0033, color: "#e84057" }
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
    <div class="flip" data-i="${i}">
      <div class="flip-inner">
        <div class="flip-back"><span>R</span></div>
        <div class="flip-front">${cardHTML(c)}</div>
      </div>
    </div>`).join("");
  $("revealAll").hidden = false;
  $("revealClose").hidden = true;
  $("reveal").hidden = false;
  updateReveal();
}

function updateReveal() {
  if (!rv) return;
  document.querySelectorAll(".flip").forEach((el, i) => el.classList.toggle("next", i === rv.next));
  $("revealMsg").textContent = rv.next < rv.cards.length
    ? `Clique pour révéler la carte ${rv.next + 1} / ${rv.cards.length}`
    : "Booster ouvert !";
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

function rarityEffect(el, rarity) {
  const fxMap = {
    epic:      { flash: .35, shake: "shake1", particles: 14 },
    legendary: { flash: .55, shake: "shake2", particles: 32 },
    mythic:    { flash: .85, shake: "shake2", particles: 70 }
  };
  const fx = fxMap[rarity];
  if (!fx) return;
  const color = RARITIES[rarity].color;

  const f = $("flash");
  f.classList.remove("go");
  f.style.setProperty("--c", color);
  f.style.setProperty("--o", fx.flash);
  void f.offsetWidth;
  f.classList.add("go");

  const row = $("revealRow");
  row.classList.remove("shake1", "shake2");
  void row.offsetWidth;
  row.classList.add(fx.shake);
  setTimeout(() => row.classList.remove(fx.shake), 800);

  for (let i = 0; i < fx.particles; i++) {
    const p = document.createElement("span");
    p.className = "particle";
    const angle = Math.random() * Math.PI * 2;
    const dist = 90 + Math.random() * (rarity === "mythic" ? 260 : 160);
    p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
    p.style.setProperty("--p", Math.random() < .3 ? "#fff" : color);
    el.appendChild(p);
    setTimeout(() => p.remove(), 1200);
  }
}

$("reveal").addEventListener("click", e => {
  if (e.target.closest("button")) return;
  if (rv && !rv.busy) flipNext();
});
$("revealAll").onclick = flipAll;
$("revealClose").onclick = closeReveal;

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
  $("openBtn").disabled = state.boosters <= 0 || !!rv;

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
  if (state.boosters !== before) {
    $("boosterCount").textContent = state.boosters;
    $("openBtn").disabled = state.boosters <= 0 || !!rv;
  }
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
  if (!u) { state = null; $("reveal").hidden = true; rv = null; return; }
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