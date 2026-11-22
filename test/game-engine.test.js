const test = require("node:test");
const assert = require("node:assert/strict");
const {
  addPlayer,
  applyElapsedTicks,
  castJuryVote,
  createRoom,
  performAction,
  publicState,
  startGame
} = require("../game-engine");

function setup() {
  const room = createRoom({ name: "Alpha", clientKey: "alpha-session-key-123", size: 11, tickMinutes: 1 });
  const alpha = Object.values(room.players)[0];
  const bravo = addPlayer(room, { name: "Bravo", clientKey: "bravo-session-key-123" });
  startGame(room, alpha.id);
  return { room, alpha, bravo };
}

test("a room starts with separated tanks, health and zero AP", () => {
  const { room, alpha, bravo } = setup();
  assert.equal(room.status, "active");
  assert.equal(alpha.hp, 3);
  assert.equal(bravo.hp, 3);
  assert.equal(alpha.ap, 0);
  assert.equal(bravo.ap, 0);
  assert.ok(Math.abs(alpha.x - bravo.x) + Math.abs(alpha.y - bravo.y) >= 3);
});

test("movement costs one AP and only allows an adjacent free cell", () => {
  const { room, alpha } = setup();
  alpha.ap = 1;
  let error;
  try { performAction(room, alpha.id, { type: "move", x: alpha.x + 2, y: alpha.y }); } catch (e) { error = e; }
  assert.match(error.message, /one square/);
  const target = [
    { x: alpha.x + 1, y: alpha.y }, { x: alpha.x - 1, y: alpha.y },
    { x: alpha.x, y: alpha.y + 1 }, { x: alpha.x, y: alpha.y - 1 }
  ].find((point) => point.x >= 0 && point.y >= 0 && point.x < room.size && point.y < room.size && !room.rocks.some((r) => r.x === point.x && r.y === point.y) && !Object.values(room.players).some((p) => p.id !== alpha.id && p.x === point.x && p.y === point.y));
  assert.ok(target);
  performAction(room, alpha.id, { type: "move", ...target });
  assert.equal(alpha.ap, 0);
  assert.deepEqual({ x: alpha.x, y: alpha.y }, target);
});

test("the public board hides other players' AP", () => {
  const { room, alpha, bravo } = setup();
  alpha.ap = 4;
  bravo.ap = 7;
  const visibleToAlpha = publicState(room, alpha.id);
  assert.equal(visibleToAlpha.me.ap, 4);
  assert.equal("ap" in visibleToAlpha.players.find((p) => p.id === bravo.id), false);
});

test("AP ticks give one AP to living players and not eliminated players", () => {
  const { room, alpha, bravo } = setup();
  bravo.alive = false;
  const firstTick = room.nextTickAt;
  const changed = applyElapsedTicks(room, firstTick);
  assert.equal(changed, true);
  assert.equal(alpha.ap, 1);
  assert.equal(bravo.ap, 0);
  assert.equal(room.tickNumber, 1);
});

test("three Jury votes award one bonus AP at the next tick", () => {
  const room = createRoom({ name: "A", clientKey: "a-session-key-123", size: 13, tickMinutes: 1 });
  const a = Object.values(room.players)[0];
  const b = addPlayer(room, { name: "B", clientKey: "b-session-key-123" });
  const c = addPlayer(room, { name: "C", clientKey: "c-session-key-123" });
  const d = addPlayer(room, { name: "D", clientKey: "d-session-key-123" });
  startGame(room, a.id);
  b.alive = false;
  c.alive = false;
  d.alive = false;
  castJuryVote(room, b.id, a.id);
  castJuryVote(room, c.id, a.id);
  castJuryVote(room, d.id, a.id);
  applyElapsedTicks(room, room.nextTickAt);
  assert.equal(a.ap, 2); // 1 regular AP + 1 Jury bonus AP
});
