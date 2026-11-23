(() => {
  const socket = io();
  const $ = (id) => document.getElementById(id);
  const elements = {
    landing: $("landingView"), game: $("gameView"), connection: $("connectionStatus"),
    createForm: $("createForm"), joinForm: $("joinForm"), createName: $("createName"), joinName: $("joinName"),
    boardSize: $("boardSize"), apSpeed: $("apSpeed"), roomCodeInput: $("roomCode"), roomCodeDisplay: $("roomCodeDisplay"),
    lobby: $("lobbyPanel"), active: $("activePanel"), finished: $("finishedPanel"), lobbyRoster: $("lobbyRoster"), lobbyCount: $("lobbyCount"),
    start: $("startGame"), hostNote: $("hostNote"), gameTitle: $("gameTitle"), copyInvite: $("copyInvite"), leave: $("leaveRoom"),
    board: $("board"), axisTop: $("axisTop"), axisSide: $("axisSide"), boardDimensions: $("boardDimensions"), boardStatus: $("boardStatus"),
    nextTick: $("nextTick"), actionPrompt: $("actionPrompt"), actionHint: $("actionHint"), myAp: $("myAp"), myApSmall: $("myApSmall"),
    myName: $("myName"), myHp: $("myHp"), myRange: $("myRange"), myCoords: $("myCoords"), myStatus: $("myStatus"), myTankBadge: $("myTankBadge"),
    roster: $("playerRoster"), rosterCount: $("rosterCount"), log: $("eventLog"), chat: $("chatMessages"), chatForm: $("chatForm"), chatInput: $("chatInput"),
    heal: $("healButton"), upgrade: $("upgradeButton"), jury: $("juryVoteBlock"), winner: $("winnerTitle"), finalRoster: $("finalRoster"), toast: $("toast"),
    planningToggle: $("planningToggle"), planningPanel: $("planningPanel"), planningClose: $("planningClose"),
    planBudget: $("planBudget"), planCost: $("planCost"), planRemaining: $("planRemaining"), planPosition: $("planPosition"), planRange: $("planRange"), planHp: $("planHp"),
    planHint: $("planHint"), planFutureTicks: $("planFutureTicks"), planQueue: $("planQueue"), planActionCount: $("planActionCount"),
    planOpponentEstimates: $("planOpponentEstimates"), undoPlan: $("undoPlan"), clearPlan: $("clearPlan"), copyPlan: $("copyPlan")
  };

  let currentState = null;
  let currentRoom = null;
  let currentPlayerKey = null;
  let currentPlayerName = null;
  let currentPlayerId = null;
  let selectedMode = null;
  let toastTimer = null;
  let lastConnected = false;
  let refreshTimer = null;
  let planningOpen = false;
  let planMode = null;
  let planActions = [];
  let planFutureTicks = 0;
  let apEstimates = {};

  function randomKey() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function playerStorageKey(code) { return `ttt-player-${code}`; }
  function nameStorageKey(code) { return `ttt-name-${code}`; }
  function estimateStorageKey(code, playerKey) { return `ttt-ap-estimates-${code}-${playerKey}`; }

  function setConnection(connected) {
    elements.connection.classList.toggle("connected", connected);
    elements.connection.classList.toggle("disconnected", !connected);
    elements.connection.innerHTML = `<i></i>${connected ? "Connected" : "Reconnecting"}`;
  }

  function showToast(message, isError = false) {
    elements.toast.textContent = message;
    elements.toast.classList.toggle("error", isError);
    elements.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 3000);
  }

  function showGame() {
    elements.landing.hidden = true;
    elements.game.hidden = false;
  }

  function showLanding() {
    elements.game.hidden = true;
    elements.landing.hidden = false;
    currentState = null;
    currentRoom = null;
    currentPlayerKey = null;
    currentPlayerName = null;
    currentPlayerId = null;
    selectedMode = null;
    planningOpen = false;
    planMode = null;
    planActions = [];
    apEstimates = {};
    elements.planningPanel.hidden = true;
    if (refreshTimer) clearInterval(refreshTimer);
    history.replaceState({}, "", window.location.pathname);
  }

  function request(eventName, payload, onSuccess) {
    if (!socket.connected) {
      showToast("Not connected to the game server yet. Try again in a moment.", true);
      return;
    }
    socket.emit(eventName, payload, (response) => {
      if (!response?.ok) {
        showToast(response?.error || "That action could not be completed.", true);
        return;
      }
      if (onSuccess) onSuccess(response);
    });
  }

  function enterRoom(state, clientKey, playerName) {
    currentState = state;
    currentRoom = state.code;
    currentPlayerKey = clientKey;
    currentPlayerName = playerName || state.me.name;
    currentPlayerId = state.me.id;
    selectedMode = null;
    planningOpen = false;
    planMode = null;
    planActions = [];
    planFutureTicks = 0;
    apEstimates = loadApEstimates(state.code, state.me.id);
    elements.planningPanel.hidden = true;
    elements.planningToggle.classList.remove("active");
    elements.planningToggle.textContent = "◎ Private planning";
    elements.planFutureTicks.value = "0";
    localStorage.setItem(playerStorageKey(state.code), clientKey);
    localStorage.setItem(nameStorageKey(state.code), state.me.name);
    history.replaceState({}, "", `${window.location.pathname}?room=${encodeURIComponent(state.code)}`);
    showGame();
    render(state);
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (currentRoom && socket.connected) socket.emit("refresh-room");
    }, 30_000);
  }

  function createGame(event) {
    event.preventDefault();
    const name = elements.createName.value.trim();
    const clientKey = randomKey();
    request("create-room", {
      name,
      clientKey,
      size: Number(elements.boardSize.value),
      tickMinutes: Number(elements.apSpeed.value)
    }, (response) => {
      enterRoom(response.state, clientKey, name);
      showToast("Room created. Send the invite link to your friends.");
    });
  }

  function joinGame(event) {
    event.preventDefault();
    const name = elements.joinName.value.trim();
    const code = elements.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const clientKey = localStorage.getItem(playerStorageKey(code)) || randomKey();
    request("join-room", { code, name, clientKey }, (response) => {
      enterRoom(response.state, clientKey, response.state.me.name || name);
      showToast(`Joined room ${code}.`);
    });
  }

  function autoJoinFromInvite() {
    const params = new URLSearchParams(window.location.search);
    const code = (params.get("room") || "").toUpperCase();
    if (!code) return;
    elements.roomCodeInput.value = code;
    const savedKey = localStorage.getItem(playerStorageKey(code));
    const savedName = localStorage.getItem(nameStorageKey(code));
    if (!savedKey || !savedName) return;
    elements.joinName.value = savedName;
    const joinWhenReady = () => {
      if (!socket.connected || currentRoom) return;
      request("join-room", { code, name: savedName, clientKey: savedKey }, (response) => {
        enterRoom(response.state, savedKey, response.state.me.name || savedName);
      });
    };
    if (socket.connected) joinWhenReady();
    else socket.once("connect", joinWhenReady);
  }

  function updateRoomState(state) {
    if (!currentRoom || state.code !== currentRoom) return;
    currentState = state;
    currentPlayerId = state.me.id;
    render(state);
  }

  function render(state) {
    elements.roomCodeDisplay.textContent = state.code;
    elements.gameTitle.innerHTML = `Operation <em>${escapeHTML(state.code)}</em>`;
    elements.boardDimensions.textContent = `${state.size} × ${state.size} GRID`;

    const inLobby = state.status === "lobby";
    const isFinished = state.status === "finished";
    elements.lobby.hidden = !inLobby;
    elements.active.hidden = inLobby;
    elements.finished.hidden = !isFinished;

    if (inLobby) {
      renderLobby(state);
      return;
    }

    updateActionControls(state);
    renderBoard(state);
    renderMyStatus(state);
    renderRoster(state);
    renderLog(state);
    renderChat(state);
    renderJury(state);
    if (planningOpen) renderPlanning();
    elements.boardStatus.textContent = isFinished ? "OPERATION COMPLETE" : "LIVE BOARD";
    if (isFinished) {
      const winner = state.players.find((player) => player.id === state.winnerId);
      elements.winner.textContent = winner ? `${winner.name} is the last tank standing.` : "No winner this time.";
      elements.finalRoster.innerHTML = state.players
        .slice()
        .sort((a, b) => Number(b.alive) - Number(a.alive))
        .map((player) => `<span class="final-player"><i class="player-colour-dot" style="display:inline-block;background:${safeColour(player.colour)};margin-right:6px"></i>${escapeHTML(player.name)} · ${player.alive ? "SURVIVED" : "OUT"}</span>`)
        .join("");
    }
    updateCountdown();
  }

  function renderLobby(state) {
    const players = state.players;
    elements.lobbyCount.textContent = `${players.length} PLAYER${players.length === 1 ? "" : "S"}`;
    elements.lobbyRoster.innerHTML = players.map((player) => `
      <div class="lobby-player">
        <i class="player-colour-dot" style="background:${safeColour(player.colour)}"></i>
        <strong>${escapeHTML(player.name)}</strong>
        <small>${player.host ? "HOST" : "READY"}</small>
      </div>`).join("");
    const isHost = state.me.host;
    elements.start.disabled = !isHost || players.length < 2;
    elements.start.textContent = isHost ? (players.length < 2 ? "Waiting for players" : "Start game ↗") : "Waiting for host";
    elements.hostNote.textContent = isHost ? "You are the host. Start when everyone has joined." : "Only the room host can start the game.";
  }

  function safeColour(colour) {
    return /^#[0-9a-fA-F]{6}$/.test(String(colour)) ? colour : "#91b884";
  }

  function renderBoard(state) {
    const size = state.size;
    const playerAt = new Map();
    for (const player of state.players) {
      if (Number.isInteger(player.x) && Number.isInteger(player.y)) playerAt.set(`${player.x},${player.y}`, player);
    }
    const me = state.me;
    const myTank = state.players.find((player) => player.id === me.id);
    const plan = planningOpen ? derivePlan() : null;
    const displayX = planningOpen ? plan.x : myTank?.x;
    const displayY = planningOpen ? plan.y : myTank?.y;
    const displayRange = planningOpen ? plan.range : me.range;
    const activeMode = planningOpen ? planMode : selectedMode;
    const cells = [];
    const topLabels = [];
    const sideLabels = [];
    for (let x = 0; x < size; x += 1) topLabels.push(`<span>${String.fromCharCode(65 + x)}</span>`);
    for (let y = 0; y < size; y += 1) sideLabels.push(`<span>${y + 1}</span>`);
    elements.axisTop.innerHTML = topLabels.join("");
    elements.axisSide.innerHTML = sideLabels.join("");

    const liveMove = !planningOpen && state.status === "active" && me.alive && selectedMode === "move" && me.ap >= 1;
    const liveTarget = !planningOpen && state.status === "active" && me.alive && ["attack", "gift-ap", "gift-heart"].includes(selectedMode);
    const planMove = planningOpen && state.status === "active" && me.alive && planMode === "move";
    const planTarget = planningOpen && state.status === "active" && me.alive && ["attack", "gift-ap", "gift-heart"].includes(planMode);
    const pathSteps = new Map();
    if (planningOpen) {
      let stepNo = 0;
      for (const action of planActions) {
        if (action.type === "move") {
          stepNo += 1;
          pathSteps.set(`${action.x},${action.y}`, stepNo);
        }
      }
    }

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const key = `${x},${y}`;
        const player = playerAt.get(key);
        const distance = Number.isInteger(displayX) && Number.isInteger(displayY)
          ? Math.abs(displayX - x) + Math.abs(displayY - y)
          : Number.POSITIVE_INFINITY;
        const adjacent = distance === 1;
        const inRange = distance > 0 && distance <= displayRange;
        const canMove = (liveMove || planMove) && (!player || player.id === me.id) && adjacent;
        const targetMode = activeMode;
        const canTargetPlayer = player && player.id !== me.id && inRange && (
          targetMode === "gift-heart" || player.alive
        );
        const classes = ["board-cell"];
        if (canMove) classes.push("can-move");
        if ((liveTarget || planTarget) && inRange) classes.push(planningOpen ? "plan-range-cell" : "range-cell");
        if ((liveTarget || planTarget) && canTargetPlayer) classes.push("can-target");
        if (player?.id === me.id) classes.push("selected-cell");
        if (planningOpen && pathSteps.has(key)) classes.push("plan-route-cell");
        if (planningOpen && x === plan.x && y === plan.y) classes.push("plan-position-cell");

        let content = "";
        let title = `${String.fromCharCode(65 + x)}${y + 1}`;
        if (player) {
          const playerName = escapeHTML(player.name);
          const dead = !player.alive;
          content = `<span class="tank-token ${player.id === me.id ? "you" : ""} ${dead ? "dead" : ""}" style="background:${safeColour(player.colour)}">${dead ? "×" : "T"}</span>`;
          title += ` · ${playerName} · ${player.hp} HP${dead ? " · OUT" : ""}`;
        }
        if (planningOpen && pathSteps.has(key)) {
          content += `<span class="plan-step-badge">${pathSteps.get(key)}</span>`;
        }
        if (planningOpen && x === plan.x && y === plan.y && (x !== myTank?.x || y !== myTank?.y)) {
          content += `<span class="plan-ghost-marker">P</span>`;
          title += " · Planned position";
        }
        if ((liveTarget || planTarget) && inRange) title += ` · In ${displayRange}-cell range`;
        cells.push(`<button type="button" role="gridcell" class="${classes.join(" ")}" data-x="${x}" data-y="${y}" aria-label="${escapeHTML(title)}" title="${escapeHTML(title)}">${content}</button>`);
      }
    }
    elements.board.style.gridTemplateColumns = `repeat(${size}, minmax(0, 1fr))`;
    elements.board.style.gridTemplateRows = `repeat(${size}, minmax(0, 1fr))`;
    elements.board.innerHTML = cells.join("");
  }

  function renderMyStatus(state) {
    const me = state.me;
    const x = Number.isInteger(state.players.find((p) => p.id === me.id)?.x) ? state.players.find((p) => p.id === me.id).x : null;
    const y = Number.isInteger(state.players.find((p) => p.id === me.id)?.y) ? state.players.find((p) => p.id === me.id).y : null;
    elements.myName.textContent = me.name;
    elements.myHp.textContent = `${me.hp} HP`;
    elements.myRange.textContent = `${me.range} CELLS`;
    elements.myAp.textContent = me.ap;
    elements.myApSmall.textContent = me.ap;
    elements.myTankBadge.style.background = safeColour(state.players.find((p) => p.id === me.id)?.colour);
    elements.myTankBadge.textContent = me.alive ? "T" : "×";
    elements.myCoords.textContent = x === null ? "POSITION —" : `POSITION ${String.fromCharCode(65 + x)}${y + 1}`;
    elements.myStatus.textContent = me.alive ? "ACTIVE" : "JURY";
    elements.myStatus.style.color = me.alive ? "var(--mint)" : "var(--orange)";
  }

  function renderRoster(state) {
    const players = state.players.slice().sort((a, b) => Number(b.alive) - Number(a.alive));
    elements.rosterCount.textContent = `${players.length} PLAYERS`;
    elements.roster.innerHTML = players.map((player) => {
      const isMe = player.id === state.me.id;
      const status = player.alive ? `${player.hp} HP · R${player.range}` : "OUT";
      const apText = isMe ? `<span class="ap-private">${state.me.ap} AP</span>` : "AP HIDDEN";
      return `<div class="roster-player ${isMe ? "you" : ""} ${player.alive ? "" : "dead"}">
        <i class="player-colour-dot" style="background:${safeColour(player.colour)}"></i>
        <span class="roster-player-name">${escapeHTML(player.name)}${player.host ? " ★" : ""}${isMe ? " (YOU)" : ""}</span>
        <span class="roster-player-stats">${status} · ${apText}</span>
      </div>`;
    }).join("");
  }

  function formatTime(timestamp) {
    if (!timestamp) return "--:--";
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function renderLog(state) {
    elements.log.innerHTML = state.log.slice(0, 24).map((entry) => `
      <div class="log-entry ${escapeHTML(entry.type || "")}">
        <time>${formatTime(entry.at)}</time>
        <span>${escapeHTML(entry.message)}</span>
      </div>`).join("") || `<div class="log-entry"><span>No activity yet.</span></div>`;
  }

  function renderChat(state) {
    elements.chat.innerHTML = state.chat.slice(-30).map((message) => `
      <div class="chat-message"><strong style="color:${safeColour(message.colour)}">${escapeHTML(message.name)}</strong>${escapeHTML(message.message)}<time>${formatTime(message.at)}</time></div>`).join("");
    elements.chat.scrollTop = elements.chat.scrollHeight;
  }

  function renderJury(state) {
    const me = state.me;
    if (me.alive || state.status !== "active") {
      elements.jury.hidden = true;
      return;
    }
    const living = state.players.filter((player) => player.alive);
    if (!living.length) {
      elements.jury.hidden = true;
      return;
    }
    elements.jury.hidden = false;
    if (me.hasVoted) {
      elements.jury.innerHTML = `<p>Your Jury vote has been cast. It resolves at the next AP drop.</p>`;
    } else {
      elements.jury.innerHTML = `<p>You are part of the Jury. Vote for a living player.</p>
        <select id="juryTarget" aria-label="Choose a player">${living.map((p) => `<option value="${p.id}">${escapeHTML(p.name)}</option>`).join("")}</select>
        <button id="castJuryVote" type="button">Cast vote</button>`;
      $("castJuryVote").addEventListener("click", () => {
        const targetId = $("juryTarget").value;
        request("jury-vote", { targetId }, () => showToast("Jury vote submitted."));
      });
    }
  }

  function loadApEstimates(roomCode, playerId) {
    try {
      const stored = localStorage.getItem(estimateStorageKey(roomCode, playerId));
      const parsed = stored ? JSON.parse(stored) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveApEstimates() {
    if (!currentRoom || !currentPlayerId) return;
    try {
      localStorage.setItem(estimateStorageKey(currentRoom, currentPlayerId), JSON.stringify(apEstimates));
    } catch {
      showToast("Your AP estimates could not be saved in this browser.", true);
    }
  }

  function derivePlan() {
    const myTank = currentState?.players.find((player) => player.id === currentState.me.id);
    let x = myTank?.x ?? 0;
    let y = myTank?.y ?? 0;
    let range = currentState?.me.range ?? 0;
    let hp = currentState?.me.hp ?? 0;
    let cost = 0;
    const targetHp = {};
    const targetAlive = {};
    for (const player of currentState?.players ?? []) {
      targetHp[player.id] = player.hp;
      targetAlive[player.id] = player.alive;
    }

    for (const action of planActions) {
      cost += action.cost;
      if (action.type === "move") { x = action.x; y = action.y; }
      if (action.type === "upgrade") range += 1;
      if (action.type === "heal") hp += 1;
      if (action.type === "attack" && action.targetId) {
        targetHp[action.targetId] = Math.max(0, (targetHp[action.targetId] ?? 0) - 1);
        if (targetHp[action.targetId] === 0) targetAlive[action.targetId] = false;
      }
      if (action.type === "gift-heart" && action.targetId) {
        targetHp[action.targetId] = Math.max(1, (targetHp[action.targetId] ?? 0) + (targetAlive[action.targetId] ? 1 : 0));
        targetAlive[action.targetId] = true;
      }
    }
    return { x, y, range, hp, cost, targetHp, targetAlive };
  }

  function planBudget() {
    return (currentState?.me.ap ?? 0) + planFutureTicks;
  }

  function planCoordinate(x, y) {
    return `${String.fromCharCode(65 + x)}${y + 1}`;
  }

  function queuePlanAction(action) {
    const plan = derivePlan();
    if (plan.cost + action.cost > planBudget()) {
      showToast(`That plan costs ${plan.cost + action.cost} AP, but your projected budget is ${planBudget()} AP.`, true);
      return;
    }
    planActions.push(action);
    if (action.type !== "move") planMode = null;
    updatePlanModeButtons();
    renderPlanning();
    renderBoard(currentState);
  }

  function updatePlanModeButtons() {
    document.querySelectorAll("[data-plan-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.planMode === planMode);
    });
  }

  function renderPlanning() {
    if (!planningOpen || !currentState) return;
    elements.planningPanel.hidden = false;
    const plan = derivePlan();
    const budget = planBudget();
    const remaining = budget - plan.cost;
    elements.planBudget.textContent = String(budget);
    elements.planCost.textContent = String(plan.cost);
    elements.planRemaining.textContent = String(remaining);
    elements.planPosition.textContent = planCoordinate(plan.x, plan.y);
    elements.planRange.textContent = `${plan.range} CELLS`;
    elements.planHp.textContent = `${plan.hp} HP`;
    elements.planActionCount.textContent = `${planActions.length} ACTION${planActions.length === 1 ? "" : "S"}`;
    elements.planRemaining.classList.toggle("negative", remaining < 0);

    const prompts = {
      move: `Click an empty square one step from your planned position (${planCoordinate(plan.x, plan.y)}). Each square costs 1 AP.`,
      attack: `Click a living opponent within ${plan.range} cells of ${planCoordinate(plan.x, plan.y)}.`,
      "gift-ap": `Click a living player within ${plan.range} cells of ${planCoordinate(plan.x, plan.y)}.`,
      "gift-heart": `Click any player within ${plan.range} cells of ${planCoordinate(plan.x, plan.y)}.`,
      heal: "Add HP has been queued when selected.",
      upgrade: "Range upgrade has been queued when selected."
    };
    elements.planHint.textContent = prompts[planMode] || "Choose an action. Move one square at a time to draw a route; target actions use your planned position.";
    updatePlanModeButtons();

    elements.planQueue.innerHTML = planActions.length ? planActions.map((action, index) => {
      let description = "";
      if (action.type === "move") description = `Move to ${planCoordinate(action.x, action.y)}`;
      else if (action.type === "attack" && action.targetName) {
        description = `Attack · ${escapeHTML(action.targetName)} (${action.targetHpBefore} → ${Math.max(0, action.targetHpBefore - 1)} HP)`;
      } else if (action.type === "gift-heart" && action.targetName) {
        const result = action.targetWasAlive
          ? `${action.targetHpBefore} → ${action.targetHpAfter} HP`
          : `revive · ${action.targetHpAfter} HP`;
        description = `Gift heart · ${escapeHTML(action.targetName)} (${result})`;
      } else if (action.targetName) description = `${planActionName(action.type)} · ${escapeHTML(action.targetName)}`;
      else description = planActionName(action.type);
      return `<div class="plan-queue-item"><span class="plan-queue-index">${index + 1}</span><span>${description}</span><small>${action.cost} AP</small></div>`;
    }).join("") : `<p class="plan-empty">No actions planned yet. Choose a tool above and build a route or action sequence.</p>`;

    renderOpponentEstimates();
    elements.undoPlan.disabled = planActions.length === 0;
    elements.clearPlan.disabled = planActions.length === 0;
    elements.copyPlan.disabled = planActions.length === 0;
  }

  function planActionName(type) {
    return ({ move: "Move", attack: "Attack", "gift-ap": "Gift 1 AP", "gift-heart": "Gift heart", heal: "Add 1 HP", upgrade: "Upgrade range" })[type] || type;
  }

  function renderOpponentEstimates() {
    const opponents = currentState.players.filter((player) => player.id !== currentState.me.id);
    if (!opponents.length) {
      elements.planOpponentEstimates.innerHTML = `<p class="plan-empty">No opponents to estimate yet.</p>`;
      return;
    }
    elements.planOpponentEstimates.innerHTML = opponents.map((player) => {
      const raw = apEstimates[player.id];
      const hasEstimate = raw !== undefined && raw !== "";
      const value = hasEstimate ? Math.max(0, Math.floor(Number(raw) || 0)) : 0;
      const plannedGifts = planActions.filter((action) => action.type === "gift-ap" && action.targetId === player.id).length;
      const forecast = hasEstimate ? `${value + (player.alive ? planFutureTicks : 0) + plannedGifts} AP` : "—";
      return `<label class="plan-opponent-row">
        <span class="plan-opponent-name"><i class="player-colour-dot" style="background:${safeColour(player.colour)}"></i>${escapeHTML(player.name)}${player.alive ? "" : " · OUT"}</span>
        <span class="plan-opponent-input"><input type="number" min="0" max="999" step="1" inputmode="numeric" data-estimate-player="${player.id}" aria-label="Estimated AP for ${escapeHTML(player.name)}" value="${raw === undefined ? "" : escapeHTML(raw)}" placeholder="?"> <small>AP now</small></span>
        <span class="plan-opponent-forecast">${forecast} after ${planFutureTicks} tick${planFutureTicks === 1 ? "" : "s"}${plannedGifts ? ` + ${plannedGifts} planned AP gift${plannedGifts === 1 ? "" : "s"}` : ""}</span>
      </label>`;
    }).join("");
  }

  function handlePlanningBoardClick(x, y, player) {
    if (!planMode) {
      elements.planHint.textContent = "Choose a planning tool first. Your current planned position is " + planCoordinate(derivePlan().x, derivePlan().y) + ".";
      return;
    }
    const plan = derivePlan();
    if (planMode === "move") {
      const distance = Math.abs(plan.x - x) + Math.abs(plan.y - y);
      if (distance !== 1) {
        showToast("Plan movement one adjacent square at a time.", true);
        return;
      }
      if (player && player.id !== currentState.me.id) {
        showToast("That square is occupied by another player.", true);
        return;
      }
      queuePlanAction({ type: "move", x, y, cost: 1 });
      return;
    }

    if (!["attack", "gift-ap", "gift-heart"].includes(planMode)) return;
    if (!player || player.id === currentState.me.id) {
      showToast("Select an opponent on the board.", true);
      return;
    }
    if (planMode !== "gift-heart" && !plan.targetAlive[player.id]) {
      showToast("That planned action requires a living player.", true);
      return;
    }
    const distance = Math.abs(plan.x - player.x) + Math.abs(plan.y - player.y);
    if (distance === 0 || distance > plan.range) {
      showToast(`That player is outside your planned range of ${plan.range} cells.`, true);
      return;
    }
    const cost = planMode === "gift-heart" ? 3 : 1;
    const targetHpBefore = plan.targetHp[player.id] ?? player.hp;
    const targetWasAlive = Boolean(plan.targetAlive[player.id]);
    const targetHpAfter = planMode === "gift-heart"
      ? (targetWasAlive ? targetHpBefore + 1 : 1)
      : targetHpBefore;
    queuePlanAction({
      type: planMode,
      targetId: player.id,
      targetName: player.name,
      targetHpBefore,
      targetHpAfter,
      targetWasAlive,
      cost
    });
  }

  function togglePlanning(forceOpen) {
    if (!currentState) return;
    const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : !planningOpen;
    if (shouldOpen && (!currentState.me.alive || currentState.status !== "active")) {
      showToast("Planning mode is available while your tank is active.", true);
      return;
    }
    planningOpen = shouldOpen;
    planMode = null;
    selectedMode = null;
    elements.planningPanel.hidden = !planningOpen;
    elements.planningToggle.classList.toggle("active", planningOpen);
    elements.planningToggle.textContent = planningOpen ? "◎ Planning open" : "◎ Private planning";
    updatePlanModeButtons();
    if (planningOpen) renderPlanning();
    renderBoard(currentState);
  }

  function planSummaryText() {
    const plan = derivePlan();
    const lines = [
      `Tank Turn Tactics — private plan for ${currentState.me.name}`,
      `Current AP: ${currentState.me.ap}`,
      `Projected AP budget: ${planBudget()} (${planFutureTicks} future tick(s))`,
      `Planned AP cost: ${plan.cost}`,
      `AP remaining: ${planBudget() - plan.cost}`,
      `Planned position: ${planCoordinate(plan.x, plan.y)}`,
      `Planned range: ${plan.range} cells`,
      `Projected HP after queued heals: ${plan.hp}`,
      "",
      "Actions:",
      ...planActions.map((action, index) => {
        const target = action.targetName ? ` — ${action.targetName}` : "";
        const expectedHp = action.type === "attack" ? ` (target HP ${action.targetHpBefore} → ${Math.max(0, action.targetHpBefore - 1)})` : "";
        const expectedHeart = action.type === "gift-heart" && action.targetName
          ? (action.targetWasAlive ? ` (target HP ${action.targetHpBefore} → ${action.targetHpAfter})` : " (revive to 1 HP)")
          : "";
        return `${index + 1}. ${action.type === "move" ? `Move to ${planCoordinate(action.x, action.y)}` : planActionName(action.type) + target}${expectedHp}${expectedHeart} (${action.cost} AP)`;
      }),
      "",
      "Private AP estimates:",
      ...currentState.players.filter((player) => player.id !== currentState.me.id).map((player) => {
        const guess = apEstimates[player.id] === undefined || apEstimates[player.id] === "" ? "unknown" : apEstimates[player.id];
        return `${player.name}: ${guess} AP now`;
      })
    ];
    return lines.join("\n");
  }

  function setMode(mode) {
    if (planningOpen) togglePlanning(false);
    selectedMode = selectedMode === mode ? null : mode;
    for (const button of document.querySelectorAll(".action-button[data-mode]")) {
      button.classList.toggle("active", button.dataset.mode === selectedMode);
    }
    const prompts = {
      move: "Select an adjacent empty square to move into.",
      attack: `Range radius: ${currentState.me.range} orthogonal steps (Manhattan distance). Select a living opponent in the highlighted area.`,
      "gift-ap": `Gift range: ${currentState.me.range} orthogonal steps (Manhattan distance). Select a living player in the highlighted area.`,
      "gift-heart": `Gift range: ${currentState.me.range} orthogonal steps (Manhattan distance). Select a player in the highlighted area; this can revive them.`
    };
    elements.actionPrompt.textContent = selectedMode ? `${selectedMode.replace("-", " ").toUpperCase()} SELECTED` : "Choose an action";
    elements.actionHint.textContent = prompts[selectedMode] || "Select an action, then select a square or player on the board.";
    if (currentState) renderBoard(currentState);
  }

  function updateActionControls(state) {
    const disabled = state.status !== "active" || !state.me.alive;
    for (const button of document.querySelectorAll(".action-button")) button.disabled = disabled;
    elements.heal.disabled = disabled || state.me.ap < 3;
    elements.upgrade.disabled = disabled || state.me.ap < 3;
    for (const button of document.querySelectorAll(".action-button[data-mode]")) {
      button.disabled = disabled || (button.dataset.mode === "gift-heart" ? state.me.ap < 3 : state.me.ap < 1);
      button.classList.toggle("active", button.dataset.mode === selectedMode);
    }
    if (!state.me.alive && state.status === "active") {
      planningOpen = false;
      planMode = null;
      elements.planningPanel.hidden = true;
      elements.planningToggle.classList.remove("active");
      elements.planningToggle.textContent = "◎ Private planning";
      elements.actionPrompt.textContent = "Your tank is out of action";
      elements.actionHint.textContent = "You can still chat and vote as part of the Jury. Another player may revive you with a gifted heart.";
      selectedMode = null;
    } else if (state.status === "finished") {
      planningOpen = false;
      planMode = null;
      elements.planningPanel.hidden = true;
      elements.planningToggle.classList.remove("active");
      elements.planningToggle.textContent = "◎ Private planning";
      elements.actionPrompt.textContent = "Operation complete";
      elements.actionHint.textContent = "The last tank standing has won. The board is now locked.";
      selectedMode = null;
    }
  }

  function handleBoardClick(event) {
    const cell = event.target.closest(".board-cell");
    if (!cell || !currentState) return;
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    const player = currentState.players.find((p) => p.x === x && p.y === y);
    if (planningOpen) {
      handlePlanningBoardClick(x, y, player);
      return;
    }
    if (!selectedMode) {
      if (player && player.id !== currentState.me.id) {
        elements.actionHint.textContent = `${player.name}: ${player.alive ? `${player.hp} HP · range ${player.range}` : "eliminated"}. Choose an action to interact with them.`;
      } else if (player?.id === currentState.me.id) {
        elements.actionHint.textContent = `Your tank is at ${planCoordinate(x, y)}. Choose an action above.`;
      }
      return;
    }
    if (selectedMode === "move") {
      sendAction({ type: "move", x, y });
    } else {
      if (!player || player.id === currentState.me.id) {
        showToast("Select another player on the board.", true);
        return;
      }
      sendAction({ type: selectedMode, targetId: player.id });
    }
  }

  function sendAction(action) {
    request("game-action", action, () => {
      selectedMode = null;
      planActions = [];
      planMode = null;
      planningOpen = false;
      elements.planningPanel.hidden = true;
      elements.planningToggle.classList.remove("active");
      elements.planningToggle.textContent = "◎ Private planning";
      for (const button of document.querySelectorAll(".action-button[data-mode]")) button.classList.remove("active");
      elements.actionPrompt.textContent = "Choose an action";
      elements.actionHint.textContent = "Action submitted. The shared board has been updated.";
    });
  }

  function updateCountdown() {
    if (!currentState?.nextTickAt || currentState.status !== "active") {
      elements.nextTick.textContent = "—";
      return;
    }
    const remaining = Math.max(0, currentState.nextTickAt - Date.now());
    const hours = Math.floor(remaining / 3_600_000);
    const minutes = Math.floor((remaining % 3_600_000) / 60_000);
    const seconds = Math.floor((remaining % 60_000) / 1000);
    elements.nextTick.textContent = [hours, minutes, seconds].map((n) => String(n).padStart(2, "0")).join(":");
  }

  async function copyInvite() {
    const link = `${window.location.origin}${window.location.pathname}?room=${currentRoom}`;
    try {
      await navigator.clipboard.writeText(link);
      showToast("Invite link copied to clipboard.");
    } catch {
      const input = document.createElement("textarea");
      input.value = link;
      document.body.appendChild(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      showToast(copied ? "Invite link copied to clipboard." : link, !copied);
    }
  }

  elements.createForm.addEventListener("submit", createGame);
  elements.joinForm.addEventListener("submit", joinGame);
  elements.roomCodeInput.addEventListener("input", () => {
    elements.roomCodeInput.value = elements.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  });
  elements.start.addEventListener("click", () => request("start-game", {}, () => showToast("The operation has started.")));
  elements.copyInvite.addEventListener("click", copyInvite);
  elements.leave.addEventListener("click", () => {
    socket.emit("leave-room");
    showLanding();
    showToast("You left the room on this device. The game is still saved.");
  });
  elements.board.addEventListener("click", handleBoardClick);
  document.querySelectorAll(".action-button[data-mode]").forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
  elements.planningToggle.addEventListener("click", () => togglePlanning());
  elements.planningClose.addEventListener("click", () => togglePlanning(false));
  document.querySelectorAll("[data-plan-mode]").forEach((button) => button.addEventListener("click", () => {
    if (!planningOpen) return;
    const mode = button.dataset.planMode;
    if (mode === "heal" || mode === "upgrade") {
      const cost = 3;
      queuePlanAction({ type: mode, cost });
    } else {
      planMode = planMode === mode ? null : mode;
      updatePlanModeButtons();
      renderPlanning();
      renderBoard(currentState);
    }
  }));
  elements.planFutureTicks.addEventListener("change", () => {
    planFutureTicks = Math.max(0, Math.min(30, Math.floor(Number(elements.planFutureTicks.value) || 0)));
    elements.planFutureTicks.value = String(planFutureTicks);
    renderPlanning();
    renderBoard(currentState);
  });
  elements.planOpponentEstimates.addEventListener("change", (event) => {
    const input = event.target.closest("[data-estimate-player]");
    if (!input) return;
    const playerId = input.dataset.estimatePlayer;
    const value = input.value.trim();
    apEstimates[playerId] = value === "" ? "" : String(Math.max(0, Math.min(999, Math.floor(Number(value) || 0))));
    saveApEstimates();
    renderPlanning();
  });
  elements.undoPlan.addEventListener("click", () => {
    planActions.pop();
    planMode = null;
    renderPlanning();
    renderBoard(currentState);
  });
  elements.clearPlan.addEventListener("click", () => {
    planActions = [];
    planMode = null;
    renderPlanning();
    renderBoard(currentState);
  });
  elements.copyPlan.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(planSummaryText());
      showToast("Private plan copied to your clipboard.");
    } catch {
      showToast("Clipboard access was unavailable. Your plan is still shown here.", true);
    }
  });
  elements.heal.addEventListener("click", () => sendAction({ type: "heal" }));
  elements.upgrade.addEventListener("click", () => sendAction({ type: "upgrade" }));
  elements.chatForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const message = elements.chatInput.value.trim();
    if (!message) return;
    request("chat-message", { message }, () => { elements.chatInput.value = ""; });
  });

  socket.on("connect", () => {
    setConnection(true);
    if (currentRoom && currentPlayerKey && currentPlayerName) {
      request("join-room", { code: currentRoom, name: currentPlayerName, clientKey: currentPlayerKey }, (response) => {
        updateRoomState(response.state);
      });
    }
    if (!lastConnected) autoJoinFromInvite();
    lastConnected = true;
  });
  socket.on("disconnect", () => setConnection(false));
  socket.on("connect_error", () => setConnection(false));
  socket.on("room-state", updateRoomState);
  socket.on("room-error", (message) => showToast(message, true));

  setConnection(socket.connected);
  setInterval(updateCountdown, 1000);
})();
