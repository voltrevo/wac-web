// test-lane: browser — drives Chromium through Playwright, which needs -A
// A page reads the site it was served from (`wac.site`, `src/site.wac`): `example/sitepage.wac` built, a `data`
// folder put beside it, `tools/index.wac` run over the lot, and the page served over http — where it lists the folder
// from the index and reads the note by a GET, and cannot write — and opened from a file, where there is no site.
import { ROOT, WAC, buildPage, serve, waitInPage } from "./harness.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) throw new Error(`assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`);
}

const cannotBecause = ((): string => {
  if (Deno.permissions.querySync({ name: "sys", kind: "homedir" }).state !== "granted") return "no `sys` permission";
  const home = Deno.env.get("HOME") ?? "";
  try {
    const found = [...Deno.readDirSync(`${home}/.cache/ms-playwright`)].some((e) => e.isDirectory && e.name.startsWith("chromium"));
    return found ? "" : `no chromium in ${home}/.cache/ms-playwright`;
  } catch {
    return `no ${home}/.cache/ms-playwright`;
  }
})();
if (cannotBecause !== "") console.warn(`SKIPPING the site live test: ${cannotBecause}.`);

Deno.test({
  name: "a page reads its own site as files over http, and has none from a file",
  ignore: cannotBecause !== "",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { chromium } = await import("npm:playwright@1");
    const dir = await Deno.makeTempDir({ prefix: "web-site-" });
    let browser;
    let http: { port: number; stop(): Promise<void> } | undefined;
    try {
      await buildPage("example/sitepage.wac", dir);
      await Deno.mkdir(`${dir}/data`);
      await Deno.writeTextFile(`${dir}/data/note.txt`, "from the site");
      await Deno.writeTextFile(`${dir}/data/other.txt`, "streamed");
      const indexed = await new Deno.Command(WAC, {
        args: ["run", "--allow-read", "--allow-write", "tools/index.wac", dir], cwd: ROOT, stdout: "piped", stderr: "piped",
      }).output();
      if (!indexed.success) throw new Error(new TextDecoder().decode(indexed.stderr));
      const port = (http = serve(dir)).port;
      browser = await chromium.launch({ args: ["--no-proxy-server"] });
      const said = async (url: string) => {
        const page = await browser!.newPage();
        await page.goto(url, { waitUntil: "load" });
        await waitInPage(page, "(() => { const e = document.getElementById('said'); return e !== null && e.textContent !== '…'; })()", null, { timeout: 30_000 });
        return await page.evaluate("document.getElementById('said').textContent") as string;
      };
      assertEquals((await said(`http://127.0.0.1:${port}/`)).split("|").map((x, i) => i === 0 ? x.split(",").sort().join(",") : x),
                   ["note.txt,other.txt", "from the site", "streamed", "read-only"], "listed from the index, read by a GET, streamed, and not written");
      assertEquals(await said(`file://${dir}/index.html`), "no site: a page opened from a file has no site", "from a file");
    } finally {
      await browser?.close();
      await http?.stop();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
