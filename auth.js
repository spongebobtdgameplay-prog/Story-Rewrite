let AccountMode = "register";

window.addEventListener("DOMContentLoaded", () => {
    if (GetAuthToken()) {
        window.location.replace(BuildStoryUrl("index.html"));
        return;
    }

    const ServerSetup = document.getElementById("ServerSetup");
    if (!GetServerUrl()) ServerSetup.classList.remove("Hidden");

    document.getElementById("RegisterTab").addEventListener("click", () => SetMode("register"));
    document.getElementById("LoginTab").addEventListener("click", () => SetMode("login"));
    document.getElementById("AccountForm").addEventListener("submit", SubmitAccount);
    document.getElementById("SaveServerButton").addEventListener("click", SaveServerUrl);
});

function SetMode(Mode) {
    AccountMode = Mode;
    const Register = Mode === "register";
    document.getElementById("RegisterTab").classList.toggle("Active", Register);
    document.getElementById("LoginTab").classList.toggle("Active", !Register);
    document.getElementById("ConfirmLabel").classList.toggle("Hidden", !Register);
    document.getElementById("AccountTitle").textContent = Register ? "Create your account" : "Welcome back";
    document.getElementById("AccountSubmit").textContent = Register ? "Create Account" : "Sign In";
    document.getElementById("PasswordInput").autocomplete = Register ? "new-password" : "current-password";
    HideStatus();
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

    if (AccountMode === "register" && Password !== Confirm) {
        ShowStatus("The passwords do not match.", false);
        return;
    }

    Button.disabled = true;
    Button.textContent = AccountMode === "register" ? "Creating..." : "Signing in...";

    try {
        if (AccountMode === "register") await RegisterAccount(Username, Password);
        else await LoginAccount(Username, Password);
        window.location.replace(BuildStoryUrl("index.html"));
    } catch (Error) {
        ShowStatus(Error.message, false);
    } finally {
        Button.disabled = false;
        Button.textContent = AccountMode === "register" ? "Create Account" : "Sign In";
    }
}

function ShowStatus(Text, Good) {
    const Status = document.getElementById("AccountStatus");
    Status.className = `StatusText ${Good ? "Good" : "Bad"}`;
    Status.textContent = Text;
}

function HideStatus() {
    document.getElementById("AccountStatus").className = "StatusText Hidden";
}
