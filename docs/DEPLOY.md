# Deploying Cue

Cue is a static site. Cloudflare Pages hosts it and builds it, Cloudflare Access puts a login wall in front of it, and Supabase Realtime relays messages between the screen and phones. Everything here fits in the free tiers.

```
GitHub: cue (platform)  ──build──►  Cloudflare Pages  ◄── Cloudflare Access (login wall)
GitHub: slides (decks)  ──cloned at build time with a read-only token
Phone remote  ◄──── Supabase Realtime (broadcast) ────►  Screen
```

## 1. Supabase relay (about 5 minutes)

1. Create a project at supabase.com. Any region near you works. Save the database password somewhere safe; Cue does not use it.
2. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key. The anon key is designed to sit in web pages, so it is safe to share.
3. No tables are needed. Cue uses Realtime broadcast only, which is on by default.

> **Free projects pause after about a week without activity.** The `keepalive` workflow in this repository pings the project weekly. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` as GitHub Actions secrets on the cue repository to turn it on. If the project does pause, the remote stops working but decks still play. Un-pause it from the Supabase dashboard.

## 2. GitHub token for the build (about 2 minutes)

The build clones the private slides repository, so it needs a read-only token.

1. GitHub → profile picture → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name it `cue build`. Set an expiration and a reminder to renew it.
3. **Repository access → Only select repositories → slides.**
4. **Repository permissions → Contents: Read-only.**
5. Generate it and paste it straight into Cloudflare in step 3. Do not save it anywhere else.

## 3. Cloudflare Pages (about 5 minutes)

1. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**. Authorize GitHub for the **cue** repository only.
2. Build settings:
   - Framework preset: **None**
   - Build command: `node scripts/build.mjs`
   - Build output directory: `dist`
3. **Environment variables** (Production, and Preview if you use previews):

| Variable | Value | Encrypt |
|---|---|---|
| `SLIDES_REPO` | `your-github-name/slides`, the repository that holds your cartridges | no |
| `GITHUB_TOKEN` | the token from step 2 | **yes** |
| `SUPABASE_URL` | from step 1 | no |
| `SUPABASE_ANON_KEY` | from step 1 | no |
| `CUE_LOBBY_KEY` | any long random string; run `openssl rand -hex 16` | **yes** |
| `NODE_VERSION` | `20` | no |

4. Save and deploy. The site is live at `https://<project>.pages.dev` and is **public until step 4 is done**.

## 4. Login wall

Pick one. The password gate is built in and takes two minutes. Cloudflare Access gives each person their own email login, but setting up Zero Trust can get stuck, and did on 2026-10-02.

### Option A: password gate (about 2 minutes)

1. Pages project → **Settings → Environment variables** → add `CUE_PASSWORD`, set it to **Encrypt**, and use a long passphrase.
2. Redeploy. Every page now asks for the password once per device, and remembers it for 30 days. **Lock** in the library signs a device out.
3. `/remote/` stays open, so phones never need the password. The QR session code is the key.

The gate lives in `functions/_middleware.js` and runs on Cloudflare before any file is served. Changing the password signs out every device.

### Option B: Cloudflare Access (about 10 minutes)

1. Cloudflare dashboard → **Zero Trust**. Pick a team name and the Free plan, which allows up to 50 users. If "Get started" does nothing, try another browser or contact Cloudflare support.
2. **Settings → Authentication**: one-time PIN by email is on by default. Add Google or Microsoft sign-in if you like.
3. **Access → Applications → Add an application → Self-hosted**:
   - Name: `Cue`
   - Domain: `<project>.pages.dev` (leave the path empty)
   - Policy: **Allow**, Include → Emails → your address, plus anyone else who should present.
4. Add a **second** self-hosted application for the phone remote:
   - Name: `Cue remote`
   - Domain: `<project>.pages.dev`, path `remote`
   - Policy: action **Bypass**, Include → **Everyone**

   The remote page holds no content. Notes travel over the session channel, and the long random session ID in the QR code is the key. The lobby key never reaches this path.
5. In the Pages project, go to **Settings → General → Access policy** and enable it, so preview deployments are protected too.
6. Test it in a private window: `/` should ask you to log in, and `/remote/` should load without asking.
7. Remove `CUE_PASSWORD` so people do not have to log in twice.

## 5. Publish on push from the slides repository

1. Pages project → **Settings → Builds → Deploy hooks** → add a hook for the `main` branch and copy its URL.
2. In the **slides** repository, go to **Settings → Secrets and variables → Actions** and add `CUE_DEPLOY_HOOK` with that URL.
3. The `slides/.github/workflows/publish.yml` workflow calls the hook on every push to `main`, so a new or changed deck is live about a minute later.

## 6. Optional: a custom domain

Pages project → **Custom domains**, for example `present.rook.ltd`. Then add that hostname to both Access applications, keeping `remote` as the bypass path.

## Install as an app

Open the site in Chrome, Brave or Edge and choose **Install Cue** from the address bar or the menu. It opens in its own window, and decks you have opened once keep working offline.

## Troubleshooting

| Symptom | Cause |
|---|---|
| Pairing screen says "Phone remote is off" | `SUPABASE_URL` or `SUPABASE_ANON_KEY` is missing. Redeploy after adding them. |
| Phone stuck on "Waiting for the screen" | The screen tab is closed, or the Supabase project is paused. |
| Library is empty | The build could not clone slides: check the token and `SLIDES_REPO`, and read the Pages build log. |
| The phone asks to log in | Option B: the `remote` bypass application is missing or its path is wrong. |
| Everyone was signed out | `CUE_PASSWORD` changed. That is expected. |
| Join page says it needs a lobby key | `CUE_LOBBY_KEY` is not set. |
