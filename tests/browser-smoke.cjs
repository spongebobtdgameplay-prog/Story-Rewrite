const { chromium } = require("playwright");
const fs = require("node:fs/promises");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await fs.mkdir("browser-artifacts", { recursive: true });

  try {
    await page.goto("https://www.storyrewritegame.com/auth.html", { waitUntil: "networkidle", timeout: 60000 });
    await page.screenshot({ path: "browser-artifacts/auth.png", fullPage: true });
    const authBackground = await page.evaluate(() => ({
      bodyAttachment: getComputedStyle(document.body).backgroundAttachment,
      bodyImage: getComputedStyle(document.body).backgroundImage,
      scrollHeight: document.body.scrollHeight,
      clientHeight: document.body.clientHeight
    }));
    if (!authBackground.bodyImage || authBackground.bodyImage === "none") throw new Error("Shared page gradient is missing on auth page.");

    await page.goto("https://www.storyrewritegame.com/social.html", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: "browser-artifacts/social.png", fullPage: true });
    const searchState = await page.evaluate(() => {
      const input = document.querySelector("#SocialSearchInput");
      const frame = input?.closest(".StorySocialSearchBox");
      if (typeof window.SocialRenderUsers === "function") {
        window.SocialRenderUsers([], "Search for players");
      }
      const style = frame ? getComputedStyle(frame) : null;
      return {
        finalUrl: location.href,
        searchInputExists: !!input,
        searchFrameExists: !!frame,
        searchFrameBackground: style?.backgroundImage || null,
        searchFrameBackgroundColor: style?.backgroundColor || null,
        emptyStateText: document.querySelector("#SocialUserList")?.innerText || "",
        emptyStateCard: !!document.querySelector("#SocialUserList .StorySocialEmptyGlyph"),
        bodyAttachment: getComputedStyle(document.body).backgroundAttachment,
        bodyBackground: getComputedStyle(document.body).backgroundImage
      };
    });
    await page.screenshot({ path: "browser-artifacts/social-search-reset.png", fullPage: true });
    if (!searchState.searchInputExists || !searchState.searchFrameExists) throw new Error("Social search frame/input missing.");
    if (!searchState.searchFrameBackground || searchState.searchFrameBackground === "none") throw new Error("Social search frame has no background.");
    if (!searchState.emptyStateCard || !searchState.emptyStateText.includes("Search the player index")) throw new Error("Social reset empty-state card did not render.");

    await page.evaluate(() => window.scrollTo(0, Math.max(0, document.documentElement.scrollHeight - innerHeight)));
    await page.waitForTimeout(500);
    await page.screenshot({ path: "browser-artifacts/social-scrolled.png", fullPage: true });

    await fs.writeFile("browser-artifacts/results.json", JSON.stringify({ authBackground, searchState, consoleErrors: errors }, null, 2));
    if (errors.length) throw new Error("Browser console errors: " + errors.join(" | "));
    console.log(JSON.stringify({ authBackground, searchState, consoleErrors: errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
