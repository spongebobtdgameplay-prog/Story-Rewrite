const BrowserbaseModule = require("@browserbasehq/sdk");
const Browserbase = BrowserbaseModule.default || BrowserbaseModule;
const { chromium } = require("playwright-core");
const crypto = require("crypto");

function SafeErrorMessage(ErrorValue, ApiKey) {
    const RawMessage = String(ErrorValue?.message || ErrorValue || "Unknown error");
    const RedactedMessage = ApiKey ? RawMessage.replaceAll(ApiKey, "[redacted]") : RawMessage;
    return RedactedMessage
        .replace(/(connectUrl|authorization|x-bb-api-key)\s*[:=]\s*\S+/gi, "$1=[redacted]")
        .slice(0, 500);
}



async function InspectDocumentGradient(Page) {
    return Page.evaluate(() => {
        const Root = document.documentElement;
        const Html = getComputedStyle(Root);
        const Body = getComputedStyle(document.body);
        const PseudoCanvas = getComputedStyle(Root, "::before");
        const Module = window.GlobalModule;
        const Theme = String(Root.dataset.storyGradient || "");
        const RootCanvasOk = Html.backgroundAttachment === "scroll"
            && (Theme === "account-settings"
                ? Html.backgroundImage === "none" && Html.backgroundColor === "rgb(141, 104, 73)"
                : Html.backgroundImage.includes("gradient"));
        const NoCompetingGradient = !Body.backgroundImage.includes("gradient")
            && PseudoCanvas.display === "none";
        return {
            moduleLoaded: Boolean(Module && Module.version === "1.0.0"),
            theme: Theme,
            htmlBackgroundImage: Html.backgroundImage,
            htmlBackgroundColor: Html.backgroundColor,
            htmlAttachment: Html.backgroundAttachment,
            pseudoCanvasDisplay: PseudoCanvas.display,
            bodyBackgroundImage: Body.backgroundImage,
            rootCanvasOk: RootCanvasOk,
            noCompetingGradient: NoCompetingGradient,
            ok: Boolean(Module && Theme && Module.gradients.getTheme() === Theme
                && RootCanvasOk && NoCompetingGradient)
        };
    });
}

async function VerifyShellGradientRoutes(Page, BaseUrl) {
    const ShellRoutes = ["main.html", "levels.html", "multiplayer.html", "social.html", "settings.html",
        "account.html", "tutorial.html", "terms.html", "about.html", "privacy.html",
        "think.html", "hackers.html", "dialog.html", "rules.html"];
    const ShellMobileRoutes = ["main.html", "levels.html", "multiplayer.html", "social.html",
        "settings.html", "think.html", "about.html"];
    const Results = [];
    const WaitForRoute = Route => Page.waitForFunction(Expected => {
        return [...document.querySelectorAll("#StoryShellRoot iframe.StoryShellFrame")].some(Frame =>
            Frame.dataset.storyRoute === Expected
            && Frame.dataset.storyLoaded === "1"
            && getComputedStyle(Frame).visibility === "visible"
        );
    }, Route, { timeout: 20000 });

    async function InspectFrame(Route, Viewport) {
        const Frame = Page.frames().find(Child => {
            if (Child.parentFrame() !== Page.mainFrame()) return false;
            try { return new URL(Child.url()).pathname.split("/").pop() === Route; }
            catch { return false; }
        });
        if (!Frame) throw new Error("Missing iframe document for " + Route);
        const State = await Frame.evaluate(() => {
            const Root = document.documentElement;
            const Html = getComputedStyle(Root);
            const Body = getComputedStyle(document.body);
            const PseudoCanvas = getComputedStyle(Root, "::before");
            const Module = window.GlobalModule;
            const Theme = String(Root.dataset.storyGradient || "");
            const Route = location.pathname.split("/").pop();
            const ExpectedTheme = Route === "social.html" ? "social"
                : Route === "settings.html" || Route === "account.html" ? "account-settings"
                : Route === "levels.html" ? "levels"
                : Route === "multiplayer.html" ? "multiplayer"
                : Route === "think.html" || Route === "hackers.html" ? "think"
                : "parchment";
            const RootCanvasOk = Html.backgroundAttachment === "scroll"
                && (ExpectedTheme === "account-settings"
                    ? Html.backgroundImage === "none" && Html.backgroundColor === "rgb(141, 104, 73)"
                    : Html.backgroundImage.includes("gradient"));
            const NoCompetingGradient = !Body.backgroundImage.includes("gradient")
                && PseudoCanvas.display === "none";
            return {
                moduleLoaded: Boolean(Module && Module.version === "1.0.0"),
                theme: Theme,
                expectedTheme: ExpectedTheme,
                htmlBackgroundImage: Html.backgroundImage,
                htmlBackgroundColor: Html.backgroundColor,
                htmlAttachment: Html.backgroundAttachment,
                pseudoCanvasDisplay: PseudoCanvas.display,
                bodyBackgroundImage: Body.backgroundImage,
                rootCanvasOk: RootCanvasOk,
                noCompetingGradient: NoCompetingGradient,
                ok: Boolean(Module && Theme === ExpectedTheme
                    && Module.gradients.getTheme() === Theme
                    && RootCanvasOk && NoCompetingGradient)
            };
        });

        const Shot = await Page.screenshot({
            fullPage: false,
            type: "jpeg",
            quality: 38,
            timeout: 15000
        });
        // Emit real screenshots for the routes the user explicitly needs checked.
        if (["main.html", "levels.html", "multiplayer.html", "social.html", "settings.html",
            "account.html", "tutorial.html", "think.html"].includes(Route)) {
            console.log("BROWSERBASE_VISUAL_SCREENSHOT " + JSON.stringify({
                route: Route,
                viewport: Viewport,
                mime: "image/jpeg",
                data: Buffer.from(Shot).toString("base64")
            }));
        }
        return {
            route: Route,
            viewport: Viewport,
            ...State,
            screenshotBytes: Shot.length
        };
    }

    await Page.setViewportSize({ width: 1365, height: 900 });
    await Page.goto(BaseUrl + "/index.html#main.html", {
        waitUntil: "domcontentloaded",
        timeout: 45000
    });
    await WaitForRoute("main.html");
    const ShellCanvas = await InspectDocumentGradient(Page);

    for (const Route of ShellRoutes) {
        try {
            const Navigation = await Page.evaluate(Expected => {
                const Current = window.StoryShell?.GetCurrentRoute?.() || "";
                if (Current === Expected) return true;
                return Boolean(window.StoryShell?.Navigate?.(Expected));
            }, Route);
            if (!Navigation) throw new Error("Shell navigation rejected " + Route);
            await WaitForRoute(Route);
            Results.push(await InspectFrame(Route, "desktop"));
        } catch (Error) {
            Results.push({
                route: Route,
                viewport: "desktop",
                ok: false,
                error: SafeErrorMessage(Error, "")
            });
        }
    }

    await Page.setViewportSize({ width: 390, height: 844 });
    for (const Route of ShellMobileRoutes) {
        try {
            // Recreate each route after the viewport is mobile-sized, then check the loaded iframe.
            await Page.goto(BaseUrl + "/index.html#" + Route, {
                waitUntil: "domcontentloaded",
                timeout: 30000
            });
            await WaitForRoute(Route);
            Results.push(await InspectFrame(Route, "mobile"));
        } catch (Error) {
            Results.push({
                route: Route,
                viewport: "mobile",
                ok: false,
                error: SafeErrorMessage(Error, "")
            });
        }
    }

    return {
        ok: ShellCanvas.ok === true
            && Results.length === ShellRoutes.length + ShellMobileRoutes.length
            && Results.every(Result => Result.ok === true),
        shellCanvas: ShellCanvas,
        shellRoutes: Results
    };
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

        if (Name === "auth") Summary.gradientCanvas = await InspectDocumentGradient(Page);

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

async function RunAccountFlow(Context, BaseUrl) {
    const Username = "srqa" + Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
    const Password = crypto.randomBytes(24).toString("base64url").slice(0, 32);
    const Page = await Context.newPage();
    const SetCookieMetadata = [];
    Page.on("response", async Response => {
        if (!/\/api\/(register|login)(?:[?#]|$)/i.test(Response.url())) return;
        const Header = await Response.headerValue("set-cookie").catch(() => "");
        if (!Header) return;
        for (const Entry of String(Header).split(/,(?=\s*[^;,=]+=)/)) {
            const Parts = Entry.split(";");
            const CookieName = String(Parts.shift() || "").split("=")[0].trim();
            const Attributes = Parts.map(Part => Part.trim().toLowerCase());
            const SameSite = Attributes.find(Part => Part.startsWith("samesite=")) || "";
            SetCookieMetadata.push({
                name: CookieName,
                httpOnly: Attributes.includes("httponly"),
                secure: Attributes.includes("secure"),
                sameSite: SameSite.split("=")[1] || "",
                path: (Attributes.find(Part => Part.startsWith("path=")) || "").split("=")[1] || "",
                domain: (Attributes.find(Part => Part.startsWith("domain=")) || "").split("=")[1] || ""
            });
        }
    });
    let AccountCreated = false;
    let AccountDeleted = false;
    const Summary = {
        registration: "not_run",
        cookie: "not_checked",
        sessionRead: "not_checked",
        logout: "not_run",
        signedOutCheck: "not_run",
        login: "not_run",
        loginSessionRead: "not_run",
        cleanup: "not_run"
    };

    async function ReadMe() {
        return Page.evaluate(async () => {
            const Response = await fetch("/api/me", {
                method: "GET",
                credentials: "include",
                cache: "no-store"
            });
            let Data = {};
            try { Data = await Response.json(); } catch {}
            return {
                status: Response.status,
                username: String(Data?.profile?.username || ""),
                ok: Response.ok
            };
        });
    }

    async function SubmitAccount(Mode) {
        if (Mode === "login") {
            await Page.locator("#LoginTab").click();
        }
        await Page.locator("#UsernameInput").fill(Username);
        await Page.locator("#PasswordInput").fill(Password);
        if (Mode === "register") await Page.locator("#ConfirmInput").fill(Password);
        await Page.locator("#AccountSubmit").click();
        try {
            await Page.waitForURL(Url => Url.pathname.endsWith("/index.html"), { timeout: 45000 });
            return { navigated: true, message: "" };
        } catch {
            const Message = await Page.locator("#AccountStatus").innerText().catch(() => "");
            const ChallengeVisible = await Page.locator("#TurnstileContainer").isVisible().catch(() => false);
            return { navigated: false, message: Message.slice(0, 240), challengeVisible: ChallengeVisible };
        }
    }

    try {
        await Page.goto(BaseUrl + "/auth.html", { waitUntil: "domcontentloaded", timeout: 45000 });
        await Page.locator("#AccountForm").waitFor({ state: "visible", timeout: 20000 });

        const Registration = await SubmitAccount("register");
        AccountCreated = true; // Cleanup also attempts a login in case registration succeeded but its first session check failed.
        if (!Registration.navigated) {
            Summary.registration = Registration.challengeVisible
                ? "blocked_by_turnstile"
                : "failed: " + (Registration.message || "form did not complete");
            Summary.manualActionRequired = Boolean(Registration.challengeVisible);
            Summary.ok = false;
            return Summary;
        }
        Summary.registration = "passed";

        const CookieJar = await Context.cookies();
        const JarMetadata = CookieJar.map(Entry => ({
            name: Entry.name,
            domain: Entry.domain,
            path: Entry.path,
            httpOnly: Entry.httpOnly === true,
            secure: Entry.secure === true,
            sameSite: Entry.sameSite || "unspecified"
        }));
        const SecureSessionCookie = [...SetCookieMetadata, ...JarMetadata].some(Entry =>
            Entry.httpOnly === true && Entry.secure === true && String(Entry.name || "").length > 0
        );
        Summary.finalPageUrl = Page.url();
        Summary.cookie = {
            setCookie: SetCookieMetadata,
            browserJar: JarMetadata,
            secureHttpOnlyCookieObserved: SecureSessionCookie
        };

        const RegisteredSession = await ReadMe();
        Summary.sessionRead = RegisteredSession.status === 200
            && RegisteredSession.username.toLowerCase() === Username.toLowerCase()
            ? "passed"
            : "failed_http_" + RegisteredSession.status;

        const Logout = await Page.evaluate(async () => {
            const Response = await fetch("/api/session", {
                method: "DELETE",
                credentials: "include",
                cache: "no-store"
            });
            return { status: Response.status };
        });
        Summary.logout = Logout.status === 200 ? "passed" : "failed_http_" + Logout.status;

        const SignedOut = await ReadMe();
        Summary.signedOutCheck = SignedOut.status === 401 ? "passed" : "failed_http_" + SignedOut.status;

        await Page.goto(BaseUrl + "/auth.html", { waitUntil: "domcontentloaded", timeout: 45000 });
        await Page.locator("#AccountForm").waitFor({ state: "visible", timeout: 20000 });
        const Login = await SubmitAccount("login");
        if (!Login.navigated) {
            Summary.login = Login.challengeVisible
                ? "blocked_by_turnstile"
                : "failed: " + (Login.message || "form did not complete");
            return Summary;
        }
        Summary.login = "passed";

        const LoggedInSession = await ReadMe();
        Summary.loginSessionRead = LoggedInSession.status === 200
            && LoggedInSession.username.toLowerCase() === Username.toLowerCase()
            ? "passed"
            : "failed_http_" + LoggedInSession.status;

        Summary.gradientRoutes = await VerifyShellGradientRoutes(Page, BaseUrl);
        Summary.gradientRoutesPassed = Summary.gradientRoutes.ok === true;

        const DeleteAccount = await Page.evaluate(async () => {
            const Response = await fetch("/api/account", {
                method: "DELETE",
                credentials: "include",
                cache: "no-store"
            });
            return { status: Response.status };
        });
        Summary.cleanup = DeleteAccount.status === 200 ? "passed" : "failed_http_" + DeleteAccount.status;
        AccountDeleted = DeleteAccount.status === 200;
        if (AccountDeleted) {
            const AfterDelete = await ReadMe();
            Summary.deletedAccountSignedOut = AfterDelete.status === 401 ? "passed" : "failed_http_" + AfterDelete.status;
        }
        Summary.ok = Summary.registration === "passed"
            && Summary.cookie?.secureHttpOnlyCookieObserved === true
            && Summary.sessionRead === "passed"
            && Summary.logout === "passed"
            && Summary.signedOutCheck === "passed"
            && Summary.login === "passed"
            && Summary.loginSessionRead === "passed"
            && Summary.gradientRoutesPassed === true
            && Summary.cleanup === "passed"
            && Summary.deletedAccountSignedOut === "passed";
        return Summary;
    } catch (Error) {
        Summary.error = SafeErrorMessage(Error, Password);
        Summary.ok = false;
        return Summary;
    } finally {
        if (AccountCreated && !AccountDeleted) {
            try {
                let Current = await ReadMe();
                if (Current.status !== 200 || Current.username.toLowerCase() !== Username.toLowerCase()) {
                    await Page.evaluate(async Credentials => {
                        await fetch("/api/login", {
                            method: "POST",
                            credentials: "include",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(Credentials)
                        }).catch(() => null);
                    }, { username: Username, password: Password });
                    Current = await ReadMe();
                }
                if (Current.status === 200 && Current.username.toLowerCase() === Username.toLowerCase()) {
                    const Cleanup = await Page.evaluate(async () => {
                        const Response = await fetch("/api/account", {
                            method: "DELETE",
                            credentials: "include",
                            cache: "no-store"
                        });
                        return Response.status;
                    });
                    Summary.cleanup = Cleanup === 200 ? "passed_best_effort" : "failed_http_" + Cleanup;
                }
            } catch {}
        }
        await Page.close().catch(() => {});
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
        const BrowserbaseClient = new Browserbase({
            apiKey: ApiKey,
            baseURL: "https://api.browserbase.com",
            timeout: 20000,
            maxRetries: 0
        });
        console.log("BROWSERBASE_SMOKE: creating a remote Chromium session.");

        const Session = await BrowserbaseClient.sessions.create({ api_timeout: 120 });
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

        const BaseUrl = String(process.env.BROWSERBASE_TEST_BASE_URL || "https://story-rewrite-iota.vercel.app").trim().replace(/\/+$/, "");
        let AccountFlow = null;
        let GradientRoutes = null;
        if (String(process.env.BROWSERBASE_TEST_ACCOUNT_FLOW || "") === "1") {
            console.log("BROWSERBASE_ACCOUNT_FLOW: starting disposable account registration/login verification.");
            AccountFlow = await RunAccountFlow(Context, BaseUrl);
            GradientRoutes = AccountFlow.gradientRoutes || null;
            console.log("BROWSERBASE_ACCOUNT_FLOW_RESULT " + JSON.stringify(AccountFlow));
        } else {
            console.log("BROWSERBASE_GRADIENT: running public-screen route sweep without account creation.");
            GradientRoutes = await VerifyShellGradientRoutes(Page, BaseUrl);
            console.log("BROWSERBASE_GRADIENT_RESULT " + JSON.stringify(GradientRoutes));
        }

        await Browser.close();
        Browser = null;

        const AccountFlowPassed = !AccountFlow || AccountFlow.ok === true;
        const Result = {
            ok: Example.status === 200
                && Auth.gradientCanvas?.ok === true
                && GradientRoutes?.ok === true
                && AccountFlowPassed,
            sessionId: SessionId,
            connectivity: Example,
            storyRewriteAuth: Auth,
            storyRewriteSocial: Social,
            gradientRoutes: GradientRoutes,
            accountFlow: AccountFlow,
            replayUrl: "https://browserbase.com/sessions/" + SessionId
        };
        console.log("BROWSERBASE_SMOKE_OK " + JSON.stringify(Result));
        return Result;
    } catch (Error) {
        const Message = SafeErrorMessage(Error, ApiKey);
        const Details = {
            sessionId: SessionId || null,
            error: Message,
            errorName: String(Error?.name || "Error").slice(0, 100),
            errorCode: Error?.code ? String(Error.code).slice(0, 100) : null,
            causeName: Error?.cause?.name ? String(Error.cause.name).slice(0, 100) : null,
            causeCode: Error?.cause?.code ? String(Error.cause.code).slice(0, 100) : null,
            causeMessage: Error?.cause ? SafeErrorMessage(Error.cause, ApiKey) : null
        };
        console.error("BROWSERBASE_SMOKE_FAILED " + JSON.stringify(Details));
        return { ok: false, ...Details };
    } finally {
        if (Browser) {
            await Browser.close().catch(() => {});
        }
    }
}

module.exports = { runBrowserbaseSmokeTest };
