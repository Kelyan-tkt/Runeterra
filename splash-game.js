import { runTransaction } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const ZOOMS = [430, 330, 260, 205, 165, 130, 100];

function hash(text) {
    let value = 2166136261;
    for (let i = 0; i < text.length; i++) {
        value ^= text.charCodeAt(i);
        value = Math.imul(value, 16777619);
    }
    return value >>> 0;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function parisSecondsToday() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Paris",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date());

    const get = type => Number(parts.find(part => part.type === type)?.value || 0);
    return get("hour") * 3600 + get("minute") * 60 + get("second");
}

export function installSplashGame({
    db,
    getUser,
    getUserRef,
    getChampions,
    getCard,
    dayKey,
    normalize,
    onChanged = () => { }
}) {
    const root = document.getElementById("splash-game");
    if (!root) return;

    root.innerHTML = `
    <h2>Splash mystère</h2>
    <p class="hint">
      Retrouve le champion à partir d’une portion agrandie de son splash art.
      La réponse attendue est le nom du champion, pas celui du skin.
    </p>

    <div id="splash-stage" class="splash-stage" role="img" aria-label="Splash art mystère"></div>

    <div class="splash-controls">
      <input
        id="splash-input"
        list="splash-champions"
        placeholder="Nom du champion…"
        autocomplete="off"
      >
      <datalist id="splash-champions"></datalist>
      <button id="splash-submit" class="btn-play small" type="button">Valider</button>
    </div>

    <p id="splash-msg" class="splash-msg"></p>
    <p id="splash-status" class="splash-status"></p>
    <div id="splash-guesses" class="splash-guesses"></div>
    <div id="splash-result" class="splash-result"></div>

    <p class="splash-rules">
      Récompense : <b>3 boosters améliorés</b> jusqu’à la 4e tentative,
      <b>2</b> jusqu’à la 7e, puis <b>1</b>.
      Une nouvelle énigme chaque jour à minuit, heure de Paris.
    </p>
  `;

    const stage = root.querySelector("#splash-stage");
    const input = root.querySelector("#splash-input");
    const datalist = root.querySelector("#splash-champions");
    const submit = root.querySelector("#splash-submit");
    const message = root.querySelector("#splash-msg");
    const status = root.querySelector("#splash-status");
    const guesses = root.querySelector("#splash-guesses");
    const result = root.querySelector("#splash-result");

    let current = null;
    let busy = false;
    let generation = 0;
    let refreshPromise = null;
    let failure = "";

    const today = () => (typeof dayKey === "function" ? dayKey() : dayKey);
    const clean = value =>
        typeof normalize === "function"
            ? normalize(value)
            : String(value ?? "").trim().toLowerCase();

    const champion = () =>
        getChampions().find(item => String(item.key) === String(current?.championKey)) || null;

    function championSplashes(item) {
        return (item?.splashIds || [])
            .map(id => getCard(id))
            .filter(card => card?.splash);
    }

    function championCard(item) {
        const splashes = championSplashes(item);
        return splashes.length ? splashes[0] : getCard(item.key * 1000);
    }

    function pickChampion(champions, key) {
        const usable = champions.filter(item => championSplashes(item).length);
        if (!usable.length) return null;
        return usable[hash(`splash-${key}`) % usable.length];
    }

    function setMessage(text) {
        message.textContent = text || "";
    }

    function render() {
        const champions = getChampions();
        const item = champion();

        datalist.innerHTML = champions
            .map(item => `<option value="${escapeHtml(item.name)}"></option>`)
            .join("");

        if (!current) {
            stage.className = "splash-stage loading";
            stage.style.backgroundImage = "";
            input.disabled = true;
            submit.disabled = true;
            setMessage(failure || (getUser() ? "Chargement du Splash mystère…" : "Connecte-toi pour participer au Splash mystère."));
            status.textContent = "";
            guesses.innerHTML = "";
            result.innerHTML = "";
            return;
        }

        const splashes = championSplashes(item);
        const card = item
            ? (splashes.length
                ? splashes[hash(`${current.championKey}-${current.day}`) % splashes.length]
                : getCard(Number(item.key) * 1000))
            : null;

        if (!item || !card?.splash) {
            stage.className = "splash-stage loading";
            stage.style.backgroundImage = "";
            input.disabled = true;
            submit.disabled = true;
            setMessage("Splash art indisponible pour aujourd’hui.");
            status.textContent = "";
            guesses.innerHTML = "";
            result.innerHTML = "";
            return;
        }

        const wrongGuesses = current.guesses.length;
        const zoom = current.solved
            ? 100
            : ZOOMS[Math.min(wrongGuesses, ZOOMS.length - 1)];

        const seed = hash(`${current.championKey}-${current.day}`);
        const positionX = 25 + (seed % 50);
        const positionY = 20 + ((seed >> 3) % 55);

        stage.className = "splash-stage";
        stage.style.backgroundImage = `url("${card.splash}")`;
        stage.style.backgroundSize = `${zoom}%`;
        stage.style.backgroundPosition = `${positionX}% ${positionY}%`;
        stage.classList.toggle("solved", current.solved);

        input.disabled = current.solved || busy;
        submit.disabled = current.solved || busy;

        guesses.innerHTML = current.guesses
            .map(name => `<span class="splash-chip">${escapeHtml(name)}</span>`)
            .join("");

        if (current.solved) {
            setMessage(`Bravo ! C’était ${item.name}.`);
            status.textContent =
                current.reward > 0
                    ? `Récompense obtenue : +${current.reward} booster${current.reward > 1 ? "s" : ""} amélioré${current.reward > 1 ? "s" : ""}.`
                    : "Énigme déjà résolue aujourd’hui.";

            result.innerHTML = `
        <img
          src="${escapeHtml(card.splash)}"
          alt="${escapeHtml(item.name)}"
          referrerpolicy="no-referrer"
        >
        <p><b>${escapeHtml(item.name)}</b></p>
      `;
            return;
        }

        const nextAttempt = wrongGuesses + 1;
        const nextReward = nextAttempt <= 4 ? 3 : nextAttempt <= 7 ? 2 : 1;

        setMessage(failure);
        status.textContent =
            `Essais : ${wrongGuesses} — bonne réponse maintenant : ` +
            `+${nextReward} booster${nextReward > 1 ? "s" : ""} amélioré${nextReward > 1 ? "s" : ""}.`;
        result.innerHTML = "";
    }

    function newGame(key) {
        const selected = pickChampion(getChampions(), key);
        if (!selected) throw new Error("Aucun splash art disponible dans le catalogue.");
        return { day: key, championKey: selected.key, guesses: [], solved: false, reward: 0 };
    }

    async function ensureState() {
        const account = getUser();
        const reference = account ? getUserRef?.() : null;
        const request = ++generation;
        busy = false;
        failure = "";
        current = null;
        render();
        if (!account || !reference || !getChampions().length) return;

        try {
            const game = await runTransaction(db, async transaction => {
                const snapshot = await transaction.get(reference);
                if (!snapshot.exists()) throw new Error("Compte introuvable.");
                const data = snapshot.data();
                const key = today();
                const saved = data.splash;
                if (saved && saved.day === key) return saved;
                const created = newGame(key);
                transaction.set(reference, { splash: created }, { merge: true });
                return created;
            });
            if (request !== generation || getUser()?.uid !== account.uid) return;
            current = { ...game, guesses: Array.isArray(game.guesses) ? game.guesses : [] };
            render();
        } catch (error) {
            if (request !== generation || getUser()?.uid !== account.uid) return;
            console.warn("Splash mystère", error);
            failure = error.message || "Impossible de charger l’énigme pour le moment.";
            render();
        }
    }

    async function submitGuess() {
        if (busy) return;
        const account = getUser();
        const reference = account ? getUserRef?.() : null;
        if (!account || !reference) {
            setMessage("Connecte-toi pour participer au Splash mystère.");
            return;
        }
        if (!current || current.day !== today()) {
            await refresh();
            setMessage("L’énigme a été actualisée. Propose ta réponse.");
            return;
        }
        if (current.solved) return;
        const guess = clean(input.value.trim());
        const guessed = getChampions().find(item => clean(item.name) === guess);
        if (!guess) return setMessage("Écris le nom d’un champion.");
        if (!guessed) return setMessage("Champion inconnu.");
        if (current.guesses.some(name => clean(name) === guess)) {
            return setMessage("Déjà proposé — essaie un autre champion.");
        }

        const request = generation;
        const expectedDay = current.day;
        busy = true;
        failure = "";
        render();
        try {
            const outcome = await runTransaction(db, async transaction => {
                const snapshot = await transaction.get(reference);
                if (!snapshot.exists()) throw new Error("Compte introuvable.");
                if (getUser()?.uid !== account.uid) throw new Error("Le compte a changé.");
                if (today() !== expectedDay) throw new Error("Nouvelle énigme disponible : actualise la page.");
                const data = snapshot.data();
                const game = data.splash?.day === expectedDay ? data.splash : newGame(expectedDay);
                game.guesses = Array.isArray(game.guesses) ? game.guesses : [];
                if (game.solved) return { game };
                if (game.guesses.some(name => clean(name) === guess)) return { game };
                const answer = getChampions().find(item => String(item.key) === String(game.championKey));
                if (!answer) throw new Error("Champion indisponible dans le catalogue.");
                game.guesses.push(guessed.name);
                if (clean(guessed.name) === clean(answer.name)) {
                    const attempts = game.guesses.length;
                    game.reward = attempts <= 4 ? 3 : attempts <= 7 ? 2 : 1;
                    game.solved = true;
                    data.bonusBoosters = (data.bonusBoosters || 0) + game.reward;
                }
                data.splash = game;
                transaction.set(reference, data);
                return { game, account: data };
            });
            if (request !== generation || getUser()?.uid !== account.uid) return;
            current = outcome.game;
            input.value = "";
            onChanged(outcome.account);
        } catch (error) {
            if (request !== generation || getUser()?.uid !== account.uid) return;
            console.warn("Splash mystère", error);
            failure = error.message || "Impossible de valider ta réponse.";
        } finally {
            if (request === generation && getUser()?.uid === account.uid) {
                busy = false;
                render();
            }
        }
    }

    function refresh() {
        return ensureState();
    }

    submit.addEventListener("click", submitGuess);

    input.addEventListener("keydown", event => {
        if (event.key === "Enter") {
            event.preventDefault();
            submitGuess();
        }
    });

    setInterval(() => {
        if (!getUser()) return;
        if (current && current.day !== today() && !busy && !refreshPromise) {
            refreshPromise = refresh().finally(() => { refreshPromise = null; });
            return;
        }
        if (!current) return;
        const remaining = 86400 - parisSecondsToday();
        const hours = String(Math.floor(remaining / 3600)).padStart(2, "0");
        const minutes = String(Math.floor((remaining % 3600) / 60)).padStart(2, "0");
        status.dataset.timer = `Nouvelle énigme dans ${hours}:${minutes}`;
    }, 30000);

    return { refresh };
}