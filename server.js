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
  for (const socket of sockets) {
    try {
      socket.emit("room-state", publicState(room, socket.data.playerId));
    } catch {
      socket.emit("room-error", "Your player session is no longer connected to this room. Rejoin using the same browser.");
    }
  }
}

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => res.json({ ok: true, storage: pool ? "postgres" : "local" }));

io.on("connection", (socket) => {
  socket.on("create-room", async (payload = {}, ack) => {
    try {
      let room;
      let player;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        room = createRoom(payload);
        try {
          player = Object.values(room.players)[0];
          await createStoredRoom(room);
          break;
        } catch (error) {
          if (attempt === 7) throw error;
          if (!String(error.message).toLowerCase().includes("duplicate")) throw error;
        }
      }
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      const state = publicState(room, player.id);
      if (typeof ack === "function") ack({ ok: true, state });
      socket.emit("room-state", state);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("join-room", async (payload = {}, ack) => {
    try {
      const code = String(payload.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
      if (code.length !== 6) throw new Error("Enter the six-character room code.");
      let player;
      const room = await updateStoredRoom(code, (current) => {
        player = addPlayer(current, payload);
        applyElapsedTicks(current);
      });
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.playerId = player.id;
      const state = publicState(room, player.id);
      if (typeof ack === "function") ack({ ok: true, state });
      await broadcastRoom(code, room);
    } catch (error) {
      ackError(ack, error);
    }
  });

  socket.on("start-game", async (_payload, ack) => {
    try {
      const code = socket.data.roomCode;
      if (!code) throw new Error("Join a room first.");
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
      if (!code) throw new Error("Join a room first.");
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
      if (!code) throw new Error("Join a room first.");
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
      if (!code) throw new Error("Join a room first.");
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
      if (!code) return;
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
  });

  socket.on("disconnect", () => {
    socket.data.roomCode = null;
    socket.data.playerId = null;
  });
});

initStore()
  .then(() => {
    server.listen(PORT, () => console.log(`Tank Turn Tactics running on port ${PORT}`));
  })
  .catch((error) => {
    console.error("Could not start the game server:", error);
    process.exit(1);
  });

process.on("SIGTERM", async () => {
  if (pool) await pool.end().catch(() => {});
  server.close(() => process.exit(0));
});
