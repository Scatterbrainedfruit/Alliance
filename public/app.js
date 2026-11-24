(() => {
  const socket = io();
  const $ = (id) => document.getElementById(id);
  const elements = {
    landing: $("landingView"), game: $("gameView"), connection: $("connectionStatus"),
    createForm: $("createForm"), joinForm: $("joinForm"), createName: $("createName"), joinName: $("joinName"),
    boardWidth: $("boardWidth"), boardHeight: $("boardHeight"), apSpeed: $("apSpeed"), firstTickAt: $("firstTickAt"),
    roomCodeInput: $("roomCode"), roomCodeDisplay: $("roomCodeDisplay"), previewRoom: $("previewRoom"), joinOptions: $("joinOptions"),
    joinArmySelect: $("joinArmySelect"), requestArmyJoin: $("requestArmyJoin"), createArmySubmit: $("createArmySubmit"), joinRoomStatus: $("joinRoomStatus"),
    joinPendingView: $("joinPendingView"), cancelJoinWait: $("cancelJoinWait"),
    lobby: $("lobbyPanel"), active: $("activePanel"), finished: $("finishedPanel"), lobbyRoster: $("lobbyRoster"), lobbyCount: $("lobbyCount"),
    start: $("startGame"), hostNote: $("hostNote"), gameTitle: $("gameTitle"), copyInvite: $("copyInvite"), leave: $("leaveRoom"),
    board: $("board"), axisTop: $("axisTop"), axisSide: $("axisSide"), boardDimensions: $("boardDimensions"), boardStatus: $("boardStatus"),
    nextTick: $("nextTick"), actionPrompt: $("actionPrompt"), actionHint: $("actionHint"), myAp: $("myAp"), myApSmall: $("myApSmall"),
    myName: $("myName"), myHp: $("myHp"), myRange: $("myRange"), myCoords: $("myCoords"), myStatus: $("myStatus"), myArmyBadge: $("myArmyBadge"),
    armyMembership: $("armyMembership"),
    roster: $("playerRoster"), rosterCount: $("rosterCount"), log: $("eventLog"), chat: $("chatMessages"), chatForm: $("chatForm"), chatInput: $("chatInput"),
    heal: $("healButton"), upgrade: $("upgradeButton"), jury: $("juryVoteBlock"), winner: $("winnerTitle"), finalRoster: $("finalRoster"), toast: $("toast"),
    planningToggle: $("planningToggle"), planningPanel: $("planningPanel"), planningClose: $("planningClose"),
    planBudget: $("planBudget"), planCost: $("planCost"), planRemaining: $("planRemaining"), planPosition: $("planPosition"), planRange: $("planRange"), planHp: $("planHp"),
    planHint: $("planHint"), planFutureTicks: $("planFutureTicks"), planQueue: $("planQueue"), planActionCount: $("planActionCount"),
    planOpponentEstimates: $("planOpponentEstimates"), planArmySelect: $("planningArmySelect"), undoPlan: $("undoPlan"), clearPlan: $("clearPlan"), copyPlan: $("copyPlan"),
    replaySlider: $("replaySlider"), replayLabel: $("replayLabel"), replayRoster: $("replayRoster"), replayCount: $("replayCount")
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
  let planDrafts = {};
  let planArmyId = null;
  let pendingJoinDetails = null;
  let waitingForApproval = false;
  let firstTickManuallySet = false;
  const seenNotificationIds = new Set();
  let replayIndex = null;

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
  function pendingJoinStorageKey(code) { return `ttt-pending-join-${code}`; }
  function estimateStorageKey(code, playerKey) { return `ttt-ap-estimates-${code}-${playerKey}`; }
  function planStorageKey(code, playerKey) { return `ttt-plans-${code}-${playerKey}`; }

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
    elements.joinPendingView.hidden = true;
    waitingForApproval = false;
    pendingJoinDetails = null;
    currentState = null;
    currentRoom = null;
    currentPlayerKey = null;
    currentPlayerName = null;
    currentPlayerId = null;
    selectedMode = null;
    planningOpen = false;
    planMode = null;
    planActions = [];
    planDrafts = {};
    planArmyId = null;
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
    planDrafts = loadPlanDrafts(state.code, clientKey);
    planArmyId = state.me.id;
    planFutureTicks = 0;
    apEstimates = loadApEstimates(state.code, state.me.id);
    replayIndex = null;
    waitingForApproval = false;
    pendingJoinDetails = null;
    localStorage.removeItem(pendingJoinStorageKey(state.code));
    elements.joinPendingView.hidden = true;
    elements.planningPanel.hidden = true;
    elements.planningToggle.classList.remove("active");
    elements.planningToggle.textContent = "◎ Private planning";
    elements.planFutureTicks.value = "0";
    localStorage.setItem(playerStorageKey(state.code), clientKey);
    localStorage.setItem(nameStorageKey(state.code), state.me.name);
    history.replaceState({}, "", `${window.location.pathname}?room=${encodeURIComponent(state.code)}`);
    showGame();
    notifyPrivateAp(state);
    render(state);
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => {
      if (currentRoom && socket.connected) socket.emit("refresh-room");
    }, 30_000);
  }

  function localDateTimeValue(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function setDefaultFirstTick() {
    if (firstTickManuallySet && elements.firstTickAt.value) return;
    const intervalMinutes = Math.max(1, Math.min(10080, Math.floor(Number(elements.apSpeed.value) || 1440)));
    const next = new Date(Date.now() + intervalMinutes * 60 * 1000);
    next.setSeconds(0, 0);
    elements.firstTickAt.value = localDateTimeValue(next);
  }

  function createGame(event) {
    event.preventDefault();
    const name = elements.createName.value.trim();
    const clientKey = randomKey();
    const firstTickAt = new Date(elements.firstTickAt.value).getTime();
    if (!Number.isFinite(firstTickAt)) {
      showToast("Choose the date and time of the first AP tick.", true);
      return;
    }
    request("create-room", {
      name,
      clientKey,
      width: Number(elements.boardWidth.value),
      height: Number(elements.boardHeight.value),
      tickMinutes: Number(elements.apSpeed.value),
      firstTickAt
    }, (response) => {
      enterRoom(response.state, clientKey, name);
      showToast("Room created. Share the room code with other commanders.");
    });
  }

  function joinGame(event) {
    event.preventDefault();
    const name = elements.joinName.value.trim();
    const code = elements.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 6) {
      showToast("Enter the six-character room code and find the room first.", true);
      return;
    }
    const clientKey = randomKey();
    request("join-room", { code, name, clientKey }, (response) => {
      enterRoom(response.state, clientKey, response.state.me.name || name);
      showToast(`Created an army in room ${code}.`);
    });
  }

  function previewJoinRoom() {
    const code = elements.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    elements.roomCodeInput.value = code;
    request("preview-room", { code }, (response) => {
      const room = response.room;
      elements.joinArmySelect.innerHTML = room.armies.map((army) =>
        `<option value="${army.id}">${escapeHTML(army.name)} · ${army.memberCount} device/member${army.memberCount === 1 ? "" : "s"}${army.alive === false ? " · OUT" : ""}</option>`
      ).join("");
      elements.joinOptions.hidden = false;
      elements.createArmySubmit.disabled = room.status !== "lobby" || room.armies.length >= room.maxArmies;
      elements.joinRoomStatus.textContent = `${room.armies.length}/${room.maxArmies} armies · ${room.width} × ${room.height} board · ${room.status === "lobby" ? "Waiting to start" : room.status === "finished" ? "Game finished" : "Game in progress"}.`;
      elements.requestArmyJoin.disabled = room.status === "finished" || room.armies.length === 0;
      showToast("Room found. Choose how to join.");
    });
  }

  function requestJoinSelectedArmy() {
    const name = elements.joinName.value.trim();
    const code = elements.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const armyId = elements.joinArmySelect.value;
    if (!name || !armyId) {
      showToast("Enter your callsign and select an army.", true);
      return;
    }
    const clientKey = randomKey();
    pendingJoinDetails = { code, name, clientKey, armyId };
    request("request-army-join", { ...pendingJoinDetails }, (response) => {
      if (response.joined && response.state) {
        enterRoom(response.state, clientKey, response.state.me.name || name);
        showToast("This device is linked to your army.");
        return;
      }
      currentRoom = code;
      currentPlayerKey = clientKey;
      currentPlayerName = name;
      waitingForApproval = true;
      localStorage.setItem(pendingJoinStorageKey(code), JSON.stringify({ ...pendingJoinDetails, requestId: response.requestId }));
      localStorage.setItem(playerStorageKey(code), clientKey);
      localStorage.setItem(nameStorageKey(code), name);
      elements.landing.hidden = true;
      elements.game.hidden = true;
      elements.joinPendingView.hidden = false;
      history.replaceState({}, "", `${window.location.pathname}?room=${encodeURIComponent(code)}`);
    });
  }

  function cancelPendingJoin() {
    if (!pendingJoinDetails || !currentRoom) {
      showLanding();
      return;
    }
    const code = currentRoom;
    request("cancel-army-join", {
      code,
      clientKey: pendingJoinDetails.clientKey,
      armyId: pendingJoinDetails.armyId
    }, () => {
      localStorage.removeItem(pendingJoinStorageKey(code));
      localStorage.removeItem(playerStorageKey(code));
      localStorage.removeItem(nameStorageKey(code));
      showLanding();
      showToast("Join request cancelled.");
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
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem(pendingJoinStorageKey(code)) || "null"); } catch { pending = null; }
    if (pending?.armyId) {
      pendingJoinDetails = { code, name: pending.name || savedName, clientKey: savedKey, armyId: pending.armyId };
      currentRoom = code;
      currentPlayerKey = savedKey;
      currentPlayerName = pendingJoinDetails.name;
      waitingForApproval = true;
      elements.landing.hidden = true;
      elements.game.hidden = true;
      elements.joinPendingView.hidden = false;
    }
    const joinWhenReady = () => {
      if (!socket.connected || currentRoom || waitingForApproval) return;
      request("join-room", { code, name: savedName, clientKey: savedKey }, (response) => {
        enterRoom(response.state, savedKey, response.state.me.name || savedName);
      });
    };
    const resumeWhenReady = () => {
      if (!socket.connected) return;
      if (waitingForApproval && pendingJoinDetails) {
        request("request-army-join", pendingJoinDetails, (response) => {
          if (response.joined && response.state) enterRoom(response.state, savedKey, response.state.me.name || savedName);
          else if (response.requestId) {
            const saved = { ...pendingJoinDetails, requestId: response.requestId };
            localStorage.setItem(pendingJoinStorageKey(code), JSON.stringify(saved));
          }
        });
      } else joinWhenReady();
    };
    if (socket.connected) resumeWhenReady();
    else socket.once("connect", resumeWhenReady);
  }

  function updateRoomState(state) {
    if (!currentRoom || state.code !== currentRoom) return;
    currentState = state;
    currentPlayerId = state.me.id;
    notifyPrivateAp(state);
    render(state);
  }

  function render(state) {
    elements.roomCodeDisplay.textContent = state.code;
    elements.gameTitle.innerHTML = `Operation <em>${escapeHTML(state.code)}</em>`;
    elements.boardDimensions.textContent = `${state.width || state.size} × ${state.height || state.size} GRID`;

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
    renderArmyMembership(state);
    if (planningOpen) renderPlanning();
    elements.boardStatus.textContent = isFinished ? "OPERATION COMPLETE" : "LIVE BOARD";
    if (isFinished) {
      const winner = state.players.find((army) => army.id === state.winnerId);
      elements.winner.textContent = winner ? `${winner.name} is the last army standing.` : "No winner this time.";
      elements.finalRoster.innerHTML = state.players
        .slice()
        .sort((a, b) => Number(b.alive) - Number(a.alive))
        .map((army) => `<span class="final-player"><i class="player-colour-dot" style="display:inline-block;background:${safeColour(army.colour)};margin-right:6px"></i>${escapeHTML(army.name)} · ${army.alive ? "SURVIVED" : "OUT"}<span class="final-ap">${army.ap ?? 0} AP · ${army.hp} HP</span></span>`)
        .join("");
      renderReplay(state, Number.isInteger(replayIndex) ? replayIndex : (state.history?.length || 1) - 1);
    } else {
      elements.boardStatus.textContent = "LIVE BOARD";
    }
    updateCountdown();
  }

  function renderLobby(state) {
    const players = state.players;
    elements.lobbyCount.textContent = `${players.length} ARM${players.length === 1 ? "Y" : "IES"}`;
    elements.lobbyRoster.innerHTML = players.map((player) => `
      <div class="lobby-player">
        <i class="player-colour-dot" style="background:${safeColour(player.colour)}"></i>
        <strong>${escapeHTML(player.name)}</strong>
        <small>${player.memberCount || 1} MEMBER${(player.memberCount || 1) === 1 ? "" : "S"}${player.host ? " · HOST" : ""}</small>
      </div>`).join("");
    const isHost = state.me.host;
    elements.start.disabled = !isHost || players.length < 2;
    elements.start.textContent = isHost ? (players.length < 2 ? "Waiting for armies" : "Start game ↗") : "Waiting for host army";
    elements.hostNote.textContent = isHost ? `You lead this army. Start when the other armies are ready (maximum ${state.maxArmies || 32}).` : "Only the host army can start the game.";
    renderArmyMembership(state);
  }

  function safeColour(colour) {
    return /^#[0-9a-fA-F]{6}$/.test(String(colour)) ? colour : "#91b884";
  }

  function columnLabel(index) {
    let number = index + 1;
    let label = "";
    while (number > 0) {
      const remainder = (number - 1) % 26;
      label = String.fromCharCode(65 + remainder) + label;
      number = Math.floor((number - 1) / 26);
    }
    return label;
  }

  function coordinateLabel(x, y) { return `${columnLabel(x)}${y + 1}`; }

  function notifyPrivateAp(state) {
    for (const notification of (state.me.notifications || []).slice().reverse()) {
      if (seenNotificationIds.has(notification.id)) continue;
      seenNotificationIds.add(notification.id);
      showToast(notification.message);
    }
  }

  function renderArmyMembership(state) {
    const members = state.me.members || [];
    const requests = state.me.joinRequests || [];
    const inbox = (state.me.notifications || []).slice(0, 4);
    const html = `
      <div class="army-member-line"><strong>Linked devices/members</strong><span>${members.length}</span></div>
      ${members.map((member) => `<div class="army-member-line"><span>${escapeHTML(member.name)}</span><small>LINKED</small></div>`).join("")}
      ${requests.length ? `<div class="panel-label"><span>JOIN REQUESTS</span><b>${requests.length} PENDING</b></div>` : ""}
      ${requests.map((request) => `<div class="army-request-line"><span><strong>${escapeHTML(request.name)}</strong> wants to join this army</span><span class="army-request-actions"><button class="accept" type="button" data-join-decision="accept" data-request-id="${request.id}">Accept</button><button class="decline" type="button" data-join-decision="decline" data-request-id="${request.id}">Decline</button></span></div>`).join("")}
      ${inbox.length ? `<div class="panel-label"><span>PRIVATE AP MESSAGES</span></div>${inbox.map((item) => `<div class="army-member-line"><span>${escapeHTML(item.message)}</span><small>${formatTime(item.at)}</small></div>`).join("")}` : ""}
      ${!members.length && !requests.length && !inbox.length ? `<p class="plan-empty">No additional members or requests.</p>` : ""}`;
    elements.armyMembership.innerHTML = html;
    if ($("lobbyMembership")) $("lobbyMembership").innerHTML = html;
  }

  function renderReplay(state, requestedIndex) {
    const history = Array.isArray(state.history) ? state.history : [];
    if (!history.length) {
      elements.replayCount.textContent = "NO HISTORY";
      elements.replayLabel.textContent = "No event snapshots were recorded for this game.";
      elements.replayRoster.innerHTML = "";
      elements.replaySlider.disabled = true;
      return;
    }
    const index = Math.max(0, Math.min(history.length - 1, Number.isInteger(requestedIndex) ? requestedIndex : history.length - 1));
    replayIndex = index;
    elements.replaySlider.min = "0";
    elements.replaySlider.max = String(history.length - 1);
    elements.replaySlider.value = String(index);
    elements.replaySlider.disabled = history.length < 2;
    elements.replayCount.textContent = `${history.length} EVENTS`;
    const event = history[index];
    const eventDate = new Date(event.at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    elements.replayLabel.textContent = `EVENT ${index + 1}/${history.length} · ${eventDate} · ${event.message}`;

    const known = new Map(state.players.map((army) => [army.id, army]));
    const replayPlayers = event.players.map((army) => ({
      ...army,
      memberCount: known.get(army.id)?.memberCount || 1,
      host: known.get(army.id)?.host || false
    }));
    const replayMe = replayPlayers.find((army) => army.id === state.me.id);
    const replayState = {
      ...state,
      players: replayPlayers,
      me: replayMe ? { ...state.me, ap: replayMe.ap, hp: replayMe.hp, range: replayMe.range, alive: replayMe.alive } : state.me
    };
    renderBoard(replayState);
    elements.boardStatus.textContent = `REPLAY ${index + 1}/${history.length}`;
    elements.replayRoster.innerHTML = replayPlayers
      .slice()
      .sort((a, b) => Number(b.alive) - Number(a.alive))
      .map((army) => `<div class="replay-army"><strong><i class="player-colour-dot" style="display:inline-block;background:${safeColour(army.colour)};margin-right:6px"></i>${escapeHTML(army.name)}</strong><small>${army.hp} HP · ${army.ap} AP · ${army.alive ? "ACTIVE" : "OUT"} · ${coordinateLabel(army.x, army.y)}</small></div>`)
      .join("");
  }

  function renderBoard(state) {
    const width = state.width || state.size || 13;
    const height = state.height || state.size || 13;
    const playerAt = new Map();
    for (const player of state.players) {
      const projected = planningOpen ? projectedArmyState(player.id) : player;
      if (Number.isInteger(projected.x) && Number.isInteger(projected.y)) {
        playerAt.set(`${projected.x},${projected.y}`, { ...player, x: projected.x, y: projected.y, plannedPosition: projected.plannedPosition });
      }
    }
    const me = state.me;
    const selectedArmyId = planningOpen ? (planArmyId || me.id) : me.id;
    const actingArmy = state.players.find((player) => player.id === selectedArmyId);
    const plan = planningOpen ? derivePlan() : null;
    const displayX = planningOpen ? plan.x : actingArmy?.x;
    const displayY = planningOpen ? plan.y : actingArmy?.y;
    const displayRange = planningOpen ? plan.range : me.range;
    const activeMode = planningOpen ? planMode : selectedMode;
    const cells = [];
    const topLabels = [];
    const sideLabels = [];
    for (let x = 0; x < width; x += 1) topLabels.push(`<span>${columnLabel(x)}</span>`);
    for (let y = 0; y < height; y += 1) sideLabels.push(`<span>${y + 1}</span>`);
    elements.axisTop.innerHTML = topLabels.join("");
    elements.axisSide.innerHTML = sideLabels.join("");

    const liveMove = !planningOpen && state.status === "active" && me.alive && selectedMode === "move" && me.ap >= 1;
    const liveTarget = !planningOpen && state.status === "active" && me.alive && ["attack", "gift-ap", "gift-heart"].includes(selectedMode);
    const planMove = planningOpen && state.status === "active" && Boolean(actingArmy?.alive) && planMode === "move";
    const planTarget = planningOpen && state.status === "active" && Boolean(actingArmy?.alive) && ["attack", "gift-ap", "gift-heart"].includes(planMode);
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

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const key = `${x},${y}`;
        const player = playerAt.get(key);
        const distance = Number.isInteger(displayX) && Number.isInteger(displayY)
          ? Math.abs(displayX - x) + Math.abs(displayY - y)
          : Number.POSITIVE_INFINITY;
        const adjacent = distance === 1;
        const inRange = distance > 0 && distance <= displayRange;
        const canMove = (liveMove || planMove) && (!player || player.id === selectedArmyId) && adjacent;
        const targetMode = activeMode;
        const canTargetPlayer = player && player.id !== selectedArmyId && inRange && (
          targetMode === "gift-heart" || player.alive
        );
        const classes = ["board-cell"];
        if (canMove) classes.push("can-move");
        if ((liveTarget || planTarget) && inRange) classes.push(planningOpen ? "plan-range-cell" : "range-cell");
        if ((liveTarget || planTarget) && canTargetPlayer) classes.push("can-target");
        if (player?.id === selectedArmyId) classes.push("selected-cell");
        if (planningOpen && pathSteps.has(key)) classes.push("plan-route-cell");
        if (planningOpen && x === plan.x && y === plan.y) classes.push("plan-position-cell");

        let content = "";
        let title = coordinateLabel(x, y);
        if (player) {
          const playerName = escapeHTML(player.name);
          const dead = !player.alive;
          content = `<span class="army-token ${player.id === selectedArmyId ? "you" : ""} ${dead ? "dead" : ""}" style="background:${safeColour(player.colour)}">${dead ? "×" : "A"}</span>`;
          if (planningOpen && player.plannedPosition) content += `<span class="plan-ghost-marker" aria-hidden="true">P</span>`;
          title += ` · ${playerName} · ${player.hp} HP${dead ? " · OUT" : ""}`;
        }
        if (planningOpen && pathSteps.has(key)) {
          content += `<span class="plan-step-badge">${pathSteps.get(key)}</span>`;
        }
        if (planningOpen && x === plan.x && y === plan.y && (x !== actingArmy?.x || y !== actingArmy?.y)) {
          content += `<span class="plan-ghost-marker">P</span>`;
          title += " · Planned position";
        }
        if ((liveTarget || planTarget) && inRange) title += ` · In ${displayRange}-step range`;
        cells.push(`<button type="button" role="gridcell" class="${classes.join(" ")}" data-x="${x}" data-y="${y}" aria-label="${escapeHTML(title)}" title="${escapeHTML(title)}">${content}</button>`);
      }
    }
    elements.board.style.gridTemplateColumns = `repeat(${width}, minmax(0, 1fr))`;
    elements.board.style.gridTemplateRows = `repeat(${height}, minmax(0, 1fr))`;
    elements.board.style.aspectRatio = `${width} / ${height}`;
    elements.board.innerHTML = cells.join("");
  }

  function renderMyStatus(state) {
    const me = state.me;
    const x = Number.isInteger(state.players.find((p) => p.id === me.id)?.x) ? state.players.find((p) => p.id === me.id).x : null;
    const y = Number.isInteger(state.players.find((p) => p.id === me.id)?.y) ? state.players.find((p) => p.id === me.id).y : null;
    elements.myName.textContent = `${me.name} · ${me.members?.length || 1} MEMBER${(me.members?.length || 1) === 1 ? "" : "S"}`;
    elements.myHp.textContent = `${me.hp} HP`;
    elements.myRange.textContent = `${me.range} CELLS`;
    elements.myAp.textContent = me.ap;
    elements.myApSmall.textContent = me.ap;
    elements.myArmyBadge.style.background = safeColour(state.players.find((p) => p.id === me.id)?.colour);
    elements.myArmyBadge.textContent = me.alive ? "A" : "×";
    elements.myCoords.textContent = x === null ? "POSITION —" : `POSITION ${coordinateLabel(x, y)}`;
    elements.myStatus.textContent = me.alive ? "ACTIVE" : "JURY";
    elements.myStatus.style.color = me.alive ? "var(--mint)" : "var(--orange)";
  }

  function renderRoster(state) {
    const players = state.players.slice().sort((a, b) => Number(b.alive) - Number(a.alive));
    elements.rosterCount.textContent = `${players.length} ARMIES`;
    elements.roster.innerHTML = players.map((player) => {
      const isMe = player.id === state.me.id;
      const status = player.alive ? `${player.hp} HP · R${player.range}` : "OUT";
      const apText = state.status === "finished" ? `${player.ap ?? 0} AP` : isMe ? `<span class="ap-private">${state.me.ap} AP</span>` : "AP HIDDEN";
      return `<div class="roster-player ${isMe ? "you" : ""} ${player.alive ? "" : "dead"}">
        <i class="player-colour-dot" style="background:${safeColour(player.colour)}"></i>
        <span class="roster-player-name">${escapeHTML(player.name)}${player.host ? " ★" : ""}${isMe ? " (YOUR ARMY)" : ""}<small class="roster-member-count">${player.memberCount || 1} MEMBER${(player.memberCount || 1) === 1 ? "" : "S"}</small></span>
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
      elements.jury.innerHTML = `<p>You are part of the Jury. Vote for a living army.</p>
        <select id="juryTarget" aria-label="Choose an army">${living.map((p) => `<option value="${p.id}">${escapeHTML(p.name)}</option>`).join("")}</select>
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

  function loadPlanDrafts(roomCode, playerKey) {
    try {
      const parsed = JSON.parse(localStorage.getItem(planStorageKey(roomCode, playerKey)) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function savePlanDrafts() {
    if (!currentRoom || !currentPlayerKey) return;
    try {
      localStorage.setItem(planStorageKey(currentRoom, currentPlayerKey), JSON.stringify(planDrafts));
    } catch {
      showToast("Your private plans could not be saved in this browser.", true);
    }
  }

  function selectedPlanArmy() {
    return currentState?.players.find((army) => army.id === planArmyId) || currentState?.players.find((army) => army.id === currentState.me.id);
  }

  function allPlannedActions() {
    const all = [];
    for (const [armyId, actions] of Object.entries(planDrafts)) {
      for (const action of actions || []) all.push({ ...action, sourceArmyId: armyId });
    }
    if (!planDrafts[planArmyId]) {
      for (const action of planActions) all.push({ ...action, sourceArmyId: planArmyId });
    }
    return all;
  }

  function derivePlan(armyId = planArmyId, actions = planActions) {
    const acting = currentState?.players.find((army) => army.id === armyId);
    let x = acting?.x ?? 0;
    let y = acting?.y ?? 0;
    let range = acting?.range ?? 0;
    let hp = acting?.hp ?? 0;
    let cost = 0;
    const targetHp = {};
    const targetAlive = {};
    for (const army of currentState?.players ?? []) {
      targetHp[army.id] = army.hp;
      targetAlive[army.id] = army.alive;
    }

    for (const action of actions) {
      cost += action.cost;
      if (action.type === "move") { x = action.x; y = action.y; }
      if (action.type === "upgrade") range += 1;
      if (action.type === "heal") hp += 1;
      if (action.type === "attack" && action.targetId) {
        targetHp[action.targetId] = Math.max(0, (targetHp[action.targetId] ?? 0) - 1);
        if (targetHp[action.targetId] === 0) targetAlive[action.targetId] = false;
      }
      if (action.type === "gift-heart" && action.targetId) {
        targetHp[action.targetId] = targetAlive[action.targetId]
          ? (targetHp[action.targetId] ?? 0) + 1
          : 1;
        targetAlive[action.targetId] = true;
      }
    }
    return { x, y, range, hp, cost, targetHp, targetAlive };
  }

  function projectedArmyState(armyId) {
    const army = currentState?.players.find((item) => item.id === armyId);
    if (!army) return {};
    const actions = planDrafts[armyId] || (armyId === planArmyId ? planActions : []);
    let x = army.x;
    let y = army.y;
    for (const action of actions) {
      if (action.type === "move") { x = action.x; y = action.y; }
    }
    return {
      x,
      y,
      plannedPosition: Number.isInteger(x) && (x !== army.x || y !== army.y)
    };
  }

  function planBudgetBase() {
    if (!currentState || !planArmyId) return null;
    if (planArmyId === currentState.me.id) return currentState.me.ap;
    const raw = apEstimates[planArmyId];
    if (raw === undefined || raw === "") return null;
    return Math.max(0, Math.floor(Number(raw) || 0));
  }

  function planBudget() {
    const base = planBudgetBase();
    return base === null ? null : base + planFutureTicks;
  }

  function planCoordinate(x, y) { return coordinateLabel(x, y); }

  function queuePlanAction(action) {
    const plan = derivePlan();
    const budget = planBudget();
    if (budget === null) {
      showToast("Enter an estimated AP value for this army before planning its actions.", true);
      return;
    }
    if (plan.cost + action.cost > budget) {
      showToast(`That plan costs ${plan.cost + action.cost} AP, but the projected budget is ${budget} AP.`, true);
      return;
    }
    planActions.push(action);
    planDrafts[planArmyId] = planActions;
    savePlanDrafts();
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
    const activeArmies = currentState.players.filter((army) => army.alive);
    if (!activeArmies.some((army) => army.id === planArmyId)) planArmyId = currentState.me.alive ? currentState.me.id : (activeArmies[0]?.id ?? currentState.me.id);
    if (!planArmyId) planArmyId = currentState.me.id;
    planActions = planDrafts[planArmyId] || [];
    elements.planArmySelect.innerHTML = currentState.players.map((army) =>
      `<option value="${army.id}" ${army.alive ? "" : "disabled"}>${escapeHTML(army.name)}${army.id === currentState.me.id ? " · YOUR ARMY" : ""}${army.alive ? "" : " · OUT"}</option>`
    ).join("");
    elements.planArmySelect.value = planArmyId;

    const acting = selectedPlanArmy();
    const plan = derivePlan();
    const budget = planBudget();
    const remaining = budget === null ? null : budget - plan.cost;
    elements.planBudget.textContent = budget === null ? "SET ESTIMATE" : String(budget);
    elements.planCost.textContent = String(plan.cost);
    elements.planRemaining.textContent = remaining === null ? "—" : String(remaining);
    elements.planPosition.textContent = planCoordinate(plan.x, plan.y);
    elements.planRange.textContent = `${plan.range} STEPS`;
    elements.planHp.textContent = `${plan.hp} HP`;
    elements.planActionCount.textContent = `${planActions.length} ACTION${planActions.length === 1 ? "" : "S"}`;
    elements.planRemaining.classList.toggle("negative", remaining !== null && remaining < 0);

    const prompts = {
      move: `Click an empty square one step from ${acting?.name || "this army"}'s planned position (${planCoordinate(plan.x, plan.y)}). Each square costs 1 AP.`,
      attack: `Click a living army within ${plan.range} steps of ${planCoordinate(plan.x, plan.y)}.`,
      "gift-ap": `Click a living army within ${plan.range} steps of ${planCoordinate(plan.x, plan.y)}.`,
      "gift-heart": `Click any other army within ${plan.range} steps of ${planCoordinate(plan.x, plan.y)}.`,
      heal: "Add HP has been queued for the selected army.",
      upgrade: "Range upgrade has been queued for the selected army."
    };
    if (!acting?.alive) elements.planHint.textContent = "This army is out of action and cannot make moves.";
    else if (budget === null) elements.planHint.textContent = "Enter this army's estimated AP in the estimates panel before adding actions. You can also plan future AP ticks.";
    else elements.planHint.textContent = prompts[planMode] || `Build a private plan for ${acting?.name || "the selected army"}. Select a tool, then the board.`;
    updatePlanModeButtons();

    elements.planQueue.innerHTML = planActions.length ? planActions.map((action, index) => {
      let description = "";
      if (action.type === "move") description = `Move to ${planCoordinate(action.x, action.y)}`;
      else if (action.type === "attack" && action.targetName) description = `Attack · ${escapeHTML(action.targetName)} (${action.targetHpBefore} → ${Math.max(0, action.targetHpBefore - 1)} HP)`;
      else if (action.type === "gift-heart" && action.targetName) {
        const result = action.targetWasAlive ? `${action.targetHpBefore} → ${action.targetHpAfter} HP` : `revive · ${action.targetHpAfter} HP`;
        description = `Gift heart · ${escapeHTML(action.targetName)} (${result})`;
      } else if (action.targetName) description = `${planActionName(action.type)} · ${escapeHTML(action.targetName)}`;
      else description = planActionName(action.type);
      return `<div class="plan-queue-item"><span class="plan-queue-index">${index + 1}</span><span>${description}</span><small>${action.cost} AP</small></div>`;
    }).join("") : `<p class="plan-empty">No actions planned yet for this army.</p>`;

    renderArmyEstimates();
    elements.undoPlan.disabled = planActions.length === 0;
    elements.clearPlan.disabled = planActions.length === 0;
    elements.copyPlan.disabled = !Object.values(planDrafts).some((actions) => actions.length) && planActions.length === 0;
  }

  function planActionName(type) {
    return ({ move: "Move", attack: "Attack", "gift-ap": "Gift 1 AP", "gift-heart": "Gift heart", heal: "Add 1 HP", upgrade: "Upgrade range" })[type] || type;
  }

  function renderArmyEstimates() {
    const planned = allPlannedActions();
    elements.planOpponentEstimates.innerHTML = currentState.players.map((army) => {
      const isMe = army.id === currentState.me.id;
      const raw = isMe ? String(currentState.me.ap) : apEstimates[army.id];
      const hasEstimate = isMe || (raw !== undefined && raw !== "");
      const value = hasEstimate ? Math.max(0, Math.floor(Number(raw) || 0)) : 0;
      const plannedGifts = planned.filter((action) => action.type === "gift-ap" && action.targetId === army.id).length;
      const forecast = hasEstimate ? `${value + (army.alive ? planFutureTicks : 0) + plannedGifts} AP` : "—";
      return `<label class="plan-opponent-row">
        <span class="plan-opponent-name"><i class="player-colour-dot" style="background:${safeColour(army.colour)}"></i>${escapeHTML(army.name)}${isMe ? " · YOU" : ""}${army.alive ? "" : " · OUT"}</span>
        <span class="plan-opponent-input"><input type="number" min="0" max="999" step="1" inputmode="numeric" data-estimate-player="${army.id}" aria-label="Estimated AP for ${escapeHTML(army.name)}" value="${raw === undefined ? "" : escapeHTML(raw)}" placeholder="?" ${isMe ? "disabled" : ""}> <small>AP now</small></span>
        <span class="plan-opponent-forecast">${forecast} after ${planFutureTicks} tick${planFutureTicks === 1 ? "" : "s"}${plannedGifts ? ` + ${plannedGifts} planned AP gift${plannedGifts === 1 ? "" : "s"}` : ""}</span>
      </label>`;
    }).join("");
  }

  function handlePlanningBoardClick(x, y, armyAtCell) {
    if (!planMode) {
      const plan = derivePlan();
      const acting = selectedPlanArmy();
      elements.planHint.textContent = `Choose a tool first. ${acting?.name || "This army"}'s planned position is ${planCoordinate(plan.x, plan.y)}.`;
      return;
    }
    const actor = selectedPlanArmy();
    if (!actor?.alive) {
      showToast("Only a living army can be planned.", true);
      return;
    }
    const plan = derivePlan();
    if (planMode === "move") {
      const distance = Math.abs(plan.x - x) + Math.abs(plan.y - y);
      if (distance !== 1) {
        showToast("Plan movement one adjacent square at a time.", true);
        return;
      }
      if (armyAtCell && armyAtCell.id !== planArmyId) {
        showToast("That square is occupied by another army.", true);
        return;
      }
      queuePlanAction({ type: "move", x, y, cost: 1 });
      return;
    }

    if (!["attack", "gift-ap", "gift-heart"].includes(planMode)) return;
    if (!armyAtCell || armyAtCell.id === planArmyId) {
      showToast("Select another army on the board.", true);
      return;
    }
    if (planMode !== "gift-heart" && !plan.targetAlive[armyAtCell.id]) {
      showToast("That planned action requires a living army.", true);
      return;
    }
    const distance = Math.abs(plan.x - armyAtCell.x) + Math.abs(plan.y - armyAtCell.y);
    if (distance === 0 || distance > plan.range) {
      showToast(`That army is outside the planned range of ${plan.range} steps.`, true);
      return;
    }
    const cost = planMode === "gift-heart" ? 3 : 1;
    const targetHpBefore = plan.targetHp[armyAtCell.id] ?? armyAtCell.hp;
    const targetWasAlive = Boolean(plan.targetAlive[armyAtCell.id]);
    const targetHpAfter = planMode === "gift-heart" ? (targetWasAlive ? targetHpBefore + 1 : 1) : targetHpBefore;
    queuePlanAction({
      type: planMode,
      targetId: armyAtCell.id,
      targetName: armyAtCell.name,
      targetHpBefore,
      targetHpAfter,
      targetWasAlive,
      cost
    });
  }

  function togglePlanning(force) {
    const next = typeof force === "boolean" ? force : !planningOpen;
    if (next && (!currentState || currentState.status !== "active" || !currentState.players.some((army) => army.alive))) return;
    if (next) {
      planningOpen = true;
      selectedMode = null;
      document.querySelectorAll(".action-button[data-mode]").forEach((button) => button.classList.remove("active"));
      if (!currentState.players.some((army) => army.id === planArmyId && army.alive)) {
        planArmyId = currentState.players.find((army) => army.id === currentState.me.id && army.alive)?.id
          || currentState.players.find((army) => army.alive)?.id;
      }
      planActions = planDrafts[planArmyId] || [];
      elements.planningToggle.classList.add("active");
      elements.planningToggle.textContent = "◎ Close planning";
      elements.planningPanel.hidden = false;
      renderPlanning();
      renderBoard(currentState);
      return;
    }
    if (planArmyId) planDrafts[planArmyId] = planActions;
    savePlanDrafts();
    planningOpen = false;
    planMode = null;
    elements.planningPanel.hidden = true;
    elements.planningToggle.classList.remove("active");
    elements.planningToggle.textContent = "◎ Private planning";
    if (currentState) renderBoard(currentState);
  }

  function planSummaryText() {
    const lines = ["TANK TURN TACTICS — PRIVATE PLAN", `Room: ${currentRoom}`, `Projected AP ticks: ${planFutureTicks}`, ""];
    for (const army of currentState?.players || []) {
      const actions = planDrafts[army.id] || (army.id === planArmyId ? planActions : []);
      if (!actions.length) continue;
      const estimate = army.id === currentState.me.id ? currentState.me.ap : apEstimates[army.id];
      lines.push(`${army.name} — ${estimate === undefined || estimate === "" ? "AP unknown" : `${estimate} AP estimated`}`);
      actions.forEach((action, index) => {
        const target = action.targetName ? ` → ${action.targetName}` : "";
        const place = action.type === "move" ? ` to ${coordinateLabel(action.x, action.y)}` : "";
        lines.push(`  ${index + 1}. ${planActionName(action.type)}${target}${place} (${action.cost} AP)`);
      });
      const projected = derivePlan(army.id, actions);
      lines.push(`  Projected state: ${coordinateLabel(projected.x, projected.y)}, ${projected.hp} HP, range ${projected.range}`);
      lines.push("");
    }
    return lines.join("\n");
  }

  function projectedArmyAt(x, y) {
    if (!planningOpen) return currentState.players.find((army) => army.x === x && army.y === y);
    const army = currentState.players.find((item) => {
      const projected = projectedArmyState(item.id);
      return projected.x === x && projected.y === y;
    });
    return army ? { ...army, ...projectedArmyState(army.id) } : undefined;
  }

  function setMode(mode) {
    if (planningOpen) togglePlanning(false);
    selectedMode = selectedMode === mode ? null : mode;
    for (const button of document.querySelectorAll(".action-button[data-mode]")) {
      button.classList.toggle("active", button.dataset.mode === selectedMode);
    }
    const prompts = {
      move: "Select an adjacent empty square to move into.",
      attack: `Range radius: ${currentState.me.range} orthogonal steps (Manhattan distance). Select a living opposing army in the highlighted area.`,
      "gift-ap": `Gift range: ${currentState.me.range} orthogonal steps (Manhattan distance). Select a living army in the highlighted area.`,
      "gift-heart": `Gift range: ${currentState.me.range} orthogonal steps (Manhattan distance). Select another army in the highlighted area; this can revive it.`
    };
    elements.actionPrompt.textContent = selectedMode ? `${selectedMode.replace("-", " ").toUpperCase()} SELECTED` : "Choose an action";
    elements.actionHint.textContent = prompts[selectedMode] || "Select an action, then select a square or army on the board.";
    if (currentState) renderBoard(currentState);
  }

  function updateActionControls(state) {
    const disabled = state.status !== "active" || !state.me.alive;
    elements.planningToggle.disabled = state.status !== "active" || !state.players.some((army) => army.alive);
    for (const button of document.querySelectorAll(".action-button")) button.disabled = disabled;
    elements.heal.disabled = disabled || state.me.ap < 3;
    elements.upgrade.disabled = disabled || state.me.ap < 3;
    for (const button of document.querySelectorAll(".action-button[data-mode]")) {
      button.disabled = disabled || (button.dataset.mode === "gift-heart" ? state.me.ap < 3 : state.me.ap < 1);
      button.classList.toggle("active", button.dataset.mode === selectedMode);
    }
    if (!state.me.alive && state.status === "active") {
      elements.actionPrompt.textContent = "Your army is out of action";
      elements.actionHint.textContent = "You can still chat, vote in the Jury and use private planning to study the other armies.";
      selectedMode = null;
    } else if (state.status === "finished") {
      planningOpen = false;
      planMode = null;
      elements.planningPanel.hidden = true;
      elements.planningToggle.classList.remove("active");
      elements.planningToggle.textContent = "◎ Private planning";
      elements.actionPrompt.textContent = "Operation complete";
      elements.actionHint.textContent = "The last army standing has won. The board is now locked.";
      selectedMode = null;
    }
  }

  function handleBoardClick(event) {
    const cell = event.target.closest(".board-cell");
    if (!cell || !currentState) return;
    const x = Number(cell.dataset.x);
    const y = Number(cell.dataset.y);
    const player = projectedArmyAt(x, y);
    if (planningOpen) {
      handlePlanningBoardClick(x, y, player);
      return;
    }
    if (!selectedMode) {
      if (player && player.id !== currentState.me.id) {
        elements.actionHint.textContent = `${player.name}: ${player.alive ? `${player.hp} HP · range ${player.range}` : "eliminated"}. Choose an action to interact with them.`;
      } else if (player?.id === currentState.me.id) {
        elements.actionHint.textContent = `Your army is at ${planCoordinate(x, y)}. Choose an action above.`;
      }
      return;
    }
    if (selectedMode === "move") {
      sendAction({ type: "move", x, y });
    } else {
      if (!player || player.id === currentState.me.id) {
        showToast("Select another army on the board.", true);
        return;
      }
      sendAction({ type: selectedMode, targetId: player.id });
    }
  }

  function sendAction(action) {
    request("game-action", action, () => {
      selectedMode = null;
      planActions = [];
      planDrafts[currentState.me.id] = [];
      savePlanDrafts();
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
  elements.firstTickAt.addEventListener("input", () => { firstTickManuallySet = Boolean(elements.firstTickAt.value); });
  elements.apSpeed.addEventListener("input", () => setDefaultFirstTick());
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
  elements.planArmySelect.addEventListener("change", () => {
    if (!planningOpen) return;
    if (planArmyId) planDrafts[planArmyId] = planActions;
    planArmyId = elements.planArmySelect.value;
    planActions = planDrafts[planArmyId] || [];
    planMode = null;
    savePlanDrafts();
    renderPlanning();
    renderBoard(currentState);
  });
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
    planDrafts[planArmyId] = planActions;
    savePlanDrafts();
    planMode = null;
    renderPlanning();
    renderBoard(currentState);
  });
  elements.clearPlan.addEventListener("click", () => {
    planActions = [];
    planDrafts[planArmyId] = [];
    savePlanDrafts();
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

  elements.previewRoom.addEventListener("click", previewJoinRoom);
  elements.requestArmyJoin.addEventListener("click", requestJoinSelectedArmy);
  elements.cancelJoinWait.addEventListener("click", cancelPendingJoin);
  elements.armyMembership.addEventListener("click", (event) => {
    const button = event.target.closest("[data-join-decision]");
    if (!button) return;
    request("respond-army-join", {
      requestId: button.dataset.requestId,
      approved: button.dataset.joinDecision === "accept"
    }, () => showToast(button.dataset.joinDecision === "accept" ? "Army membership approved." : "Army membership declined."));
  });
  if ($("lobbyMembership")) $("lobbyMembership").addEventListener("click", (event) => {
    const button = event.target.closest("[data-join-decision]");
    if (!button) return;
    request("respond-army-join", {
      requestId: button.dataset.requestId,
      approved: button.dataset.joinDecision === "accept"
    }, () => showToast(button.dataset.joinDecision === "accept" ? "Army membership approved." : "Army membership declined."));
  });
  elements.replaySlider.addEventListener("input", () => {
    if (currentState?.status === "finished") renderReplay(currentState, Number(elements.replaySlider.value));
  });

  socket.on("connect", () => {
    setConnection(true);
    if (currentRoom && currentPlayerKey && currentPlayerName) {
      if (waitingForApproval && pendingJoinDetails) {
        request("request-army-join", pendingJoinDetails, (response) => {
          if (response.joined && response.state) enterRoom(response.state, currentPlayerKey, response.state.me.name || currentPlayerName);
          else if (response.requestId) localStorage.setItem(pendingJoinStorageKey(currentRoom), JSON.stringify({ ...pendingJoinDetails, requestId: response.requestId }));
        });
      } else {
        request("join-room", { code: currentRoom, name: currentPlayerName, clientKey: currentPlayerKey }, (response) => {
          updateRoomState(response.state);
        });
      }
    }
    if (!lastConnected && !currentRoom) autoJoinFromInvite();
    lastConnected = true;
  });
  socket.on("disconnect", () => setConnection(false));
  socket.on("connect_error", () => setConnection(false));
  socket.on("room-state", updateRoomState);
  socket.on("room-error", (message) => showToast(message, true));
  socket.on("army-join-result", (result) => {
    if (result?.ok && result.state) {
      enterRoom(result.state, currentPlayerKey, currentPlayerName);
      showToast("Your army membership request was approved.");
    } else {
      if (currentRoom) {
        localStorage.removeItem(pendingJoinStorageKey(currentRoom));
        localStorage.removeItem(playerStorageKey(currentRoom));
        localStorage.removeItem(nameStorageKey(currentRoom));
      }
      showLanding();
      showToast(result?.message || "Your request was declined.", true);
    }
  });

  setDefaultFirstTick();
  setConnection(socket.connected);
  setInterval(updateCountdown, 1000);
})();
