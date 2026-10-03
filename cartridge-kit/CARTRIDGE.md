# Building a Cue cartridge

Instructions for an AI agent, or a person, making a presentation that Cue can play.

A **cartridge** is a self-contained HTML slide deck in its own folder, plus a manifest and presenter notes. Cue loads it in a frame, drives it through a small message protocol, and sends the notes to the presenter's phone. Two references: `examples/hello-world` in the cue repository is an unbranded deck with the full engine (particles, motion, builds), and `cartridge-kit/template` is the bare minimum. Start from Hello World when the deck should look designed.

## 1. Folder layout

Each cartridge is one top-level folder in the slides repository:

```
slides/
└── your-deck-id/
    ├── cartridge.json   required: manifest
    ├── index.html       required: the deck, fully self-contained
    ├── notes.md         required: presenter notes, one section per slide
    ├── src/             optional: sources you build index.html from (never published)
    └── build.py         optional: build script (never published)
```

What gets published: everything in the folder except dotfiles, `src/`, `node_modules/`, and `*.py`, `*.mjs` and `*.md` files. Notes are converted to `notes.json` at build time.

## 2. cartridge.json

| Field | Required | Notes |
|---|---|---|
| `cue` | yes | Always `1`. |
| `id` | yes | Lowercase letters, numbers and hyphens. Match the folder name. Never change it after first use. |
| `title` | yes | Shown in the library and on the remote. |
| `subtitle` | no | One sentence for the library card. |
| `author` | no | Person or company. |
| `version` | no | Semantic version. Bump it when content changes. |
| `entry` | no | Defaults to `index.html`. |
| `notes` | no | Defaults to `notes.md`. |
| `duration` | no | Target length in minutes. The remote timer shows it and turns red past it. |
| `accent`, `background` | no | Hex colors for the library card. Use the deck's own palette. |
| `tags` | no | Array of strings. |

Start from `cartridge-kit/template/` and copy the whole folder. If the slides repository has a brand template under `templates/<brand>/`, start from that instead; it carries the brand system and a layout library.

## 3. Deck rules (hard requirements)

1. **Self-contained.** Inline all CSS and JavaScript. Embed fonts as base64 `@font-face` and images as data URIs, or ship them as files inside the folder and reference them with relative paths. No CDN scripts, no remote images. A deck that needs the internet fails when venue Wi-Fi does. Google Fonts are tolerated but discouraged.
2. **Fixed stage.** Design on a 1920 by 1080 stage scaled to fit the window, as in the template. Never rely on the viewport size for layout.
3. **Slides.** Each slide is `<section class="slide" data-id="..." data-title="...">`, in presentation order.
   - `data-id` is permanent: kebab case, unique, and never renumbered. Notes and rehearsal history are keyed to it. Use a meaningful name like `pricing-table`, not `slide-7`.
   - `data-title` is the short name the presenter sees on the remote.
4. **Builds.** Elements with `data-b="N"` appear on the Nth press. A slide's build count is its highest `data-b`. Builds must be reversible: going back hides them again. Scripted animations must be able to render any build's final state instantly, for when the presenter goes backward or jumps.
5. **Keyboard.** Right, Down, Page Down, Space and Enter go forward. Left, Up, Page Up and Backspace go back. Clickers send Page Up and Page Down. Home and End jump.
6. **Protocol.** Copy the block marked "Cue player protocol (cue/1)" from the template unchanged, and call `cueState()` after every slide or build change. Forward keys you do not handle to the player with `cuePost({ type: 'key', key })`.
7. **Standalone.** Opening `index.html` directly from disk must still work, with no player present. The protocol is inert outside a frame.
8. **No surprises.** No `alert()` or `confirm()`, no sound without a click, no network calls, no analytics, no external links that open on their own.
9. **Size.** Keep the folder under 25 MB. Prefer CSS, SVG and canvas to large images and video.

## 4. Protocol reference (cue/1)

All messages are `postMessage` objects carrying `cue: 1`, between the deck and its parent frame on the same origin.

| Direction | `type` | Fields | Meaning |
|---|---|---|---|
| Player → deck | `hello` | | Announce yourself and your state. |
| Player → deck | `next` / `prev` | | Same as the arrow keys. |
| Player → deck | `goto` | `index`, `build` | Jump to a slide by index, at a build. |
| Deck → player | `ready` | `title`, `slides: [{ id, title, builds }]` | Sent on load and on `hello`. |
| Deck → player | `state` | `index`, `id`, `build`, `builds`, `total` | Sent after every change. |
| Deck → player | `key` | `key` | A key the deck does not use. The player handles B for blackout, P for the presenter window, Q for pairing, and F for full screen. |

The player, not the deck, owns blackout, timers, rehearsal and remotes. Do not build those into a deck.

## 5. notes.md

```markdown
# Deck title: presenter notes

Optional intro paragraph.

## [slide-id] Slide title

- What to say before any click.
- **Click 1:** What to say when the first build appears.
- **Clicks 2 to 4:** One note covering several builds.
```

- Every `## [id]` must match a `data-id` in the deck. The validator fails on unknown IDs and warns on slides with no notes.
- Write notes the presenter can glance at mid-sentence: short bullets, the key line in bold, and no paragraphs longer than three lines.
- `**Click N:**` items are special. The remote highlights the current one and labels the next one "Next click", so the presenter always knows what the next press reveals. Use them on every slide that has builds.
- Include timing guidance on section openers, for example "Part two: 25 minutes."

## 6. Workflow for an agent

1. **Brief.** Get the audience, goal, length, brand (colors, fonts, logo files), copy rules, and any source material. Ask when something is missing; do not invent a brand.
2. **Outline first.** Propose the slide list with IDs, titles, build counts and a one-line purpose for each. Get approval before designing.
3. **Build from a starting point.** Copy the brand template (`slides/templates/<brand>/`) if one exists, otherwise `examples/hello-world/`, or `cartridge-kit/template/` for something minimal, to `slides/<id>/`. Replace the tokens with the brand. Keep the protocol block intact.
4. **Write notes alongside the slides,** not after. Each build gets a `**Click N:**` line.
5. **Validate.** From the cue repository, run `node scripts/validate.mjs ../slides/<id>`. Fix every error.
6. **Play it in Cue.** Run `npm run dev` in the cue repository, which builds from `../slides`, and open http://localhost:8787. Load the cartridge, then open the presenter window with P. Step through every slide and build, forward and backward, and check the notes stay in sync.
7. **Check standalone.** Open `index.html` directly from disk.
8. **Commit** to the slides repository. Pushing publishes it.

## 7. Quality bar

The audience should feel the deck was designed, not assembled. Concretely:

- **One idea per slide,** set large. If a slide needs a paragraph, it is two slides or a presenter note.
- **Motion with purpose.** Builds reveal the argument in order. Entrances ease out, with nothing bouncing or spinning for its own sake. Respect the brand's pace.
- **Show, do not list.** Replace bullet lists with a diagram, a mock screen, a live demo, or a before-and-after wherever you can. The reference deck animates token prediction, a context window, and a GitHub setup flow with a moving cursor.
- **Type.** Use the brand's display face for headlines, and size body text for the back of the room: 24 px minimum on the 1920 stage, 30 px or more preferred. Check every glyph you use exists in the font, because trial fonts often lack punctuation.
- **Contrast** of at least 4.5 to 1 for text, so it survives a washed-out projector.
- **Brand and copy rules** come from the client. If they say no em dashes or contractions, apply that to slides and notes alike.
- **Mock screens** of real products are illustrations, not copies. Use generic names like `your-name`, and never real customer data.

## 8. Done checklist

- [ ] `validate.mjs` passes with no errors.
- [ ] Every slide has a meaningful `data-id` and `data-title`.
- [ ] Every build has a `**Click N:**` note.
- [ ] Forward, backward, Home, End and `goto` all work, and scripted builds render correctly when reached backward.
- [ ] The deck works opened from disk with no internet.
- [ ] Text is readable at 1280 by 720.
- [ ] Fonts are licensed for this use, or the client has accepted the risk in writing.
