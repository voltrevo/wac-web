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
        await buildPage("example/sense.wac", dir, mode);
        const port = (http = serve(dir)).port;
        browser = await chromium.launch({ args: ["--no-proxy-server"] });
        const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 });
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
      } finally {
        await browser?.close();
        await http?.stop();
        await Deno.remove(dir, { recursive: true });
      }
    },
  });
}
