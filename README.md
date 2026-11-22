# Tank Turn Tactics — Friends & Foes Edition

A mobile-friendly, shared Tank Turn Tactics board for a private group of friends. Players join the same room from separate devices; actions are checked by the server and the board updates for everyone in real time.

## Features

- Private rooms with six-character invite codes and shareable links.
- 2–12 players per game, with a randomly generated square board and rock obstacles.
- Live board updates, player roster, activity log and room chat.
- Player health, range and positions are visible to everyone. **AP is only sent to the player who owns it.**
- Move, attack, upgrade range, add HP, gift AP and gift hearts (including reviving an eliminated player).
- An AP tick scheduler that catches up after the site has been idle.
- Bonus hearts that appear on the board, plus the Jury vote for eliminated players.
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

## Put it on the internet for your friends

The app needs a **Node web service**, not a static-only website host: Socket.IO runs on the server to keep all players on the same live board.

### 1. Create a PostgreSQL database

Create a project with a PostgreSQL provider such as Supabase. In its dashboard, open **Connect** and copy a PostgreSQL connection string. For a long-running Node server, use a connection method intended for a persistent backend. If your host cannot use IPv6 direct connections, use the provider's session pooler connection string instead. Replace the database password placeholder in the connection string with your actual password.

The server creates its own `tank_turn_tactics_games` table on first start. You do not need to run SQL manually.

### 2. Put this folder in a GitHub repository

Create a new repository and upload the contents of this folder (not the containing folder itself). Keep your database connection string out of GitHub; it belongs in the hosting provider's environment-variable settings.

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

## Rules in this version

- Each player begins with 3 HP, 0 AP and range 2.
- Every AP tick, each living player gains 1 AP. The default is every 24 hours; the host can choose 1 minute for testing or 1 hour for a shorter game.
- Move one orthogonal square: 1 AP.
- Attack a living player within your range: 1 AP and 1 damage.
- Add 1 HP: 3 AP.
- Upgrade range by 1: 3 AP.
- Gift 1 AP to a living player in range: 1 AP is transferred from you to them.
- Gift 1 heart to a player in range: 3 AP. This adds 1 HP to a living player, or revives an eliminated player with 1 HP and 0 AP.
- Eliminated players stay on the board. Each can cast one Jury vote per AP cycle; a player receiving at least 3 votes gets 1 bonus AP at the next tick.
- A bonus heart appears on an empty square at an AP tick if one is not already on the board. Moving onto it grants 1 HP.
- The game ends when one player remains alive.

This edition uses Manhattan distance for range on the square board. It is a friends' adaptation, not an official digital rules implementation.

## Important notes

- The room code/link is the invitation. Anyone who has it can join while the lobby is open; new players cannot join after the game starts.
- A player's session is saved in that browser. Players should use the same browser/device when returning to an existing game and should not clear the site's local storage.
- This is a casual private-room game, not an account-secured competitive service. Do not put personal or sensitive information in player names or chat.
- If the hosted app is restarted, PostgreSQL keeps the game state. The local JSON fallback is intended for local testing only.
