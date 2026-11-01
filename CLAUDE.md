# web

The page a wac program is handed — `export async i32 main(Page page)` — and the builder that makes one
`index.html` of it. [README.md](README.md) is the package; this file is how to work on it.

**It was wac's `packages/web` until 2026-10-29**, split out with its history so that work on it does not
wait on wac's gate (about twenty minutes, plus seed rebuilds). `template/` was wac's `templates/webapp`,
and `example/` holds the five pages only this package's tests use, which were in wac's
`packages/platform/example/`.

## What it depends on

**Nothing but a `wac` command.** `std` and `core` are built into the compiler, so the package imports no
other and pins nothing; what a change here needs from wac is a `wac` new enough. It was split from wac
`desktop-base` (`84e91aebf`) and is tested against a `wac` built from that commit. A change that needs
something new in wac lands in wac first, through its gate.

wac depends on this package by git, pinned to a commit (its site, and the page examples under its
`packages/`), as `wac-desktop` does. Moving that pin is a wac change and goes through wac's gate; nothing
pushed here reaches wac until someone moves it.

**References to `design/…`, `issues/…`, `spec ch…` and `packages/…` in comments name wac's
documents and files**, at `https://git.voltrevo.com/wac.git`. They were written when this was a
directory of wac, and they are still the reasons.

## Running things

    wac check . && wac test test/wac                 the package, with no browser — about a second
    deno test -A --unstable-net --no-check test/     the template outside the repository, and pages in Chromium
    tools/push.sh                                    all of it, then push

`$WAC` names the `wac` the Deno tests and the gate run; the one on `PATH` otherwise. The browser tests skip,
loudly, without Chromium under `~/.cache/ms-playwright`.

## Working agreements

- **Pushing to `https://git.voltrevo.com/web.git` is the agent's call** once `tools/push.sh` passes,
  as it is for wac. Nothing goes to GitHub unless the owner says so.
- **wac's rule holds here: there are no users and no legacy.** When nothing needs a thing, delete it —
  not deprecate it, not keep it behind a flag. If you find yourself proposing to keep something, say
  what would break, and check that it is not just a test you could edit.
- **Comments explain why, in full sentences, as the existing ones do.** Match the surrounding style.

## What is being built here

**`wac.page`**: `Page` over host requests, so the same program draws into a standalone page or into a window
of the desktop (step 2 of the handover in `https://git.voltrevo.com/notes.git`,
`2026-10-29-wac-desktop-handover.md`).

- **Done:** the capability (`src/line.wac`), `Page` and `Element` over it (`Page.open(sys)`), `TestDoc` as a
  host answering it, and the browser host answering it (`wacPageServer` in `tools/build.wac`). A page's program
  is a plain module (`moduleFor`): built by `wac build`, driven from its manifest like any module (`wacRun`),
  rendering on `Page.changed`. The bindgen wrapper, `PageHost`, `Spawned` and `system.wac` are gone.
- **Done, for the desktop:** changes travel as one `PAGE_BATCH` a turn — a request, so it reaches a parent that
  provides the capability — and `PageServer` (`src/serve.wac`) answers `wac.page` into an `Element` this program
  holds, refusing a child's mistakes rather than trapping on them. `Procs.spawnProviding` with `server.provider()`
  is a page's program in a window; wac-desktop's `src/desk/program.wac` does it.
- **Next:** files a window hands its program (drops, a picker), and grants (the handover's design point 6).
