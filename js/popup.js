"use strict";

(() => {
    const byId = id => document.getElementById(id);
    const store = Neo.createStore();
    const status = byId("status");
    const fileInput = byId("backgroundFile");
    let processingImage = false;
    let lastWrite = 0;
    let pendingWrites = 0;
    let managing = false;
    let settingsReady = false;
    const managementIds = ["exportSettings", "importSettings", "resetSettings"];
    function syncControls() {
        const busy = !settingsReady || managing || processingImage;
        for (const id of ["themeColor", "searchEngine", "chooseBackground", "font", "widgetOpacity", "clearSearchHistory"]) byId(id).disabled = busy;
        managementIds.forEach(id => { byId(id).disabled = busy || pendingWrites > 0; });
        byId("resetBackground").disabled = busy || !store.get().backgroundImage;
    }
    const swatches = [...document.querySelectorAll(".swatch")];
    swatches.forEach(button => { button.style.backgroundColor = button.dataset.color; button.disabled = true; });

    function message(text, error = false) {
        status.textContent = text;
        status.classList.toggle("error", error);
    }
    function render(settings, changed) {
        if (changed.includes("themeColor")) {
            Neo.applyTheme(settings.themeColor, document.documentElement, settings.widgetOpacity);
            byId("themeColor").value = settings.themeColor;
            byId("colorValue").textContent = settings.themeColor.toUpperCase();
            swatches.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.color === settings.themeColor.toLowerCase())));
        }
        if (changed.includes("font")) {
            document.documentElement.style.setProperty("--font", settings.font);
            byId("font").value = settings.font;
        }
        if (changed.includes("widgetOpacity")) byId("widgetOpacity").value = settings.widgetOpacity;
        if (changed.includes("searchEngine")) byId("searchEngine").value = settings.searchEngine;
        if (changed.includes("backgroundImage")) {
            byId("backgroundPreview").style.backgroundImage = settings.backgroundImage ? `url(${JSON.stringify(settings.backgroundImage)})` : "";
            byId("resetBackground").disabled = processingImage || !settings.backgroundImage;
        }
    }
    store.subscribe((settings, changed) => { render(settings, changed); syncControls(); });
    store.ready.then(() => {
        settingsReady = true;
        syncControls();
        message("");
    }).catch(() => message("設定を読み込めませんでした。開き直してください。", true));

    async function save(patch) {
        const currentWrite = ++lastWrite;
        pendingWrites++;
        syncControls();
        message("保存中…");
        try {
            await store.save(patch);
            if (currentWrite === lastWrite) message("保存しました");
            return true;
        } catch (error) {
            render(store.get(), Object.keys(patch));
            message(`保存できませんでした。${error.message}`, true);
            return false;
        } finally { pendingWrites--; syncControls(); }
    }
    byId("font").addEventListener("change", () => save({ font: byId("font").value }));
    byId("widgetOpacity").addEventListener("input", () => Neo.applyTheme(byId("themeColor").value, document.documentElement, Number(byId("widgetOpacity").value)));
    byId("widgetOpacity").addEventListener("change", () => save({ widgetOpacity: Number(byId("widgetOpacity").value) }));
    byId("clearSearchHistory").addEventListener("click", () => {
        if (confirm("検索履歴をすべて削除しますか？")) save({ searchHistory: [] });
    });
    byId("searchEngine").addEventListener("change", () => save({ searchEngine: byId("searchEngine").value }));
    byId("themeColor").addEventListener("input", () => {
        Neo.applyTheme(byId("themeColor").value, document.documentElement, Number(byId("widgetOpacity").value));
        byId("colorValue").textContent = byId("themeColor").value.toUpperCase();
    });
    byId("themeColor").addEventListener("change", () => save({ themeColor: byId("themeColor").value }));
    swatches.forEach(button => button.addEventListener("click", () => save({ themeColor: button.dataset.color })));
    byId("chooseBackground").addEventListener("click", () => fileInput.click());
    byId("resetBackground").addEventListener("click", () => save({ backgroundImage: null }));

    async function optimizeImage(file) {
        if (!/^image\/(png|jpeg|webp|avif|gif|bmp)$/.test(file.type) || file.size > 10 * 1024 * 1024) {
            throw new Error("10MB以下の対応画像を選んでください。");
        }
        const bitmap = await createImageBitmap(file);
        try {
            const scale = Math.min(1, 1920 / Math.max(bitmap.width, bitmap.height));
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            const context = canvas.getContext("2d");
            if (!context) throw new Error("画像を処理できませんでした。");
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.85));
            if (!blob || blob.size > 2 * 1024 * 1024) throw new Error("画像を十分に軽量化できませんでした。別の画像を選んでください。");
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(new Error("画像を読み込めませんでした。"));
                reader.readAsDataURL(blob);
            });
        } finally { bitmap.close(); }
    }
    fileInput.addEventListener("change", async () => {
        const file = fileInput.files[0];
        if (!file || processingImage) return;
        processingImage = true;
        syncControls();
        message("画像を軽量化しています…");
        try { await save({ backgroundImage: await optimizeImage(file) }); }
        catch (error) { message(`背景を変更できませんでした。${error.message}`, true); }
        finally {
            processingImage = false;
            syncControls();
            fileInput.value = "";
        }
    });
    async function manage(task) {
        if (managing || processingImage || pendingWrites || !settingsReady) return;
        managing = true;
        syncControls();
        try { await task(); }
        catch (error) { message(error.message, true); }
        finally { managing = false; syncControls(); }
    }
    byId("exportSettings").addEventListener("click", () => manage(async () => {
        const data = await chrome.storage.local.get(Object.keys(Neo.defaults));
        const blob = new Blob([JSON.stringify(Neo.createBackup(data), null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = "ChosuTab-Neo-backup.json";
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        message("バックアップのダウンロードを開始しました。");
    }));
    byId("importSettings").addEventListener("click", () => byId("settingsFile").click());
    byId("settingsFile").addEventListener("change", () => manage(async () => {
        const input = byId("settingsFile");
        const file = input.files[0];
        if (!file) return;
        try {
            if (file.size > 10 * 1024 * 1024) throw new Error("10MB以下のバックアップを選んでください。");
            const backup = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
            const settings = Neo.parseBackup(backup);
            if (!confirm("背景・ショートカット・検索履歴を含む現在の設定を、バックアップの内容に置き換えますか？")) return;
            // A single write preserves the old settings if validation or saving fails.
            if (await save(settings)) message(backup.format === "ChosuTab_ExportFile"
                ? "ChosuTab 1.6.2以降の旧形式をインポートしました。"
                : "設定をインポートしました。");
        } catch (error) { message(`インポートできませんでした。${error.message}`, true); }
        finally { input.value = ""; }
    }));
    byId("resetSettings").addEventListener("click", () => manage(async () => {
        if (!confirm("背景・ショートカット・検索履歴を含むすべての設定を初期状態に戻しますか？")) return;
        if (await save({ ...Neo.defaults })) message("すべての設定をリセットしました。");
    }));
})();
