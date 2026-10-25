"use strict";

globalThis.Neo = (() => {
    const engines = Object.freeze({
        google: { name: "Google", url: "https://www.google.com/search?q=" },
        bing: { name: "Bing", url: "https://www.bing.com/search?q=" },
        duckduckgo: { name: "DuckDuckGo", url: "https://duckduckgo.com/?q=" },
        yahoo: { name: "Yahoo! JAPAN", url: "https://search.yahoo.co.jp/search?p=" }
    });
    const defaults = Object.freeze({
        themeColor: "#282828",
        widgetOpacity: 40,
        font: "yomogi",
        searchHistory: Object.freeze([]),
        searchEngine: "google",
        backgroundImage: null,
        shortcuts: Object.freeze([
            Object.freeze({ id: "youtube", name: "YouTube", url: "https://www.youtube.com/" }),
            Object.freeze({ id: "x", name: "X", url: "https://x.com/" }),
            Object.freeze({ id: "gmail", name: "Gmail", url: "https://mail.google.com/" }),
            Object.freeze({ id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/" })
        ])
    });
    const keys = Object.keys(defaults);

    function httpUrl(value, allowBare = false) {
        if (typeof value !== "string" || !value.trim() || /\s/.test(value.trim())) return null;
        let text = value.trim();
        if (allowBare && (!/^[a-z][a-z\d+.-]*:/i.test(text) || /^[^/:]+\.([^/:]+):\d+(?:[/?#]|$)/.test(text))) text = `https://${text}`;
        try {
            const url = new URL(text);
            return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
        } catch { return null; }
    }

    function valid(key, value) {
        switch (key) {
            case "font": return ["yomogi", "mushin"].includes(value);
            case "widgetOpacity": return Number.isFinite(value) && value >= 0 && value <= 100;
            case "searchHistory": return Array.isArray(value) && value.length <= 20 && value.every(item => typeof item === "string" && item.length <= 2048);
            case "themeColor": return typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
            case "searchEngine": return typeof value === "string" && Object.hasOwn(engines, value);
            case "backgroundImage": return value === null || (typeof value === "string" && value.length <= 2800000 && /^data:image\/(?:webp|png|jpeg);base64,[a-z\d+/=]+$/i.test(value));
            case "shortcuts": return Array.isArray(value) && value.every(item => item &&
                typeof item.id === "string" && item.id.length > 0 && item.id.length <= 100 &&
                typeof item.name === "string" && item.name.trim().length > 0 && item.name.length <= 30 &&
                typeof item.url === "string" && item.url.length <= 2048 && !!httpUrl(item.url)) &&
                new Set(value.map(item => item.id)).size === value.length;
            default: return false;
        }
    }

    function normalize(key, value) {
        return valid(key, value) ? value : defaults[key];
    }

    function createBackup(data) {
        const settings = Object.fromEntries(keys.map(key => [key, normalize(key, data[key])]));
        return { format: "ChosuTabNeo_Backup", formatVersion: 1, settings };
    }

    function parseBackup(data) {
        const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
        if (!object(data)) throw new Error("バックアップはオブジェクト形式で指定してください。");
        let source;
        let legacy = false;
        if (Object.hasOwn(data, "format")) {
            if (data.format === "ChosuTabNeo_Backup" && data.formatVersion === 1) source = data.settings;
            else if (data.format === "ChosuTab_ExportFile" && data.format_version === 1) {
                source = data.settings;
                legacy = true;
            } else throw new Error("未対応のバックアップ形式・バージョンです。");
        } else {
            throw new Error("形式情報のない旧バックアップには対応していません。");
        }
        if (!object(source)) throw new Error("設定データがありません。");
        const settings = { ...defaults };
        const booleanKeys = ["showClock", "showDate", "showGreeting", "showMemo", "showMusic", "showSeconds", "showShortcuts", "showTip"];
        let count = 0;
        if (legacy) {
            // Recognize old files that contain only options removed from Neo.
            for (const key of booleanKeys) {
                if (!Object.hasOwn(source, key)) continue;
                if (source[key] !== null && typeof source[key] !== "boolean") throw new Error(`設定値が不正です: ${key}`);
                count++;
            }
            for (const key of ["memo", "musicVolume", "backgroundImages"]) {
                if (!Object.hasOwn(source, key)) continue;
                const value = source[key];
                const validIgnored = value === null || (key === "memo" ? typeof value === "string" :
                    key === "backgroundImages" ? Array.isArray(value) && value.every(item => typeof item === "string") :
                    ["number", "string"].includes(typeof value) && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100);
                if (!validIgnored) throw new Error(`設定値が不正です: ${key}`);
                count++;
            }
        }
        for (const key of keys) {
            const inputKey = legacy && key === "themeColor" && !Object.hasOwn(source, key) ? "widgetColor" : key;
            if (!Object.hasOwn(source, inputKey)) continue;
            let value = source[inputKey];
            if (legacy) {
                if (value === null) value = defaults[key];
                if (key === "widgetOpacity" && typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())) value = Number(value);
                if (key === "font" && ["keifont", "sans-serif", "serif", "monospace"].includes(value)) value = defaults.font;
                if (key === "shortcuts" && Array.isArray(value)) {
                    value = value.length ? value.map((item, index) => {
                        if (!object(item) || typeof item.name !== "string") throw new Error("ショートカットの形式が不正です。");
                        const url = httpUrl(item.url);
                        if (!url) throw new Error("ショートカットのURLが不正です。");
                        return { id: `legacy-${index}`, name: (item.name.trim() || new URL(url).hostname).slice(0, 30), url };
                    }) : defaults.shortcuts;
                }
                if (key === "searchHistory" && Array.isArray(value) && value.every(item => typeof item === "string")) value = value.slice(0, 20);
            }
            if (!valid(key, value)) throw new Error(`設定値が不正です: ${inputKey}`);
            settings[key] = value;
            count++;
        }
        if (!count) throw new Error("ちょすたぶの設定データがありません。");
        return settings;
    }

    function searchTarget(query, engine) {
        const text = query.trim();
        if (!text) return null;
        // Only explicit HTTP(S) addresses or a domain-like input navigate directly.
        const candidate = /^https?:\/\//i.test(text) || (!/\s/.test(text) && /^[^/:]+\.[^/:]+(?::\d+)?(?:[/?#]|$)/.test(text));
        const direct = candidate ? httpUrl(text, true) : null;
        return direct || (engines[engine] || engines.google).url + encodeURIComponent(text);
    }

    function applyTheme(color, root = document.documentElement, opacity = 40) {
        const rgb = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
        // Pick a legible foreground even for very light custom colors.
        const channels = rgb.map(n => n / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4);
        const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        root.style.setProperty("--widget-bg", `rgba(${rgb.join(", ")}, ${opacity / 100})`);
        root.style.setProperty("--accent", color);
        root.style.setProperty("--accent-rgb", rgb.join(", "));
        root.style.setProperty("--on-accent", luminance > 0.179 ? "#172033" : "#ffffff");
    }

    function createStore() {
        let state = { ...defaults };
        const subscribers = new Set();
        const changedWhileLoading = new Set();
        function emit(changed) { subscribers.forEach(fn => fn(state, changed)); }
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== "local") return;
            const changed = keys.filter(key => Object.hasOwn(changes, key));
            if (!changed.length) return;
            state = { ...state };
            for (const key of changed) {
                changedWhileLoading.add(key);
                state[key] = normalize(key, changes[key].newValue);
            }
            emit(changed);
        });
        const ready = chrome.storage.local.get(keys).then(data => {
            state = { ...state };
            for (const key of keys) {
                if (!changedWhileLoading.has(key)) state[key] = normalize(key, data[key]);
            }
            emit(keys);
            return state;
        });
        return {
            ready,
            get: () => state,
            subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
            async save(patch) {
                for (const [key, value] of Object.entries(patch)) {
                    if (!valid(key, value)) throw new Error("設定値を確認してください。");
                }
                await ready;
                await chrome.storage.local.set(patch);
            },
            // Read at commit time, so editing a shortcut preserves other tabs' changes.
            async changeShortcut(id, shortcut) {
                await ready;
                const data = await chrome.storage.local.get("shortcuts");
                const current = normalize("shortcuts", data.shortcuts);
                let next;
                if (id === null) next = [...current, shortcut];
                else {
                    if (!current.some(item => item.id === id)) throw new Error("このショートカットは別のタブで削除されました。");
                    next = shortcut ? current.map(item => item.id === id ? shortcut : item) : current.filter(item => item.id !== id);
                }
                await this.save({ shortcuts: next });
            }
        };
    }

    return Object.freeze({ defaults, engines, valid, normalize, httpUrl, searchTarget, applyTheme, createStore, createBackup, parseBackup });
})();
