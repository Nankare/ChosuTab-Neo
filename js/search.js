"use strict";

globalThis.NeoSearch = {
    attach(store) {
        const input = document.getElementById("searchInput");
        const form = document.getElementById("searchForm");
        const list = document.getElementById("suggestions");
        let timer;
        let controller;
        let revision = 0;
        let selected = -1;
        let composing = false;

        function clear() {
            selected = -1;
            list.replaceChildren();
            input.setAttribute("aria-expanded", "false");
            input.removeAttribute("aria-activedescendant");
        }
        function close() {
            clearTimeout(timer);
            revision++;
            controller?.abort();
            controller = null;
            clear();
        }
        function render(google, history) {
            clear();
            const fragment = document.createDocumentFragment();
            for (const [index, entry] of [...google.map(text => ({ text, icon: "⌕" })), ...history.map(text => ({ text, icon: "↻" }))].entries()) {
                const row = document.createElement("div");
                row.className = "suggestion";
                row.id = `suggestion-${index}`;
                row.setAttribute("role", "option");
                row.setAttribute("aria-selected", "false");
                const label = document.createElement("span");
                label.className = "suggestion-label";
                label.textContent = `${entry.icon} ${entry.text}`;
                const add = document.createElement("button");
                add.type = "button";
                add.className = "suggestion-add";
                add.textContent = "↖";
                add.title = "検索バーに入力";
                add.setAttribute("aria-label", `${entry.text}を検索バーに入力`);
                row.addEventListener("click", () => { input.value = entry.text; form.requestSubmit(); });
                add.addEventListener("click", event => {
                    event.stopPropagation();
                    input.value = entry.text;
                    input.focus();
                    close();
                });
                row.append(label, add);
                fragment.append(row);
            }
            list.append(fragment);
            input.setAttribute("aria-expanded", String(list.childElementCount > 0));
        }
        async function update(query) {
            const request = ++revision;
            try { await store.ready; } catch { return; }
            if (request !== revision) return;
            const keyword = query.trim().toLocaleLowerCase();
            const history = store.get().searchHistory.filter(item => item.toLocaleLowerCase().startsWith(keyword));
            render([], history.slice(0, keyword ? 2 : 5));
            if (!keyword) return;
            const active = new AbortController();
            controller = active;
            const timeout = setTimeout(() => active.abort(), 5000);
            try {
                const response = await fetch(`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query.trim())}`, { signal: active.signal, credentials: "omit" });
                if (!response.ok) return;
                const data = await response.json();
                if (request !== revision || !Array.isArray(data?.[1])) return;
                const seen = new Set();
                const google = data[1].filter(item => typeof item === "string").map(item => item.trim()).filter(item => {
                    const key = item.toLocaleLowerCase();
                    if (!key || seen.has(key)) return false;
                    seen.add(key);
                    return true;
                }).slice(0, 3);
                const googleKeys = new Set(google.map(item => item.toLocaleLowerCase()));
                render(google, history.filter(item => !googleKeys.has(item.toLocaleLowerCase())).slice(0, 2));
            } catch { /* Local history remains usable without network access. */ }
            finally { clearTimeout(timeout); if (controller === active) controller = null; }
        }
        function schedule() {
            close();
            if (!composing) timer = setTimeout(() => update(input.value), 200);
        }
        input.addEventListener("input", schedule);
        input.addEventListener("focus", () => { close(); update(input.value); });
        input.addEventListener("compositionstart", () => { composing = true; close(); });
        input.addEventListener("compositionend", () => { composing = false; schedule(); });
        input.addEventListener("keydown", event => {
            if (event.isComposing) return;
            if (event.key === "Escape") { close(); return; }
            const rows = [...list.children];
            if (!rows.length) return;
            if (event.key === "Enter" && selected >= 0) { event.preventDefault(); rows[selected].click(); return; }
            if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
            event.preventDefault();
            selected = event.key === "ArrowDown" ? (selected + 1) % rows.length : selected <= 0 ? rows.length - 1 : selected - 1;
            rows.forEach((row, index) => {
                row.classList.toggle("selected", index === selected);
                row.setAttribute("aria-selected", String(index === selected));
            });
            input.setAttribute("aria-activedescendant", rows[selected].id);
            rows[selected].scrollIntoView({ block: "nearest" });
        });
        document.addEventListener("click", event => { if (!form.contains(event.target) && !list.contains(event.target)) close(); });
        window.addEventListener("pagehide", close);
        return { close };
    }
};
