// What the browser tests share: building a page the way a reader would, and waiting on one.
//
// The way to the artefact is `tools/build.wac`, run by the `wac` command, which is what `template/` runs. A
// test that built its page some other way would be testing a page nobody ships.
//
// **Which `wac`** is `$WAC` when it is set, and the one on `PATH` otherwise. This package carries no compiler:
// `std` and `core` are built into whichever `wac` runs it, so the command is the one thing a run has to name.

/** This repository's root. */
export const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

/** The `wac` command the tests build with. */
export const WAC = Deno.env.get("WAC") ?? "wac";

/** Build `entry` — a module relative to the root — as a `.wasm` program at `out`, throwing with the compiler's words. */
export async function buildModule(entry: string, out: string): Promise<void> {
  const built = await new Deno.Command(WAC, {
    args: ["build", entry, "-o", out],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!built.success) throw new Error(`building ${entry} failed:\n${new TextDecoder().decode(built.stderr)}`);
}

/**
 * Build `entry` (relative to the root) as a page, and put its `index.html` in `outDir`.
 * `extra` goes to the builder as it is — `["--in-page"]` for a page whose program runs on its own thread.
 *
 * Built under `.cache/pages/` first, because the builder writes its wrapper module into its output
 * directory and refuses one outside the project — from a temporary directory the wrapper's imports
 * would cross a project boundary. The page itself is one self-contained file, so copying it out is
 * all a test serving it needs — and, built as an app to install (`--app`), its manifest, icon and service worker.
 *
 * Throws with the builder's own words on failure, because a test that carries on past a failed build
 * reports a confusing second failure about a file that is not there.
 */
export async function buildPage(entry: string, outDir: string, extra: string[] = []): Promise<string> {
  const name = entry.replace(/^.*\//, "").replace(/\.wac$/, "") + (extra.includes("--in-page") ? "-inpage" : "");
  const built = `.cache/pages/${name}`;
  const out = await new Deno.Command(WAC, {
    args: [
      "run", "--allow-read", "--allow-write", "--allow-run", "tools/build.wac",
      entry, built, "--page", "./src/page.wac", "--wac", WAC, ...extra,
    ],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!out.success) {
    const said = new TextDecoder().decode(out.stderr) + new TextDecoder().decode(out.stdout);
    throw new Error(`building ${entry} as a page failed:\n${said}`);
  }
  await Deno.mkdir(outDir, { recursive: true });
  await Deno.copyFile(`${ROOT}/${built}/index.html`, `${outDir}/index.html`);
  for (const f of ["manifest.webmanifest", "icon.png", "sw.js"]) {
    if (extra.includes("--app")) await Deno.copyFile(`${ROOT}/${built}/${f}`, `${outDir}/${f}`);
    else await Deno.remove(`${ROOT}/${built}/${f}`).catch(() => {});
  }
  return `${outDir}/index.html`;
}

/** Serve a directory. A page built by this package needs no special headers, but a service worker is a script. */
export function serve(dir: string): { port: number; stop: () => Promise<void> } {
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
    const path = new URL(req.url).pathname;
    try {
      const body = await Deno.readFile(`${dir}${path === "/" ? "/index.html" : path}`);
      const type = path.endsWith(".js") ? "text/javascript" : path.endsWith(".png") ? "image/png"
        : path.endsWith(".webmanifest") ? "application/manifest+json" : "text/html";
      return new Response(body, { headers: { "content-type": type } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
  return { port: server.addr.port, stop: () => server.shutdown() };
}

/**
 * `page.waitForFunction(expr, arg, options)` for a page this builder made.
 *
 * **Playwright evaluates a string predicate with `eval` inside the page**, and the page's Content
 * Security Policy refuses that — it allows its own loader and nothing else (`policy` in
 * `tools/build.wac`). `page.evaluate` goes through DevTools rather than the page's own
 * script, so this asks with that until `expr` is truthy. The signature is Playwright's, `arg` unused, so
 * a call converts by its name alone — including the calls that passed their options second.
 */
export async function waitInPage(
  page: { evaluate(expr: string): Promise<unknown> },
  expr: string,
  arg?: unknown,
  options?: { timeout?: number },
): Promise<void> {
  const opts = options ??
    (arg !== null && typeof arg === "object" && "timeout" in arg ? arg as { timeout?: number } : {});
  const timeout = opts.timeout ?? 30_000;
  const end = Date.now() + timeout;
  while (!(await page.evaluate(expr))) {
    if (Date.now() > end) throw new Error(`waitInPage: timed out after ${timeout}ms waiting for ${expr}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
