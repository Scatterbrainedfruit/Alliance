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
    heal: $("healButton"), upgrade: $("upgradeButton"), jury: $("juryVoteBlock"), winner: $("winnerTitle"), finalRoster: $("finalRoster"), toast: $("toast")
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
    const rocks = new Set(state.rocks.map((rock) => `${rock.x},${rock.y}`));
    const me = state.me;
    const myTank = state.players.find((player) => player.id === me.id);
    const cells = [];
    const topLabels = [];
    const sideLabels = [];
    for (let x = 0; x < size; x += 1) topLabels.push(`<span>${String.fromCharCode(65 + x)}</span>`);
    for (let y = 0; y < size; y += 1) sideLabels.push(`<span>${y + 1}</span>`);
    elements.axisTop.innerHTML = topLabels.join("");
    elements.axisSide.innerHTML = sideLabels.join("");

    const validMove = state.status === "active" && me.alive && selectedMode === "move" && me.ap >= 1;
    const validTarget = state.status === "active" && me.alive && ["attack", "gift-ap", "gift-heart"].includes(selectedMode);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const key = `${x},${y}`;
        const player = playerAt.get(key);
        const isRock = rocks.has(key);
        const isHeart = state.heart?.x === x && state.heart?.y === y;
        const distance = myTank ? Math.abs(myTank.x - x) + Math.abs(myTank.y - y) : Number.POSITIVE_INFINITY;
        const adjacent = distance === 1;
        const inRange = distance > 0 && distance <= me.range;
        const canMove = validMove && !player && !isRock && adjacent;
        const canTarget = validTarget && player && player.id !== me.id && inRange && (selectedMode === "gift-heart" || player.alive);
        const classes = ["board-cell"];
        if (isRock) classes.push("rock");
        if (canMove) classes.push("can-move");
        if (canTarget) classes.push("can-target");
        if (validTarget && inRange && player && player.id !== me.id) classes.push("range-cell");
        if (isHeart) classes.push("heart-cell");
        if (player?.id === me.id) classes.push("selected-cell");

        let content = "";
        let title = `${String.fromCharCode(65 + x)}${y + 1}`;
        if (isRock) {
          content = `<span class="rock-shape"></span>`;
          title += " · Rock";
        } else if (player) {
          const playerName = escapeHTML(player.name);
          const dead = !player.alive;
          content = `<span class="tank-token ${player.id === me.id ? "you" : ""} ${dead ? "dead" : ""}" style="background:${safeColour(player.colour)}">${dead ? "×" : "T"}</span>`;
          title += ` · ${playerName} · ${player.hp} HP${dead ? " · OUT" : ""}`;
        } else if (isHeart) {
          content = `<span class="bonus-heart">✦</span>`;
          title += " · Bonus heart";
        }
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

  function setMode(mode) {
    selectedMode = selectedMode === mode ? null : mode;
    for (const button of document.querySelectorAll(".action-button[data-mode]")) {
      button.classList.toggle("active", button.dataset.mode === selectedMode);
    }
    const prompts = {
      move: "Select an adjacent empty square to move into.",
      attack: "Select a living opponent within your range.",
      "gift-ap": "Select a living player within your range to gift 1 AP.",
      "gift-heart": "Select a player within your range. A heart can revive an eliminated player."
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
      elements.actionPrompt.textContent = "Your tank is out of action";
      elements.actionHint.textContent = "You can still chat and vote as part of the Jury. Another player may revive you with a gifted heart.";
      selectedMode = null;
    } else if (state.status === "finished") {
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
    if (!selectedMode) {
      if (player && player.id !== currentState.me.id) {
        elements.actionHint.textContent = `${player.name}: ${player.alive ? `${player.hp} HP · range ${player.range}` : "eliminated"}. Choose an action to interact with them.`;
      } else if (player?.id === currentState.me.id) {
        elements.actionHint.textContent = `Your tank is at ${String.fromCharCode(65 + x)}${y + 1}. Choose an action above.`;
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
