# Tank Turn Tactics — Multiplayer Strategy Board

A mobile-friendly, shared strategy board. Players create an army or request to join an existing army from another device. The server checks actions and updates the board for every linked member in real time.

## Features

- Private rooms with six-character invite codes and shareable links.
- Up to **32 armies** per room, with up to 12 linked members/devices in each army.
- Separate board width and height settings, each from 6 to 40 squares.
- Custom AP interval from 1 minute to 7 days, plus an exact first AP tick date and time in the creator's local time zone.
- Request-based army membership: the selected army can accept or decline each request. Multiple devices then control the same army.
- Live board updates, roster, restricted field log and room chat.
- Player health, range and positions are visible to everyone. Other armies' AP stays private until the game has ended.
- Private inbox messages when another army gifts AP to you or the Jury awards your army bonus AP.
- Move, attack, upgrade range, add HP, gift AP and gift hearts (including reviving an eliminated army).
- Private planning mode for every army, including route planning, costed action queues, private AP estimates and future tick forecasts. Plans stay in that device's browser.
- Clear range highlighting for attack and gift actions, using Manhattan distance.
- Event-by-event replay after the game ends, including each army's position, HP and AP after every recorded event.
- PostgreSQL storage for hosted games, so rooms are not lost when the web server restarts.
- Local JSON storage for running the app on your own computer.

## Run it on your computer

You need Node.js 20 or newer.

```bash
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000). Create a room in one browser tab and join it from another tab or device on the same network to test the shared board.

Without `DATABASE_URL`, the app saves rooms in `data/games.json`. This is useful for local testing. Do not rely on that local file for a hosted game unless your host explicitly provides persistent disk storage.

## Host the game online

The app needs a **Node web service**, not a static-only website host: Socket.IO runs on the server to keep all armies on the same live board.

### 1. Create a PostgreSQL database

Create a project with a PostgreSQL provider such as Supabase. In its dashboard, open **Connect** and copy a PostgreSQL connection string. For a long-running Node server, use a connection method intended for a persistent backend. If your host cannot use IPv6 direct connections, use the provider's session pooler connection string instead. Replace the database password placeholder in the connection string with your actual password.

The server creates its own `tank_turn_tactics_games` table on first start. You do not need to run SQL manually.

### 2. Put this folder in a GitHub repository

Create a repository and upload the contents of this folder (not the containing folder itself). Keep your database connection string out of GitHub; it belongs in the hosting provider's environment-variable settings.

### 3. Deploy the repository as a web service

In Render, create **New → Web Service** and connect the repository. Use:

- Runtime: `Node`
- Build command: `npm install`
- Start command: `npm start`

Add these environment variables in the service's Environment settings:

| Key | Value |
|---|---|
| `DATABASE_URL` | Your PostgreSQL connection string |
| `NODE_ENV` | `production` |

The server enables PostgreSQL SSL by default. If your database provider specifically requires a non-SSL connection, set `DATABASE_SSL=false` (normally leave this unset).

When the deployment finishes, open the public `onrender.com` address and share that address with your players. To invite someone into a particular game, share the room link generated inside the game.

## Rules and settings

- Each army begins with 3 HP, 0 AP and range 2.
- The default AP interval is every 24 hours. The room creator can choose any interval from 1 minute to 7 days and set the exact first AP tick date/time. Later ticks repeat at the chosen interval from that first tick.
- Every AP tick, each living army gains 1 AP.
- Move one orthogonal square: 1 AP.
- Attack a living army within your range: 1 AP and 1 damage.
- Add 1 HP: 3 AP.
- Upgrade range by 1: 3 AP.
- Gift 1 AP to a living army in range: 1 AP is transferred from you to them. The recipient gets a private notification; it is not written to the field log.
- Gift 1 heart to an army in range: 3 AP. This adds 1 HP to a living army, or revives an eliminated army with 1 HP and 0 AP.
- Eliminated armies do not transfer their remaining AP to the army that eliminates them; unspent AP is lost.
- Eliminated armies stay on the board. Each can cast one Jury vote per AP cycle; an army receiving at least 3 votes gets 1 bonus AP at the next tick and a private notification.
- The board has no rock obstacles or random bonus-heart pickups. The gift-heart action remains available.
- The public field log only reports army movement/locations, that an army was hit (without naming the attacker), and which army made a final hit that eliminated another army. AP transfers and other actions are not logged.
- The game ends when one army remains alive. Final AP becomes visible to everyone, and event replay becomes available.

Range uses Manhattan distance: range is counted in orthogonal steps, not straight-line distance.

## Planning and replay

Planning mode is entirely local to the current browser/device. It can hold a separate action queue for each army, show planned positions and projected costs, and use private estimates for other armies' AP. Future AP ticks can be included in forecasts. Plans and estimates are saved in that browser's local storage and are not sent to the server.

When the game ends, the replay timeline lets players select any recorded event. The board and the replay roster show the position, HP and AP of every army at that point. The room keeps the most recent 5,000 event snapshots; replay history is stored with the room and does not require a separate database table.

## Important notes

- The room code/link is the invitation. Anyone who has it can create an army while the lobby is open, or request to join an existing army. The selected army must approve a membership request.
- Each device has its own session key. Several devices can be linked to one army, and all linked devices control that same army. Members share its AP, HP, position, actions and private AP messages.
- Keep the room link private to the people you intend to invite. This is a casual private-room game, not an account-secured competitive service. Do not put personal or sensitive information in callsigns or chat.
- If the hosted app is restarted, PostgreSQL keeps the game state. The local JSON fallback is intended for local testing only.

## Updating an existing hosted game

For the browser-based GitHub upload and Render redeployment steps, see [`UPDATE-GUIDE.md`](UPDATE-GUIDE.md). This release keeps the existing Supabase table and room-state storage; no SQL migration or new Supabase project is required.
