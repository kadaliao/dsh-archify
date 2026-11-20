# Archify

English | [简体中文](README.zh-CN.md)

**Ask for a diagram and get a checked, interactive page right in the conversation.**

Brings [Archify](https://github.com/tt-a1i/archify) by tt-a1i to DeepSeek Harness. Ask for an
architecture, workflow, sequence, data-flow, lifecycle/state, ER, class, tree, timeline or
waterfall diagram (from a description, from Mermaid, or from the code in your workspace), or
for a one-page explainer that answers a question. The conversation model writes the diagram as
Archify JSON, the plugin renders and checks it, and the page appears in the conversation with
light and dark themes, motion and export.

Or skip the typing: in the **Archify panel**, pick a diagram type (and a project folder to draw
from its code) and press **Generate**. The plugin scans the repository, starts the conversation and
shows its progress, and the page lands in the panel's gallery. There, **Edit** changes a diagram
through the conversation that drew it, and **Review** has the model review an architecture from its
code, every point citing the lines it rests on, checked by the plugin.

```
> 画一下这个仓库的运行时架构图
  ▸ Completed in 39s
  [ the architecture diagram, live ]   ⛶ Full screen · ↗ Browser · ⤓ · 📁 · ⧉
  The plugin has two halves: …
```

## Install

Add the [DSH Plugins](https://github.com/kadaliao/dsh-plugins) index in DeepSeek Harness (**Plugins → Discover → Sources**):

```
https://raw.githubusercontent.com/kadaliao/dsh-plugins/main/marketplace.json
```

then install **Archify**. The Discover tab is part of the experimental **Custom plugin markets**
feature; turn it on under **Plugins → Experimental plugins** if you don't see it.

Without Discover, paste the package name into the plugin manager:

```
@kadaliao/dsh-archify
```

Or from a terminal with the `dsh` CLI (`--profile desktop` for the desktop app; restart Harness
afterwards):

```
dsh plugin --profile web add @kadaliao/dsh-archify
```

For the latest unreleased code, use the Git spec `git+https://github.com/kadaliao/dsh-archify.git#main` instead.

Refresh the page once after installing. There is nothing to configure: no Node.js install, no
key, no model of its own. Archify runs with the Harness's own JavaScript runtime.

## In the conversation

The plugin adds an `archify` skill to the skill catalog, so the model loads it when you ask for a
diagram or a page ("画个时序图", "draw the ERD of these tables", "用一页讲清楚……"). It then reads
the few Archify references it needs, writes the diagram, and calls `archify_render`.

- While it works, a card in the turn's process fold shows the diagram type, its title and the
  checks: validate, deliver, a strict artifact check, and a check in a real browser. A failed
  check lists Archify's diagnostics, and the model repairs the draft and renders it again.
- The delivered page appears as a row of the conversation, above the model's reply, so it stays
  visible after the fold closes. It shows just the drawing, in the Harness's light or dark theme,
  sized to the diagram. Double-click it, or press **Full screen**, for the whole Archify viewer:
  its toolbar, themes and presets, live motion, search, route tracing and export to PNG, SVG or
  WebM.
- The card's buttons: **Full screen**, **Browser** (opens the HTML file in your default browser),
  **Download**, **Show in folder** and **Copy path**.

Each page is a standalone HTML file that works offline, so you can send it to someone as is.

## The Archify panel

**Archify** in the left sidebar (or `/archify`) has two tabs, **New** and **Gallery**, and a **How to use** button.

**New** draws a diagram without writing a prompt:

1. **From a project** (optional): type a folder, press **Choose…** for the folder dialog, or pick
   one of your recent workspaces. With a folder, the model reads that code, the diagram cites the
   files it comes from and pins the commit (about one to two minutes). Without one, only your
   description is drawn and no file is read (about half a minute), so it can be any system, a plan,
   or something that is not software. A line under the text box says which of the two it will be.
2. **Diagram type**: one of the ten, an explainer page, or **Best fit** to let the model choose.
   Each card shows a picture of that kind of diagram and says what it is for; the chosen one is
   shown large, and **Open the full example** opens Archify's own example of it as a live page.
3. **What to draw**: optional with a project (empty draws the whole picture; "only the backend
   services" narrows it), the description itself without one. A few examples per type are one click
   away.
4. **Quality**: **Fine** runs Archify's full `showcase` checks, **Fast** its `standard` profile.

On a wide panel, the right side keeps what the form will do in view: the picture of the type you
chose (or point at), the prompt when you ask to see it, and your runs. **Generate**, **Open in a
conversation** and **Copy the prompt** stay pinned at the bottom, and a folder that is not there is
flagged as you type. On a narrow panel the picture comes right under the type cards, and the prompt
and the latest run show in the bottom bar.

**Generate** starts a conversation of its own (in the project's workspace, so it shows in the
sidebar) and sends the prompt, with the plugin's scan of the repository attached so the model does
not have to list folders first. The run is listed under the form with what it is doing (reading,
rendering…), its steps and time, and a link to the conversation; **Show** opens its page.
**Open in a conversation** puts the same prompt in a new conversation's composer for you to send,
and **Copy the prompt** copies it for any conversation.

**Gallery** lists every page drawn in your conversations, newest first, with a search box. Pick one
to preview it; from there open it full screen, in the browser, in its folder, or go back to the
conversation it was drawn in. **Remove** only takes it off the list; the file stays.

For an architecture diagram, **Review** in the header opens the review beside the drawing. A review is written by the model from the code, never guessed from the
drawing: **Review it from the code** asks the conversation that drew the diagram to read the
repository, establish what kind of software it is and how it runs, and judge only what matters for
that kind (no scaling out or message queues for an app that runs on one machine). Every point
cites the files and line ranges it rests on, and the `archify_review` tool checks each citation
(the file is in the repository, the lines exist) before it keeps the review; a point whose
citations do not check out is refused, so the model backs it up or drops it. The review shows the
verdict, the kind of software, the commit it was checked against, and each point with its
suggestion and citations; a click on a citation shows those lines of code. A diagram drawn from a
description, with no code behind it, gets a review of its design, every point naming the
components it is about. Whether each argument holds is still yours to judge: the citations are
there so you can. The conversation card of an architecture diagram has a **Review** button that opens it here.

**Edit**, in the same header, changes the diagram without leaving the panel: say what to change, or
start from a suggestion. The ones that are complete come first and can be sent as they are (tidy
the layout, another style, the text in another language, a legend, brand marks); the ones with a
blank (split a part, a before/after comparison page) select the blank for your words, and Send
waits until no dots are left. It goes to the conversation that drew the diagram, which knows its
context, and the page here updates when it is done. Edit and Review sit beside the drawing: the
list narrows so the whole drawing stays in view next to them, and only on a window too narrow
for both do they lie over its right side.

There is no separate help page. Each hint sits where it is used: in New, that Mermaid can be pasted
as is and, for an explainer, the rules line for pages without asking and where it goes; in the
Gallery, the suggestions for a change; in full screen, the reader's shortcuts the first few times.
**How to use**, next to the panel's tabs, opens a short card: each thing Archify does, in a line,
with a button named for what it does (start a diagram, paste Mermaid, edit a diagram, review it,
full screen, make an explainer). It lands where the thing is done, with the caret in New's "What to
draw" box; Review keeps the selected architecture, else picks one drawn from code, and says so when
there is none yet. The only prompt it offers to copy is one that works in any conversation; the
card says that a repository is drawn from a conversation opened in it. A click outside closes it.

Pages without asking come from your instructions: DeepSeek Harness reads `~/.dsh/AGENTS.md` into
every conversation and a project's `AGENTS.md` (or `CLAUDE.md`) into the conversations opened in
it. Add `[archify explainer: proactive]` to one of them; conversations started after that follow it.

## Fast by default

Archify's checks are strict, and repairing a layout is where a model spends its time. The plugin
keeps that bounded:

- **Schema slips are fixed, not repaired.** Before checking, the tool walks the draft against the
  diagram type's own schema and fixes what a model gets wrong most: a property the schema does
  not have, an enum value off by case or a close synonym (`cache` for `database`, `queue` for
  `messagebus`, `vpc` for `security-group`, `async` for `dashed`), more than three sources, an
  over-long label, a source given as a bare path. The result lists each change. Each of these used
  to cost a failed render and a repair round.
- **A repository in one call.** `archify_scan` gives the model a repository at a glance: Git remote
  and revision, folders with file counts, languages, manifests and dependencies, Docker Compose
  services, Dockerfiles, Kubernetes objects, Terraform resources, CI workflows, configuration key
  names, the README's opening, and a code map: the module graph between folders (which folder
  imports from which) and, for the key files, what each imports and where its main declarations
  start, ready to cite. It takes well under a second on a repository of a few thousand files, and
  saves the model from grepping for imports and paging through big files. A run from the panel
  attaches it to the prompt.
- **Source evidence is pinned for the model.** Archify checks a diagram's repository identity
  strictly (the remote must match `origin`, the commit must exist, web links need the canonical
  HTTPS address), and getting it right by hand took models several failed renders. The tool writes
  `meta.repository` from the checkout itself; outside a Git checkout it leaves the sources out and
  says so, instead of failing.
- **Architecture diagrams are laid out for the model.** The model writes only the boxes, the
  arrows and the groups; the plugin places them with [ELK](https://github.com/kieler/elkjs)'s
  layered layout (each group kept together, the main path top to bottom), tries four layouts
  against Archify's own checks in about a second, and keeps the passing one with the fewest
  crossings and detours. The positions go into `candidate.json`, so later edits still work: after
  a change to the text or the topology the diagram is laid out again, while positions you move by
  hand stay where you put them.
- **A passing page is the answer.** The model replies as soon as a page is delivered. It does not
  start visual reviews, screenshots or another layout round on its own. When Archify suggests
  tidying routes, the reply ends with an offer instead: say "整理一下布局" or "tidy the layout" to
  get that pass.
- **A repair budget.** From the third failed render of the same draft, the tool asks the model to
  switch it to Archify's `standard` profile, which leaves out the showcase-only polish checks
  (label clearance, corridor and crossing rules, canvas width), and deliver. From the eighth, it
  asks the model to stop and tell you what is left.
- **Rendering is quick.** A failed validation answers in about a second; a full pass, including
  the real-browser check, takes about three.

In our tests with DeepSeek-V4.1-Flash, at Archify's strict `showcase` profile (one run each, so
take the numbers as a guide): an architecture diagram of a described system took about 25 seconds
(30 with 0.2.0). An architecture diagram traced from a real repository, the Images plugin (seven
source files, about 4,000 lines), took about 100 seconds in 12 steps with a single render, against
150 seconds, 24 steps and three renders with 0.2.0, and the model read a third as many tokens. That
clone's origin was a local folder, which cost 0.2.0's model two failed renders on the repository
identity that 0.3.0 now fills in. Earlier: an explainer page about 20 seconds, a sequence diagram
about 50.

## Where the files go

Each request gets a folder in the conversation's working directory:

```
.archify/<type>-<name>-<YYYYMMDD-HHMMSS>/
  candidate.json            the diagram (candidate.archify.md for an explainer)
  candidate.layout.json     the layout the plugin wrote into it (architecture)
  <name>.html               the page
  <name>.*.json             Archify's delivery and check receipts
```

A repair rewrites the same page; a new request gets a new folder. The panel's list lives in
`~/.dsh/cache/archify/gallery.json`, and the runs it started in `jobs.json` beside it. A diagram of
a description started from the panel is drawn in `~/.dsh/archify/workspace` (the `workdir`
setting), and the examples the panel opens are rendered once into `~/.dsh/cache/archify/examples/`.

## What it reads and sends

- The plugin calls no model. The conversation's own model writes the diagram, reading Archify's
  references from the plugin folder and, for a diagram of your code, your files as it normally
  would.
- Rendering runs locally. Archify's update check is turned off: this copy is updated with the
  plugin. Archify goes online only to fetch a brand logo from a URL a diagram names.
- Nothing is added to what the model reads except the skill (when it loads it), the tool results
  and, for a run you start from the panel, its prompt.
- `archify_scan` reads names and structure: folders, manifests, Compose, Docker, Kubernetes and
  Terraform files, workflow names, the README's opening, and only the variable *names* in
  `.env.example`-style files. It never opens `.env`, prints no value, and strips credentials from
  the Git remote.
- The panel's review runs locally on the diagram's JSON. **Ask the model to review** sends a
  message to a conversation, like one you would type.
- Pages are served to the Harness page in a sandbox with their own origin: the viewer's scripts
  run, but nothing on a page can reach the Harness or its routes. The routes serve only pages the
  tool delivered.

## Tools

| Tool | What it does |
| --- | --- |
| `archify_render` | Renders, checks and delivers a page: Archify's `finalize`. Takes `type`, and either `spec` (the JSON, or `markdown` for an explainer) for a new page, or `candidate` (a path) to render an edited draft again. Optional `name`, `quality` (defaults to the draft's `meta.quality_profile`), `relayout`, `repoRoot` (defaults to the working directory's Git root when the draft cites source files) and `output`. |
| `archify_scan` | A repository at a glance for a diagram of a codebase, with its code map (see above). Optional `path`; its Git root is scanned. |
| `archify_review` | Keeps an architecture review of a delivered diagram: `candidate`, `basis` (`code` or `description`), `software`, `verdict` and `findings`, each citing files and line ranges (or components). Refuses a point whose citations do not check out. |
| `archify_cli` | Runs any other Archify command (`guide`, `brands`, `compare`, `patch`, `validate`, `visual-check`, `doctor`, …) with the bundled runtime. `preview`, which starts a live server, is refused. |

## Settings

On the plugin's row in your profile patch (`cordis.patch.yml`):

| Key | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | `false` offers neither tool to the model. |
| `skill` | `true` | `false` leaves the `archify` skill out of the catalog. |
| `timeoutMs` | `240000` | How long one Archify run may take. |
| `workdir` | `~/.dsh/archify/workspace` | Where a diagram of a description started from the panel is drawn. |

## If something looks wrong

- **The model runs `node …/archify.mjs` in a shell instead of the tool.** Another `archify` skill
  is winning: personal and project skills (`~/.dsh/skills/archify`,
  `~/.agents/skills/archify`, or `.dsh/skills` / `.agents/skills` in the project) outrank a plugin's. Rename or remove that copy to use this one.
  Installing the separate `@tt-a1i/archify-dsh` package next to this plugin also gives two
  `archify` skills; keep one.
- **The browser check says skipped.** No Chrome, Chromium or Edge is installed. The page is still
  delivered; only that gate did not run. Set `ARCHIFY_CHROME` to a browser's executable to use
  another one.
- **An architecture diagram has many crossings.** Some systems are tangled: a main path that runs
  in and out of a large group crosses itself whatever the layout. Ask for a tidy-up, or for fewer
  or smaller groups.
- **A dense diagram looks busy.** It was probably delivered at the `standard` profile after the
  repair budget. Ask for a tidy-up, or for a higher-level diagram with fewer nodes.
- **The panel says a file is gone.** The page was moved or deleted from the working directory.
- **Generate is greyed out.** This Harness does not let a plugin start conversations; **Open in a
  conversation** still works.
- **A run ended without a page.** Open its conversation: the model may be asking you something, or
  the folder had nothing to draw (it will not invent services an empty folder does not have).

## Bundled Archify

`archify/` is Archify 3.2.0 from `main` at the commit recorded in
[`archify/UPSTREAM.json`](https://github.com/kadaliao/dsh-archify/blob/main/archify/UPSTREAM.json), unmodified, minus its tests, pre-rendered example
pages, generator scripts and lockfile. [`skill/SKILL.md`](https://github.com/kadaliao/dsh-archify/blob/main/skill/SKILL.md) is its `SKILL.md` adapted
for Harness: the shell commands become the plugin's tools, the update check and setup sections are
removed, and delivery stops at the first passing page. To refresh the copy from a checkout of
tt-a1i/archify:

```bash
node scripts/sync-archify.mjs /path/to/archify
```

`assets/previews/` holds the panel's pictures of each type, light and dark, taken from Archify's own
examples by `python3 scripts/build-previews.py` (Playwright and Pillow); run it again after
refreshing the copy.

`vendor/elkjs/` is `lib/elk.bundled.js` from [elkjs](https://github.com/kieler/elkjs) 0.12.1, the
Eclipse Layout Kernel compiled to JavaScript, unmodified. It loads only in the layout worker, a
separate process the plugin starts for each architecture layout.

## License

The plugin is MIT. `archify/` is Apache-2.0 with historical MIT grants, by tt-a1i: see its
`LICENSE`, `LICENSE-MIT`, `NOTICE` and `THIRD_PARTY_NOTICES.md`, and this plugin's
[NOTICE](https://github.com/kadaliao/dsh-archify/blob/main/NOTICE). `vendor/elkjs/` is used under the Eclipse Public License 2.0 (elkjs is offered
under EPL-2.0 or GPL-3.0-or-later): see `vendor/elkjs/LICENSE.md`.
