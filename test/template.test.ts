// `template/` works outside this repository: copied somewhere else, it builds a page and its tests pass,
// through the `wac` command and nothing else.
//
// **The dependency is this checkout, put where `wac update` would put it.** The template maps `web` and
// `webbuild` to this repository on git.voltrevo.com, and fetching is the network — so instead of fetching,
// the test writes the cache a fetch leaves behind (`$WAC_HOME/cache/git/<repo>/<commit>`, a plain checkout)
// from the working tree, and a `wac.lock` naming that commit. What is under test is everything after the
// fetch: resolving the two packages through the manifest and the lock, the builder run from the project,
// and the page's program compiled from a cache rather than from this tree. A change to this package or to
// the template that breaks a project outside the repository breaks this test.
//
// It came from wac's `tools/wac/webtemplate_test.wac`, which wrote the cache with wac's own `wacpkg`; this
// repository cannot import that, so `escapeRepo` and the lock's shape are spelled out below, and a change
// to either in wac shows up here as a template that no longer resolves.
import { ROOT, WAC } from "./harness.ts";

const GIT = "https://git.voltrevo.com/web.git";
/** A commit no fetch made: the cache entry is the test's own, so it cannot collide with a real one. */
const COMMIT = "0000000000000000000000000000000000000001";

/** wacpkg's `escapeRepo`: `[a-z0-9._-]` as they are, an uppercase letter as `!` and its lowercase, the rest `%HH`. */
function escapeRepo(url: string): string {
  let out = "";
  for (const c of new TextEncoder().encode(url)) {
    const ch = String.fromCharCode(c);
    if (/[a-z0-9._-]/.test(ch)) out += ch;
    else if (/[A-Z]/.test(ch)) out += "!" + ch.toLowerCase();
    else out += "%" + c.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

async function sh(line: string, cwd: string, env: Record<string, string> = {}): Promise<{ ok: boolean; said: string }> {
  const r = await new Deno.Command("/bin/sh", { args: ["-c", line], cwd, env, stdout: "piped", stderr: "piped" }).output();
  return { ok: r.success, said: new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr) };
}

function between(s: string, open: string, close: string): string {
  const at = s.indexOf(open);
  if (at < 0) return "";
  const rest = s.slice(at + open.length);
  const end = rest.indexOf(close);
  return end < 0 ? "" : rest.slice(0, end);
}

function assert(cond: boolean, what: string): void {
  if (!cond) throw new Error(what);
}

Deno.test("the template builds and tests outside the repository", async () => {
  const base = await Deno.makeTempDir({ prefix: "web-template-" });
  try {
    const home = `${base}/home`;
    const project = `${base}/myapp`;

    // The fetch's result, from this checkout: the files git tracks, as a fetch would have them.
    const checkout = `${home}/cache/git/${escapeRepo(GIT)}/${COMMIT}`;
    const copied = await sh(`mkdir -p '${checkout}' && git ls-files -z | xargs -0 cp --parents -t '${checkout}'`, ROOT);
    assert(copied.ok, `the package is in the cache — ${copied.said}`);
    const tpl = await sh(`mkdir -p '${project}' && cp -R template/. '${project}/'`, ROOT);
    assert(tpl.ok, `the template is copied — ${tpl.said}`);
    const lock = {
      imports: {
        web: { git: GIT, ref: "master", commit: COMMIT },
        webbuild: { git: GIT, ref: "master", subdir: "./tools", commit: COMMIT },
      },
    };
    await Deno.writeTextFile(`${project}/wac.lock`, JSON.stringify(lock, null, 2) + "\n");

    // The template's build task, spelled out so the binary under test is the one that runs the builder too.
    const env = { WAC_HOME: home };
    const built = await sh(`'${WAC}' run --allow-read --allow-write --allow-run build.wac src/app.wac dist --wac '${WAC}'`, project, env);
    assert(built.ok, `the page builds — ${built.said}`);
    const html = await Deno.readTextFile(`${project}/dist/index.html`);
    assert(html.includes("host.start()"), "the page starts the program");
    // **The one script the page runs as written is the one its policy allows.** The build states the
    // loader's hash rather than computing it — it has no SHA-256 to import (`documentScript` in
    // `tools/build.wac`) — so a loader edited without its hash is a page that runs nothing, and only a
    // browser would say so. This says so without one.
    const loader = between(html, "<script>", "</script>");
    const allowed = between(html, "script-src 'sha256-", "'");
    assert(loader !== "" && allowed !== "", "a policy and a loader in the page");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(loader)));
    const hash = btoa(String.fromCharCode(...digest));
    assert(allowed === hash, `the policy allows ${allowed} but the loader hashes to ${hash} — loaderHash() in tools/build.wac`);

    // And its test task.
    const tested = await sh(`'${WAC}' test test`, project, env);
    assert(tested.ok, `the template's tests pass — ${tested.said}`);
    assert(tested.said.includes("2 passed"), `both of them — ${tested.said}`);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});
