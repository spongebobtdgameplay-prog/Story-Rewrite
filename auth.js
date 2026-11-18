let AccountMode = "register";
let AccountStatusTimer = 0;
let RegistrationChallengeRequired = false;
let RegistrationTurnstileWidgetId = null;
let RegistrationTurnstileToken = "";

function RenderRegistrationTurnstile() {
    const Widget = document.getElementById("TurnstileWidget");
    if (!RegistrationChallengeRequired || !Widget || !window.turnstile || RegistrationTurnstileWidgetId !== null) return;

    try {
        RegistrationTurnstileWidgetId = window.turnstile.render(Widget, {
            sitekey: "0x4AAAAAAGGFz5TIyJ7WoKVe",
            theme: "auto",
            callback: Token => {
                RegistrationTurnstileToken = String(Token || "");
            },
            "expired-callback": () => {
                RegistrationTurnstileToken = "";
                ShowStatus("Verification expired. Please complete it again.", false);
            },
            "error-callback": () => {
                RegistrationTurnstileToken = "";
                ShowStatus("Verification could not load. Please retry.", false);
            }
        });
    } catch (Error) {
        RegistrationTurnstileWidgetId = null;
        ShowStatus("Verification could not load. Please retry.", false);
    }
}

function ShowRegistrationChallenge(Reset = false) {
    RegistrationChallengeRequired = true;
    const Container = document.getElementById("TurnstileContainer");
    if (Container) Container.classList.toggle("Hidden", AccountMode !== "register");

    if (Reset && RegistrationTurnstileWidgetId !== null && window.turnstile) {
        RegistrationTurnstileToken = "";
        try { window.turnstile.reset(RegistrationTurnstileWidgetId); } catch {}
    }

    RenderRegistrationTurnstile();
}

window.StoryTurnstileReady = function() {
    RenderRegistrationTurnstile();
};
window.addEventListener("DOMContentLoaded", async () => {
    const Session = await (window.StoryCookieSessionReady || Promise.resolve({ authenticated: false }));
    if (Session?.authenticated || GetAuthToken()) {
        window.location.replace(BuildStoryUrl("index.html"));
        return;
    }

    const ServerSetup = document.getElementById("ServerSetup");
    document.getElementById("TurnstileContainer")?.classList.add("Hidden");
    if (!GetServerUrl()) ServerSetup.classList.remove("Hidden");

    document.getElementById("RegisterTab").addEventListener("click", () => SetMode("register"));
    document.getElementById("LoginTab").addEventListener("click", () => SetMode("login"));
    document.getElementById("AccountForm").addEventListener("submit", SubmitAccount);
    document.getElementById("PasswordInput").addEventListener("input", HandlePasswordInput);
    document.getElementById("SaveServerButton").addEventListener("click", SaveServerUrl);
    RenderSavedAccounts();
    if (Session?.unavailable) ShowStatus("The server could not be reached. Check your connection and try again.", false);
});

function SetMode(Mode) {
    AccountMode = Mode;
    const Register = Mode === "register";
    document.getElementById("RegisterTab").classList.toggle("Active", Register);
    document.getElementById("LoginTab").classList.toggle("Active", !Register);
    document.getElementById("ConfirmLabel").classList.toggle("Hidden", !Register);
    document.getElementById("TurnstileContainer")?.classList.toggle("Hidden", !Register || !RegistrationChallengeRequired);
    document.getElementById("AccountTitle").textContent = Register ? "Create your account" : "Welcome back";
    document.getElementById("AccountSubmit").textContent = Register ? "Create Account" : "Sign In";
    document.getElementById("PasswordInput").autocomplete = Register ? "new-password" : "current-password";
    HideStatus();
}

function RenderSavedAccounts() {
    const Section = document.getElementById("SavedAccountsSection");
    const List = document.getElementById("SavedAccountsList");
    const Hint = document.getElementById("SavedAccountsHint");
    if (!Section || !List || typeof GetSavedAccountSessions !== "function") return;

    const SwitchFromUsername = typeof GetAccountSwitchSourceUsername === "function"
        ? GetAccountSwitchSourceUsername().toLowerCase()
        : "";
    const Accounts = GetSavedAccountSessions().filter(Account => {
        if (!SwitchFromUsername) return true;
        return Account.username.toLowerCase() !== SwitchFromUsername;
    });

    Section.classList.remove("Hidden");
    List.innerHTML = "";
    if (Hint) Hint.style.display = Accounts.length > 0 ? "block" : "none";

    if (Accounts.length === 0) {
        const Empty = document.createElement("div");
        Empty.className = "SavedAccountsEmpty";

        const Text = document.createElement("div");
        Text.className = "SavedAccountsEmptyText";
        Text.textContent = "You don't have any saved accounts.";

        const AddButton = document.createElement("button");
        AddButton.className = "SecondaryButton";
        AddButton.type = "button";
        AddButton.textContent = "Add Account";
        AddButton.addEventListener("click", () => {
            SetMode("login");
            document.getElementById("AccountForm")?.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
            setTimeout(() => document.getElementById("UsernameInput")?.focus(), 120);
        });

        Empty.append(Text, AddButton);
        List.appendChild(Empty);
        return;
    }

    for (const Account of Accounts) {
        const Row = document.createElement("div");
        Row.className = "SavedAccountRow";

        const SwitchButton = document.createElement("button");
        SwitchButton.className = "SecondaryButton SavedAccountButton";
        SwitchButton.type = "button";
        SwitchButton.textContent = Account.username;
        SwitchButton.addEventListener("click", () => {
            SetMode("login");
            const UsernameInput = document.getElementById("UsernameInput");
            const PasswordInput = document.getElementById("PasswordInput");
            UsernameInput.value = Account.username;
            document.getElementById("AccountForm")?.scrollIntoView({ behavior: "smooth", block: "center" });
            setTimeout(() => PasswordInput?.focus(), 120);
            ShowStatus("Enter the password to sign in to " + Account.username + ".", true);
        });

        const ForgetButton = document.createElement("button");
        ForgetButton.className = "PasswordToggle SavedAccountForget";
        ForgetButton.type = "button";
        ForgetButton.setAttribute("aria-label", `Forget ${Account.username}`);
        ForgetButton.textContent = "×";
        ForgetButton.addEventListener("click", () => {
            ForgetSavedAccount(Account.username);
            RenderSavedAccounts();
        });

        Row.appendChild(SwitchButton);
        Row.appendChild(ForgetButton);
        List.appendChild(Row);
    }
}

function SaveServerUrl() {
    const Value = document.getElementById("ServerUrlInput").value;
    SetServerOverride(Value);
    ShowStatus(GetServerUrl() ? "Server address saved for this tab." : "Enter the server address first.", Boolean(GetServerUrl()));
}

async function SubmitAccount(Event) {
    Event.preventDefault();
    const Username = document.getElementById("UsernameInput").value.trim();
    const Password = document.getElementById("PasswordInput").value;
    const Confirm = document.getElementById("ConfirmInput").value;
    const Button = document.getElementById("AccountSubmit");

    if (AccountMode === "register" && (Password.length < 8 || Password.length > 128)) {
        ShowStatus("Password must be 8 to 128 characters.", false);
        return;
    }

    if (AccountMode === "register" && Password !== Confirm) {
        ShowStatus("The passwords do not match.", false);
        return;
    }

    if (AccountMode === "register" && RegistrationChallengeRequired) {
        const Token = window.turnstile && RegistrationTurnstileWidgetId !== null
            ? String(window.turnstile.getResponse(RegistrationTurnstileWidgetId) || RegistrationTurnstileToken || "")
            : "";
        if (!Token) {
            ShowStatus("Complete the verification check to continue.", false);
            return;
        }
        RegistrationTurnstileToken = Token;
    }

    Button.disabled = true;
    Button.textContent = AccountMode === "register" ? "Creating..." : "Signing in...";

    try {
        const IsNewRegistration = AccountMode === "register";
        if (IsNewRegistration) {
            await RegisterAccount(Username, Password, RegistrationChallengeRequired ? RegistrationTurnstileToken : "");
            // A new account should not inherit the previous account's last open page.
            try { localStorage.removeItem("StoryRewriteLastShellStateV1"); } catch {}
        } else {
            await LoginAccount(Username, Password);
        }

        const Destination = new URL(BuildStoryUrl("index.html"), window.location.href);
        if (IsNewRegistration) Destination.hash = "main.html";
        window.location.replace(Destination.href);
    } catch (Error) {
        if (AccountMode === "register" && Error?.status === 428 && Error?.data?.challengeRequired) {
            ShowRegistrationChallenge(true);
            ShowStatus("We need one quick verification before continuing.", false);
        } else {
            ShowStatus(Error.message || "The request could not be completed. Please try again.", false);
        }
    } finally {
        Button.disabled = false;
        Button.textContent = AccountMode === "register" ? "Create Account" : "Sign In";
    }
}
function ShowStatus(Text, Good) {
    const Status = document.getElementById("AccountStatus");
    if (AccountStatusTimer) clearTimeout(AccountStatusTimer);
    Status.textContent = Text;
    Status.className = `StatusText AccountStatusVisible ${Good ? "Good" : "Bad"}`;
    AccountStatusTimer = window.setTimeout(HideStatus, 4500);
}

function HideStatus() {
    const Status = document.getElementById("AccountStatus");
    if (!Status) return;
    if (AccountStatusTimer) clearTimeout(AccountStatusTimer);
    AccountStatusTimer = 0;
    Status.classList.remove("AccountStatusVisible");
    Status.classList.add("AccountStatusFading");
    window.setTimeout(() => {
        if (!Status.classList.contains("AccountStatusVisible")) {
            Status.className = "StatusText Hidden";
            Status.textContent = "";
        }
    }, 260);
}

function HandlePasswordInput() {
    if (AccountMode !== "register") return;
    const Password = document.getElementById("PasswordInput").value;
    const Status = document.getElementById("AccountStatus");
    if (
        Password.length >= 8 &&
        Password.length <= 128 &&
        /password must be/i.test(Status?.textContent || "")
    ) {
        HideStatus();
    }
}
