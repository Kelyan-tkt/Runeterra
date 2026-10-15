const $ = id => document.getElementById(id);
const chest = $("chest");
const openBtn = $("openBtn");
const chestImg = $("chestImg");

const BASE = "https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/hextech-images";
const FALLBACKS = [`${BASE}/chest.png`, `${BASE}/chest_champion_mastery.png`];
let fb = 0;
chestImg.onerror = () => {
  if (fb < FALLBACKS.length) chestImg.src = FALLBACKS[fb++];
  else chestImg.style.display = "none";
};

function sync() {
  const opening = chest.classList.contains("opening");
  chest.classList.toggle("empty", openBtn.disabled && !opening);
  $("chestCount").textContent = "x" + $("boosterCount").textContent;
}

new MutationObserver(sync).observe($("boosterCount"), { childList: true, characterData: true, subtree: true });
setInterval(sync, 300);

openBtn.addEventListener("click", () => {
  chest.classList.add("opening");
  setTimeout(() => { chest.classList.remove("opening"); sync(); }, 1000);
});

chest.addEventListener("click", () => { if (!openBtn.disabled) openBtn.click(); });
chest.addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && !openBtn.disabled) { e.preventDefault(); openBtn.click(); }
});