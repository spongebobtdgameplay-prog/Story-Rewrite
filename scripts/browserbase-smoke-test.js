const BrowserbaseModule = require("@browserbasehq/sdk");
const Browserbase = BrowserbaseModule.default || BrowserbaseModule;
const { chromium } = require("playwright-core");

function SafeErrorMessage(ErrorValue, ApiKey) {
    return String(ErrorValue?.message || ErrorValue || "Unknown error")
        .replaceAll(ApiKey, "[redacted]")
        .replace(/(connectUrl|authorization|x-bb-api-key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
        .slice(0, 500);
}

async function VisitAndSummarize(Page, Name, Url) {
    try {
        const Response = await Page.goto(Url, {
            waitUntil: "domcontentloaded",
            timeout: 45000
        });

        await Page.locator("body").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
        const Summary = {
            name: Name,
            requestedUrl: Url,
            finalUrl: Page.url(),
            status: Response?.status() ?? null,
            title: await Page.title().catch(() => ""),
            bodyText: (await Page.locator("body").innerText({ timeout: 5000 }).catch(() => ""))
                .replace(/\s+/g, " ")
                .slice(0, 240)
        };

        if (Name === "auth") {
            Summary.inputTypes = await Page.locator("input").evaluateAll(
                Inputs => Inputs.map(Input => Input.getAttribute("type") || "text")
            ).catch(() => []);
            Summary.formCount = await Page.locator("form").count().catch(() => 0);
            Summary.turnstileFrameCount = Page.frames().filter(Frame =>
                /challenges\.cloudflare\.com\/turnstile/i.test(Frame.url())
            ).length;
        }

        if (Name === "social") {
            Summary.searchInputPresent = await Page.locator("#SocialSearchInput").count().then(Count => Count > 0).catch(() => false);
            Summary.searchFramePresent = await Page.locator(".StorySocialSearchBox").count().then(Count => Count > 0).catch(() => false);
        }

        const Screenshot = await Page.screenshot({ fullPage: true, timeout: 15000 });
        Summary.screenshotBytes = Screenshot.length;
        return Summary;
    } catch (Error) {
        return {
            name: Name,
            requestedUrl: Url,
            error: SafeErrorMessage(Error, "")
        };
    }
}

async function runBrowserbaseSmokeTest() {
    if (String(process.env.BROWSERBASE_TEST_ON_START || "") !== "1") {
        return { skipped: true };
    }

    const ApiKey = String(process.env.BROWSERBASE_API_KEY || "").trim();
    if (!ApiKey) {
        console.error("BROWSERBASE_SMOKE_FAILED: BROWSERBASE_API_KEY is not configured.");
        return { ok: false, reason: "missing_api_key" };
    }

    let Browser = null;
    let SessionId = "";

    try {
        const BrowserbaseClient = new Browserbase({ apiKey: ApiKey });
        console.log("BROWSERBASE_SMOKE: creating a remote Chromium session.");

        const Session = await BrowserbaseClient.sessions.create({ timeout: 120 });
        if (!Session?.id || !Session?.connectUrl) {
            throw new Error("Browserbase did not return a session ID and CDP connection URL.");
        }
        SessionId = Session.id;

        Browser = await chromium.connectOverCDP(Session.connectUrl, { timeout: 30000 });
        const Context = Browser.contexts()[0] || await Browser.newContext();
        const Page = Context.pages()[0] || await Context.newPage();

        const Example = await VisitAndSummarize(Page, "connectivity", "https://example.com/");
        if (Example.status !== 200 || Example.title !== "Example Domain") {
            throw new Error("Remote Chromium connected, but the example.com connectivity check did not return the expected page.");
        }

        const AuthPage = await Context.newPage();
        const Auth = await VisitAndSummarize(
            AuthPage,
            "auth",
            "https://www.storyrewritegame.com/auth.html"
        );

        const SocialPage = await Context.newPage();
        const Social = await VisitAndSummarize(
            SocialPage,
            "social",
            "https://www.storyrewritegame.com/social.html"
        );

        await Browser.close();
        Browser = null;

        const Result = {
            ok: true,
            sessionId: SessionId,
            connectivity: Example,
            storyRewriteAuth: Auth,
            storyRewriteSocial: Social,
            replayUrl: "https://browserbase.com/sessions/" + SessionId
        };
        console.log("BROWSERBASE_SMOKE_OK " + JSON.stringify(Result));
        return Result;
    } catch (Error) {
        const Message = SafeErrorMessage(Error, ApiKey);
        console.error(
            "BROWSERBASE_SMOKE_FAILED " +
            JSON.stringify({ sessionId: SessionId || null, error: Message })
        );
        return { ok: false, sessionId: SessionId || null, error: Message };
    } finally {
        if (Browser) {
            await Browser.close().catch(() => {});
        }
    }
}

module.exports = { runBrowserbaseSmokeTest };
