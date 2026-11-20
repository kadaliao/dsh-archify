# Archify: details

English | [简体中文](details.zh-CN.md) · [Back to the README](https://github.com/kadaliao/dsh-archify/blob/main/README.md)

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
- The panel's **Edit** and **Review from the code** send a message to the conversation that drew the diagram, the
  same as typing it yourself.
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
