const crypto = require("node:crypto");

const MAX_ARMIES = 32;
const MAX_BOARD_DIMENSION = 40;
const MAX_MEMBERS_PER_ARMY = 12;
const PLAYER_COLOURS = [
  "#63c5da", "#f3b65b", "#d68be8", "#8dcf8b", "#f07f79",
  "#a6a5ff", "#e5d36f", "#70c9ae", "#f29ac2", "#b0bac6",
  "#db9766", "#8daee8", "#b6d46d", "#df8fa8", "#78b7a3",
  "#c4a0ee", "#e7a66e", "#7ba8d9", "#d3c56e", "#7fc4d1",
  "#cb8a72", "#9bc68e", "#b88de0", "#e08b8b", "#83a7b2",
  "#d6b38a", "#a8b2e8", "#9cbf73", "#d68fbe", "#79b9a7",
  "#c5a36c", "#8ea9d5"
];
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeId() { return crypto.randomUUID(); }

function makeRoomCode() {
  let code = "";
  for (let i = 0; i < 6; i += 1) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return code;
}

function cleanName(value) {
  return String(value ?? "").trim().replace(/[<>]/g, "").slice(0, 20);
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function columnLabel(index) {
  let n = Number(index) + 1;
  let result = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function coordinateLabel(x, y) { return `${columnLabel(x)}${y + 1}`; }

function addLog(room, message, type = "normal") {
  room.log ??= [];
  room.log.unshift({ id: makeId(), message, type, at: Date.now() });
  room.log = room.log.slice(0, 70);
}

function addPrivateNotification(army, message, kind = "ap") {
  army.notifications ??= [];
  army.notifications.unshift({ id: makeId(), message, kind, at: Date.now() });
  army.notifications = army.notifications.slice(0, 40);
}

function ensureArmyMembers(army) {
  if (!Array.isArray(army.members)) {
    army.members = army.clientKey ? [{ clientKey: army.clientKey, name: army.name, joinedAt: army.joinedAt || Date.now() }] : [];
  }
  if (army.clientKey && !army.members.some((member) => member.clientKey === army.clientKey)) {
    army.members.unshift({ clientKey: army.clientKey, name: army.name, joinedAt: army.joinedAt || Date.now() });
  }
  army.notifications ??= [];
  return army.members;
}

function manhattan(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

function occupied(room, x, y, exceptId = null) {
  return Object.values(room.players).some((army) => army.id !== exceptId && army.x === x && army.y === y);
}

function randomFreeCell(room, minDistanceFromPlayers = 0) {
  const width = room.width ?? room.size ?? 13;
  const height = room.height ?? room.size ?? 13;
  const cells = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (occupied(room, x, y)) continue;
      const farEnough = Object.values(room.players)
        .filter((army) => Number.isInteger(army.x) && Number.isInteger(army.y))
        .every((army) => manhattan(army, { x, y }) >= minDistanceFromPlayers);
      if (farEnough) cells.push({ x, y });
    }
  }
  if (!cells.length && minDistanceFromPlayers > 0) return randomFreeCell(room, 0);
  if (!cells.length) return null;
  return cells[Math.floor(Math.random() * cells.length)];
}

function makePlayer(name, clientKey, isHost, index) {
  const joinedAt = Date.now();
  return {
    id: makeId(),
    clientKey,
    members: [{ clientKey, name, joinedAt }],
    notifications: [],
    name,
    colour: PLAYER_COLOURS[index % PLAYER_COLOURS.length],
    host: isHost,
    x: null,
    y: null,
    hp: 3,
    ap: 0,
    range: 2,
    alive: true,
    killedBy: null,
    joinedAt
  };
}

function createRoom({ name, clientKey, size = 13, width, height, tickMinutes = 1440, firstTickAt = null }) {
  const safeName = cleanName(name);
  if (!safeName) throw new Error("Enter an army name first.");
  if (!clientKey || String(clientKey).length < 12) throw new Error("Device session could not be created. Please refresh and try again.");
  const boardWidth = boundedInteger(width ?? size, 13, 6, MAX_BOARD_DIMENSION);
  const boardHeight = boundedInteger(height ?? size, 13, 6, MAX_BOARD_DIMENSION);
  const interval = boundedInteger(tickMinutes, 1440, 1, 10080);
  const requestedFirstTick = Number(firstTickAt);
  const player = makePlayer(safeName, String(clientKey), true, 0);
  return {
    code: makeRoomCode(),
    status: "lobby",
    width: boardWidth,
    height: boardHeight,
    size: boardWidth === boardHeight ? boardWidth : undefined,
    maxArmies: MAX_ARMIES,
    tickMinutes: interval,
    firstTickAt: Number.isFinite(requestedFirstTick) && requestedFirstTick > 0 ? requestedFirstTick : null,
    createdAt: Date.now(),
    startedAt: null,
    nextTickAt: null,
    players: { [player.id]: player },
    juryVotes: {},
    joinRequests: [],
    tickNumber: 0,
    winnerId: null,
    history: [],
    log: [{ id: makeId(), message: `${safeName} created the room.`, type: "normal", at: Date.now() }],
    chat: []
  };
}

function findArmyByClientKey(room, clientKey) {
  return Object.values(room.players).find((army) => ensureArmyMembers(army).some((member) => member.clientKey === clientKey));
}

function addPlayer(room, { name, clientKey }) {
  const safeName = cleanName(name);
  const key = String(clientKey ?? "");
  if (!safeName) throw new Error("Enter an army name first.");
  if (key.length < 12) throw new Error("Device session could not be created. Please refresh and try again.");
  const existing = findArmyByClientKey(room, key);
  if (existing) return existing;
  if (room.status !== "lobby") throw new Error("This game has already started. Use the request-to-join option to join an existing army.");
  if (Object.keys(room.players).length >= (room.maxArmies || MAX_ARMIES)) throw new Error(`This room is full (${room.maxArmies || MAX_ARMIES} armies maximum).`);
  const army = makePlayer(safeName, key, false, Object.keys(room.players).length);
  room.players[army.id] = army;
  addLog(room, `${safeName} joined the room.`);
  return army;
}

function requestArmyJoin(room, { armyId, name, clientKey }) {
  const safeName = cleanName(name);
  const key = String(clientKey ?? "");
  if (!safeName) throw new Error("Enter a callsign first.");
  if (key.length < 12) throw new Error("Device session could not be created. Please refresh and try again.");
  if (room.status === "finished") throw new Error("This game has finished and is no longer accepting army members.");
  const alreadyIn = findArmyByClientKey(room, key);
  if (alreadyIn) {
    if (alreadyIn.id === String(armyId)) return { alreadyMember: true, armyId: alreadyIn.id };
    throw new Error("This device is already linked to another army in this room.");
  }
  const army = room.players[String(armyId)];
  if (!army) throw new Error("Choose an army that is still in this game.");
  const members = ensureArmyMembers(army);
  if (members.length >= MAX_MEMBERS_PER_ARMY) throw new Error(`That army already has ${MAX_MEMBERS_PER_ARMY} devices/members linked.`);
  room.joinRequests ??= [];
  const alreadyPending = room.joinRequests.find((request) => request.clientKey === key);
  if (alreadyPending) {
    if (alreadyPending.armyId === army.id) return alreadyPending;
    throw new Error("This device already has a pending request to join another army.");
  }
  const request = { id: makeId(), armyId: army.id, clientKey: key, name: safeName, at: Date.now() };
  room.joinRequests.push(request);
  return request;
}

function respondArmyJoin(room, responderArmyId, requestId, approved) {
  if (room.status === "finished") throw new Error("This game has finished and cannot accept new army members.");
  const requestIndex = (room.joinRequests ?? []).findIndex((request) => request.id === String(requestId) && request.armyId === String(responderArmyId));
  if (requestIndex < 0) throw new Error("That army membership request is no longer pending.");
  const request = room.joinRequests[requestIndex];
  const army = room.players[String(responderArmyId)];
  if (!army) throw new Error("Army not found.");
  if (approved) {
    const members = ensureArmyMembers(army);
    if (members.length >= MAX_MEMBERS_PER_ARMY) throw new Error(`That army already has ${MAX_MEMBERS_PER_ARMY} devices/members linked.`);
    if (findArmyByClientKey(room, request.clientKey)) throw new Error("That device has already joined an army in this room.");
    members.push({ clientKey: request.clientKey, name: request.name, joinedAt: Date.now() });
  }
  room.joinRequests.splice(requestIndex, 1);
  return { approved: Boolean(approved), armyId: army.id, clientKey: request.clientKey, name: request.name };
}

function recordHistory(room, message, type = "event", at = Date.now()) {
  room.history ??= [];
  const snapshot = {
    id: makeId(),
    message: String(message || "Game event"),
    type,
    at,
    players: Object.values(room.players).map((army) => ({
      id: army.id,
      name: army.name,
      colour: army.colour,
      x: army.x,
      y: army.y,
      hp: army.hp,
      ap: army.ap,
      range: army.range,
      alive: army.alive
    }))
  };
  room.history.push(snapshot);
  if (room.history.length > 5000) room.history.splice(0, room.history.length - 5000);
  return snapshot;
}

function startGame(room, hostId) {
  if (room.status !== "lobby") throw new Error("This game has already started.");
  if (room.players[hostId]?.host !== true) throw new Error("Only the host army can start the game.");
  const armies = Object.values(room.players);
  if (armies.length < 2) throw new Error("At least two armies are needed to start.");
  const width = room.width ?? room.size ?? 13;
  const height = room.height ?? room.size ?? 13;
  if (width * height < armies.length * 2) throw new Error("Choose a larger board for the number of armies in the lobby.");

  room.juryVotes = {};
  room.tickNumber = 0;
  for (const army of armies) {
    ensureArmyMembers(army);
    army.hp = 3;
    army.ap = 0;
    army.range = 2;
    army.alive = true;
    army.killedBy = null;
    army.x = null;
    army.y = null;
  }

  for (const army of armies) {
    const spot = randomFreeCell(room, 3);
    if (!spot) throw new Error("There is not enough room for every army. Choose a larger board.");
    army.x = spot.x;
    army.y = spot.y;
  }

  room.status = "active";
  room.startedAt = Date.now();
  const tickMs = room.tickMinutes * 60_000;
  let firstTick = Number(room.firstTickAt);
  if (!Number.isFinite(firstTick) || firstTick <= 0) firstTick = room.startedAt + tickMs;
  if (firstTick <= room.startedAt) firstTick += (Math.floor((room.startedAt - firstTick) / tickMs) + 1) * tickMs;
  room.nextTickAt = firstTick;
  room.history = [];
  recordHistory(room, "Game started", "start", room.startedAt);
}

function applyElapsedTicks(room, now = Date.now()) {
  if (room.status !== "active" || !room.nextTickAt) return false;
  const tickMs = room.tickMinutes * 60_000;
  let changed = false;
  let safety = 0;
  while (now >= room.nextTickAt && safety < 500) {
    safety += 1;
    const tickAt = room.nextTickAt;
    room.tickNumber += 1;
    for (const army of Object.values(room.players)) {
      if (army.alive) army.ap += 1;
    }

    const voteCounts = {};
    for (const targetId of Object.values(room.juryVotes ?? {})) voteCounts[targetId] = (voteCounts[targetId] ?? 0) + 1;
    const juryAwards = [];
    for (const [targetId, votes] of Object.entries(voteCounts)) {
      const target = room.players[targetId];
      if (target?.alive && votes >= 3) {
        target.ap += 1;
        addPrivateNotification(target, "The Jury awarded your army 1 AP.", "jury-ap");
        juryAwards.push(target.name);
      }
    }
    room.juryVotes = {};
    room.nextTickAt += tickMs;
    const detail = juryAwards.length ? `AP tick ${room.tickNumber}; Jury bonus awarded` : `AP tick ${room.tickNumber}`;
    recordHistory(room, detail, "tick", tickAt);
    changed = true;
  }
  return changed;
}

function checkWinner(room) {
  if (room.status !== "active") return;
  const alive = Object.values(room.players).filter((army) => army.alive);
  if (alive.length <= 1) {
    room.status = "finished";
    room.winnerId = alive[0]?.id ?? null;
    addLog(room, alive[0] ? `${alive[0].name} is the last army standing.` : "The game ended without a winner.", "important");
  }
}

function playerForAction(room, playerId) {
  const army = room.players[playerId];
  if (!army) throw new Error("Your device is no longer linked to an army in this room.");
  if (room.status !== "active") throw new Error("The game is not currently active.");
  if (!army.alive) throw new Error("Your army is out of action. You can still vote in the Jury.");
  return army;
}

function spend(army, cost) {
  if (army.ap < cost) throw new Error(`Your army needs ${cost} AP for that action, but has only ${army.ap}.`);
  army.ap -= cost;
}

function performAction(room, playerId, action) {
  const actor = playerForAction(room, playerId);
  const type = action?.type;
  let historyMessage = "Game action";

  if (type === "move") {
    const x = Number(action.x);
    const y = Number(action.y);
    const width = room.width ?? room.size ?? 13;
    const height = room.height ?? room.size ?? 13;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= width || y >= height) throw new Error("That square is outside the board.");
    if (manhattan(actor, { x, y }) !== 1) throw new Error("You can only move one square up, down, left or right.");
    if (occupied(room, x, y, actor.id)) throw new Error("That square is already occupied.");
    spend(actor, 1);
    actor.x = x;
    actor.y = y;
    addLog(room, `${actor.name} moved to ${coordinateLabel(x, y)}.`, "location");
    historyMessage = `${actor.name} moved to ${coordinateLabel(x, y)}`;
  } else if (type === "attack") {
    const target = room.players[String(action.targetId)];
    if (!target || !target.alive || target.id === actor.id) throw new Error("Choose a living opposing army.");
    if (manhattan(actor, target) > actor.range) throw new Error("That army is outside your range.");
    spend(actor, 1);
    target.hp -= 1;
    addLog(room, `${target.name} was hit.`, "hit");
    historyMessage = `${actor.name} hit ${target.name}`;
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.killedBy = actor.id;
      target.ap = 0;
      addLog(room, `${actor.name} got the last hit on ${target.name}.`, "last-hit");
      historyMessage = `${actor.name} got the last hit on ${target.name}`;
    }
  } else if (type === "upgrade") {
    spend(actor, 3);
    actor.range += 1;
    addLog(room, `${actor.name} upgraded range to ${actor.range}.`, "action");
    historyMessage = `${actor.name} upgraded range to ${actor.range}`;
  } else if (type === "heal") {
    spend(actor, 3);
    actor.hp += 1;
    addLog(room, `${actor.name} added 1 HP. They now have ${actor.hp} HP.`, "action");
    historyMessage = `${actor.name} added 1 HP`;
  } else if (type === "gift-ap") {
    const target = room.players[String(action.targetId)];
    if (!target || !target.alive || target.id === actor.id) throw new Error("Choose a living opposing army to receive the AP.");
    if (manhattan(actor, target) > actor.range) throw new Error("That army is outside your range.");
    spend(actor, 1);
    target.ap += 1;
    addPrivateNotification(target, `${actor.name} gave your army 1 AP.`, "gift-ap");
    historyMessage = "An AP transfer was completed";
  } else if (type === "gift-heart") {
    const target = room.players[String(action.targetId)];
    if (!target || target.id === actor.id) throw new Error("Choose another army to receive the heart.");
    if (manhattan(actor, target) > actor.range) throw new Error("That army is outside your range.");
    spend(actor, 3);
    if (!target.alive) {
      target.alive = true;
      target.hp = 1;
      target.ap = 0;
      target.killedBy = null;
      addLog(room, `${actor.name} revived ${target.name}. They return with 1 HP and 0 AP.`, "important");
      historyMessage = `${actor.name} revived ${target.name} with 1 HP`;
    } else {
      target.hp += 1;
      addLog(room, `${actor.name} gave ${target.name} 1 HP.`, "action");
      historyMessage = `${actor.name} gave ${target.name} 1 HP`;
    }
  } else {
    throw new Error("Unknown action.");
  }

  checkWinner(room);
  recordHistory(room, historyMessage, "action");
}

function castJuryVote(room, playerId, targetId) {
  const voter = room.players[playerId];
  const target = room.players[targetId];
  if (room.status !== "active") throw new Error("The game is not currently active.");
  if (!voter || voter.alive) throw new Error("Only eliminated armies can vote in the Jury.");
  if (!target || !target.alive) throw new Error("Choose a living army to receive your vote.");
  if (room.juryVotes[playerId]) throw new Error("Your army has already voted in this AP cycle.");
  room.juryVotes[playerId] = targetId;
  recordHistory(room, "A Jury vote was recorded", "jury-vote");
}

function addChatMessage(room, playerId, text) {
  const army = room.players[playerId];
  if (!army) throw new Error("Army not found.");
  const message = String(text ?? "").trim().replace(/[<>]/g, "").slice(0, 240);
  if (!message) throw new Error("Write a message first.");
  room.chat ??= [];
  room.chat.push({ id: makeId(), playerId, name: army.name, colour: army.colour, message, at: Date.now() });
  room.chat = room.chat.slice(-60);
}

function publicFieldLog(room) {
  const entries = Array.isArray(room.log) ? room.log : [];
  const visible = [];
  const legacyLastHit = /^(.+?)'s tank is out of action\. Their remaining AP went to (.+)\.$/;
  const legacyHit = /^(.+?) hit (.+)\. \2 has (\d+) HP left\.$/;
  const legacyMove = /^(.+?) moved to ([A-Z]+\d+)\.$/;
  for (const entry of entries) {
    const message = String(entry.message ?? "");
    if (entry.type === "location" || legacyMove.test(message)) {
      if (entry.type === "location") visible.push({ ...entry, type: "location" });
      else {
        const match = message.match(legacyMove);
        visible.push({ ...entry, message: `${match[1]} moved to ${match[2]}.`, type: "location" });
      }
      continue;
    }
    if (entry.type === "hit") { visible.push({ ...entry, type: "hit" }); continue; }
    if (entry.type === "last-hit") { visible.push({ ...entry, type: "last-hit" }); continue; }
    const oldHit = message.match(legacyHit);
    if (oldHit) { visible.push({ ...entry, message: `${oldHit[2]} was hit.`, type: "hit" }); continue; }
    const oldLastHit = message.match(legacyLastHit);
    if (oldLastHit) visible.push({ ...entry, message: `${oldLastHit[2]} got the last hit on ${oldLastHit[1]}.`, type: "last-hit" });
  }
  return visible.slice(0, 70);
}

function publicState(room, playerId) {
  const me = room.players[playerId];
  if (!me) throw new Error("Your device is no longer linked to an army in this room.");
  const isFinished = room.status === "finished";
  const players = Object.values(room.players).map((army) => {
    ensureArmyMembers(army);
    const publicArmy = {
      id: army.id,
      name: army.name,
      colour: army.colour,
      host: army.host,
      x: army.x,
      y: army.y,
      hp: army.hp,
      range: army.range,
      alive: army.alive,
      memberCount: army.members.length,
      memberNames: army.members.map((member) => member.name),
      hasVoted: Boolean(room.juryVotes?.[army.id])
    };
    if (isFinished) publicArmy.ap = army.ap;
    return publicArmy;
  });
  const ownMembers = ensureArmyMembers(me).map((member) => ({ name: member.name, joinedAt: member.joinedAt }));
  const ownRequests = (room.joinRequests ?? []).filter((request) => request.armyId === me.id)
    .map((request) => ({ id: request.id, name: request.name, at: request.at }));
  return {
    code: room.code,
    status: room.status,
    width: room.width ?? room.size ?? 13,
    height: room.height ?? room.size ?? 13,
    size: room.size,
    maxArmies: room.maxArmies || MAX_ARMIES,
    tickMinutes: room.tickMinutes,
    firstTickAt: room.firstTickAt ?? null,
    nextTickAt: room.nextTickAt,
    tickNumber: room.tickNumber,
    winnerId: room.winnerId,
    players,
    log: publicFieldLog(room),
    chat: room.chat ?? [],
    history: isFinished ? (room.history ?? []) : undefined,
    me: {
      id: me.id,
      name: me.name,
      ap: me.ap,
      hp: me.hp,
      range: me.range,
      alive: me.alive,
      host: me.host,
      hasVoted: Boolean(room.juryVotes?.[me.id]),
      members: ownMembers,
      joinRequests: ownRequests,
      notifications: (me.notifications ?? []).slice(0, 8)
    }
  };
}

module.exports = {
  addChatMessage,
  addPlayer,
  addPrivateNotification,
  applyElapsedTicks,
  castJuryVote,
  columnLabel,
  coordinateLabel,
  createRoom,
  makeRoomCode,
  performAction,
  publicState,
  publicFieldLog,
  recordHistory,
  requestArmyJoin,
  respondArmyJoin,
  startGame,
  manhattan,
  MAX_ARMIES,
  MAX_BOARD_DIMENSION
};
