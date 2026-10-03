# Setting up Cue: instructions for an AI agent

You are helping a person set up Cue, a presentation player for HTML decks called "cartridges", and then make their first cartridge. Work through the steps in order. Each **Gate** is a decision that belongs to the person: ask the question, explain the options in a sentence or two, recommend one, and wait for their answer.

## Ground rules

- **The person does the sign-ins.** Account creation, OAuth prompts ("Authorize GitHub") and dashboard clicks in Cloudflare and Supabase are theirs. Give exact click paths; do not ask for their passwords.
- **Secrets never go in chat.** GitHub tokens and lobby keys are pasted by the person straight into the service that needs them. The two exceptions are the Supabase project URL and anon key, which are public by design.
- **You do the terminal work.** That covers cloning, creating repositories with `gh`, building, validating, and the verification checks with `curl`.
- **Verify, do not assume.** Every step ends with a check, and you report the result honestly.
- **Never leave a deck site public by accident.** If the person is hosting online, the login wall goes up before they put real decks in.

## Step 0: Prerequisites

Check, and help install what is missing:

```bash
node -v        # 18 or newer
git --version
gh auth status # GitHub CLI, signed in; optional but makes step 2 easy
```

The person needs a GitHub account.

## Step 1: Get Cue

**Gate A: Will you change Cue's own code?**
- **No, just use it (recommended for most people):** `git clone https://github.com/asxi9832/cue.git`
- **Yes, customize it:** `gh repo fork asxi9832/cue --clone`. Cue is AGPL-3.0. If they host a modified version for other people, they must offer those people the source: update `SOURCE_URL` in `public/app.js` and the source link in `public/remote/remote.js` to point at their fork.

Then run `cd cue && npm start` and open http://localhost:8787. With no slides repository yet, the library shows the Hello World example. Load it to confirm everything works.

## Step 2: A private repository for their decks

Decks live in their own repository, separate from Cue, so they stay private even when Cue is public. Create it **next to** the cue folder, which is where the local server looks by default:

```bash
cd ..
gh repo create slides --private --clone   # or ask what they want to call it
cp -R cue/examples/hello-world slides/hello-world
cp -R cue/examples/slides-repo/.github slides/.github   # publishes decks to a hosted Cue on push (Gate B option 2)
cat > slides/AGENTS.md <<'EOF'
This repository holds Cue cartridges. To build or change one, read ../cue/cartridge-kit/CARTRIDGE.md
and study ../cue/examples/hello-world. Validate with: node ../cue/scripts/validate.mjs <deck-folder>
EOF
cd slides && git add -A && git commit -m "Start my slides repository" && git push && cd ..
gh repo view slides --json visibility   # must say PRIVATE
```

Without `gh`: in GitHub, click **+ → New repository**, choose **Private**, and tick **Add a README file**. Then clone it.

If they named the folder something other than `slides`, or put it elsewhere, add `SLIDES_DIR=/path/to/folder` to `cue/.env`.

## Gate B: Where will Cue run?

| Option | Good for | Trade-offs |
|---|---|---|
| **1. This computer only** | Trying it out, presenting from one laptop | Nothing to sign up for. A phone remote works on the same Wi-Fi if they also add a relay (Gate C). Nothing is reachable from outside. |
| **2. Cloudflare, free (recommended)** | Presenting from any computer, a stable link, phones on any network | About 30 minutes of setup across Cloudflare and Supabase. Free for one person or a small team. |
| **3. Another static host** | People who already use Netlify, Vercel and the like | Works, but you have to provide your own login wall. Not covered here. |

### Option 1: this computer
- Run `npm start` in `cue`. It serves http://localhost:8787 and builds from `../slides` on every page load.
- The terminal prints the address phones should use on the same Wi-Fi, and the QR code uses it automatically.
- Go to Gate C if they want the phone remote; otherwise go to Step 3. The presenter window (press **P**) works with no relay at all.

### Option 2: Cloudflare
Follow `docs/DEPLOY.md` together, one section at a time, confirming each before moving on. Do Gate C first, so the Supabase values are ready when they set the Cloudflare environment variables. Points to stress:
- **Publish on push (`DEPLOY.md` step 5):** without it, new decks only appear when someone redeploys by hand.
  1. They create a Pages deploy hook.
  2. They store its URL as the `CUE_DEPLOY_HOOK` Actions secret on the **slides** repository, either through GitHub's web UI or by running `gh secret set CUE_DEPLOY_HOOK -R <owner>/slides` themselves in their own terminal. The URL is a credential: they paste it, never you, and never in chat.
  3. Confirm the secret exists. This shows the name only, never the value:
     ```bash
     gh secret list -R <owner>/slides
     ```
  4. Trigger the workflow and check its log:
     ```bash
     gh workflow run "Publish to Cue" -R <owner>/slides
     gh run view -R <owner>/slides --log | grep -E "Deploy triggered|skipping"
     ```
     "Deploy triggered" means it works. "skipping" means the secret is missing or misnamed.
- **Login wall:** Cloudflare Access is recommended. If its "Get started" button does nothing, try another browser; it has failed in Brave. The built-in password gate (`CUE_PASSWORD`) is the fallback.
- **The `/remote` path must bypass the login,** so phones never need to sign in. The QR session code is the key.
- **Every hostname needs the login wall.** When they add a custom domain, add it to **both** Access applications (the main one, and the `remote` bypass) **before** it goes live. A new hostname is public until it is added.

## Gate C: Do you want a phone or tablet remote?

- **Yes (recommended):**
  1. They create a free project at supabase.com.
  2. They go to **Project Settings → API** and send you the **Project URL** and the **anon public** key.
  3. Local (Option 1): write both into `cue/.env` as `SUPABASE_URL=...` and `SUPABASE_ANON_KEY=...`. That file is ignored by git.
  4. Cloudflare (Option 2): they add both as Pages environment variables, as described in `DEPLOY.md`.
  5. Mention that free Supabase projects pause after about a week idle. The `keepalive` workflow prevents that if they add the same two values as GitHub Actions secrets on their copy of cue.
- **No:** skip it. Decks, the presenter window and keyboard or clicker control all work without a relay.

## Gate D: Audience participation

Ask: **"Do you want your audience to join from their phones: polls, word clouds, Q&A, and contact capture?"** It needs the relay from Gate C.

- **Yes:**
  1. They open their Supabase project, go to **SQL Editor → New query**, paste all of `supabase/schema.sql`, and click **Run**. It is safe to run again later.
  2. **Online only:** in Cloudflare Access, edit the `Cue remote` application and add a second path, `j`, so `https://their-domain/j` opens without a login. Verify `/j` returns 200 and `/` still redirects to the login.
  3. Explain that it is opt-in per deck: only slides they add on purpose use it (`cartridge-kit/CARTRIDGE.md` section 5).
  4. Mention consent: contact capture uses unchecked opt-in boxes, and public-facing decks should link a privacy notice.
  5. Free Supabase handles about 200 people connected at once. For bigger rooms, the $25 per month Pro plan raises that.
- **No:** skip it. Nothing is created until a deck asks for it.

## Step 3: Verify

**Local:**
1. Open http://localhost:8787 and confirm the library lists their decks.
2. Load one, press **P** for the presenter window, and click Next in it.
3. If they have a relay, have them scan the QR code with a phone on the same Wi-Fi.

**Cloudflare:** run these checks and report every result.

```bash
H=https://their-domain
for p in / /c/index.json /config.js; do curl -s -o /dev/null -w "$p %{http_code}\n" $H$p; done  # each must be 302 (to login)
for p in /remote/ /remote/config.js; do curl -s -o /dev/null -w "$p %{http_code}\n" $H$p; done  # each must be 200
curl -s $H/remote/config.js | grep -c lobby   # must be 0
```

Then the live test:
1. They open the site and sign in.
2. They scan the QR code with their phone. The screen should say "connected".
3. They load a deck and tap Next on the phone.

## Step 4: Their first cartridge

Hello World is already in their library. Now they make their own. Give them this prompt to paste back to you, or to any coding agent, and have them fill in the brackets:

```text
Make my first Cue cartridge: a four-slide "Hello, World" that introduces [me / my team / my company]
and shows how presenting with Cue works.

First read cue/cartridge-kit/CARTRIDGE.md, then study cue/examples/hello-world. Reuse its engine:
particles, motion, builds and the cue/1 protocol. Do not reuse its words or colors.

1. Hello: [name], with particles spelling a short word that fits (five letters or fewer).
2. What we do: three cards that appear one click at a time.
3. How to drive this deck: arrows, B for blackout, F for full screen, P for the presenter window, Q to pair a phone.
4. What is next: three steps, then one closing line.

Palette: [two or three colors, or "choose one that fits"]. No logos unless I give you the files.
Make it animated, graphic and beautiful. Write notes.md with a **Click N:** line for every build.
Copy examples/hello-world to slides/hello-[name] as the starting point, give it a new id,
validate it, play it in Cue forward and backward, then commit and push it to my slides repository.
```

When you build it yourself, follow `cartridge-kit/CARTRIDGE.md` section 7 (the workflow) and section 9 (the done checklist).

For real talks after that, the person can use this longer prompt:

```text
Build a Cue cartridge for a talk.
Topic: [...]  Audience: [who, and what they already know]  Length: [minutes]
Goal: [what they should think, feel or do afterwards]
Brand: [colors, fonts, logo files], or "invent a palette that fits"
Source material: [files or links]
Read cue/cartridge-kit/CARTRIDGE.md first. Start from my brand template in slides/templates/ if there is one,
otherwise from cue/examples/hello-world. Propose the outline (slide ids, titles, builds and a one-line
purpose each) and wait for my approval before you design anything.
```

## Step 5: Hand-off

End by telling the person, briefly:
- Their Cue address (local or online), and that the `/remote` path is meant to be public.
- Where each secret lives: Cloudflare environment variables, `cue/.env`, GitHub Actions secrets. Never list the values.
- How to add a deck: make a folder in the slides repository and push. Online, it publishes in about a minute once the deploy hook from `DEPLOY.md` step 5 is set up.
- Shortcuts: **P** presenter window, **Q** pair a phone, **B** blackout, **F** full screen.
