const path = require("node:path");
const fs = require("node:fs/promises");
const http = require("node:http");
const express = require("express");
const { Server } = require("socket.io");
const { Pool } = require("pg");
const {
  addChatMessage,
  addPlayer,
  applyElapsedTicks,
  castJuryVote,
  createRoom,
  performAction,
  publicState,
  recordHistory,
  requestArmyJoin,
  respondArmyJoin,
  startGame
} = require("./game-engine");

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "games.json");
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, methods: ["GET", "POST"] } });

let pool = null;
const memoryGames = new Map();
const roomLocks = new Map();

function withRoomLock(code, task) {
  const previous = roomLocks.get(code) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  const queued = current.finally(() => {
    if (roomLocks.get(code) === queued) roomLocks.delete(code);
  });
  roomLocks.set(code, queued);
  return current;
}

async function initStore() {
  if (process.env.DATABASE_URL) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000
    });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tank_turn_tactics_games (
        code TEXT PRIMARY KEY,
        state JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    console.log("Using PostgreSQL game storage.");
  } else {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      const raw = await fs.readFile(DATA_FILE, "utf8");
      const entries = JSON.parse(raw);
      for (const [code, state] of Object.entries(entries)) memoryGames.set(code, state);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    console.log("Using local JSON game storage. Set DATABASE_URL for hosted persistent storage.");
  }
}

async function saveLocalGames() {
  const serialised = Object.fromEntries(memoryGames.entries());
  await fs.writeFile(DATA_FILE, JSON.stringify(serialised, null, 2), "utf8");
}

async function createStoredRoom(room) {
  if (pool) {
    await pool.query("INSERT INTO tank_turn_tactics_games (code, state) VALUES ($1, $2::jsonb)", [room.code, JSON.stringify(room)]);
  } else {
    memoryGames.set(room.code, room);
    await saveLocalGames();
  }
  return room;
}

async function updateStoredRoom(code, mutator) {
  return withRoomLock(code, async () => {
    let room;
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query("SELECT state FROM tank_turn_tactics_games WHERE code = $1 FOR UPDATE", [code]);
        if (!result.rowCount) throw new Error("Room not found. Check the invite code.");
        room = result.rows[0].state;
        if (typeof room === "string") room = JSON.parse(room);
        if (room.status === "active" && (!Array.isArray(room.history) || room.history.length === 0)) {
          recordHistory(room, "Replay baseline recorded after update", "start");
        }
        await mutator(room);
        await client.query("UPDATE tank_turn_tactics_games SET state = $2::jsonb, updated_at = NOW() WHERE code = $1", [code, JSON.stringify(room)]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    } else {
      room = memoryGames.get(code);
      if (!room) throw new Error("Room not found. Check the invite code.");
      if (room.status === "active" && (!Array.isArray(room.history) || room.history.length === 0)) {
        recordHistory(room, "Replay baseline recorded after update", "start");
      }
      await mutator(room);
      memoryGames.set(code, room);
      await saveLocalGames();
    }
    return room;
  });
}

async function getStoredRoom(code) {
  let room;
  if (pool) {
    const result = await pool.query("SELECT state FROM tank_turn_tactics_games WHERE code = $1", [code]);
    if (!result.rowCount) throw new Error("Room not found. Check the invite code.");
    room = result.rows[0].state;
    if (typeof room === "string") room = JSON.parse(room);
  } else {
    room = memoryGames.get(code);
    if (!room) throw new Error("Room not found. Check the invite code.");
  }
  return room;
}

function ackError(ack, error) {
  const message = error instanceof Error ? error.message : "Something went wrong. Please try again.";
  if (typeof ack === "function") ack({ ok: false, error: message });
}

async function broadcastRoom(code, room) {
  const sockets = await io.in(code).fetchSockets();
  for (const client of sockets) {
    if (!client.data.playerId) continue; // Pending membership requests do not see the board.
    try {
      client.emit("room-state", publicState(room, client.data.playerId));
    } catch {
      client.emit("room-error", "Your device is no longer linked to an army in this room. Rejoin using the same device.");
    }
  }
}

function cleanRoomCode(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

io.on("connection", (socket) => {
  socket.on("create-room", async (payload = {}, ack) => {
    try {
      let room;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        room = createRoom(payload);
        try {
          const army = Object.values(room.players)[0];
          await createStoredRoom(room);
          socket.join(room.code);
          socket.data.roomCode = room.code;
          socket.data.playerId = army.id;
          socket.data.clientKey = String(payload.clientKey);
          if (typeof ack === "function") ack({ ok: true, state: publicState(room, army.id) });
          socket.emit("room-state", publicState(room, army.id));
          return;
        } catch (error) {
          if (attempt === 7 || !String(error.message).toLowerCase().includes("duplicate")) throw error;
        }
      }
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("preview-room", async (payload = {}, ack) => {
    try {
      const code = cleanRoomCode(payload.code);
      if (code.length !== 6) throw new Error("Enter the six-character room code.");
      const room = await getStoredRoom(code);
      const result = {
        ok: true,
        room: {
          code,
          status: room.status,
          width: room.width ?? room.size ?? 13,
          height: room.height ?? room.size ?? 13,
          maxArmies: room.maxArmies || 32,
          armies: Object.values(room.players).map((army) => ({
            id: army.id,
            name: army.name,
            colour: army.colour,
            memberCount: Array.isArray(army.members) ? army.members.length : 1,
            alive: army.alive
          }))
        }
      };
      if (typeof ack === "function") ack(result);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("join-room", async (payload = {}, ack) => {
    try {
      const code = cleanRoomCode(payload.code);
      if (code.length !== 6) throw new Error("Enter the six-character room code.");
      let army;
      const room = await updateStoredRoom(code, (current) => {
        army = addPlayer(current, payload);
        applyElapsedTicks(current);
      });
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.playerId = army.id;
      socket.data.clientKey = String(payload.clientKey);
      socket.data.pendingClientKey = null;
      const state = publicState(room, army.id);
      if (typeof ack === "function") ack({ ok: true, state });
      await broadcastRoom(code, room);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("request-army-join", async (payload = {}, ack) => {
    try {
      const code = cleanRoomCode(payload.code);
      if (code.length !== 6) throw new Error("Enter the six-character room code.");
      const clientKey = String(payload.clientKey ?? "");
      let requestResult;
      const room = await updateStoredRoom(code, (current) => {
        applyElapsedTicks(current);
        requestResult = requestArmyJoin(current, {
          armyId: String(payload.armyId ?? ""),
          name: payload.name,
          clientKey
        });
      });
      if (requestResult.alreadyMember) {
        socket.join(code);
        socket.data.roomCode = code;
        socket.data.playerId = requestResult.armyId;
        socket.data.clientKey = clientKey;
        socket.data.pendingClientKey = null;
        socket.data.pendingRequestId = null;
        if (typeof ack === "function") ack({ ok: true, joined: true, state: publicState(room, requestResult.armyId) });
        return;
      }
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.playerId = null;
      socket.data.clientKey = null;
      socket.data.pendingClientKey = clientKey;
      socket.data.pendingRequestId = requestResult.id;
      if (typeof ack === "function") ack({ ok: true, waiting: true, requestId: requestResult.id });
      await broadcastRoom(code, room);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("respond-army-join", async (payload = {}, ack) => {
    try {
      const code = socket.data.roomCode;
      const responderArmyId = socket.data.playerId;
      if (!code || !responderArmyId) throw new Error("Join your army before responding to requests.");
      let decision;
      const room = await updateStoredRoom(code, (current) => {
        applyElapsedTicks(current);
        decision = respondArmyJoin(current, responderArmyId, String(payload.requestId ?? ""), Boolean(payload.approved));
      });
      const connected = await io.in(code).fetchSockets();
      for (const client of connected) {
        if (client.data.pendingClientKey === decision.clientKey && client.data.pendingRequestId === String(payload.requestId)) {
          if (decision.approved) {
            client.data.playerId = decision.armyId;
            client.data.clientKey = decision.clientKey;
            client.data.pendingClientKey = null;
            client.data.pendingRequestId = null;
            client.emit("army-join-result", { ok: true, state: publicState(room, decision.armyId) });
          } else {
            client.emit("army-join-result", { ok: false, message: "Your request to join that army was declined." });
            client.leave(code);
            client.data.roomCode = null;
            client.data.pendingClientKey = null;
            client.data.pendingRequestId = null;
          }
        }
      }
      if (typeof ack === "function") ack({ ok: true });
      await broadcastRoom(code, room);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("cancel-army-join", async (payload = {}, ack) => {
    try {
      const code = cleanRoomCode(payload.code || socket.data.roomCode);
      if (code.length !== 6) throw new Error("Room not found. Check the invite code.");
      const clientKey = String(payload.clientKey ?? socket.data.pendingClientKey ?? "");
      if (!socket.data.pendingClientKey || socket.data.pendingClientKey !== clientKey) {
        throw new Error("You can only cancel a join request made from this device.");
      }
      const room = await updateStoredRoom(code, (current) => {
        current.joinRequests = (current.joinRequests ?? []).filter((request) => request.clientKey !== clientKey || request.armyId !== payload.armyId);
      });
      socket.leave(code);
      socket.data.roomCode = null;
      socket.data.playerId = null;
      socket.data.clientKey = null;
      socket.data.pendingClientKey = null;
      socket.data.pendingRequestId = null;
      if (typeof ack === "function") ack({ ok: true });
      await broadcastRoom(code, room);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("start-game", async (_payload, ack) => {
    try {
      const code = socket.data.roomCode;
      if (!code) throw new Error("Join an army first.");
      const room = await updateStoredRoom(code, (current) => startGame(current, socket.data.playerId));
      if (typeof ack === "function") ack({ ok: true });
      await broadcastRoom(code, room);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("game-action", async (action, ack) => {
    try {
      const code = socket.data.roomCode;
      if (!code) throw new Error("Join an army first.");
      const room = await updateStoredRoom(code, (current) => {
        applyElapsedTicks(current);
        performAction(current, socket.data.playerId, action);
      });
      if (typeof ack === "function") ack({ ok: true });
      await broadcastRoom(code, room);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("jury-vote", async (payload, ack) => {
    try {
      const code = socket.data.roomCode;
      if (!code) throw new Error("Join an army first.");
      const room = await updateStoredRoom(code, (current) => {
        applyElapsedTicks(current);
        castJuryVote(current, socket.data.playerId, String(payload?.targetId ?? ""));
      });
      if (typeof ack === "function") ack({ ok: true });
      await broadcastRoom(code, room);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("chat-message", async (payload, ack) => {
    try {
      const code = socket.data.roomCode;
      if (!code || !socket.data.playerId) throw new Error("Join an army first.");
      const room = await updateStoredRoom(code, (current) => addChatMessage(current, socket.data.playerId, payload?.message));
      if (typeof ack === "function") ack({ ok: true });
      await broadcastRoom(code, room);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("refresh-room", async () => {
    try {
      const code = socket.data.roomCode;
      if (!code || !socket.data.playerId) return;
      const room = await updateStoredRoom(code, (current) => applyElapsedTicks(current));
      await broadcastRoom(code, room);
    } catch (error) {
      socket.emit("room-error", error.message);
    }
  });

  socket.on("leave-room", () => {
    const code = socket.data.roomCode;
    if (code) socket.leave(code);
    socket.data.roomCode = null;
    socket.data.playerId = null;
    socket.data.clientKey = null;
    socket.data.pendingClientKey = null;
    socket.data.pendingRequestId = null;
  });

  socket.on("disconnect", () => {
    socket.data.roomCode = null;
    socket.data.playerId = null;
    socket.data.clientKey = null;
    socket.data.pendingClientKey = null;
    socket.data.pendingRequestId = null;
  });
});

initStore()
  .then(() => server.listen(PORT, () => console.log(`Tank Turn Tactics running on port ${PORT}`)))
  .catch((error) => {
    console.error("Could not start the game server:", error);
    process.exit(1);
  });

process.on("SIGTERM", async () => {
  if (pool) await pool.end().catch(() => {});
  server.close(() => process.exit(0));
});
