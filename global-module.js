(() => {
    "use strict";
    const Root = document.documentElement;
    const Registry = new Map();
    const SurfaceRegistry = new Map();
    const SurfaceCache = new Map();
    const ObservedSurfaces = new WeakSet();
    let SurfaceResizeObserver = null;
    let SceneVignetteApplied = false;

    function RegisterSurface(Name, Definition) {
        const Key = String(Name || "").trim().toLowerCase();
        if (!/^[a-z][a-z0-9-]{0,47}$/.test(Key) || !Definition || typeof Definition !== "object") return false;
        const HasLegacyBase = Boolean(Definition.top && Definition.bottom);
        const HasLayers = Array.isArray(Definition.layers) && Definition.layers.length > 0;
        if (!HasLegacyBase && !HasLayers) return false;
        const Layers = HasLayers ? Definition.layers.map(Layer => Object.freeze({
            type: Layer.type === "radial" ? "radial" : "linear",
            angle: Number.isFinite(Number(Layer.angle)) ? Number(Layer.angle) : 180,
            x: Math.max(0, Math.min(1, Number(Layer.x ?? 0.5))),
            y: Math.max(0, Math.min(1, Number(Layer.y ?? 0.5))),
            radiusScale: Math.max(0.01, Math.min(2, Number(Layer.radiusScale ?? 1))),
            stops: (Array.isArray(Layer.stops) ? Layer.stops : []).map(Stop => ({
                at: Math.max(0, Math.min(1, Number(Stop.at))),
                color: String(Stop.color || "transparent")
            }))
        })) : [];
        SurfaceRegistry.set(Key, Object.freeze({
            top: String(Definition.top || ""),
            bottom: String(Definition.bottom || ""),
            overlayTop: String(Definition.overlayTop || ""),
            overlayBottom: String(Definition.overlayBottom || ""),
            highlight: String(Definition.highlight || "rgba(0,0,0,0)"),
            highlightX: Math.max(0, Math.min(1, Number(Definition.highlightX ?? 0.5))),
            highlightY: Math.max(0, Math.min(1, Number(Definition.highlightY ?? 0.5))),
            highlightRadius: Math.max(0.01, Math.min(1, Number(Definition.highlightRadius ?? 0.24))),
            backgroundColor: String(Definition.backgroundColor || Definition.bottom || ""),
            alpha: Definition.alpha === true,
            layers: Layers
        }));
        return true;
    }

    function AddStops(Gradient, Stops) {
        for (const Stop of Stops) {
            Gradient.addColorStop(Stop.at, Stop.color);
        }
    }

    function DrawLinear(Context, Width, Height, Angle, Stops) {
        if (!Stops || Stops.length < 2) return;
        const Radians = Angle * Math.PI / 180;
        const DirectionX = Math.sin(Radians);
        const DirectionY = -Math.cos(Radians);
        const HalfLength = (Math.abs(Width * DirectionX) + Math.abs(Height * DirectionY)) / 2;
        const CenterX = Width / 2;
        const CenterY = Height / 2;
        const Gradient = Context.createLinearGradient(
            CenterX - DirectionX * HalfLength,
            CenterY - DirectionY * HalfLength,
            CenterX + DirectionX * HalfLength,
            CenterY + DirectionY * HalfLength
        );
        AddStops(Gradient, Stops);
        Context.fillStyle = Gradient;
        Context.fillRect(0, 0, Width, Height);
    }

    function DrawRadial(Context, Width, Height, Layer) {
        if (!Layer.stops || Layer.stops.length < 2) return;
        const X = Width * Layer.x;
        const Y = Height * Layer.y;
        const FarthestCorner = Math.max(
            Math.hypot(X, Y),
            Math.hypot(Width - X, Y),
            Math.hypot(X, Height - Y),
            Math.hypot(Width - X, Height - Y)
        );
        const Radius = Math.max(1, FarthestCorner * Layer.radiusScale);
        const Gradient = Context.createRadialGradient(X, Y, 0, X, Y, Radius);
        AddStops(Gradient, Layer.stops);
        Context.fillStyle = Gradient;
        Context.fillRect(0, 0, Width, Height);
    }

    function RenderSurface(Definition, Width, Height) {
        const Canvas = document.createElement("canvas");
        Canvas.width = Width;
        Canvas.height = Height;
        const Context = Canvas.getContext("2d", { alpha: Definition.alpha });
        if (!Context) return "";

        if (Definition.top && Definition.bottom) {
            DrawLinear(Context, Width, Height, 180, [
                { at: 0, color: Definition.top },
                { at: 1, color: Definition.bottom }
            ]);

            if (Definition.overlayTop && Definition.overlayBottom) {
                DrawLinear(Context, Width, Height, 180, [
                    { at: 0, color: Definition.overlayTop },
                    { at: 1, color: Definition.overlayBottom }
                ]);
            }

            if (Definition.highlight !== "rgba(0,0,0,0)") {
                DrawRadial(Context, Width, Height, {
                    x: Definition.highlightX,
                    y: Definition.highlightY,
                    radiusScale: Definition.highlightRadius,
                    stops: [
                        { at: 0, color: Definition.highlight },
                        { at: 1, color: "rgba(0,0,0,0)" }
                    ]
                });
            }
        } else {
            for (const Layer of Definition.layers) {
                if (Layer.type === "radial") {
                    DrawRadial(Context, Width, Height, Layer);
                } else {
                    DrawLinear(Context, Width, Height, Layer.angle, Layer.stops);
                }
            }
        }

        return Canvas.toDataURL("image/png");
    }

    function GetSurfaceImage(Name, Width, Height) {
        const Definition = SurfaceRegistry.get(Name);
        if (!Definition) return "";
        const CacheKey = Name + ":" + Width + "x" + Height;
        let Image = SurfaceCache.get(CacheKey);
        if (!Image) {
            Image = RenderSurface(Definition, Width, Height);
            if (!Image) return "";
            SurfaceCache.set(CacheKey, Image);
        }
        return Image;
    }

    function MeasureSurface(Element) {
        const Rect = Element.getBoundingClientRect();
        return {
            width: Math.max(320, Math.min(1920, Math.round(Element.clientWidth || Rect.width || 1280))),
            height: Math.max(120, Math.min(1600, Math.round(Element.clientHeight || Rect.height || 900)))
        };
    }

    function PaintSurface(Element) {
        const Name = String(Element.dataset.storyGradientSurface || "").trim().toLowerCase();
        const Definition = SurfaceRegistry.get(Name);
        if (!Definition) return false;
        const Size = MeasureSurface(Element);
        const CacheKey = Name + ":" + Size.width + "x" + Size.height;
        const Image = GetSurfaceImage(Name, Size.width, Size.height);
        if (!Image) return false;

        if (Name.startsWith("scene-background-")) {
            Element.style.setProperty(
                "--SceneBackground",
                'url("' + Image + '") center center / 100% 100% no-repeat',
                "important"
            );
        } else {
            Element.style.setProperty("background-color", Definition.backgroundColor || "transparent", "important");
            Element.style.setProperty("background-image", 'url("' + Image + '")', "important");
            Element.style.setProperty("background-repeat", "no-repeat", "important");
            Element.style.setProperty("background-position", "center center", "important");
            Element.style.setProperty("background-size", "100% 100%", "important");
            Element.style.setProperty("background-attachment", "scroll", "important");
        }

        Element.dataset.storyGradientSurfaceReady = "true";
        Element.dataset.storyGradientSurfaceSize = CacheKey;
        if (SurfaceResizeObserver && !ObservedSurfaces.has(Element)) {
            SurfaceResizeObserver.observe(Element);
            ObservedSurfaces.add(Element);
        }
        return true;
    }

    function ApplySceneVignette() {
        if (SceneVignetteApplied) return;
        const Vignette = GetSurfaceImage("scene-vignette", 1600, 900);
        const FailureOverlay = GetSurfaceImage("scene-failure-overlay", 1600, 900);
        if (!Vignette || !FailureOverlay) return;
        Root.style.setProperty(
            "--story-gradient-token-058",
            'url("' + Vignette + '") center center / 100% 100% no-repeat'
        );
        Root.style.setProperty(
            "--story-gradient-token-070",
            'url("' + FailureOverlay + '") center center / 100% 100% no-repeat'
        );
        SceneVignetteApplied = true;
    }

    function GetClassSuffix(Element, Prefix, Fallback) {
        for (const ClassName of Element.classList) {
            if (ClassName.startsWith(Prefix)) return ClassName.slice(Prefix.length).toLowerCase();
        }
        return Fallback;
    }

    function GetAutomaticSurfaceName(Element) {
        if (Element.classList.contains("StorySettingsPage")) return "settings-page-background";
        if (Element.classList.contains("StorySocialChat") || Element.classList.contains("StorySocialChatView")) {
            return "social-chat";
        }
        if (Element.classList.contains("ChapterGameHeader")) {
            return "chapter-header-" + GetClassSuffix(Element, "Theme-", "default");
        }
        if (Element.classList.contains("StageMapArea")) {
            return "stage-map-" + GetClassSuffix(Element, "Theme-", "default");
        }
        if (Element.classList.contains("GameScene")) {
            return "scene-background-" + GetClassSuffix(Element, "SceneTheme-", "fromville");
        }
        const Scene = Element.closest(".GameScene");
        if (Scene && Element.classList.contains("SceneAtmosphere")) {
            const Theme = GetClassSuffix(Scene, "SceneTheme-", "fromville");
            if (Theme === "fromville") return "scene-atmosphere-fromville";
        }
        if (Element.classList.contains("MultiplayerHero")) return "multiplayer-hero";
        if (
            Element.classList.contains("RoomActionCard")
            || Element.classList.contains("RoomPanel")
            || Element.classList.contains("ChatPanel")
        ) return "multiplayer-panel";
        if (Element.classList.contains("AccountCard")) return "account-card";
        return "";
    }

    function ApplySurfaces() {
        const Targets = document.querySelectorAll(
            "[data-story-gradient-surface], .StorySettingsPage, .StorySocialChat, .StorySocialChatView, " +
            ".ChapterGameHeader, .StageMapArea, .GameScene, .SceneAtmosphere, .MultiplayerHero, " +
            ".RoomActionCard, .RoomPanel, .ChatPanel, .AccountCard"
        );

        Targets.forEach(Element => {
            const AutoName = GetAutomaticSurfaceName(Element);
            if (Element.dataset.storyGradientSurfaceAuto === "true") {
                if (AutoName && Element.dataset.storyGradientSurface !== AutoName) {
                    Element.dataset.storyGradientSurface = AutoName;
                    delete Element.dataset.storyGradientSurfaceSize;
                }
            } else if (!Element.dataset.storyGradientSurface && AutoName) {
                Element.dataset.storyGradientSurface = AutoName;
                Element.dataset.storyGradientSurfaceAuto = "true";
            }

            const Name = String(Element.dataset.storyGradientSurface || "").trim().toLowerCase();
            if (!Name) return;

            if (
                Name.startsWith("scene-background-")
                || Name.startsWith("scene-atmosphere-")
            ) ApplySceneVignette();

            const Size = MeasureSurface(Element);
            const CacheKey = Name + ":" + Size.width + "x" + Size.height;
            if (Element.dataset.storyGradientSurfaceSize !== CacheKey) PaintSurface(Element);

            if (SurfaceResizeObserver && !ObservedSurfaces.has(Element)) {
                SurfaceResizeObserver.observe(Element);
                ObservedSurfaces.add(Element);
            }
        });
    }

    RegisterSurface("social-chat", {
        top: "#352a23",
        bottom: "#28201b",
        highlight: "rgba(216,177,117,.13)",
        highlightX: 0.88,
        highlightY: 0.08,
        highlightRadius: 0.24
    });

    RegisterSurface("social-chat-empty", {
        top: "#352a23",
        bottom: "#28201b",
        overlayTop: "rgba(53,42,35,.4)",
        overlayBottom: "rgba(40,32,27,.76)",
        highlight: "rgba(240,204,144,.08)",
        highlightX: 0.5,
        highlightY: 0.35,
        highlightRadius: 0.31
    });

    RegisterSurface("chapter-header-default", {
        layers: [{ type: "linear", angle: 110, stops: [
            { at: 0, color: "#3b2317" },
            { at: 0.64, color: "#1d110c" },
            { at: 1, color: "#422619" }
        ] }]
    });
    RegisterSurface("chapter-header-fromville", {
        layers: [{ type: "linear", angle: 110, stops: [
            { at: 0, color: "#35251d" },
            { at: 0.62, color: "#101513" },
            { at: 1, color: "#27352f" }
        ] }]
    });
    RegisterSurface("chapter-header-anime", {
        layers: [{ type: "linear", angle: 110, stops: [
            { at: 0, color: "#3f1729" },
            { at: 0.60, color: "#16101f" },
            { at: 1, color: "#55243f" }
        ] }]
    });
    RegisterSurface("chapter-header-manor", {
        layers: [{ type: "linear", angle: 110, stops: [
            { at: 0, color: "#25283a" },
            { at: 0.62, color: "#12131c" },
            { at: 1, color: "#3f3441" }
        ] }]
    });
    RegisterSurface("chapter-header-forest", {
        layers: [{ type: "linear", angle: 110, stops: [
            { at: 0, color: "#24331f" },
            { at: 0.62, color: "#0f170f" },
            { at: 1, color: "#40522c" }
        ] }]
    });
    RegisterSurface("chapter-header-city", {
        layers: [{ type: "linear", angle: 110, stops: [
            { at: 0, color: "#203445" },
            { at: 0.62, color: "#10171e" },
            { at: 1, color: "#334c60" }
        ] }]
    });

    RegisterSurface("stage-map-default", {
        backgroundColor: "#160d09",
        layers: [
            { type: "linear", angle: 145, stops: [
                { at: 0, color: "#2b1a12" },
                { at: 0.62, color: "#160d09" },
                { at: 1, color: "#21140e" }
            ] },
            { type: "radial", x: 0.18, y: 0.20, radiusScale: 0.22, stops: [
                { at: 0, color: "rgba(222,174,100,.08)" },
                { at: 0.22, color: "rgba(0,0,0,0)" },
                { at: 1, color: "rgba(0,0,0,0)" }
            ] }
        ]
    });
    RegisterSurface("stage-map-fromville", {
        backgroundColor: "#111713",
        layers: [
            { type: "linear", angle: 145, stops: [
                { at: 0, color: "#223028" }, { at: 0.64, color: "#111713" }, { at: 1, color: "#0a0e0c" }
            ] },
            { type: "radial", x: 0.78, y: 0.20, radiusScale: 0.18, stops: [
                { at: 0, color: "rgba(207,222,197,.12)" }, { at: 0.18, color: "rgba(0,0,0,0)" }, { at: 1, color: "rgba(0,0,0,0)" }
            ] }
        ]
    });
    RegisterSurface("stage-map-anime", {
        backgroundColor: "#120c19",
        layers: [
            { type: "linear", angle: 145, stops: [
                { at: 0, color: "#2b1020" }, { at: 0.63, color: "#120c19" }, { at: 1, color: "#1d0d1a" }
            ] },
            { type: "radial", x: 0.78, y: 0.18, radiusScale: 0.20, stops: [
                { at: 0, color: "rgba(255,93,178,.15)" }, { at: 0.20, color: "rgba(0,0,0,0)" }, { at: 1, color: "rgba(0,0,0,0)" }
            ] }
        ]
    });
    RegisterSurface("stage-map-manor", {
        backgroundColor: "#101219",
        layers: [
            { type: "linear", angle: 145, stops: [
                { at: 0, color: "#222535" }, { at: 0.65, color: "#101219" }, { at: 1, color: "#1a1720" }
            ] },
            { type: "radial", x: 0.76, y: 0.20, radiusScale: 0.18, stops: [
                { at: 0, color: "rgba(174,183,219,.13)" }, { at: 0.18, color: "rgba(0,0,0,0)" }, { at: 1, color: "rgba(0,0,0,0)" }
            ] }
        ]
    });
    RegisterSurface("stage-map-forest", {
        backgroundColor: "#0d150e",
        layers: [
            { type: "linear", angle: 145, stops: [
                { at: 0, color: "#202e1c" }, { at: 0.65, color: "#0d150e" }, { at: 1, color: "#151e12" }
            ] },
            { type: "radial", x: 0.76, y: 0.18, radiusScale: 0.18, stops: [
                { at: 0, color: "rgba(171,203,126,.12)" }, { at: 0.18, color: "rgba(0,0,0,0)" }, { at: 1, color: "rgba(0,0,0,0)" }
            ] }
        ]
    });
    RegisterSurface("stage-map-city", {
        backgroundColor: "#0d141a",
        layers: [
            { type: "linear", angle: 145, stops: [
                { at: 0, color: "#1b2c38" }, { at: 0.65, color: "#0d141a" }, { at: 1, color: "#15222c" }
            ] },
            { type: "radial", x: 0.78, y: 0.16, radiusScale: 0.18, stops: [
                { at: 0, color: "rgba(94,167,221,.13)" }, { at: 0.18, color: "rgba(0,0,0,0)" }, { at: 1, color: "rgba(0,0,0,0)" }
            ] }
        ]
    });

    RegisterSurface("scene-background-fromville", {
        backgroundColor: "#080b0a",
        layers: [
            { type: "linear", angle: 180, stops: [
                { at: 0, color: "#202d29" }, { at: 0.46, color: "#121a17" }, { at: 1, color: "#080b0a" }
            ] },
            { type: "radial", x: 0.78, y: 0.17, radiusScale: 0.12, stops: [
                { at: 0, color: "rgba(220,228,204,.6)" },
                { at: 0.03, color: "rgba(220,228,204,.12)" },
                { at: 0.035, color: "rgba(0,0,0,0)" },
                { at: 0.12, color: "rgba(0,0,0,0)" },
                { at: 1, color: "rgba(0,0,0,0)" }
            ] }
        ]
    });
    RegisterSurface("scene-background-anime", {
        backgroundColor: "#130d1a",
        layers: [
            { type: "linear", angle: 135, stops: [
                { at: 0, color: "#2c1028" }, { at: 0.48, color: "#130d1a" }, { at: 1, color: "#35142e" }
            ] },
            { type: "radial", x: 0.76, y: 0.20, radiusScale: 0.20, stops: [
                { at: 0, color: "rgba(255,68,166,.28)" }, { at: 0.20, color: "rgba(0,0,0,0)" }, { at: 1, color: "rgba(0,0,0,0)" }
            ] }
        ]
    });
    RegisterSurface("scene-background-manor", {
        backgroundColor: "#11131b",
        layers: [
            { type: "linear", angle: 145, stops: [
                { at: 0, color: "#252839" }, { at: 0.52, color: "#11131b" }, { at: 1, color: "#211b26" }
            ] },
            { type: "radial", x: 0.72, y: 0.17, radiusScale: 0.17, stops: [
                { at: 0, color: "rgba(196,203,235,.22)" }, { at: 0.17, color: "rgba(0,0,0,0)" }, { at: 1, color: "rgba(0,0,0,0)" }
            ] }
        ]
    });
    RegisterSurface("scene-background-forest", {
        backgroundColor: "#0d160e",
        layers: [
            { type: "linear", angle: 145, stops: [
                { at: 0, color: "#21351e" }, { at: 0.54, color: "#0d160e" }, { at: 1, color: "#182315" }
            ] },
            { type: "radial", x: 0.76, y: 0.20, radiusScale: 0.16, stops: [
                { at: 0, color: "rgba(181,212,130,.18)" }, { at: 0.16, color: "rgba(0,0,0,0)" }, { at: 1, color: "rgba(0,0,0,0)" }
            ] }
        ]
    });
    RegisterSurface("scene-background-city", {
        backgroundColor: "#0c151c",
        layers: [
            { type: "linear", angle: 145, stops: [
                { at: 0, color: "#1c3444" }, { at: 0.52, color: "#0c151c" }, { at: 1, color: "#152a37" }
            ] },
            { type: "radial", x: 0.72, y: 0.15, radiusScale: 0.19, stops: [
                { at: 0, color: "rgba(83,170,230,.18)" }, { at: 0.19, color: "rgba(0,0,0,0)" }, { at: 1, color: "rgba(0,0,0,0)" }
            ] }
        ]
    });

    RegisterSurface("scene-atmosphere-fromville", {
        alpha: true,
        layers: [
            { type: "linear", angle: 180, stops: [
                { at: 0, color: "rgba(0,0,0,0)" },
                { at: 0.54, color: "rgba(0,0,0,0)" },
                { at: 0.54, color: "rgba(126,145,133,.11)" },
                { at: 0.66, color: "rgba(126,145,133,.11)" },
                { at: 0.66, color: "rgba(0,0,0,0)" },
                { at: 1, color: "rgba(0,0,0,0)" }
            ] },
            { type: "linear", angle: 90, stops: [
                { at: 0, color: "rgba(0,0,0,0)" },
                { at: 0.09, color: "rgba(0,0,0,0)" },
                { at: 0.09, color: "rgba(0,0,0,.55)" },
                { at: 0.11, color: "rgba(0,0,0,.55)" },
                { at: 0.11, color: "rgba(0,0,0,0)" },
                { at: 0.23, color: "rgba(0,0,0,0)" },
                { at: 0.23, color: "rgba(0,0,0,.5)" },
                { at: 0.25, color: "rgba(0,0,0,.5)" },
                { at: 0.25, color: "rgba(0,0,0,0)" },
                { at: 0.76, color: "rgba(0,0,0,0)" },
                { at: 0.76, color: "rgba(0,0,0,.45)" },
                { at: 0.78, color: "rgba(0,0,0,.45)" },
                { at: 0.78, color: "rgba(0,0,0,0)" },
                { at: 1, color: "rgba(0,0,0,0)" }
            ] }
        ]
    });

    
    RegisterSurface("scene-failure-overlay", {
        alpha: true,
        layers: [
            { type: "linear", angle: 180, stops: [
                { at: 0, color: "rgba(141,19,16,.2)" },
                { at: 1, color: "rgba(0,0,0,.72)" }
            ] },
            { type: "radial", x: 0.5, y: 0.5, radiusScale: 1, stops: [
                { at: 0, color: "rgba(0,0,0,0)" },
                { at: 0.16, color: "rgba(0,0,0,0)" },
                { at: 0.70, color: "rgba(92,5,4,.42)" },
                { at: 1, color: "rgba(40,0,0,.78)" }
            ] }
        ]
    });
    RegisterSurface("scene-vignette", {
        alpha: true,
        layers: [
            { type: "radial", x: 0.5, y: 0.5, radiusScale: 1, stops: [
                { at: 0, color: "rgba(0,0,0,0)" },
                { at: 0.35, color: "rgba(0,0,0,0)" },
                { at: 1, color: "rgba(0,0,0,.38)" }
            ] },
            { type: "linear", angle: 180, stops: [
                { at: 0, color: "rgba(0,0,0,.08)" },
                { at: 0.42, color: "rgba(0,0,0,.02)" },
                { at: 1, color: "rgba(0,0,0,.72)" }
            ] }
        ]
    });

    RegisterSurface("account-card", {
        backgroundColor: "#21130d",
        layers: [{ type: "linear", angle: 180, stops: [
            { at: 0, color: "#3a2418" }, { at: 1, color: "#21130d" }
        ] }]
    });
    RegisterSurface("settings-page-background", {
        backgroundColor: "#100906",
        layers: [
            { type: "linear", angle: 145, stops: [
                { at: 0, color: "#432718" },
                { at: 0.48, color: "#21130d" },
                { at: 1, color: "#100906" }
            ] },
            { type: "radial", x: 0.18, y: 0.08, radiusScale: 0.34, stops: [
                { at: 0, color: "rgba(213,165,95,.16)" },
                { at: 1, color: "rgba(213,165,95,0)" }
            ] }
        ]
    });
    RegisterSurface("multiplayer-hero", {
        backgroundColor: "#24150e",
        layers: [{ type: "linear", angle: 120, stops: [
            { at: 0, color: "#4a2b1a" }, { at: 0.70, color: "#24150e" }, { at: 1, color: "#24150e" }
        ] }]
    });
    RegisterSurface("multiplayer-panel", {
        backgroundColor: "#21130d",
        layers: [{ type: "linear", angle: 180, stops: [
            { at: 0, color: "#392317" }, { at: 1, color: "#21130d" }
        ] }]
    });

    function RegisterTheme(Name, Definition) {
        const Key = String(Name || "").trim().toLowerCase();
        if (!/^[a-z][a-z0-9-]{0,31}$/.test(Key) || !Definition || typeof Definition !== "object") return false;
        const Image = String(Definition.image || "").trim();
        if (!Image || /url\s*\(/i.test(Image)) return false;
        Registry.set(Key, Object.freeze({
            image: Image,
            repeat: String(Definition.repeat || "no-repeat"),
            size: String(Definition.size || "cover"),
            position: String(Definition.position || "center center"),
            color: String(Definition.color || "#4d301f")
        }));
        return true;
    }

    // Page-level gradients remain in the shared CSS registry; large scrolling
    // surfaces are rasterized once per size and reused from the cache above.
    RegisterTheme("parchment", {
        image: "var(--story-theme-image-parchment)",
        repeat: "repeat, repeat, no-repeat, no-repeat, no-repeat",
        size: "120px 96px, 120px 96px, 100% 100%, 100% 100%, 100% 100%",
        position: "0 0, 0 0, center center, center center, center center"
    });
    RegisterTheme("paper", {
        image: "var(--story-theme-image-paper)"
    });
    RegisterTheme("social", {
        image: "var(--story-theme-image-social)"
    });
    RegisterTheme("account-settings", {
        image: "none",
        color: "#8d6849"
    });
    RegisterTheme("account", {
        image: "var(--story-theme-image-account)"
    });
    RegisterTheme("multiplayer", {
        image: "var(--story-theme-image-account)"
    });
    RegisterTheme("levels", {
        image: "var(--story-theme-image-levels)"
    });
    RegisterTheme("think", {
        image: "var(--story-theme-image-think)",
        color: "#17110d"
    });

    function DetectTheme() {
        const Body = document.body;
        if (!Body) return "parchment";
        const Explicit = String(Body.dataset.storyGradientTheme || "").trim().toLowerCase();
        if (Explicit) return Explicit;
        if (Body.classList.contains("StorySocialPage")) return "social";
        if (Body.classList.contains("ThinkPage")) return "think";
        if (Body.classList.contains("LevelSelectPage")) return "levels";
        if (Body.classList.contains("MultiplayerPage")) return "multiplayer";
        if (Body.classList.contains("AccountSettingsPage")) return "account-settings";
        if (Body.classList.contains("AccountPage")) return "account";
        if (Body.classList.contains("paper-body")) return "paper";
        return "parchment";
    }

    function SetTheme(Name) {
        const Key = String(Name || "").trim().toLowerCase();
        const Definition = Registry.get(Key);
        if (!Definition) return false;
        Root.dataset.storyGradient = Key;
        Root.style.setProperty("--story-gradient-base", Definition.color);
        Root.style.setProperty("--story-global-gradient-image", Definition.image);
        Root.style.setProperty("--story-global-gradient-repeat", Definition.repeat);
        Root.style.setProperty("--story-global-gradient-size", Definition.size);
        Root.style.setProperty("--story-global-gradient-position", Definition.position);
        return true;
    }

    function ApplyTheme() {
        return SetTheme(DetectTheme());
    }

    window.GlobalModule = Object.freeze({
        version: "1.2.0",
        gradients: Object.freeze({
            registerTheme: RegisterTheme,
            setTheme: SetTheme,
            apply: ApplyTheme,
            detectTheme: DetectTheme,
            getTheme: () => Root.dataset.storyGradient || "",
            themes: () => Array.from(Registry.keys()),
            registerSurface: RegisterSurface,
            applySurfaces: ApplySurfaces,
            surfaceThemes: () => Array.from(SurfaceRegistry.keys())
        })
    });

    if (typeof ResizeObserver === "function") {
        SurfaceResizeObserver = new ResizeObserver(Entries => {
            for (const Entry of Entries) {
                const Element = Entry.target;
                const Size = MeasureSurface(Element);
                const Name = String(Element.dataset.storyGradientSurface || "").trim().toLowerCase();
                const CacheKey = Name + ":" + Size.width + "x" + Size.height;
                if (Name && Element.dataset.storyGradientSurfaceSize !== CacheKey) PaintSurface(Element);
            }
        });
    }

    ApplyTheme();
    ApplySurfaces();

    if (typeof MutationObserver === "function" && document.body) {
        const SurfaceObserver = new MutationObserver(ApplySurfaces);
        SurfaceObserver.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["data-story-gradient-surface"]
        });
        const ThemeObserver = new MutationObserver(ApplyTheme);
        ThemeObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ["class", "data-story-gradient-theme"]
        });
    }

    window.addEventListener("resize", ApplySurfaces, { passive: true });
})();
