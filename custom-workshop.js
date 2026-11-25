// custom-workshop.js
const ALLOWED_RARITIES = new Set(["kDefault", "kRare", "kEpic", "kLegendary", "kMythic"]);
const RARITY_LABELS = {
  kDefault: "Commune",
  kRare: "Rare",
  kEpic: "Épique",
  kLegendary: "Légendaire",
  kMythic: "Mythique"
};

function escHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isValidHttpsUrl(url) {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith("https://") || trimmed.length > 1000) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function compressImageFile(file, maxWidth, maxHeight, quality = 0.82) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      reject(new Error("Le fichier sélectionné n'est pas une image."));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Impossible de lire le fichier image."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Image corrompue ou format non pris en charge."));
      img.onload = () => {
        let { width, height } = img;
        const ratio = Math.min(maxWidth / width, maxHeight / height, 1);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        let dataUrl = canvas.toDataURL("image/webp", quality);
        if (!dataUrl.startsWith("data:image/webp")) {
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }
        if (dataUrl.length > 350000) {
          dataUrl = canvas.toDataURL("image/jpeg", 0.65);
        }
        if (dataUrl.length > 420000) {
          reject(new Error("L'image est trop lourde même après compression. Choisis une image plus légère."));
          return;
        }
        resolve(dataUrl);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

export class CustomCardWorkshop {
  constructor(deps) {
    this.deps = deps;
    this.portraitData = "";
    this.splashData = "";
    this.approvedList = [];
    this.pendingList = [];
    this.myProposals = [];
  }

  init() {
    this.populateChampions();
    this.bindFormEvents();
  }

  isAdmin() {
    return Boolean(this.deps.getState()?.isAdmin === true);
  }

  populateChampions() {
    const select = document.getElementById("wsChampionSelect");
    if (!select) return;
    const champs = [...(this.deps.getChampions() || [])].sort((a, b) =>
      String(a.name).localeCompare(String(b.name), "fr")
    );
    select.innerHTML = `<option value="">— Choisir un champion —</option>` +
      champs.map(c => `<option value="${escHtml(c.id)}" data-key="${escHtml(c.key)}">${escHtml(c.name)}</option>`).join("");
  }

  async loadApprovedSkinsIntoCatalog() {
    const db = this.deps.getDb?.();
    if (!db) return [];
    const { collection, getDocs, query, where } = this.deps.fs;
    try {
      const q = query(collection(db, "customSkinProposals"), where("status", "==", "approved"));
      const snap = await getDocs(q);
      const approved = [];
      snap.forEach(d => approved.push({ docId: d.id, ...d.data() }));
      approved.sort((a, b) => Number(a.skinId || 0) - Number(b.skinId || 0));
      this.approvedList = approved;

      const champions = this.deps.getChampions() || [];
      const skinsById = this.deps.getSkinsById() || {};
      const installed = [];

      for (const item of approved) {
        const champ = champions.find(c => c.id === item.championId);
        const skinId = Number(item.skinId);
        if (!champ || !Number.isSafeInteger(skinId) || skinId <= 0 || skinId >= 1000000) continue;
        if (skinsById[skinId] && skinsById[skinId].customSkinKey !== `community:${item.docId}`) continue;

        const skin = {
          id: skinId,
          name: String(item.title || "Skin personnalisé"),
          isBase: false,
          rarity: ALLOWED_RARITIES.has(item.rarity) ? item.rarity : "kRare",
          customSkinKey: `community:${item.docId}`,
          customAuthor: item.authorName || "Joueur",
          customPortrait: item.portrait,
          customSplash: item.splash,
          loadScreenPath: item.portrait,
          splashPath: item.splash,
          uncenteredSplashPath: item.splash,
          tilePath: item.portrait
        };
        skinsById[skinId] = skin;
        installed.push(skin);
      }

      if (installed.length && typeof this.deps.registerApprovedSkins === "function") {
        this.deps.registerApprovedSkins(installed);
      }
      return installed;
    } catch (err) {
      console.warn("Chargement des cartes communautaires :", err);
      return [];
    }
  }

  async refreshWorkshopLists() {
    const user = this.deps.getUser();
    const db = this.deps.getDb?.();
    if (!user || !db) return;
    const { collection, getDocs, query, where } = this.deps.fs;

    const adminBadge = document.getElementById("wsAdminBadge");
    const adminSection = document.getElementById("wsAdminSection");
    const isAdmin = this.isAdmin();

    if (adminBadge) adminBadge.hidden = !isAdmin;
    if (adminSection) adminSection.hidden = !isAdmin;

    try {
      const myQ = query(collection(db, "customSkinProposals"), where("authorUid", "==", user.uid));
      const mySnap = await getDocs(myQ);
      this.myProposals = [];
      mySnap.forEach(d => this.myProposals.push({ docId: d.id, ...d.data() }));
      this.myProposals.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      this.renderMyProposals();

      if (isAdmin) {
        const pendQ = query(collection(db, "customSkinProposals"), where("status", "==", "pending"));
        const pendSnap = await getDocs(pendQ);
        this.pendingList = [];
        pendSnap.forEach(d => this.pendingList.push({ docId: d.id, ...d.data() }));
        this.pendingList.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
        this.renderAdminPending();
      }
    } catch (err) {
      console.warn("Erreur lecture propositions :", err);
    }
  }

  bindFormEvents() {
    const champSel = document.getElementById("wsChampionSelect");
    const titleInp = document.getElementById("wsTitleInput");
    const raritySel = document.getElementById("wsRaritySelect");

    document.querySelectorAll("[data-ws-source-toggle]").forEach(btn => {
      btn.addEventListener("click", () => {
        const target = btn.dataset.wsSourceToggle;
        const mode = btn.dataset.mode;
        document.querySelectorAll(`[data-ws-source-toggle="${target}"]`).forEach(b =>
          b.classList.toggle("active", b === btn)
        );
        const fileBox = document.getElementById(`ws-${target}-file-box`);
        const urlBox = document.getElementById(`ws-${target}-url-box`);
        if (fileBox) fileBox.hidden = mode !== "file";
        if (urlBox) urlBox.hidden = mode !== "url";
      });
    });

    document.getElementById("wsPortraitFile")?.addEventListener("change", async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        this.portraitData = await compressImageFile(file, 340, 600, 0.84);
        this.updateLivePreview();
      } catch (err) {
        alert(err.message);
        e.target.value = "";
      }
    });

    document.getElementById("wsPortraitUrl")?.addEventListener("input", e => {
      const val = e.target.value.trim();
      this.portraitData = isValidHttpsUrl(val) ? val : "";
      this.updateLivePreview();
    });

    document.getElementById("wsSplashFile")?.addEventListener("change", async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        this.splashData = await compressImageFile(file, 960, 540, 0.82);
        this.updateLivePreview();
      } catch (err) {
        alert(err.message);
        e.target.value = "";
      }
    });

    document.getElementById("wsSplashUrl")?.addEventListener("input", e => {
      const val = e.target.value.trim();
      this.splashData = isValidHttpsUrl(val) ? val : "";
      this.updateLivePreview();
    });

    champSel?.addEventListener("change", () => this.updateLivePreview());
    titleInp?.addEventListener("input", () => this.updateLivePreview());
    raritySel?.addEventListener("change", () => this.updateLivePreview());

    document.getElementById("wsProposalForm")?.addEventListener("submit", async e => {
      e.preventDefault();
      await this.submitProposal();
    });
  }

  updateLivePreview() {
    const champSel = document.getElementById("wsChampionSelect");
    const champName = champSel?.selectedOptions?.[0]?.textContent || "Champion";
    const title = document.getElementById("wsTitleInput")?.value.trim() || "Titre du skin";
    const rarity = document.getElementById("wsRaritySelect")?.value || "kRare";

    const prevCard = document.getElementById("wsPreviewCard");
    const prevSplash = document.getElementById("wsPreviewSplash");
    const prevTitle = document.getElementById("wsPreviewTitle");
    const prevMeta = document.getElementById("wsPreviewMeta");

    if (prevTitle) prevTitle.textContent = title;
    if (prevMeta) prevMeta.textContent = `${champName} • ${RARITY_LABELS[rarity] || "Rare"}`;

    if (prevCard) {
      prevCard.innerHTML = this.portraitData
        ? `<img src="${escHtml(this.portraitData)}" alt="Aperçu carte">`
        : `<span>Aperçu carte (portrait)</span>`;
    }
    if (prevSplash) {
      prevSplash.innerHTML = this.splashData
        ? `<img src="${escHtml(this.splashData)}" alt="Aperçu splash art">`
        : `<span>Aperçu Splash Art</span>`;
    }
  }

  async submitProposal() {
    const user = this.deps.getUser();
    const state = this.deps.getState();
    const db = this.deps.getDb?.();
    const statusEl = document.getElementById("wsFormStatus");

    if (!user || !state || !db) return;
    const { collection, addDoc, serverTimestamp } = this.deps.fs;

    const champSel = document.getElementById("wsChampionSelect");
    const championId = champSel?.value || "";
    const championKey = Number(champSel?.selectedOptions?.[0]?.dataset.key || 0);
    const championName = champSel?.selectedOptions?.[0]?.textContent || "";
    const title = document.getElementById("wsTitleInput")?.value.trim() || "";
    const rarity = document.getElementById("wsRaritySelect")?.value || "";

    if (!championId || !championKey) {
      if (statusEl) statusEl.textContent = "Choisis un champion.";
      return;
    }
    if (title.length < 2 || title.length > 50) {
      if (statusEl) statusEl.textContent = "Le titre doit contenir entre 2 et 50 caractères.";
      return;
    }
    if (!ALLOWED_RARITIES.has(rarity)) {
      if (statusEl) statusEl.textContent = "Rareté invalide.";
      return;
    }
    if (!this.portraitData || !this.splashData) {
      if (statusEl) statusEl.textContent = "Ajoute les 2 images (carte portrait ET splash art).";
      return;
    }

    const submitBtn = document.getElementById("wsSubmitBtn");
    if (submitBtn) submitBtn.disabled = true;
    if (statusEl) statusEl.textContent = "Envoi de la proposition...";

    try {
      await addDoc(collection(db, "customSkinProposals"), {
        authorUid: user.uid,
        authorName: state.username || user.displayName || "Invocateur",
        championId,
        championKey,
        championName,
        title,
        rarity,
        portrait: this.portraitData,
        splash: this.splashData,
        status: "pending",
        createdAt: serverTimestamp()
      });

      document.getElementById("wsProposalForm")?.reset();
      this.portraitData = "";
      this.splashData = "";
      this.updateLivePreview();
      if (statusEl) statusEl.textContent = "✅ Proposition envoyée ! Un administrateur va l'examiner.";
      await this.refreshWorkshopLists();
    } catch (err) {
      console.error(err);
      if (statusEl) statusEl.textContent = "❌ Erreur lors de l'envoi : " + err.message;
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  allocateNextSlot(championKey) {
    const skinsById = this.deps.getSkinsById() || {};
    for (let slot = 998; slot >= 700; slot--) {
      const candidateId = championKey * 1000 + slot;
      if (candidateId < 1000000 && !skinsById[candidateId]) {
        return { slot, skinId: candidateId };
      }
    }
    return null;
  }

  async approveProposal(docId) {
    if (!this.isAdmin()) return;
    const item = this.pendingList.find(p => p.docId === docId);
    if (!item) return;

    const champKey = Number(item.championKey);
    const allocated = this.allocateNextSlot(champKey);
    if (!allocated) {
      alert("Plus aucun emplacement disponible pour ce champion.");
      return;
    }

    try {
      const { doc, updateDoc, serverTimestamp } = this.deps.fs;
      await updateDoc(doc(this.deps.getDb(), "customSkinProposals", docId), {
        status: "approved",
        slot: allocated.slot,
        skinId: allocated.skinId,
        reviewedBy: this.deps.getUser().uid,
        reviewedAt: serverTimestamp()
      });

      await this.loadApprovedSkinsIntoCatalog();
      await this.refreshWorkshopLists();
      this.deps.refreshAllUI?.();
    } catch (err) {
      alert("Erreur lors de la validation : " + err.message);
    }
  }

  async rejectProposal(docId) {
    if (!this.isAdmin()) return;
    try {
      const { doc, updateDoc, serverTimestamp } = this.deps.fs;
      await updateDoc(doc(this.deps.getDb(), "customSkinProposals", docId), {
        status: "rejected",
        reviewedBy: this.deps.getUser().uid,
        reviewedAt: serverTimestamp()
      });
      await this.refreshWorkshopLists();
    } catch (err) {
      alert("Erreur lors du refus : " + err.message);
    }
  }

  renderAdminPending() {
    const listEl = document.getElementById("wsAdminPendingList");
    if (!listEl) return;

    if (!this.pendingList.length) {
      listEl.innerHTML = `<p class="hint">Aucune proposition en attente de validation.</p>`;
      return;
    }

    listEl.innerHTML = this.pendingList.map(item => `
      <article class="ws-proposal-card">
        <div class="ws-proposal-media">
          <img class="ws-thumb-portrait" src="${escHtml(item.portrait)}" alt="Portrait">
          <img class="ws-thumb-splash" src="${escHtml(item.splash)}" alt="Splash">
        </div>
        <div class="ws-proposal-info">
          <h4>${escHtml(item.title)}</h4>
          <p><strong>Champion :</strong> ${escHtml(item.championName)} • <strong>Rareté :</strong> ${escHtml(RARITY_LABELS[item.rarity] || item.rarity)}</p>
          <p class="hint">Proposé par <strong>${escHtml(item.authorName)}</strong></p>
          <div class="ws-proposal-actions">
            <button type="button" class="btn-play small" data-ws-approve="${escHtml(item.docId)}">✅ Valider et publier</button>
            <button type="button" class="btn" data-ws-reject="${escHtml(item.docId)}">❌ Refuser</button>
          </div>
        </div>
      </article>
    `).join("");

    listEl.querySelectorAll("[data-ws-approve]").forEach(btn => {
      btn.addEventListener("click", () => {
        btn.disabled = true;
        this.approveProposal(btn.dataset.wsApprove);
      });
    });
    listEl.querySelectorAll("[data-ws-reject]").forEach(btn => {
      btn.addEventListener("click", () => {
        btn.disabled = true;
        this.rejectProposal(btn.dataset.wsReject);
      });
    });
  }

  renderMyProposals() {
    const listEl = document.getElementById("wsMyProposalsList");
    if (!listEl) return;

    if (!this.myProposals.length) {
      listEl.innerHTML = `<p class="hint">Tu n'as encore proposé aucune carte.</p>`;
      return;
    }

    const badgeMap = {
      pending: `<span class="ws-status pending">⏳ En attente</span>`,
      approved: `<span class="ws-status approved">✅ Validée (en jeu !)</span>`,
      rejected: `<span class="ws-status rejected">❌ Refusée</span>`
    };

    listEl.innerHTML = this.myProposals.map(item => `
      <div class="ws-my-item">
        <img src="${escHtml(item.portrait)}" alt="">
        <div>
          <strong>${escHtml(item.title)}</strong> (${escHtml(item.championName)} — ${escHtml(RARITY_LABELS[item.rarity] || item.rarity)})
          <div>${badgeMap[item.status] || ""}</div>
        </div>
      </div>
    `).join("");
  }
}