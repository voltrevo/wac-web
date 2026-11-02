// test-lane: browser — drives Chromium through Playwright, which needs -A
// A page's sounds in an actual browser: `example/beep.wac` built as a page, its buttons clicked in Chromium.
//
// `test/wac/serve_test.wac` checks that a child's sounds reach its desktop's page; what it cannot check is the host
// — that a sound arrives as samples a Web Audio buffer is made of, that a click plays it, a loop loops and a stop
// stops it. The page's `AudioBufferSourceNode`s are watched by a script added before the page's own, which counts
// what is started and stopped; Chromium plays to no device here, and the counts are what the page asked for.
//
// **Skipped loudly** when there is no browser, as `view_live.test.ts` is.

import { buildPage, serve, waitInPage } from "./harness.ts";
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(`assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`);
  }
}

const cannotBecause = ((): string => {
  if (Deno.permissions.querySync({ name: "sys", kind: "homedir" }).state !== "granted") {
    return "no `sys` permission: run this file with `deno test -A`";
  }
  const home = Deno.env.get("HOME") ?? "";
  try {
    const found = [...Deno.readDirSync(`${home}/.cache/ms-playwright`)]
      .some((e) => e.isDirectory && e.name.startsWith("chromium"));
    if (!found) return `no chromium in ${home}/.cache/ms-playwright`;
  } catch {
    return `no ${home}/.cache/ms-playwright — run: ./node_modules/.bin/playwright install chromium`;
  }
  return "";
})();
if (cannotBecause !== "") {
  console.warn(
    `SKIPPING the audio live test: ${cannotBecause}.\n` +
      `  test/wac/serve_test.wac checks sounds without a browser; this is the one that reaches Web Audio.`,
  );
}

/** Counts each buffer source started — its buffer's length and rate, and whether it loops — and each stopped. */
const WATCH = `
  window.__played = []; window.__stopped = 0;
  const start = AudioBufferSourceNode.prototype.start, stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start = function (...a) {
    window.__played.push([this.buffer.length, this.buffer.sampleRate, this.loop]);
    return start.apply(this, a);
  };
  AudioBufferSourceNode.prototype.stop = function (...a) { window.__stopped++; return stop.apply(this, a); };
  window.__starts = []; window.__ramps = [];
  const realStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, offset) {
    window.__starts.push([when ?? 0, offset ?? 0, this.context.currentTime]);
    return realStart.call(this, when, offset);
  };
  const ramp = AudioParam.prototype.linearRampToValueAtTime;
  AudioParam.prototype.linearRampToValueAtTime = function (v, t) { window.__ramps.push(v); return ramp.call(this, v, t); };
`;

Deno.test({
  name: "a page's sounds play, loop and stop in Chromium",
  ignore: cannotBecause !== "",
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const { chromium } = await import("npm:playwright@1");
    const dir = await Deno.makeTempDir({ prefix: "wac-audiolive-" });
    let browser;
    let http: { port: number; stop(): Promise<void> } | undefined;
    try {
      await buildPage("example/beep.wac", dir);
      const port = (http = serve(dir)).port;
      browser = await chromium.launch({ args: ["--no-proxy-server", "--autoplay-policy=no-user-gesture-required"] });
      const page = await browser.newPage();
      await page.addInitScript(WATCH);
      const failures: string[] = [];
      page.on("pageerror", (e: Error) => failures.push(String(e)));
      page.on("console", (m: { type(): string; text(): string }) => { if (m.type() === "error") failures.push(m.text()); });
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
      await waitInPage(page, "document.getElementById('count') !== null", null, { timeout: 30_000 });

      await page.click("#beep");
      await waitInPage(page, "window.__played.length === 1", null, { timeout: 10_000 });
      assertEquals(await page.evaluate("window.__played"), [[Math.trunc(0.12 * 22050), 22050, false]], "the beep, once");

      await page.click("#drone");
      await waitInPage(page, "window.__played.length === 2", null, { timeout: 10_000 });
      assertEquals(await page.evaluate("window.__played[1]"), [22050, 22050, true], "the drone, looping");
      const stoppedBefore = await page.evaluate("window.__stopped") as number;
      await page.click("#hush");
      await waitInPage(page, `window.__stopped > ${stoppedBefore}`, null, { timeout: 10_000 });
      // Two layers for the same moment, 200 ms ahead: both start at the same audio time, ahead of now, and one fades up.
      const before = await page.evaluate("window.__starts.length") as number;
      await page.click("#layers");
      await waitInPage(page, `window.__starts.length === ${before + 2}`, null, { timeout: 10_000 });
      const [a, b] = await page.evaluate(`window.__starts.slice(${before})`) as number[][];
      if (Math.abs(a[0] - b[0]) > 1e-9) throw new Error(`the layers start apart: ${a[0]} and ${b[0]}`);
      if (!(a[0] > a[2] + 0.1 && a[0] < a[2] + 0.3)) throw new Error(`not started 200 ms ahead: at ${a[0]}, now ${a[2]}`);
      await waitInPage(page, "window.__ramps.includes(0.6)", null, { timeout: 10_000 });
      assertEquals(failures, [], "the page reported an error");
    } finally {
      await browser?.close();
      await http?.stop();
      await Deno.remove(dir, { recursive: true });
    }
  },
});
