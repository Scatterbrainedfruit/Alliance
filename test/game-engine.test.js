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
  const invalidMove = alpha.x <= room.size - 3
    ? { x: alpha.x + 2, y: alpha.y }
    : { x: alpha.x - 2, y: alpha.y };
  let error;
  try { performAction(room, alpha.id, { type: "move", ...invalidMove }); } catch (e) { error = e; }
  assert.match(error.message, /one square/);
  const target = [
    { x: alpha.x + 1, y: alpha.y }, { x: alpha.x - 1, y: alpha.y },
    { x: alpha.x, y: alpha.y + 1 }, { x: alpha.x, y: alpha.y - 1 }
  ].find((point) => point.x >= 0 && point.y >= 0 && point.x < room.size && point.y < room.size && !Object.values(room.players).some((p) => p.id !== alpha.id && p.x === point.x && p.y === point.y));
  assert.ok(target);
  performAction(room, alpha.id, { type: "move", ...target });
  assert.equal(alpha.ap, 0);
  assert.deepEqual({ x: alpha.x, y: alpha.y }, target);
});

test("the public board hides other players' AP and contains no rocks or bonus heart", () => {
  const { room, alpha, bravo } = setup();
  alpha.ap = 4;
  bravo.ap = 7;
  const visibleToAlpha = publicState(room, alpha.id);
  assert.equal(visibleToAlpha.me.ap, 4);
  assert.equal("ap" in visibleToAlpha.players.find((p) => p.id === bravo.id), false);
  assert.equal("rocks" in visibleToAlpha, false);
  assert.equal("heart" in visibleToAlpha, false);
  assert.equal("rocks" in room, false);
  assert.equal("heart" in room, false);
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


test("eliminated players do not donate their remaining AP", () => {
  const { room, alpha, bravo } = setup();
  alpha.x = 4; alpha.y = 4;
  bravo.x = 5; bravo.y = 4;
  alpha.ap = 3;
  bravo.ap = 8;
  bravo.hp = 1;
  performAction(room, alpha.id, { type: "attack", targetId: bravo.id });
  assert.equal(alpha.ap, 2); // Only the 1 AP attack cost is deducted.
  assert.equal(bravo.ap, 0);
  assert.equal(bravo.alive, false);
  assert.ok(publicState(room, alpha.id).log.some((entry) => entry.message === "Alpha got the last hit on Bravo."));
  assert.ok(publicState(room, alpha.id).log.some((entry) => entry.message === "Bravo was hit."));
});

test("field log exposes hits without naming the attacker, and names the final hitter", () => {
  const { room, alpha, bravo } = setup();
  alpha.x = 4; alpha.y = 4;
  bravo.x = 5; bravo.y = 4;
  alpha.ap = 2;
  bravo.hp = 2;
  performAction(room, alpha.id, { type: "attack", targetId: bravo.id });
  const hitLog = publicState(room, alpha.id).log;
  assert.equal(hitLog[0].message, "Bravo was hit.");
  assert.equal(hitLog[0].message.includes("Alpha"), false);
  bravo.hp = 1;
  alpha.ap = 1;
  performAction(room, alpha.id, { type: "attack", targetId: bravo.id });
  const messages = publicState(room, alpha.id).log.map((entry) => entry.message);
  assert.ok(messages.includes("Alpha got the last hit on Bravo."));
  assert.ok(messages.includes("Bravo was hit."));
});

test("field log filters old AP donations and unrelated legacy events", () => {
  const { room, alpha } = setup();
  room.log = [
    { id: "a", message: "Alpha's tank is out of action. Their remaining AP went to Bravo.", type: "important", at: 5 },
    { id: "b", message: "Bravo hit Alpha. Alpha has 0 HP left.", type: "action", at: 4 },
    { id: "c", message: "Bravo gave 1 AP to Alpha.", type: "action", at: 3 },
    { id: "d", message: "Alpha moved to F6.", type: "normal", at: 2 },
    { id: "e", message: "AP tick 2: living players received 1 AP.", type: "tick", at: 1 }
  ];
  const messages = publicState(room, alpha.id).log.map((entry) => entry.message);
  assert.deepEqual(messages, [
    "Bravo got the last hit on Alpha.",
    "Alpha was hit.",
    "Alpha moved to F6."
  ]);
  assert.equal(messages.some((message) => /AP went|gave 1 AP|AP tick/i.test(message)), false);
});

test("AP gifts change AP but create no field-log entry", () => {
  const { room, alpha, bravo } = setup();
  alpha.x = 4; alpha.y = 4;
  bravo.x = 5; bravo.y = 4;
  alpha.ap = 2;
  performAction(room, alpha.id, { type: "gift-ap", targetId: bravo.id });
  assert.equal(alpha.ap, 1);
  assert.equal(bravo.ap, 1);
  assert.equal(publicState(room, alpha.id).log.length, 0);
});
