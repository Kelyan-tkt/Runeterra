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
const CDN = "https://ddragon.leagueoflegends.com";

let user = null, state = null, champions = [], version = "", skinCache = {};
const $ = id => document.getElementById(id);

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
    s = applyRefill(s);
    tx.set(userRef(), s);
    return s;
  });
}

// ---------- Données Riot ----------
async function loadChampions() {
  version = (await (await fetch(`${CDN}/api/versions.json`)).json())[0];
  const d = await (await fetch(`${CDN}/cdn/${version}/data/fr_FR/champion.json`)).json();
  champions = Object.values(d.data);
}

async function getSkins(id) {
  if (!skinCache[id]) {
    const d = await (await fetch(`${CDN}/cdn/${version}/data/fr_FR/champion/${id}.json`)).json();
    skinCache[id] = d.data[id].skins;
  }
  return skinCache[id];
}

async function drawCard() {
  const champ = champions[Math.floor(Math.random() * champions.length)];
  const skins = await getSkins(champ.id);
  const skin = skins[Math.floor(Math.random() * skins.length)];
  return { champ: champ.id, name: champ.name, num: skin.num,
           skinName: skin.num === 0 ? "Classique" : skin.name };
}

// ---------- Ouverture ----------
async function openBooster() {
  $("openBtn").disabled = true;
  try {
    const drawn = [];
    for (let i = 0; i < CARDS_PER_BOOSTER; i++) drawn.push(await drawCard());

    state = await runTransaction(db, async tx => {
      const snap = await tx.get(userRef());
      let s = applyRefill(snap.data());
      if (s.boosters <= 0) throw new Error("Aucun booster disponible");
      if (s.boosters === MAX_BOOSTERS) s.lastRefill = Date.now();
      s.boosters -= 1;
      s.cards = s.cards || {};
      drawn.forEach(c => {
        const k = `${c.champ}_${c.num}`;
        s.cards[k] = (s.cards[k] || 0) + 1;
      });
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
const cardHTML = (c, qty = 0, delay = 0) => `
  <div class="card" style="animation-delay:${delay}s">
    <img loading="lazy" src="${CDN}/cdn/img/champion/loading/${c.champ}_${c.num}.jpg" alt="${c.name}">
    <div class="info"><b>${c.name}</b><br>${c.skinName}${qty > 1 ? `<br>x${qty}` : ""}</div>
  </div>`;

function render() {
  applyRefill(state);
  $("boosterCount").textContent = state.boosters;
  $("openBtn").disabled = state.boosters <= 0;

  const entries = Object.entries(state.cards || {});
  $("cardCount").textContent = entries.reduce((a, [, q]) => a + q, 0);
  $("collection").innerHTML = entries.map(([k, qty]) => {
    const [champ, num] = k.split("_");
    const ch = champions.find(c => c.id === champ);
    return cardHTML({ champ, num, name: ch?.name || champ,
      skinName: num === "0" ? "Classique" : `Skin ${num}` }, qty);
  }).join("") || "Collection vide.";
}

function tickTimer() {
  if (!state) return;
  if (state.boosters >= MAX_BOOSTERS) { $("timer").textContent = "Stock plein"; return; }
  const left = REFILL_MS - (Date.now() - state.lastRefill);
  if (left <= 0) { render(); return; }
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  $("timer").textContent = `Prochain booster dans ${m}:${String(s).padStart(2, "0")}`;
}
setInterval(() => { if (state) { const before = state.boosters; applyRefill(state); if (state.boosters !== before) render(); tickTimer(); } }, 1000);

// ---------- Onglets + Auth ----------
document.querySelectorAll("nav button").forEach(b => b.onclick = () => {
  document.querySelectorAll("nav button").forEach(x => x.classList.toggle("active", x === b));
  $("tab-boosters").hidden = b.dataset.tab !== "boosters";
  $("tab-collection").hidden = b.dataset.tab !== "collection";
});

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
  $("userName").textContent = u.displayName;
  if (!champions.length) await loadChampions();
  await loadState();
  render(); tickTimer();
});