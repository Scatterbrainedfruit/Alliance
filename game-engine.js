const crypto = require("node:crypto");

const PLAYER_COLOURS = [
  "#63c5da", "#f3b65b", "#d68be8", "#8dcf8b", "#f07f79",
  "#a6a5ff", "#e5d36f", "#70c9ae", "#f29ac2", "#b0bac6",
  "#db9766", "#8daee8"
];

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeId() {
  return crypto.randomUUID();
}

function makeRoomCode() {
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function cleanName(value) {
  return String(value ?? "").trim().replace(/[<>]/g, "").slice(0, 20);
}

function addLog(room, message, type = "normal") {
  room.log ??= [];
  room.log.unshift({ id: makeId(), message, type, at: Date.now() });
  room.log = room.log.slice(0, 70);
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function occupied(room, x, y, exceptId = null) {
  return Object.values(room.players).some((p) => p.id !== exceptId && p.x === x && p.y === y);
}

function randomFreeCell(room, minDistanceFromPlayers = 0) {
  const cells = [];
  for (let y = 0; y < room.size; y += 1) {
    for (let x = 0; x < room.size; x += 1) {
      if (occupied(room, x, y)) continue;
      const farEnough = Object.values(room.players).filter((p) => Number.isInteger(p.x) && Number.isInteger(p.y)).every((p) => manhattan(p, { x, y }) >= minDistanceFromPlayers);
      if (farEnough) cells.push({ x, y });
    }
  }
  if (!cells.length && minDistanceFromPlayers > 0) return randomFreeCell(room, 0);
  if (!cells.length) return null;
  return cells[Math.floor(Math.random() * cells.length)];
}

function makePlayer(name, clientKey, isHost, index) {
  return {
    id: makeId(),
    clientKey,
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
    joinedAt: Date.now()
  };
}

function createRoom({ name, clientKey, size = 13, tickMinutes = 1440 }) {
  const safeName = cleanName(name);
  if (!safeName) throw new Error("Enter a player name first.");
  if (!clientKey || String(clientKey).length < 12) throw new Error("Player session could not be created. Please refresh and try again.");
  const player = makePlayer(safeName, clientKey, true, 0);
  return {
    code: makeRoomCode(),
    status: "lobby",
    size: Math.max(9, Math.min(17, Number(size) || 13)),
    tickMinutes: Math.max(1, Math.min(10080, Number(tickMinutes) || 1440)),
    createdAt: Date.now(),
    startedAt: null,
    nextTickAt: null,
    players: { [player.id]: player },
    juryVotes: {},
    tickNumber: 0,
    winnerId: null,
    log: [{ id: makeId(), message: `${safeName} created the room.`, type: "normal", at: Date.now() }],
    chat: []
  };
}

function addPlayer(room, { name, clientKey }) {
  const safeName = cleanName(name);
  if (!safeName) throw new Error("Enter a player name first.");
  if (!clientKey || String(clientKey).length < 12) throw new Error("Player session could not be created. Please refresh and try again.");
  const existing = Object.values(room.players).find((p) => p.clientKey === clientKey);
  if (existing) return existing;
  if (room.status !== "lobby") throw new Error("This game has already started, so it is no longer accepting players.");
  if (Object.keys(room.players).length >= 12) throw new Error("This room is full (12 players maximum).");
  const player = makePlayer(safeName, clientKey, false, Object.keys(room.players).length);
  room.players[player.id] = player;
  addLog(room, `${safeName} joined the room.`);
  return player;
}

function startGame(room, hostId) {
  if (room.status !== "lobby") throw new Error("This game has already started.");
  if (room.players[hostId]?.host !== true) throw new Error("Only the host can start the game.");
  const players = Object.values(room.players);
  if (players.length < 2) throw new Error("At least two players are needed to start.");

  room.juryVotes = {};
  room.tickNumber = 0;
  for (const player of players) {
    player.hp = 3;
    player.ap = 0;
    player.range = 2;
    player.alive = true;
    player.killedBy = null;
    player.x = null;
    player.y = null;
  }

  // Give each player a separated starting square on the open board.
  for (const player of players) {
    const spot = randomFreeCell(room, 3);
    if (!spot) throw new Error("There is not enough room for everyone. Choose a larger board.");
    player.x = spot.x;
    player.y = spot.y;
  }


  room.status = "active";
  room.startedAt = Date.now();
  room.nextTickAt = Date.now() + room.tickMinutes * 60_000;
  // The field log is deliberately reserved for movement and combat events.
}

function applyElapsedTicks(room, now = Date.now()) {
  if (room.status !== "active" || !room.nextTickAt) return false;
  const tickMs = room.tickMinutes * 60_000;
  let changed = false;
  let safety = 0;
  while (now >= room.nextTickAt && safety < 500) {
    safety += 1;
    room.tickNumber += 1;
    for (const player of Object.values(room.players)) {
      if (player.alive) player.ap += 1;
    }

    const voteCounts = {};
    for (const targetId of Object.values(room.juryVotes ?? {})) {
      voteCounts[targetId] = (voteCounts[targetId] ?? 0) + 1;
    }
    for (const [targetId, votes] of Object.entries(voteCounts)) {
      const target = room.players[targetId];
      if (target?.alive && votes >= 3) target.ap += 1;
    }
    room.juryVotes = {};
    room.nextTickAt += tickMs;
    changed = true;
  }
  return changed;
}

function checkWinner(room) {
  if (room.status !== "active") return;
  const alive = Object.values(room.players).filter((p) => p.alive);
  if (alive.length <= 1) {
    room.status = "finished";
    room.winnerId = alive[0]?.id ?? null;
    addLog(room, alive[0] ? `${alive[0].name} is the last tank standing.` : "The game ended without a winner.", "important");
  }
}

function playerForAction(room, playerId) {
  const player = room.players[playerId];
  if (!player) throw new Error("Your player session is no longer in this room.");
  if (room.status !== "active") throw new Error("The game is not currently active.");
  if (!player.alive) throw new Error("Your tank is out of action. You can still vote in the Jury.");
  return player;
}

function spend(player, cost) {
  if (player.ap < cost) throw new Error(`You need ${cost} AP for that action, but you only have ${player.ap}.`);
  player.ap -= cost;
}

function performAction(room, playerId, action) {
  const actor = playerForAction(room, playerId);
  const type = action?.type;

  if (type === "move") {
    const x = Number(action.x);
    const y = Number(action.y);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= room.size || y >= room.size) throw new Error("That square is outside the board.");
    if (manhattan(actor, { x, y }) !== 1) throw new Error("You can only move one square up, down, left or right.");
    if (occupied(room, x, y, actor.id)) throw new Error("That square is already occupied.");
    spend(actor, 1);
    actor.x = x;
    actor.y = y;
    addLog(room, `${actor.name} moved to ${String.fromCharCode(65 + x)}${y + 1}.`, "location");
  } else if (type === "attack") {
    const target = room.players[String(action.targetId)];
    if (!target || !target.alive || target.id === actor.id) throw new Error("Choose a living opponent.");
    if (manhattan(actor, target) > actor.range) throw new Error("That player is outside your range.");
    spend(actor, 1);
    target.hp -= 1;
    addLog(room, `${target.name} was hit.`, "hit");
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.killedBy = actor.id;
      // Eliminated players lose any unspent AP; it is never transferred.
      target.ap = 0;
      addLog(room, `${actor.name} got the last hit on ${target.name}.`, "last-hit");
    }
  } else if (type === "upgrade") {
    spend(actor, 3);
    actor.range += 1;
    addLog(room, `${actor.name} upgraded their range to ${actor.range}.`, "action");
  } else if (type === "heal") {
    spend(actor, 3);
    actor.hp += 1;
    addLog(room, `${actor.name} added 1 HP. They now have ${actor.hp} HP.`, "action");
  } else if (type === "gift-ap") {
    const target = room.players[String(action.targetId)];
    if (!target || !target.alive || target.id === actor.id) throw new Error("Choose a living player to receive the AP.");
    if (manhattan(actor, target) > actor.range) throw new Error("That player is outside your range.");
    spend(actor, 1);
    target.ap += 1;
  } else if (type === "gift-heart") {
    const target = room.players[String(action.targetId)];
    if (!target || target.id === actor.id) throw new Error("Choose another player to receive the heart.");
    if (manhattan(actor, target) > actor.range) throw new Error("That player is outside your range.");
    spend(actor, 3);
    if (!target.alive) {
      target.alive = true;
      target.hp = 1;
      target.ap = 0;
      target.killedBy = null;
      addLog(room, `${actor.name} revived ${target.name}. They return with 1 HP and 0 AP.`, "important");
    } else {
      target.hp += 1;
      addLog(room, `${actor.name} gave ${target.name} 1 HP.`, "action");
    }
  } else {
    throw new Error("Unknown action.");
  }

  checkWinner(room);
}

function castJuryVote(room, playerId, targetId) {
  const voter = room.players[playerId];
  const target = room.players[targetId];
  if (room.status !== "active") throw new Error("The game is not currently active.");
  if (!voter || voter.alive) throw new Error("Only eliminated players can vote in the Jury.");
  if (!target || !target.alive) throw new Error("Choose a living player to receive your vote.");
  if (room.juryVotes[playerId]) throw new Error("You have already voted in this AP cycle.");
  room.juryVotes[playerId] = targetId;

}

function addChatMessage(room, playerId, text) {
  const player = room.players[playerId];
  if (!player) throw new Error("Player not found.");
  const message = String(text ?? "").trim().replace(/[<>]/g, "").slice(0, 240);
  if (!message) throw new Error("Write a message first.");
  room.chat ??= [];
  room.chat.push({ id: makeId(), playerId, name: player.name, colour: player.colour, message, at: Date.now() });
  room.chat = room.chat.slice(-60);
}

function publicFieldLog(room) {
  const entries = Array.isArray(room.log) ? room.log : [];
  const visible = [];
  const legacyLastHit = /^(.+?)'s tank is out of action\. Their remaining AP went to (.+)\.$/;
  const legacyHit = /^(.+?) hit (.+)\. \2 has (\d+) HP left\.$/;
  const legacyMove = /^(.+?) moved to ([A-Z]\d+)\.$/;

  for (const entry of entries) {
    const message = String(entry.message ?? "");
    if (entry.type === "location" || legacyMove.test(message)) {
      if (entry.type === "location") {
        visible.push({ ...entry, type: "location" });
      } else {
        const match = message.match(legacyMove);
        visible.push({ ...entry, message: `${match[1]} moved to ${match[2]}.`, type: "location" });
      }
      continue;
    }
    if (entry.type === "hit") {
      visible.push({ ...entry, type: "hit" });
      continue;
    }
    if (entry.type === "last-hit") {
      visible.push({ ...entry, type: "last-hit" });
      continue;
    }

    // Clean up old rooms created before this restricted field log existed.
    const oldHit = message.match(legacyHit);
    if (oldHit) {
      visible.push({ ...entry, message: `${oldHit[2]} was hit.`, type: "hit" });
      continue;
    }
    const oldLastHit = message.match(legacyLastHit);
    if (oldLastHit) {
      visible.push({ ...entry, message: `${oldLastHit[2]} got the last hit on ${oldLastHit[1]}.`, type: "last-hit" });
    }
  }
  return visible.slice(0, 70);
}

function publicState(room, playerId) {
  const me = room.players[playerId];
  if (!me) throw new Error("Your player session is no longer in this room.");
  const players = Object.values(room.players).map((p) => ({
    id: p.id,
    name: p.name,
    colour: p.colour,
    host: p.host,
    x: p.x,
    y: p.y,
    hp: p.hp,
    range: p.range,
    alive: p.alive,
    hasVoted: Boolean(room.juryVotes?.[p.id])
  }));
  return {
    code: room.code,
    status: room.status,
    size: room.size,
    tickMinutes: room.tickMinutes,
    nextTickAt: room.nextTickAt,
    tickNumber: room.tickNumber,
    winnerId: room.winnerId,
    players,
    log: publicFieldLog(room),
    chat: room.chat,
    me: {
      id: me.id,
      name: me.name,
      ap: me.ap,
      hp: me.hp,
      range: me.range,
      alive: me.alive,
      host: me.host,
      hasVoted: Boolean(room.juryVotes?.[me.id])
    }
  };
}

module.exports = {
  addChatMessage,
  addPlayer,
  applyElapsedTicks,
  castJuryVote,
  createRoom,
  makeRoomCode,
  performAction,
  publicState,
  publicFieldLog,
  startGame,
  manhattan
};
