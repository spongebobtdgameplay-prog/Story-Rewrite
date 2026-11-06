const crypto = require("crypto");

function createYouTubeRuntime({ Database, ReadJson }) {
    let SchemaReady = null;
    const RedirectUri = () => String(process.env.GOOGLE_REDIRECT_URI || "").trim();
    const ClientId = () => String(process.env.GOOGLE_CLIENT_ID || "").trim();
    const ClientSecret = () => String(process.env.GOOGLE_CLIENT_SECRET || "").trim();

    async function ensureSchema() {
        if (!SchemaReady) SchemaReady = (async () => {
            await Database.query(`
                CREATE TABLE IF NOT EXISTS story_youtube_connections (
                    username_key TEXT PRIMARY KEY REFERENCES accounts(username_key) ON DELETE CASCADE,
                    channel_id TEXT NOT NULL,
                    channel_title TEXT NOT NULL,
                    refresh_token_ciphertext TEXT,
                    refresh_token_iv TEXT,
                    refresh_token_tag TEXT,
                    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            `);
            await Database.query(`
                CREATE TABLE IF NOT EXISTS story_youtube_oauth_states (
                    state_hash TEXT PRIMARY KEY,
                    username_key TEXT NOT NULL REFERENCES accounts(username_key) ON DELETE CASCADE,
                    expires_at TIMESTAMPTZ NOT NULL
                )
            `);
            await Database.query("CREATE INDEX IF NOT EXISTS story_youtube_oauth_states_expiry_idx ON story_youtube_oauth_states(expires_at)");
        })().catch(Error => { SchemaReady = null; throw Error; });
        return SchemaReady;
    }

    function encryptionKey() {
        const Value = String(process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY || "").trim();
        if (!/^[a-f0-9]{64}$/i.test(Value)) throw new Error("YouTube token encryption is not configured.");
        return Buffer.from(Value, "hex");
    }

    function encryptToken(Value) {
        const Iv = crypto.randomBytes(12);
        const Cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), Iv);
        const Ciphertext = Buffer.concat([Cipher.update(Value, "utf8"), Cipher.final()]);
        return { ciphertext: Ciphertext.toString("base64"), iv: Iv.toString("base64"), tag: Cipher.getAuthTag().toString("base64") };
    }

    async function handle(Request, Response, RequestPath, Account) {
        await ensureSchema();

        if (RequestPath === "/api/youtube/callback" && Request.method === "GET") {
            const Url = new URL(Request.url, "https://storyrewritegame.com");
            const State = Url.searchParams.get("state") || "";
            const Code = Url.searchParams.get("code") || "";
            const ProviderError = Url.searchParams.get("error");
            const fail = Message => {
                Response.writeHead(302, { Location: "https://storyrewritegame.com/settings.html?youtube=error&reason=" + encodeURIComponent(Message), "Cache-Control": "no-store" });
                Response.end();
            };
            if (ProviderError) return fail("Google authorization was cancelled.");
            if (!State || !Code || State.length > 300) return fail("The Google authorization response was invalid.");
            const StateHash = crypto.createHash("sha256").update(State).digest("hex");
            const Pending = await Database.query(
                "DELETE FROM story_youtube_oauth_states WHERE state_hash = $1 AND expires_at > NOW() RETURNING username_key",
                [StateHash]
            );
            if (!Pending.rowCount) return fail("The connection request expired. Please try again.");
            if (!ClientId() || !ClientSecret() || !RedirectUri()) return fail("YouTube connection is not configured on the server.");
            const TokenResponse = await fetch("https://oauth2.googleapis.com/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    code: Code, client_id: ClientId(), client_secret: ClientSecret(),
                    redirect_uri: RedirectUri(), grant_type: "authorization_code"
                })
            });
            const Tokens = await TokenResponse.json().catch(() => ({}));
            if (!TokenResponse.ok || !Tokens.access_token) return fail("Google could not complete the connection.");
            const ChannelResponse = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", {
                headers: { Authorization: "Bearer " + Tokens.access_token }
            });
            const ChannelData = await ChannelResponse.json().catch(() => ({}));
            const Channel = ChannelData.items?.[0];
            if (!Channel?.id) return fail("No YouTube channel was returned for this Google account.");
            let Encrypted = null;
            if (Tokens.refresh_token) Encrypted = encryptToken(Tokens.refresh_token);
            const UsernameKey = Pending.rows[0].username_key;
            await Database.query(
                `INSERT INTO story_youtube_connections
                    (username_key, channel_id, channel_title, refresh_token_ciphertext, refresh_token_iv, refresh_token_tag)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (username_key) DO UPDATE SET
                    channel_id = EXCLUDED.channel_id,
                    channel_title = EXCLUDED.channel_title,
                    refresh_token_ciphertext = COALESCE(EXCLUDED.refresh_token_ciphertext, story_youtube_connections.refresh_token_ciphertext),
                    refresh_token_iv = COALESCE(EXCLUDED.refresh_token_iv, story_youtube_connections.refresh_token_iv),
                    refresh_token_tag = COALESCE(EXCLUDED.refresh_token_tag, story_youtube_connections.refresh_token_tag),
                    updated_at = NOW()`,
                [UsernameKey, Channel.id, String(Channel.snippet?.title || "YouTube channel").slice(0, 200),
                    Encrypted?.ciphertext || null, Encrypted?.iv || null, Encrypted?.tag || null]
            );
            Response.writeHead(302, { Location: "https://storyrewritegame.com/settings.html?youtube=connected", "Cache-Control": "no-store" });
            Response.end();
            return true;
        }

        if (RequestPath === "/api/youtube/connect" && Request.method === "POST") {
            if (!ClientId() || !ClientSecret() || !RedirectUri()) {
                Response.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
                Response.end(JSON.stringify({ error: "YouTube connection is not configured on the server." }));
                return true;
            }
            const State = crypto.randomBytes(32).toString("base64url");
            const StateHash = crypto.createHash("sha256").update(State).digest("hex");
            await Database.query("DELETE FROM story_youtube_oauth_states WHERE expires_at <= NOW()");
            await Database.query(
                "INSERT INTO story_youtube_oauth_states (state_hash, username_key, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')",
                [StateHash, Account.usernameKey || Account.username.toLowerCase()]
            );
            const Params = new URLSearchParams({
                client_id: ClientId(), redirect_uri: RedirectUri(), response_type: "code",
                scope: "openid email profile https://www.googleapis.com/auth/youtube.readonly",
                access_type: "offline", prompt: "consent", include_granted_scopes: "true", state: State
            });
            Response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            Response.end(JSON.stringify({ url: "https://accounts.google.com/o/oauth2/v2/auth?" + Params.toString() }));
            return true;
        }

        if (RequestPath === "/api/youtube/status" && Request.method === "GET") {
            const Result = await Database.query(
                "SELECT channel_id, channel_title, connected_at FROM story_youtube_connections WHERE username_key = $1 LIMIT 1",
                [Account.usernameKey || Account.username.toLowerCase()]
            );
            const Row = Result.rows[0];
            Response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            Response.end(JSON.stringify({ connected: Boolean(Row), channel: Row ? { id: Row.channel_id, title: Row.channel_title, connectedAt: Row.connected_at } : null }));
            return true;
        }

        if (RequestPath === "/api/youtube/disconnect" && Request.method === "POST") {
            await Database.query("DELETE FROM story_youtube_connections WHERE username_key = $1", [Account.usernameKey || Account.username.toLowerCase()]);
            Response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
            Response.end(JSON.stringify({ ok: true }));
            return true;
        }
        return false;
    }

    return { handle };
}

module.exports = { createYouTubeRuntime };
