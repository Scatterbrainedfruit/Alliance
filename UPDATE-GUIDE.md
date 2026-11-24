# Updating your existing Tank Turn Tactics website

This release is version 1.2.0. It updates the files in your existing GitHub repository and then lets Render redeploy the same service.

## Before you begin

- Keep the existing Supabase project and Render web service.
- Do not delete or recreate the database.
- Do not change `DATABASE_URL` or `NODE_ENV` in Render.
- Do not upload a real `.env` file or any database password to GitHub.
- The new membership, replay and setup options are stored in the existing JSONB room state. No SQL migration is required.

## Upload the update

1. Download and extract `tank-turn-tactics-v1.2.0.zip`.
2. Open your existing GitHub repository (`Alliance`).
3. Choose **Add file → Upload files**.
4. Open the extracted `tank-turn-tactics-site` folder on your computer.
5. Upload the *contents* of that folder, including the `public` and `test` folders. Do not upload an extra enclosing `tank-turn-tactics-site` folder.
6. When GitHub asks you to commit, use a message such as `Update Tank Turn Tactics to v1.2.0` and commit to the `main` branch.

GitHub will replace files with matching paths and add/update `UPDATE-GUIDE.md`. Do not remove your existing repository or change its connection to Render.

## Let Render deploy

If automatic deploys are enabled, Render should detect the new commit and deploy it. Open the existing Render web service and check **Events** or **Logs**. Wait for the deployment to report **Live**.

If it does not deploy automatically, open **Manual Deploy → Deploy latest commit**.

The application still creates/uses the same PostgreSQL table. Existing rooms remain stored, and old rooms are read with backward-compatible defaults for the new army-member list and settings. No database reset is required.

## Suggested checks after deployment

- Create a new room with a non-square board and a custom first AP tick.
- From a second device, request to join the first army and approve the request from the first device.
- Check that both devices show the same army and share its AP/position.
- Gift AP and confirm only the recipient army receives a private message.
- Open private planning, switch between armies and queue a move for another army.
- Finish a test game and move the replay slider to earlier events.
