// test-lane: browser — drives Chromium through Playwright, which needs -A
// What a page can tell in an actual browser: `example/sense.wac` built as a page, resized, scrolled over and typed at.
//
// The size an element has on screen (`resize`), which way the wheel turned, and when a key was pressed by the
// page's own clock are the host's to say: the document's `ResizeObserver`, a wheel's `deltaY`, and an event's
// `timeStamp` counted from the same start as the clock a program in a worker reads. A clock counted from the
// worker's own start would make every key seem to arrive before it was pressed, or long after.
//
// **Skipped loudly** when there is no browser, as `view_live.test.ts` is.

import { buildPage, serve, waitInPage } from "./harness.ts";

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
  console.warn(`SKIPPING the sense live test: ${cannotBecause}.`);
}

for (const mode of [[], ["--in-page"]]) {
  Deno.test({
    name: `a page hears its size, the wheel and when a key was pressed${mode.length ? " — on the page's own thread" : " — in a worker"}`,
    ignore: cannotBecause !== "",
    sanitizeResources: false,
    sanitizeOps: false,
    fn: async () => {
      const { chromium } = await import("npm:playwright@1");
      const dir = await Deno.makeTempDir({ prefix: "wac-senselive-" });
      let browser;
      let http: { port: number; stop(): Promise<void> } | undefined;
      try {
        await buildPage("example/sense.wac", dir, ["--edge", "--app", "example/icon.png", "--app-color", "#123456", ...mode]);
        // An app to install: its manifest, icon and service worker beside it, and named in its head.
        const manifest = JSON.parse(await Deno.readTextFile(`${dir}/manifest.webmanifest`));
        if (manifest.display !== "standalone" || manifest.theme_color !== "#123456" || manifest.icons[0].src !== "icon.png") {
          throw new Error(`the manifest: ${JSON.stringify(manifest)}`);
        }
        await Deno.stat(`${dir}/icon.png`);
        await Deno.stat(`${dir}/sw.js`);
        // To the screen's edges, and shrunk by an on-screen keyboard rather than covered.
        const index = await Deno.readTextFile(`${dir}/index.html`);
        if (!index.includes("interactive-widget=resizes-content, viewport-fit=cover")) throw new Error("the viewport of an --edge page");
        const port = (http = serve(dir)).port;
        browser = await chromium.launch({ args: ["--no-proxy-server"] });
        const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2, hasTouch: true });
        await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load" });
        const text = (id: string) => `(document.getElementById(${JSON.stringify(id)})?.textContent ?? "")`;
        const size = async () =>
          await page.evaluate(`(() => { const r = document.getElementById("box").getBoundingClientRect();
                                        return Math.round(r.width * 2) + "x" + Math.round(r.height * 2); })()`) as string;
        await waitInPage(page, `document.getElementById("box") !== null`, null, { timeout: 30_000 });
        await waitInPage(page, `${text("size")} === ${JSON.stringify(await size())}`, null, { timeout: 10_000 });

        await page.setViewportSize({ width: 500, height: 600 });
        await waitInPage(page, `${text("size")} === ${JSON.stringify(await size())}`, null, { timeout: 10_000 });

        const over = await page.evaluate(`(() => { const r = document.getElementById("wheel").getBoundingClientRect();
                                                    return [r.left + r.width / 2, r.top + r.height / 2]; })()`) as number[];
        await page.mouse.move(over[0], over[1]);
        await page.mouse.wheel(0, 120);
        await page.mouse.wheel(0, -40);
        // Turned in the screen's pixels, and said in the page's: at two of one to the other, 120 down and 40 up is 40.
        await waitInPage(page, `${text("wheel")} === "40"`, null, { timeout: 10_000 });

        await page.click("#box");
        await page.keyboard.press("ArrowLeft");
        await waitInPage(page, `${text("key")} !== ""`, null, { timeout: 10_000 });
        const key = await page.evaluate(text("key")) as string;
        if (key !== "ArrowLeft on time") throw new Error(`the key, and when: ${key}`);

        // Two fingers on the pad at once, each its own pointer; one slides off before it lifts, and is heard lifting.
        const pad = await page.evaluate(`(() => { const r = document.getElementById("pad").getBoundingClientRect();
                                                   return [r.left, r.top]; })()`) as number[];
        const cdp = await page.context().newCDPSession(page);
        const at = (x: number, y: number, id: number) => ({ x: pad[0] + x, y: pad[1] + y, id });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at(30, 60, 1)] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at(30, 60, 1), at(200, 60, 2)] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [at(30, 400, 1), at(200, 60, 2)] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [at(200, 60, 2)] });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await waitInPage(page, `(${text("fingers")}.match(/;/g) ?? []).length === 4`, null, { timeout: 10_000 });
        const felt = await page.evaluate(text("fingers")) as string;
        const m = felt.match(/^down (\d+);down (\d+);up (\d+);up (\d+);$/);
        if (!m || m[1] === m[2] || [m[3], m[4]].sort().join() !== [m[1], m[2]].sort().join()) {
          throw new Error(`two fingers, each lifted, the one slid off too: ${felt}`);
        }

        // A place added to the history: the program hears it, the address shows it, and the browser's Back leaves it.
        await page.click("#deeper");
        await waitInPage(page, `${text("where")} === "deeper" && location.hash === "#deeper"`, null, { timeout: 10_000 });
        await page.goBack();
        await waitInPage(page, `${text("where")} === "home" && location.hash === ""`, null, { timeout: 10_000 });
        await page.goForward();
        await waitInPage(page, `${text("where")} === "deeper"`, null, { timeout: 10_000 });

        // Installed, it opens without the network: the service worker kept the page as it loaded.
        const manifestLink = await page.evaluate(`document.querySelector('link[rel=manifest]')?.href ?? ""`) as string;
        if (!manifestLink.endsWith("/manifest.webmanifest")) throw new Error(`no manifest named: ${manifestLink}`);
        await page.evaluate(`navigator.serviceWorker.ready.then(() => true)`);
        await page.reload({ waitUntil: "load" });
        await waitInPage(page, `navigator.serviceWorker.controller !== null && document.getElementById("box") !== null`, null, { timeout: 30_000 });
        await page.context().setOffline(true);
        await page.reload({ waitUntil: "load" });
        await waitInPage(page, `document.getElementById("box") !== null`, null, { timeout: 30_000 });
        await page.context().setOffline(false);
      } finally {
        await browser?.close();
        await http?.stop();
        await Deno.remove(dir, { recursive: true });
      }
    },
  });
}
