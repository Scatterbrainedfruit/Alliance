# Updating your existing Tank Turn Tactics website

This release is version 1.1.0. It updates the files in your existing GitHub repository and then lets Render redeploy the same service.

## Before you begin

- Keep the existing Supabase project and Render web service.
- Do not delete or recreate the database.
- Do not change `DATABASE_URL` or `NODE_ENV` in Render.
- Do not upload a real `.env` file or any database password to GitHub.

## Upload the update

1. Download and extract `tank-turn-tactics-updated.zip`.
2. Open your existing GitHub repository (`Alliance`).
3. Choose **Add file → Upload files**.
4. Open the extracted `tank-turn-tactics-site` folder on your computer.
5. Upload the *contents* of that folder, including the `public` and `test` folders. Do not upload an extra enclosing `tank-turn-tactics-site` folder.
6. When GitHub asks you to commit, use a message such as `Update Tank Turn Tactics to v1.1.0` and commit to the `main` branch.

GitHub will replace files with matching paths and add `UPDATE-GUIDE.md`. Do not remove your existing repository or change its connection to Render.

## Let Render deploy

If automatic deploys are enabled, Render should detect the new commit and deploy it. Open the existing Render web service and check **Events** or **Logs**. Wait for the deployment to report **Live**.

If it does not deploy automatically, open **Manual Deploy → Deploy latest commit**.

The application still creates/uses the same PostgreSQL table and JSON room-state structure. No SQL migration or database reset is required, and existing rooms remain stored. Legacy field-log entries are filtered into the new allowed format when served.
