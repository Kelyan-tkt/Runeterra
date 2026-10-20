import {
    doc, collection, query, where, getDoc, getDocs, runTransaction
} from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

const ROLES = ["Top", "Jungle", "Mid", "ADC", "Support"];

// Liste volontairement limitée pour ce prototype.
// Ces affectations sont des choix d'équilibrage du jeu,
// pas une liste officielle exhaustive des positions.
const ROLE_CHAMPS = {
    Top: [
        "Garen", "Darius", "Fiora", "Camille", "Ornn",
        "Malphite", "Sett", "Shen", "Renekton", "Aatrox",
        "Jax", "Gwen", "Teemo", "Nasus", "Riven"
    ],
    Jungle: [
        "Warwick", "Vi", "LeeSin", "MasterYi", "Amumu",
        "Sejuani", "Volibear", "Khazix", "Rengar",
        "Evelynn", "Nocturne", "Nunu", "Hecarim", "Udyr"
    ],
    Mid: [
        "Ahri", "Lux", "Annie", "Viktor", "Syndra",
        "Orianna", "Zed", "Yasuo", "Yone", "Veigar",
        "Katarina", "Akali", "Azir", "Vex", "Malzahar"
    ],
    ADC: [
        "Ashe", "Caitlyn", "Jinx", "Ezreal", "MissFortune",
        "Jhin", "Lucian", "Vayne", "Kaisa", "Tristana",
        "Xayah", "Sivir", "Varus", "Draven", "Aphelios"
    ],
    Support: [
        "Braum", "Leona", "Nautilus", "Thresh", "Lulu",
        "Soraka", "Sona", "Nami", "Janna", "Yuumi",
        "Rakan", "Milio", "Renata", "Blitzcrank", "Karma"
    ]
};

const RANKS = [
    ["Fer", 0, 1, 0],
    ["Bronze", 100, 2, 0],
    ["Argent", 250, 3, 0],
    ["Or", 450, 4, 1],
    ["Platine", 700, 5, 1],
    ["Émeraude", 1000, 6, 2],
    ["Diamant", 1400, 8, 2],
    ["Maître", 1900, 10, 3],
    ["Grand Maître", 2500, 12, 4],
    ["Challenger", 3200, 15, 5]
];

const MULT = {
    common: 1,
    rare: 1.03,
    epic: 1.06,
    legendary: 1.09,
    mythic: 1.12
};

const LANE = [0, 1, 1, 2, 2];
const LANE_NAMES = ["Top", "Mid", "Bot"];

const html = s => String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
}[c]));

const rankOf = points => {
    let n = 0;
    RANKS.forEach((r, i) => {
        if (points >= r[1]) n = i;
    });
    return n;
};

const fresh = week => ({
    week,
    points: 0,
    best: 0,
    wins: 0,
    losses: 0,
    games: 0,
    team: []
});

export function initRanked(api) {
    const root = document.getElementById("rankedRoot");
    if (!root) throw new Error("Il manque rankedRoot dans index.html.");

    let account = null;
    let saved = null;
    let draft = [];
    let match = null;
    let busy = false;
    let message = "";
    let search = "";
    let loadNumber = 0;

    const uid = () => api.user()?.uid;
    const privateRef = id => doc(api.db, "users", id);
    const publicRef = id => doc(api.db, "rankedPlayers", id);

    const champFor = skinId =>
        api.champions().find(c => Number(c.key) === Math.floor(Number(skinId) / 1000));

    function normalizeTeam(team = [], cards = null) {
        const seen = new Set();

        return ROLES.map((role, i) => {
            const id = Number(team[i]) || 0;
            const champ = champFor(id);

            if (!champ || !ROLE_CHAMPS[role].includes(champ.id)) return 0;
            if (cards && !(cards[id] > 0)) return 0;
            if (seen.has(champ.id)) return 0;

            seen.add(champ.id);
            return id;
        });
    }

    function publicData(r, name, cards) {
        const team = normalizeTeam(r.team, cards);

        return {
            week: r.week,
            rank: rankOf(r.points),
            points: r.points,
            name: name || "Joueur",
            team,
            ready: team.every(Boolean),
            updatedAt: Date.now()
        };
    }

    // Retour à zéro de la semaine, avec versement unique de l'ancienne récompense.
    function ensureWeek(s, week) {
        let r = s.ranked;

        if (!r || r.week !== week) {
            let reward = null;

            if (r && r.games > 0) {
                const index = rankOf(r.best || 0);
                const [, , normal, bonus] = RANKS[index];

                s.boosters = (s.boosters || 0) + normal;
                s.bonusBoosters = (s.bonusBoosters || 0) + bonus;

                reward = {
                    week: r.week,
                    rank: RANKS[index][0],
                    normal,
                    bonus
                };
            }

            r = {
                ...fresh(week),
                team: Array.isArray(r?.team) ? r.team : [],
                lastReward: reward || r?.lastReward || null
            };

            s.ranked = r;
        }

        return r;
    }

    async function updateAccount(change = () => { }) {
        const user = api.user();
        if (!user) throw new Error("Connecte-toi d'abord.");

        const week = api.week();

        const result = await runTransaction(api.db, async tx => {
            const ref = privateRef(user.uid);
            const snap = await tx.get(ref);

            if (!snap.exists()) throw new Error("Compte introuvable.");

            const s = snap.data();
            const r = ensureWeek(s, week);

            change(r, s);

            tx.update(ref, {
                ranked: r,
                boosters: s.boosters || 0,
                bonusBoosters: s.bonusBoosters || 0
            });

            tx.set(
                publicRef(user.uid),
                publicData(r, user.displayName, s.cards || {})
            );

            return s;
        });

        if (uid() !== user.uid) throw new Error("Le compte a changé.");

        account = result;
        saved = result.ranked;
        return result;
    }

    async function open() {
        const number = ++loadNumber;
        match = null;
        message = "";
        busy = true;

        root.innerHTML = "<p>Chargement du mode classé…</p>";

        try {
            await updateAccount();

            if (number !== loadNumber) return;

            draft = normalizeTeam(saved.team, account.cards || {});
            search = "";
        } catch (e) {
            if (number !== loadNumber) return;
            message = e.message;
        } finally {
            if (number === loadNumber) {
                busy = false;
                render();
            }
        }
    }

    function picker(role, index) {
        const q = search.trim().toLocaleLowerCase("fr");

        const list = Object.keys(account.cards || {})
            .filter(id => account.cards[id] > 0)
            .map(Number)
            .filter(id => {
                const c = champFor(id);
                if (!c || !ROLE_CHAMPS[role].includes(c.id)) return false;

                const skin = api.card(id);
                return !q || `${skin.name} ${skin.skinName}`
                    .toLocaleLowerCase("fr").includes(q);
            })
            .sort((a, b) => {
                const ca = api.card(a), cb = api.card(b);
                return ca.name.localeCompare(cb.name, "fr");
            });

        // On garde visible la sélection même si la recherche ne la contient pas.
        if (draft[index] && !list.includes(draft[index])) {
            list.unshift(draft[index]);
        }

        return `
      <label class="rk-pick">
        <span>${role}</span>
        <select data-role="${index}">
          <option value="0">Choisir un champion</option>
          ${list.map(id => {
            const c = api.card(id);
            return `<option value="${id}" ${draft[index] === id ? "selected" : ""}>
              ${html(c.name)} — ${html(c.skinName)}
            </option>`;
        }).join("")}
        </select>
        <small>${list.length} carte(s) disponible(s)</small>
      </label>`;
    }

    function render() {
        if (match) {
            renderBattle();
            return;
        }

        if (!saved || !account) {
            root.innerHTML = `<p>${html(message || "Mode indisponible.")}</p>
        <button data-do="reload" class="btn">Réessayer</button>`;
            return;
        }

        const index = rankOf(saved.points);
        const reward = saved.lastReward;

        root.innerHTML = `
      <div class="rk-heading">
        <h2>Arène classée</h2>
        <span class="rk-rank">${RANKS[index][0]} · ${saved.points} points</span>
      </div>

      <p>
        ${saved.wins} victoire(s) · ${saved.losses} défaite(s)
        · Meilleur rang : ${RANKS[rankOf(saved.best)][0]}
      </p>

      <p class="hint">
        Saison hebdomadaire · Reset lundi à 00 h, heure de Paris.
        Victoire : +30 points · Défaite : −15 points.
      </p>

      ${reward ? `<p class="rk-notice">
        Dernière récompense : ${html(reward.rank)}
        · ${reward.normal} boosters
        · ${reward.bonus} boosters bonus.
      </p>` : ""}

      <h3>Ton équipe</h3>

      <input id="rkSearch" type="search"
        placeholder="Filtrer les champions et les skins…"
        value="${html(search)}">

      <div class="rk-picks">
        ${ROLES.map(picker).join("")}
      </div>

      <p class="hint">
        Un champion différent par rôle.
        Seuls les champions de la liste du prototype sont disponibles.
        Une carte unique peut être utilisée : elle n'est pas consommée.
      </p>

      <div class="rk-buttons">
        <button data-do="save" class="btn"
          ${busy ? "disabled" : ""}>Enregistrer l'équipe</button>
        <button data-do="play" class="btn-play"
          ${busy ? "disabled" : ""}>Chercher un adversaire</button>
        <button data-do="train" class="btn"
          ${busy ? "disabled" : ""}>Entraînement</button>
      </div>

      <p role="status">${html(message)}</p>

      <details>
        <summary>Récompenses hebdomadaires</summary>
        <p>Au moins un match classé dans la semaine pour être récompensé.</p>
        <ul>
          ${RANKS.map(([name, points, normal, bonus]) => `
            <li>${name} : ${points} points
              → ${normal} boosters + ${bonus} bonus</li>
          `).join("")}
        </ul>
      </details>
    `;
    }

    async function saveTeam() {
        const team = [...draft];

        await updateAccount((r, s) => {
            const valid = normalizeTeam(team, s.cards || {});

            if (!valid.every(Boolean)) {
                throw new Error("Il faut cinq champions valides, différents et possédés.");
            }

            r.team = valid;
        });
    }

    function trainingTeam() {
        return ROLES.map(role => {
            const list = api.champions()
                .filter(c => ROLE_CHAMPS[role].includes(c.id));
            const c = list[Math.floor(Math.random() * list.length)];

            if (!c) throw new Error(`Aucun champion pour ${role}.`);
            return Number(c.key) * 1000;
        });
    }

    function createUnit(id, role) {
        const card = api.card(id);
        const champ = champFor(id);
        const m = MULT[card.rarity] || 1;

        // Stats inventées et simplifiées pour ce mini-jeu.
        const hp = Math.round((role === "Top" ? 340 : role === "Support" ? 250 : 280) * m);
        const attack = Math.round((role === "ADC" ? 52 : role === "Support" ? 32 : 43) * m);

        return {
            id, role, name: champ.name, img: card.img,
            hp, max: hp, attack,
            cooldown: 0, shield: false, used: false
        };
    }

    async function findMatch(training) {
        await saveTeam();

        const user = api.user();
        const week = saved.week;
        let opponent = null;

        if (!training) {
            const snap = await getDocs(query(
                collection(api.db, "rankedPlayers"),
                where("week", "==", week),
                where("rank", "==", rankOf(saved.points)),
                where("ready", "==", true)
            ));

            const players = snap.docs
                .filter(d => d.id !== user.uid)
                .map(d => ({ ...d.data(), uid: d.id }))
                .filter(p => normalizeTeam(p.team).every(Boolean));

            opponent = players[Math.floor(Math.random() * players.length)];

            if (!opponent) {
                message = "Aucun joueur du même rang disponible. Essaie l'entraînement.";
                return;
            }
        }

        match = {
            user: user.uid,
            week,
            opponent: opponent?.uid || null,
            name: opponent?.name || "Équipe d'entraînement",
            training,
            round: 1,
            allies: saved.team.map((id, i) => createUnit(id, ROLES[i])),
            enemies: (opponent?.team || trainingTeam())
                .map((id, i) => createUnit(id, ROLES[i])),
            towers: [[220, 220, 220], [220, 220, 220]],
            nexus: [350, 350],
            log: ["Donne un ordre à chaque champion vivant."],
            effects: [],
            ending: false,
            ended: false
        };
    }

    function chooseTarget(units, index, role) {
        const alive = units
            .map((u, i) => ({ u, i }))
            .filter(x => x.u.hp > 0);

        // Le Jungler peut intervenir sur toutes les voies.
        const candidates = role === "Jungle"
            ? alive
            : alive.filter(x => LANE[x.i] === LANE[index]);

        return candidates
            .sort((a, b) => a.u.hp - b.u.hp)[0]?.u;
    }

    function execute(side, index, action) {
        const m = match;
        const own = side === 0 ? m.allies : m.enemies;
        const foes = side === 0 ? m.enemies : m.allies;
        const u = own[index];

        if (!u || u.hp <= 0) return;

        const enemySide = 1 - side;
        const lane = LANE[index];

        const livingOnLane = () =>
            foes.filter((x, i) => x.hp > 0 && LANE[i] === lane);

        function hitUnit(target, amount) {
            const damage = Math.round(
                amount * (target.shield ? 0.45 : 1)
            );

            target.hp = Math.max(0, target.hp - damage);

            m.log.push(
                `${u.name} inflige ${damage} dégâts à ${target.name}.`
            );

            if (target.hp === 0) {
                m.log.push(`${target.name} est vaincu !`);
            }
        }

        function hitBuilding(amount) {
            const damage = Math.max(1, Math.round(amount));

            if (m.towers[enemySide][lane] > 0) {
                const before = m.towers[enemySide][lane];

                m.towers[enemySide][lane] = Math.max(
                    0,
                    before - damage
                );

                m.log.push(
                    `${u.name} inflige ${Math.min(before, damage)} dégâts ` +
                    `à la tourelle ${LANE_NAMES[lane]}.`
                );

                if (m.towers[enemySide][lane] === 0) {
                    m.log.push(
                        `Tourelle ${LANE_NAMES[lane]} détruite ! ` +
                        `Le Nexus est accessible depuis cette voie.`
                    );
                }

                return;
            }

            const before = m.nexus[enemySide];

            m.nexus[enemySide] = Math.max(
                0,
                before - damage
            );

            m.log.push(
                `${u.name} inflige ${Math.min(before, damage)} dégâts au Nexus !`
            );
        }

        // Défense : réduction des dégâts jusqu'à la fin de la manche.
        if (action === "guard") {
            u.shield = true;

            const heal = Math.min(30, u.max - u.hp);
            u.hp += heal;

            m.log.push(
                `${u.name} défend : +${heal} PV et réduction des dégâts de 55 %.`
            );

            return;
        }

        // Siège : frappe toujours un bâtiment.
        // Des défenseurs vivants réduisent les dégâts.
        if (action === "siege") {
            const defended = livingOnLane().length > 0;

            let damage = u.attack * (defended ? 0.55 : 1.4);

            // Le tireur est spécialisé dans les dégâts aux bâtiments.
            if (u.role === "ADC") damage *= 1.25;

            hitBuilding(damage);

            if (defended) {
                m.log.push(
                    `Siège contesté : les défenseurs réduisent les dégâts.`
                );
            }

            return;
        }

        if (action === "skill") {
            if (u.cooldown > 0) return;

            u.cooldown = 4;

            // Support : soin de tous les alliés vivants.
            if (u.role === "Support") {
                let total = 0;

                own.filter(x => x.hp > 0).forEach(x => {
                    const heal = Math.min(55, x.max - x.hp);
                    x.hp += heal;
                    total += heal;
                });

                m.log.push(
                    `${u.name} soigne son équipe : ${total} PV rendus.`
                );

                return;
            }

            // Mid : attaque de zone sur la voie du milieu.
            if (u.role === "Mid") {
                const targets = livingOnLane();

                if (targets.length) {
                    targets.forEach(target => {
                        hitUnit(target, u.attack * 1.6);
                    });
                } else {
                    hitBuilding(u.attack * 1.6);
                }

                return;
            }

            // Top : attaque renforcée + protection.
            if (u.role === "Top") {
                u.shield = true;

                const target = chooseTarget(foes, index, u.role);

                if (target) hitUnit(target, u.attack * 1.8);
                else hitBuilding(u.attack * 1.8);

                m.log.push(`${u.name} se protège après son assaut.`);
                return;
            }

            // Jungle : frappe l'ennemi le plus faible, toutes voies confondues.
            if (u.role === "Jungle") {
                const target = chooseTarget(foes, index, u.role);

                if (target) hitUnit(target, u.attack * 2.2);
                else hitBuilding(u.attack * 1.8);

                return;
            }

            // ADC : tir puissant contre un champion ou un bâtiment.
            if (u.role === "ADC") {
                const target = chooseTarget(foes, index, u.role);

                if (target) hitUnit(target, u.attack * 2);
                else hitBuilding(u.attack * 2.5);

                return;
            }
        }

        // Attaque normale :
        // frappe un champion de la voie ou, si elle est libre, le bâtiment.
        const target = chooseTarget(foes, index, u.role);

        if (target) {
            hitUnit(target, u.attack);
        } else {
            hitBuilding(u.attack * 1.2);
        }
    }

    function enemyAction(unit, index) {
        const m = match;

        const defenders = m.allies.filter(
            (u, i) => u.hp > 0 && LANE[i] === LANE[index]
        );

        // Voie libre : priorité aux bâtiments.
        if (!defenders.length) {
            return unit.cooldown === 0 && unit.role !== "Support"
                ? "skill"
                : "siege";
        }

        // Soigner seulement si cela a un intérêt.
        if (
            unit.role === "Support" &&
            unit.cooldown === 0 &&
            m.enemies.some(u => u.hp > 0 && u.hp <= u.max - 45)
        ) {
            return "skill";
        }

        // Les autres rôles utilisent leur compétence dès que possible.
        if (unit.role !== "Support" && unit.cooldown === 0) {
            return "skill";
        }

        // Le tireur attaque les bâtiments même en présence de défenseurs.
        if (unit.role === "ADC" && unit.hp > unit.max * 0.4) {
            return "siege";
        }

        // Protection si le champion est en danger.
        if (unit.hp < unit.max * 0.25 && !unit.shield) {
            return "guard";
        }

        return "attack";
    }
    async function command(index, action) {
        if (!match || match.ending || match.ended || busy) return;

        const u = match.allies[index];
        if (!u || u.hp <= 0 || u.used) return;
        if (action === "skill" && u.cooldown > 0) return;

        match.effects = [];
        execute(0, index, action);
        u.used = true;

        if (match.nexus[1] <= 0) {
            await finish(true);
            return;
        }

        if (match.allies.every(x => x.hp <= 0 || x.used)) {
            match.enemies.forEach((enemy, i) => {
                if (enemy.hp <= 0) return;
                if (match.nexus[0] <= 0) return;

                execute(1, i, enemyAction(enemy, i));
            });

            if (match.nexus[0] <= 0) {
                await finish(false);
                return;
            }

            // Les tourelles attaquent les assaillants de leur voie.
            [0, 1].forEach(side => {
                const targets = side === 0 ? match.enemies : match.allies;

                match.towers[side].forEach((hp, lane) => {
                    if (hp <= 0) return;
                    const target = targets.find((x, i) => x.hp > 0 && LANE[i] === lane);
                    if (target) {
                        target.hp = Math.max(0, target.hp - (target.shield ? 8 : 18));
                    }
                });
            });

            match.round++;

            [...match.allies, ...match.enemies].forEach(x => {
                x.used = false;
                x.shield = false;
                x.cooldown = Math.max(0, x.cooldown - 1);

                // Réapparition collective toutes les quatre manches.
                if (x.hp <= 0 && match.round % 4 === 0) {
                    x.hp = x.max;
                }
            });

            if (match.round > 60) {
                const score = side =>
                    match.nexus[side] +
                    match.towers[side].reduce((a, b) => a + b, 0) +
                    (side === 0 ? match.allies : match.enemies)
                        .reduce((a, b) => a + b.hp, 0);

                await finish(score(0) > score(1));
                return;
            }

            match.log.push(`Manche ${match.round}.`);
        }

        renderBattle();
    }

    async function finish(win) {
        if (!match || match.ending || match.ended) return;

        const current = match;
        current.ending = true;
        current.result = win ? "Victoire !" : "Défaite";
        renderBattle();

        try {
            if (!current.training) {
                await updateAccount(r => {
                    if (uid() !== current.user || r.week !== current.week) {
                        throw new Error("La semaine ou le compte a changé : match non comptabilisé.");
                    }

                    r.points = Math.max(0, r.points + (win ? 30 : -15));
                    r.best = Math.max(r.best || 0, r.points);
                    r.games++;
                    if (win) r.wins++;
                    else r.losses++;
                });

                current.result += win ? " +30 points." : " −15 points, minimum 0.";
            } else {
                current.result += " Entraînement : aucun point.";
            }

            current.ended = true;
        } catch (e) {
            current.result += ` Score non enregistré : ${e.message}`;
            // Pas de nouvelle tentative automatique pour éviter un double enregistrement
            // en cas de résultat réseau incertain.
            current.ended = true;
        } finally {
            current.ending = false;
            renderBattle();
        }
    }

    function token(u, side, index) {
        const x = side === 0 ? 22 : 78;
        const y = [17, 39, 48, 73, 84][index];

        return `
      <div class="rk-token ${side ? "enemy" : "ally"} ${u.hp <= 0 ? "dead" : ""}"
        style="left:${x}%;top:${y}%">
        <img src="${html(u.img)}" alt="">
        <span>${html(u.name)}</span>
        <progress max="${u.max}" value="${u.hp}"></progress>
      </div>`;
    }

    const ROLE_SKILL_TEXT = {
        Top: "Assaut : attaque renforcée et protection.",
        Jungle: "Gank : frappe l'ennemi vivant le plus faible, toutes voies confondues.",
        Mid: "Zone : frappe tous les ennemis vivants au Mid.",
        ADC: "Tir puissant : gros dégâts, particulièrement contre les bâtiments si la voie est libre.",
        Support: "Soin : rend jusqu'à 55 PV à chaque allié vivant."
    };
    function renderBattle() {
        if (!match) return;
        const m = match;

        root.innerHTML = `
      <div class="rk-heading">
        <h2>${m.training ? "Entraînement" : "Match classé"}</h2>
        <span>Manche ${m.round} / 60</span>
      </div>

      <p>Contre ${html(m.name)} · Équipe contrôlée par l'ordinateur</p>

      <p class="rk-help">
  <strong>Objectif : détruire le Nexus adverse.</strong><br>
  Attaquer : frappe un champion, ou un bâtiment si la voie est libre.<br>
  Siège : frappe directement le bâtiment de la voie.
  Les dégâts sont réduits si des défenseurs sont encore vivants.<br>
  Défendre : récupère 30 PV maximum et réduit les dégâts reçus de 55 %.<br>
  Compétence : effet spécial du rôle, disponible à nouveau
  après le décompte affiché.
</p>
      <div class="rk-board">
        <div class="rk-lane top"></div>
        <div class="rk-lane mid"></div>
        <div class="rk-lane bot"></div>

        <div class="rk-nexus blue">Ton Nexus<br>${m.nexus[0]} PV</div>
        <div class="rk-nexus red">Nexus adverse<br>${m.nexus[1]} PV</div>

        ${[0, 1].map(side => m.towers[side].map((hp, lane) => `
          <div class="rk-tower ${hp <= 0 ? "broken" : ""}"
            style="left:${side ? 65 : 35}%;top:${[20, 48, 77][lane]}%">
            ♜ <span>${hp}</span>
          </div>
        `).join("")).join("")}

        ${m.allies.map((u, i) => token(u, 0, i)).join("")}
        ${m.enemies.map((u, i) => token(u, 1, i)).join("")}
      </div>

      ${m.result ? `<p class="rk-result" role="status">
        ${html(m.result)}
      </p>` : ""}

      <div class="rk-orders">
        ${m.allies.map((u, i) => `
          <div class="rk-order">
            <b>${u.role} · ${html(u.name)}</b>
            <small>${html(ROLE_SKILL_TEXT[u.role])}</small>
            <small>${u.hp}/${u.max} PV
              ${u.hp <= 0 ? "· Réapparition à une manche multiple de 4" : ""}
              ${u.used ? "· Ordre donné" : ""}
            </small>
            <div>
              ${[
                ["attack", "Attaquer"],
                ["siege", "Siège"],
                ["guard", "Défendre"],
                [
                    "skill",
                    u.cooldown
                        ? `Compétence (${u.cooldown})`
                        : "Compétence"
                ]
            ].map(([action, label]) => `
                <button class="btn" data-command="${action}" data-unit="${i}"
                  ${m.ending || m.ended || u.used || u.hp <= 0 ||
                    (action === "skill" && u.cooldown > 0) ? "disabled" : ""}>
                  ${label}
                </button>
              `).join("")}
            </div>
          </div>
        `).join("")}
      </div>

      <div class="rk-log" aria-live="polite">
        ${m.log.slice(-7).reverse().map(x => `<div>${html(x)}</div>`).join("")}
      </div>

      <div class="rk-buttons">
        ${m.ended
                ? '<button class="btn-play" data-do="back">Retour à mon équipe</button>'
                : `<button class="btn" data-do="surrender"
              ${m.ending ? "disabled" : ""}>Abandonner</button>`}
      </div>
    `;

        // Si toute l'équipe est morte, permet de faire avancer la manche.
        if (!m.ended && !m.ending && m.allies.every(u => u.hp <= 0)) {
            root.insertAdjacentHTML("beforeend",
                '<button class="btn" data-do="wait">Attendre les réapparitions</button>');
        }
    }

    root.addEventListener("change", e => {
        const select = e.target.closest("[data-role]");
        if (select) draft[Number(select.dataset.role)] = Number(select.value);
    });

    root.addEventListener("input", e => {
        if (e.target.id !== "rkSearch") return;

        const position = e.target.selectionStart;
        search = e.target.value;
        render();

        const input = root.querySelector("#rkSearch");
        input.focus();
        input.setSelectionRange(position, position);
    });

    root.addEventListener("click", async e => {
        const commandButton = e.target.closest("[data-command]");

        if (commandButton && !commandButton.disabled) {
            await command(Number(commandButton.dataset.unit), commandButton.dataset.command);
            return;
        }

        const button = e.target.closest("[data-do]");
        if (!button || button.disabled || busy) return;

        const action = button.dataset.do;

        if (action === "back") {
            match = null;
            draft = [...saved.team];
            render();
            return;
        }

        if (action === "surrender") {
            await finish(false);
            return;
        }

        if (action === "wait" && match && !match.ended && !match.ending) {
            const m = match;

            m.enemies.forEach((u, i) => {
                if (u.hp > 0 && m.nexus[0] > 0) {
                    execute(1, i, enemyAction(u, i));
                }
            });

            if (m.nexus[0] <= 0) {
                await finish(false);
                return;
            }

            m.round++;

            [...m.allies, ...m.enemies].forEach(u => {
                u.used = false;
                u.shield = false;
                u.cooldown = Math.max(0, u.cooldown - 1);

                if (u.hp <= 0 && m.round % 4 === 0) u.hp = u.max;
            });

            if (m.round > 60) {
                await finish(false);
                return;
            }

            m.log.push(`Manche ${m.round} : attente des réapparitions.`);
            renderBattle();
            return;
        }

        if (action === "reload") {
            await open();
            return;
        }

        busy = true;
        message = "";
        render();

        try {
            if (action === "save") {
                await saveTeam();
                message = "Équipe enregistrée.";
            }

            if (action === "play" || action === "train") {
                await findMatch(action === "train");
            }
        } catch (err) {
            message = err.message;
        } finally {
            busy = false;
            render();
        }
    });

    return {
        open,
        close() {
            loadNumber++;
            match = null;
            saved = null;
            account = null;
            busy = false;
            root.innerHTML = "<p>Connecte-toi pour jouer.</p>";
        }
    };
}