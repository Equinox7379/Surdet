<div align="center">

# Surdet

### Write the story. Make it playable.

A visual novel engine with a visual editor, scene direction, a shared player runtime, and tools for external AI assistants.

[简体中文](README.md) · **English**

[![License: MIT](https://img.shields.io/badge/engine-MIT-7eaa92?style=flat-square)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178c6?style=flat-square&logo=typescript&logoColor=white)](packages/core)
[![Node.js 24+](https://img.shields.io/badge/Node.js-24%2B-417e38?style=flat-square&logo=nodedotjs&logoColor=white)](package.json)
[![Windows](https://img.shields.io/badge/desktop-Windows-0078d4?style=flat-square)](docs/guide/export-windows.md)
[![MCP](https://img.shields.io/badge/AI_tools-MCP-7868a6?style=flat-square)](docs/AI-GUIDE.md)

[Get started](#quick-start) · [Author guide](docs/guide/README.md) · [Complete tutorial](docs/guide/tutorial.md) · [Connect an AI assistant](#external-agent-authoring) · [Contribute](#contributing)

![Harbor artwork from Surdet's bundled Letters from the Misty Harbor example](examples/starter/content/assets/bg/harbor.png)

<sub>Background artwork from the bundled example 雾港来信 (Letters from the Misty Harbor). Game assets have separate licensing terms; see below.</sub>

</div>

## From a line of dialogue to a game

A late apology. An unsent letter. A choice that changes the ending. A story can start with something small. Surdet helps you build from that first moment through dialogue, branches, characters, staging, menus, and playtesting, until you have a game to share with players.

Arrange scenes in the visual Editor or write readable `.gal` scripts directly. Work on your own or give a clearly defined task to an external AI assistant through MCP. The Editor and authoring tools use the same project operations and validation rules, and your project stays in local files.

Surdet is under active development, with **Windows desktop authoring and game export** as its current focus. Source code, examples, and a Chinese author tutorial live in this repository. Building from source is the recommended starting point; there is no signed installer release or public npm installation workflow yet.

## What you can build

| Your goal | Tools in Surdet |
| --- | --- |
| Turn a script into a branching visual novel | Arrangement, manuscript, and source views; characters, variables, conditions, jumps, and a flow map |
| Shape the rhythm of a line | Ruby annotations, emphasis marks, color, size, pauses, tag completion, and diagnostics |
| Direct a scene | Character poses, layered environments, parallax, cameras, transitions, filters, and multitrack timelines |
| Give your game its own interface | A UI designer, themes, nine-slice skins, interaction states, page transitions, and import previews |
| Support comfortable reading | Save/load, rollback, backlog, auto mode, skip, reading settings, and collection pages |
| Prepare multiple languages | Text keys, translation CSVs, existing voice recording associations, and language switching without restarting the story |
| Collaborate with an AI assistant | CLI and MCP tools for discovery, inspection, isolated drafts, validation, playtesting, and authorized application |
| Deliver a Windows game | Export a runnable game folder from the desktop Editor |

### Keep the script readable and the next playtest close

In arrangement view, backgrounds, characters, dialogue, and choices become editable story steps. Manuscript view supports continuous reading and revision. Source view gives you direct control over the script. Start a playtest from a particular line or follow the flow map to inspect a branch.

![Story arrangement and branching choices in the Editor](docs/guide/images/tutorial-branch-steps.png)

Diagnostics point back to the relevant source location. Incorrect inline tags remain as you wrote them while the Editor explains the problem. Undo, redo, drafts, and saving stay part of the regular writing workflow.

### See how the branches connect

As a story grows, its routes become harder to keep in your head. The flow view shows scenes and choices together. Story checks record visited locations, condition results, and reasons for stopping, helping you find broken connections and references.

![The Editor's story flow map](docs/guide/images/tutorial-flow.png)

Automated checks have explicit path and execution budgets. They produce inspectable results; they do not decide whether a scene reads well or feels right to play.

### Give words room to perform

ADV dialogue, NVL text, ruby annotations, and emphasis marks support different reading rhythms. The stage can move characters and environment layers independently. Multitrack timelines organize longer sequences and support bounded reuse of clips.

![Inline tag highlighting and completion in source view](docs/guide/images/pending-source-completion.png)

Backgrounds, portraits, music, sound effects, voice recordings, and video enter through project asset references. Importing, moving, and renaming assets have dedicated project operations, so replacing a picture does not require editing player code.

### Make the interface part of the story

Project UI configuration can organize title, dialogue, choices, system menu, save, settings, backlog, and gallery pages. The designer exposes typography, backgrounds, borders, padding, shadows, nine-slice skins, hover/focus/pressed/disabled states, and page entry and exit motion.

Before importing a theme or UI fragment, inspect the affected pages and changes to images and fonts. Preview it, try it in the Player, then choose whether to apply it. Technical examples explain the format:

- [U1 style example](docs/ui-style-u1-example.md)
- [U2 interactions and page motion](docs/ui-interaction-contract.md)
- [U3 complete technical theme and import preview](docs/ui-theme-u3-technical.md)

These examples demonstrate behavior and formats. The final art direction, layout, and feel of your game still deserve their own design and playtesting.

### Leave room for translation

Register text keys for dialogue, choices, character display names, and custom UI strings. Export a CSV, fill in translations, and preview the import before confirming it. Dialogue can also be associated with existing recordings by text key and language.

![Text catalog and translation status](docs/guide/images/translation-catalog.png)

The shared Player can switch the game's language from reading settings while keeping story progress. Missing translations display the source text; missing or outdated voice recordings allow silent reading. Surdet does not automatically translate text or generate voice acting.

> Editor screenshots on this page come from actual author-guide sessions and show the Chinese interface. Some were captured using an earlier Linux desktop build; they are not a pixel-exact preview of a current Windows release. See the [author guide](docs/guide/README.md#截图与版本说明) for version and verification details.

## Quick start

### 1. Get and build the source

Install **Node.js 24 or later, npm, and Git**:

```powershell
git clone https://github.com/Equinox7379/Surdet.git
cd Surdet
npm ci
npm run build
```

The root build command builds the engine, authoring tools, Editor, and Starter in dependency order. The first installation downloads dependencies; an existing development environment can be reused.

### 2. Open the desktop Editor

On Windows:

```powershell
npm run desktop:build -w surdet-editor
npm run desktop -w surdet-editor
```

Create an example project to explore a working short story, or choose a blank project and write your first line.

To produce a folder containing a directly runnable Editor:

```powershell
npm run desktop:pack -w surdet-editor
```

The output is `packages/editor/release/editor/win-unpacked/`. Keep the entire folder and run `Surdet Editor.exe`. Users of this built application do not need a separate Node.js installation.

<details>
<summary>Browser development and the sample game</summary>

Start the browser Editor:

```powershell
npm run dev -w surdet-editor
```

Open the printed address in Chrome or Edge, then select a project directory.

Run the bundled 雾港来信 (Letters from the Misty Harbor) example:

```powershell
npm run dev -w surdet-starter
```

The example has three endings and optional exploration content. See the respective guides for each entry point's behavior and export requirements. Windows desktop is the primary validation target.

</details>

### 3. Finish a first short story

Follow the [Rainy Night Station tutorial](docs/guide/tutorial.md), currently in Chinese, to build a story with two branches and one ending from a blank project:

1. Create a project, characters, and variables.
2. Import backgrounds and portraits; write dialogue and choices.
3. Add ruby annotations, pauses, and other text styles.
4. Play the branches and use saves, the backlog, and reading settings.
5. Check problems, record a saved version, and export a Windows game.

Practice assets are included. Once you know the workflow, replace them with artwork and audio you have permission to use.

## What a script looks like

A `.gal` script is readable text. This branching example requires no external assets and can replace `start.gal` in a blank project:

```text
@scene start

Rain gathers into a steady rush beneath the station roof.
Rin: The last train has already left.

@choice
  Stay until morning -> @goto stay
  Take a look outside -> @goto rain

@label stay
I sit down at the other end of the bench.
Rin: Then let's wait together.<w=500> Morning will come.
@goto finish

@label rain
The wind carries rain into the circle of lamplight.
Rin: ...The umbrella is over here. Bring it back, okay?

@label finish
<em>There is still a long night ahead.</em>
@end
```

`@end` ends the current scene. Whether the game returns to the title here depends on the project's end-scene configuration. Add characters, variables, assets, and more elaborate staging as your story grows. The [DSL specification](docs/dsl-spec.md) and [inline text guide](docs/guide/inline-text.md) define the syntax.

## External Agent authoring

Surdet's AI interface exposes real project operations. An external assistant can inspect existing scenes and assets, edit an isolated draft, and use validation, simulation, and runtime observations to check the result. You can inspect differences, play the draft in the Editor, and decide whether to apply it.

**Choose your own model and client.** The engine does not embed a model or require an AI account for ordinary manual authoring. Which provider receives project content depends on the external client and settings you choose.

After building the workspace, start Agent Port:

```powershell
node packages/cli/dist/agent-port/main.js --project "C:/games/my-story" --policy stage
```

A client supporting stdio MCP can use the following configuration. Replace both example paths with your actual locations:

```json
{
  "mcpServers": {
    "surdet": {
      "command": "node",
      "args": [
        "C:/projects/Surdet/packages/cli/dist/agent-port/main.js",
        "--project", "C:/games/my-story",
        "--policy", "stage"
      ]
    }
  }
}
```

| Session mode | Purpose |
| --- | --- |
| `observe` | Read the project; checks on a resumed draft may append evidence in isolated storage, without writing project files |
| `stage` | Edit, validate, and preview an isolated draft without changing the source project |
| `apply` | Explicitly authorize project writes, subject to transaction, draft, and lease protection; integrated results also require human approval |

A useful workflow is **inspect → draft → write → validate and play → review differences → authorize application**.

To preview the same working change in the Editor:

```powershell
npm run dev:project -w surdet-editor -- --project "C:/games/my-story"
```

Bind the Editor and Agent Port to the same project. If you configure a custom Agent data directory, use it consistently in both. The [AI authoring guide](docs/AI-GUIDE.md) documents capability discovery, asset import, scene editing, candidate composition, recovery, and permission boundaries.

## Your project stays in files you can read

A game consists of scripts, JSON configuration, and assets:

```text
my-story/
├── game.config.json         # Title, characters, variables, entry, and player configuration
├── package.json             # Project identity and build configuration
├── content/
│   ├── scenario/            # .gal scripts
│   ├── assets/              # Backgrounds, portraits, audio, video, and fonts
│   ├── timelines/           # Optional timeline sequences
│   └── config/              # Optional gallery and other content configuration
└── src/                     # Project entry point
```

You can version these files in your own repository. Saving, undo, saved-version checkpoints, and AI working drafts serve different purposes; keep your own backups of important projects.

Create a blank project with the CLI:

```powershell
node packages/cli/dist/index.js new my-story --directory "C:/games/my-story" --template blank
```

Ordinary projects use the shared Player rather than a copied menu and save implementation. Standalone source projects still need matching Surdet packages and development dependencies. Do not assume that `@surdet/*` packages are available on public npm; follow the generated project's README.

## Workspace

Surdet is written in TypeScript and uses npm workspaces. Runtime semantics, authoring operations, and presentation are separate modules. The Editor and CLI share the Authoring layer.

| Directory | Responsibility |
| --- | --- |
| [`packages/core`](packages/core) | DSL, interpreter, variables, system state, and snapshot semantics |
| [`packages/authoring`](packages/authoring) | Project reads, typed edits, validation, simulation, and commit transactions |
| [`packages/cli`](packages/cli) | Command line, Node filesystem integration, and MCP Agent Port |
| [`packages/renderer`](packages/renderer) | PixiJS presentation, stage, text, audio, and project UI |
| [`packages/host`](packages/host) | Input, menus, player operations, and host coordination |
| [`packages/shell`](packages/shell) | Electron shell, desktop storage, and game packaging |
| [`packages/editor`](packages/editor) | Visual authoring and the desktop Editor |
| [`examples/shared`](examples/shared) | The shared `@surdet/player` runtime |
| [`examples/starter`](examples/starter) | Letters from the Misty Harbor example |
| [`examples/zero-after-midnight`](examples/zero-after-midnight) | Zero After Midnight, an example with an independent player entry point |
| [`games/tide-mark`](games/tide-mark) | Tide Mark game workspace |

See the [architecture guide](docs/architecture.md) for more detail.

## Documentation

| Topic | Start here |
| --- | --- |
| Make a game without reading engine code | [Chinese author guide](docs/guide/README.md) · [Complete tutorial](docs/guide/tutorial.md) |
| Exact script syntax | [DSL specification](docs/dsl-spec.md) · [Inline text](docs/guide/inline-text.md) |
| Assets and scene direction | [Author guide](docs/guide/assets-and-staging.md) · [Presentation contract](docs/presentation-effects-contract.md) |
| Custom UI and theme sharing | [Styles](docs/ui-style-contract.md) · [Interaction](docs/ui-interaction-contract.md) · [Import preview](docs/ui-sharing-import-contract.md) |
| Translations and voice associations | [Text and translation](docs/guide/translation.md) |
| Windows game export | [Author steps](docs/guide/export-windows.md) · [Export contract](docs/windows-game-export-contract.md) |
| External AI tools | [AI authoring guide](docs/AI-GUIDE.md) |
| Implemented and planned capabilities | [Capability matrix](docs/capability-matrix.md) · [Known limitations](docs/known-limitations.md) |
| Upgrades, script revisions, and saves | [Version and data support](docs/guide/versions-and-data.md) |

The [documentation index](docs/README.md) lists all current guides. Detailed author documentation is primarily in Chinese. This English README provides the project overview and startup instructions; documentation translations are welcome.

## Current status

- **Platforms:** Windows desktop authoring and Windows game export are the current focus. Browser development primarily uses Chrome / Edge. Linux development checks do not imply a complete Linux or macOS authoring release.
- **Distribution:** Source and build instructions are available here. Desktop builds are unsigned; there is no signed installer release. Versions in the source tree do not imply that corresponding packages are published on npm.
- **Content:** The engine imports artwork and audio, but does not automatically finish a game's writing, art, voice acting, or quality review. Example placeholders serve specific demonstration purposes.
- **Features:** The capability matrix distinguishes implemented features from plans. Pre-battle formation editing, for example, remains planned. Save compatibility and recovery after script changes have defined limits.
- **Languages:** The language switch at the top changes this README. Editor screenshots and most author documentation remain Chinese; this does not claim that the entire Editor has an English interface.

## Contributing

Try Surdet with a real story, a concrete problem, or an improvement you would like to make. Feedback from actual authoring sessions is especially useful.

- **Report a problem:** Open an [issue](https://github.com/Equinox7379/Surdet/issues) with steps, expected and actual behavior, version, and platform. Remove credentials, personal paths, and unpublished story content from examples or screenshots.
- **Submit a change:** Use a branch and Pull Request. Explain the problem, resulting behavior, relevant verification, and what remains untested.
- **Improve the docs:** Corrections, English translations, and clearer examples all help.
- **Create themes or examples:** Share your work and include the origin and permission terms of any assets you contribute.

### Verification

Choose checks for the part you changed. After the workspace build, examples include:

```powershell
npm run test -w @surdet/core -- test/inline-text.test.ts
npm run typecheck -w surdet-editor
npm run verify:docs
```

Use the actual test path for the affected module. `verify:docs` checks the existing capability matrix; it is not a general validator for every document and link. `verify:all` is available for environments where full verification is permitted. Follow the task's execution rules and [AGENTS.md](AGENTS.md), and state what your results actually cover.

## License

Surdet-authored engine code and technical documentation use the [MIT License](LICENSE). Subject to its terms, you may use, modify, and redistribute the engine, including for commercial games. Using Surdet does not require you to open-source your game's code or story.

**The engine license does not license every asset.** Stories, artwork, music, video, fonts, game branding, and third-party components follow their respective terms. Game assets without explicit permission should not be redistributed as a free asset pack. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the scope.

---

<div align="center">

**Start with the first line.**

[Read the tutorial](docs/guide/tutorial.md) · [Explore the source](packages) · [Report an issue](https://github.com/Equinox7379/Surdet/issues) · [简体中文](README.md)

</div>
