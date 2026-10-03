# Agent instructions

Cue is a presentation player for self-contained HTML decks ("cartridges"), with a phone remote. Pick the guide that matches what the person asked for:

| The person wants to... | Read |
|---|---|
| Set up Cue, locally or hosted | [docs/SETUP.md](docs/SETUP.md). Follow its gates in order, and ask before every decision. |
| Make or change a cartridge | [cartridge-kit/CARTRIDGE.md](cartridge-kit/CARTRIDGE.md), then study [examples/hello-world](examples/hello-world/) |
| Deploy to Cloudflare | [docs/DEPLOY.md](docs/DEPLOY.md) |
| Change Cue itself | [README.md](README.md) for the layout of the code. Run `npm start` and test in a browser before committing. |

Rules that apply everywhere:
- Never commit secrets. `.env` is ignored by git; keep it that way.
- Decks belong in the person's private slides repository, not in this one. `examples/` holds only the public starter.
- Cue is AGPL-3.0, and `cartridge-kit/` and `examples/` are MIT, so decks built from them stay the person's own.
