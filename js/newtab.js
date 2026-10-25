"use strict";

(() => {
    const byId = id => document.getElementById(id);
    document.addEventListener("keydown", event => {
        if (event.key === "Tab") document.documentElement.classList.add("keyboard-navigation");
    });
    document.addEventListener("pointerdown", () => document.documentElement.classList.remove("keyboard-navigation"));
    window.addEventListener("blur", () => document.documentElement.classList.remove("keyboard-navigation"));
    const store = Neo.createStore();
    const status = byId("pageStatus");
    const shortcuts = byId("shortcuts");
    let overflowFrame;
    function updateOverflow() {
        if (overflowFrame) return;
        overflowFrame = requestAnimationFrame(() => {
            overflowFrame = 0;
            shortcuts.classList.toggle("is-scrollable", shortcuts.scrollWidth > shortcuts.clientWidth + 1);
        });
    }
    const shortcutSizes = new ResizeObserver(updateOverflow);
    function observeShortcutSizes() {
        shortcutSizes.disconnect();
        shortcutSizes.observe(shortcuts);
        for (const child of shortcuts.children) shortcutSizes.observe(child);
        updateOverflow();
    }
    observeShortcutSizes();
    const dialog = byId("shortcutDialog");
    const form = byId("shortcutForm");
    let editingId = null;
    let saving = false;
    let timer;
    let lastMinute = "";
    let lastDay = "";
    const search = NeoSearch.attach(store);

    function tick() {
        clearTimeout(timer);
        if (document.hidden) return;
        const now = new Date();
        const pad = n => String(n).padStart(2, "0");
        const minute = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
        if (minute !== lastMinute) { byId("hoursMinutes").textContent = minute; lastMinute = minute; }
        const second = pad(now.getSeconds());
        if (byId("seconds").textContent !== second) byId("seconds").textContent = second;
        const day = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
        if (day !== lastDay) { byId("date").textContent = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`; lastDay = day; }
        timer = setTimeout(tick, 1000 - Date.now() % 1000);
    }
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("pageshow", tick);
    window.addEventListener("pagehide", () => clearTimeout(timer));
    tick();

    function openEditor(shortcut = null) {
        editingId = shortcut?.id ?? null;
        byId("dialogTitle").textContent = shortcut ? "ショートカットを編集" : "ショートカットを追加";
        byId("shortcutName").value = shortcut?.name ?? "";
        byId("shortcutUrl").value = shortcut?.url ?? "";
        byId("shortcutError").textContent = "";
        byId("deleteShortcut").hidden = !shortcut;
        dialog.showModal();
        byId("shortcutName").focus();
    }

    function renderShortcuts(items) {
        const fragment = document.createDocumentFragment();
        for (const item of items) {
            const tile = document.createElement("div");
            tile.className = "shortcut";
            // Long-press/right-click keeps editing accessible without permanent dots.
            tile.addEventListener("contextmenu", event => { event.preventDefault(); openEditor(item); });
            const a = document.createElement("a");
            a.href = item.url;
            a.title = item.name;
            a.className = "widget";
            const icon = document.createElement("img");
            icon.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(new URL(item.url).hostname)}&sz=16`;
            icon.alt = "";
            icon.width = 16;
            icon.height = 16;
            icon.referrerPolicy = "no-referrer";
            const name = document.createElement("span");
            name.className = "shortcut-name";
            name.textContent = item.name;
            a.append(icon, name);
            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "edit-shortcut";
            edit.setAttribute("aria-label", `${item.name}を編集`);
            edit.title = "編集・削除";
            edit.addEventListener("click", () => openEditor(item));
            tile.append(a, edit);
            fragment.append(tile);
        }
        const add = document.createElement("button");
        add.type = "button";
        add.className = "add-shortcut widget";
        add.setAttribute("aria-label", "ショートカットを追加");
        const plus = document.createElement("span");
        plus.className = "shortcut-icon";
        plus.textContent = "+";
        plus.setAttribute("aria-hidden", "true");
        add.append(plus);
        add.title = "ショートカットを追加";
        add.addEventListener("click", () => openEditor());
        // Keep the last shortcut and its add button on the same row.
        const lastShortcut = fragment.lastElementChild;
        if (lastShortcut) {
            const tail = document.createElement("div");
            tail.className = "shortcut-tail";
            tail.append(lastShortcut, add);
            fragment.append(tail);
        } else fragment.append(add);
        shortcuts.replaceChildren(fragment);
        observeShortcutSizes();
    }

    store.subscribe((settings, changed) => {
        if (changed.includes("themeColor") || changed.includes("widgetOpacity")) Neo.applyTheme(settings.themeColor, document.documentElement, settings.widgetOpacity);
        if (changed.includes("font")) document.documentElement.style.setProperty("--font", settings.font);
        if (changed.includes("backgroundImage")) {
            byId("background").style.backgroundImage = `url(${JSON.stringify(settings.backgroundImage || "img/background.webp")})`;
            document.body.classList.toggle("has-background", !!settings.backgroundImage);
        }
        if (changed.includes("searchEngine")) {
            const engine = Neo.engines[settings.searchEngine];
            byId("searchInput").placeholder = settings.searchEngine === "google" ? "Search or input URL..." : `${engine.name} で検索、または URL を入力`;
        }
        if (changed.includes("shortcuts")) renderShortcuts(settings.shortcuts);
    });
    store.ready.catch(() => { status.textContent = "設定を読み込めませんでした。拡張機能を再読み込みしてください。"; });

    byId("searchForm").addEventListener("submit", async event => {
        event.preventDefault();
        if (!byId("searchInput").value.trim()) return;
        search.close();
        try {
            await store.ready;
            const query = byId("searchInput").value.trim();
            await store.save({ searchHistory: [query, ...store.get().searchHistory.filter(item => item !== query)].slice(0, 20) });
        } catch { /* A failed history write must not block search. */ }
        const target = Neo.searchTarget(byId("searchInput").value, store.get().searchEngine);
        if (target) location.assign(target);
    });
    byId("searchInput").addEventListener("keydown", event => {
        if (event.key === "Enter" && event.isComposing) event.preventDefault();
    });
    function closeEditor() { if (!saving) dialog.close(); }
    byId("closeDialog").addEventListener("click", closeEditor);
    byId("cancelDialog").addEventListener("click", closeEditor);
    dialog.addEventListener("cancel", event => { if (saving) event.preventDefault(); });

    async function commit(shortcut) {
        if (saving) return;
        saving = true;
        byId("saveShortcut").disabled = true;
        byId("deleteShortcut").disabled = true;
        byId("shortcutError").textContent = "";
        try {
            await store.changeShortcut(editingId, shortcut);
            dialog.close();
            status.textContent = shortcut ? "ショートカットを保存しました。" : "ショートカットを削除しました。";
        } catch (error) {
            byId("shortcutError").textContent = `保存できませんでした。${error.message}`;
        } finally {
            saving = false;
            byId("saveShortcut").disabled = false;
            byId("deleteShortcut").disabled = false;
        }
    }
    form.addEventListener("submit", event => {
        event.preventDefault();
        const name = byId("shortcutName").value.trim();
        const url = Neo.httpUrl(byId("shortcutUrl").value, true);
        if (!name || !url) {
            byId("shortcutError").textContent = "名前と、有効なhttp://またはhttps://のURLを入力してください。";
            return;
        }
        commit({ id: editingId ?? crypto.randomUUID(), name, url });
    });
    byId("deleteShortcut").addEventListener("click", () => {
        if (editingId !== null && confirm("このショートカットを削除しますか？")) commit(null);
    });
})();
