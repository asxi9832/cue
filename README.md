# Cue

A presentation player for self-contained HTML decks ("cartridges"), with a phone/tablet/computer remote, presenter notes, rehearsal timing, and offline playback.

**The flow:** log in → pair a phone by scanning a QR code (or skip) → pick a cartridge → share your screen.

## Quick start with an AI agent

Open this repository in Claude Code, Codex, or any coding agent, and say:

> Set me up with Cue, then help me make my first cartridge.

The agent follows [AGENTS.md](AGENTS.md) and [docs/SETUP.md](docs/SETUP.md), and asks you a few questions on the way: whether to run Cue on this computer or free on Cloudflare, whether you want a phone remote, and how to keep your decks private.

Or do it by hand:

```bash
git clone https://github.com/asxi9832/cue.git && cd cue && npm start
```

Then open http://localhost:8787 and play the Hello World cartridge.

## Features

- **Library** of cartridges, built from a private `slides` repository on every push.
- **Phone or tablet remote:** large tap areas, notes that follow each click, slide jump list, timer against target length, blackout, wake lock, and haptics. The screen is the source of truth, so remotes rejoin cleanly after a drop or a reload. One device controls at a time; others view, and can take control.
- **Presenter window** on the same computer (press **P**). It works with no internet.
- **Rehearsal mode** records time per slide and keeps the last five runs.
- **Audience participation (opt-in per deck):**
  - QR join with a name and an emoji, and a live wall of who has joined
  - live word clouds with automatic filtering, polls with a reveal, and floating emoji reactions
  - Q&A with upvotes, run from the presenter's remote
  - a consent-based follow-up offer, with CSV export afterward
  
  Runs on Supabase Postgres (`supabase/schema.sql`).
- **Installable app** with offline playback of any deck you have opened.
- **Keyboard and clickers:** arrows, Page Up and Page Down, **B** or **.** for blackout, **F** for full screen, **Q** to pair.

## Repository layout

```
public/            the app (static; no framework, no dependencies)
  app.js           screen: pairing, library, stage, rehearsal
  remote/          phone remote and presenter window (served outside the login wall)
  remote/lib/      relay (BroadcastChannel and Supabase), markdown, utilities
  sw.js            offline cache
scripts/
  build.mjs        app + cartridges → dist/
  dev.mjs          local server on :8787, builds from ../slides
  validate.mjs     check a cartridge against the spec
cartridge-kit/
  CARTRIDGE.md     the spec and agent instructions for building a cartridge
  template/        a minimal working cartridge to copy
examples/
  hello-world/     the starter cartridge: particles, motion, builds, notes
docs/SETUP.md      agent-guided setup, with decision gates
docs/DEPLOY.md     Cloudflare Pages, Access and Supabase setup
```

## Local development

```bash
npm start
```

This serves http://localhost:8787 and builds cartridges from `../slides`, or from `examples/` if that folder does not exist. Without Supabase variables, the phone remote is off, but the presenter window works. To test the phone relay locally, add `SUPABASE_URL=... SUPABASE_ANON_KEY=...` to the command.

```bash
node scripts/validate.mjs ../slides/ai-zero-to-sixty
```

## Making a cartridge

Read [cartridge-kit/CARTRIDGE.md](cartridge-kit/CARTRIDGE.md). Point an agent at it with something like: "Build a Cue cartridge for this talk, following cue/cartridge-kit/CARTRIDGE.md."

## Roadmap

- Laser pointer: drag on the phone to show a dot on screen.
- Audience: a "where do you stand" scale, asked at the start and again at the end, to show how the room shifted.
- Audience: a quiz with a leaderboard, using the names and emojis.
- Post-event report: attendance, engagement per slide, poll results and leads, sent after the talk.
- Contacts sync to a CRM (Pipedrive first).
- The audience kit in the Hello World starter.
- Thumbnails of the current and next slide on the remote.

## License

Copyright (C) 2026 Rampant LLC.

Cue is free software: you can redistribute it and modify it under the terms of the [GNU Affero General Public License, version 3](LICENSE). If you run a modified version of Cue as a service for others, you must offer them its source code. The app links to the source from the library and the remote; point `SOURCE_URL` in `public/app.js` and the link in `public/remote/remote.js` at your fork.

**Your decks are yours.** The cartridge kit (`cartridge-kit/`, including the template and the cue/1 protocol block) and the Hello World example (`examples/`) are separately licensed under the [MIT License](cartridge-kit/LICENSE), so presentations you build with it can be licensed however you like, including kept private and confidential.

Third-party code: `public/vendor/qrcode.js` is QR Code Generator by Kazuhiko Arase, under the MIT License.
