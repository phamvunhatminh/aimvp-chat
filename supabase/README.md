# Accounts and sync with Supabase

Signing in is optional. Without it the app works as before, with everything kept in the browser. Signed-in users get
their chats, projects, saved prompts, attached files and preferences on every device. API keys and the default model
never leave the device.

The app reads the project from two build-time variables. Without them, sign-in is hidden.

```sh
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

## Set up a project

1. **Create the project.** Create a project at [supabase.com](https://supabase.com).
2. **Create the tables.** Open **SQL Editor**, paste [`schema.sql`](schema.sql) and run it. This creates:
   - the `sync_records` table, with row-level security;
   - the `push_records` function;
   - the private `attachments` storage bucket, with per-user policies.

   Running the file again is safe.
3. **Set the redirect URLs.** Under **Authentication → URL Configuration**:
   - **Site URL:** `https://chat.aimvp.app`
   - **Redirect URLs:** `https://chat.aimvp.app/**` and `http://localhost:3000/**`, plus a pattern for preview deploys if you use them.

   Supabase sends users back to `/auth/account?sb_flow_id=…`. The `/**` pattern lets that query string through.
4. **Turn on the sign-in methods** under **Authentication → Sign In / Providers**. Each provider asks for the callback
   URL `https://<project-ref>.supabase.co/auth/v1/callback`.
   - **Email:** on by default. Keep "Confirm email" on.
   - **Google:** in Google Cloud Console, open APIs & Services → Credentials, then create an OAuth client ID of type
     *Web application*. Add the callback URL above as an authorized redirect URI. Paste the client ID and secret into
     Supabase.
   - **GitHub:** go to GitHub → Settings → Developer settings → OAuth Apps → New OAuth App. Set the callback URL
     above as the authorization callback URL. Paste the client ID and a new client secret into Supabase.
5. **Set up email for real users.** Supabase's built-in email sends only a few messages an hour. Before real users
   arrive, configure **Authentication → Emails → SMTP Settings**.
6. **Pass the keys to the app.** Copy the project URL and the **publishable** key from **Project Settings → API
   Keys**. Never use the secret or `service_role` key: the browser can read anything in the build.
   - **Cloudflare:** add both as build variables (Workers & Pages → aimvp-chat → Settings → Build → Variables and
     secrets), then redeploy.
   - **Local development:** put both in `.env.local`.

`public/_headers` allows `https://*.supabase.co` in `connect-src`. A project on a custom domain needs that domain
added there too.

## How sync works

Each device keeps its full copy in IndexedDB and works offline. `src/lib/sync.ts` syncs in rounds:

- **When a round runs:** after sign-in, a couple of seconds after local changes, when the tab regains focus or comes
  back online, and every minute while the tab is visible.
- **Pull:** fetches the `sync_records` rows modified since the last round. The newer `updatedAt` wins per record.
- **Push:** sends records changed locally. The `push_records` function keeps whichever version is newer, so the
  same rule applies on the server.
- **Deletes:** records are tombstoned (content wiped, `deletedAt` set), so deletions reach other devices.
- **Files:** uploaded once to `attachments/<user id>/<file id>`. Another device downloads a file the first time it is
  shown, and removes it when its message is deleted.
- **First sign-in:** chats made before signing in join the account.
- **Switching accounts:** signing in as a different account replaces the previous account's data on the device.
- **Signing out:** sends the last changes, then removes the account's data from the device.
