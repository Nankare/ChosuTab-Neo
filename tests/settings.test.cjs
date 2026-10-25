const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(initial = {}, delayed = false) {
    let data = structuredClone(initial);
    const listeners = [];
    let release;
    let failure = false;
    const context = vm.createContext({
        URL,
        chrome: { storage: {
            local: {
                get: async () => {
                    const snapshot = structuredClone(data);
                    if (delayed) { delayed = false; await new Promise(resolve => { release = resolve; }); }
                    return snapshot;
                },
                set: async patch => {
                    if (failure) throw new Error('Storage full');
                    const changes = Object.fromEntries(Object.entries(patch).map(([key, newValue]) => [key, { oldValue: data[key], newValue }]));
                    data = { ...data, ...structuredClone(patch) };
                    listeners.forEach(fn => fn(changes, 'local'));
                }
            },
            onChanged: { addListener: fn => listeners.push(fn) }
        } }
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/shared.js'), 'utf8'), context);
    return { Neo: context.Neo, read: () => data, release: () => release(), fail: () => { failure = true; }, change: async patch => context.chrome.storage.local.set(patch) };
}

test('missing, legacy, or corrupted settings use Neo defaults; empty shortcuts remain empty', () => {
    const { Neo } = setup();
    assert.equal(Neo.normalize('searchEngine', null), 'google');
    assert.equal(Neo.normalize('searchEngine', '__proto__'), 'google');
    assert.equal(Neo.normalize('themeColor', 'red'), '#282828');
    assert.equal(Neo.normalize('backgroundImage', 'https://example.com/image.png'), null);
    assert.equal(Neo.normalize('shortcuts', []).length, 0);
});

test('shortcut URLs reject active schemes, malformed addresses and credentials', () => {
    const { Neo } = setup();
    for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///test', 'https://', 'https://u:p@example.com', 'not a url']) {
        assert.equal(Neo.httpUrl(url, true), null, url);
    }
    assert.equal(Neo.httpUrl('example.com', true), 'https://example.com/');
    assert.equal(Neo.httpUrl('example.com:8080/path', true), 'https://example.com:8080/path');
});

test('every search engine encodes a query and direct HTTP(S) URLs navigate', () => {
    const { Neo } = setup();
    for (const [key, engine] of Object.entries(Neo.engines)) assert.equal(Neo.searchTarget('日本語 & test', key), engine.url + encodeURIComponent('日本語 & test'));
    assert.equal(Neo.searchTarget('example.com/path', 'bing'), 'https://example.com/path');
    assert.equal(Neo.searchTarget('http://localhost:8080', 'google'), 'http://localhost:8080/');
    assert.equal(Neo.searchTarget('javascript:alert(1)', 'google'), Neo.engines.google.url + encodeURIComponent('javascript:alert(1)'));
    assert.equal(Neo.searchTarget('   ', 'google'), null);
});

test('shortcut schema rejects duplicate identities and unsafe URLs', () => {
    const { Neo } = setup();
    const shortcut = { id: 'one', name: 'Example', url: 'https://example.com/' };
    assert.equal(Neo.valid('shortcuts', [shortcut]), true);
    assert.equal(Neo.valid('shortcuts', [shortcut, shortcut]), false);
    assert.equal(Neo.valid('shortcuts', [{ ...shortcut, url: 'javascript:alert(1)' }]), false);
    assert.equal(Neo.valid('shortcuts', [{ ...shortcut, name: ' ' }]), false);
});

test('storage initialization cannot overwrite a more recent setting change', async () => {
    const env = setup({ searchEngine: 'google' }, true);
    const store = env.Neo.createStore();
    await env.change({ searchEngine: 'bing' });
    env.release();
    await store.ready;
    assert.equal(store.get().searchEngine, 'bing');
});

test('add, edit, delete preserve latest changes; deleting every shortcut persists', async () => {
    const env = setup({ shortcuts: [] });
    const store = env.Neo.createStore();
    await store.ready;
    const first = { id: 'first', name: 'First', url: 'https://example.com/' };
    const second = { id: 'second', name: 'Second', url: 'https://example.org/' };
    await store.changeShortcut(null, first);
    await env.change({ shortcuts: [first, second] });
    await store.changeShortcut('first', { ...first, name: 'Edited' });
    assert.equal(env.read().shortcuts.length, 2);
    assert.equal(env.read().shortcuts[0].name, 'Edited');
    await store.changeShortcut('first', null);
    await store.changeShortcut('second', null);
    assert.equal(env.read().shortcuts.length, 0);
    await assert.rejects(store.changeShortcut('missing', null), /削除/);
});

test('failed writes keep previously saved settings intact', async () => {
    const env = setup({ themeColor: '#0f766e' });
    const store = env.Neo.createStore();
    await store.ready;
    env.fail();
    await assert.rejects(store.save({ themeColor: '#ffffff' }), /Storage full/);
    assert.equal(env.read().themeColor, '#0f766e');
    assert.equal(store.get().themeColor, '#0f766e');
});

test('only Yomogi and Mushin fonts are accepted and history is bounded', () => {
    const { Neo } = setup();
    assert.equal(Neo.valid('font', 'yomogi'), true);
    assert.equal(Neo.valid('font', 'mushin'), true);
    assert.equal(Neo.valid('font', 'keifont'), false);
    assert.equal(Neo.normalize('font', null), 'yomogi');
    assert.equal(Neo.valid('searchHistory', Array(21).fill('x')), false);
    assert.equal(Neo.valid('widgetOpacity', 101), false);
});


test('Neo backups round-trip every setting, including an empty shortcut list', () => {
    const { Neo } = setup();
    const settings = { ...Neo.defaults, font: 'mushin', themeColor: '#123456', widgetOpacity: 23, searchHistory: ['query'], shortcuts: [] };
    const backup = JSON.parse(JSON.stringify(Neo.createBackup(settings)));
    assert.deepEqual(JSON.parse(JSON.stringify(Neo.parseBackup(backup))), JSON.parse(JSON.stringify(settings)));
});

test('backup parser rejects wrong formats, invalid values and unsafe shortcut URLs', () => {
    const { Neo } = setup();
    for (const data of [null, [], {}, { format: 'ChosuTab_ExportFile', settings: {} }, { format: 'ChosuTabNeo_Backup', formatVersion: 2, settings: { font: 'yomogi' } }]) assert.throws(() => Neo.parseBackup(data));
    for (const settings of [{}, [], { font: 'keifont' }, { searchHistory: [123] }, { shortcuts: [{ id: 'x', name: 'x', url: 'javascript:alert(1)' }] }]) {
        assert.throws(() => Neo.parseBackup({ format: 'ChosuTabNeo_Backup', formatVersion: 1, settings }));
    }
});

test('partial backup uses defaults for missing values and ignores unknown keys', () => {
    const { Neo } = setup();
    const settings = Neo.parseBackup({ format: 'ChosuTabNeo_Backup', formatVersion: 1, settings: { font: 'mushin', unrelated: true } });
    assert.equal(settings.font, 'mushin');
    assert.equal(settings.searchEngine, 'google');
    assert.equal(settings.backgroundImage, null);
    assert.equal(Object.hasOwn(settings, 'unrelated'), false);
});


test('ChosuTab Edit versioned backups migrate color, opacity strings and ID-less shortcuts', () => {
    const { Neo } = setup();
    const settings = Neo.parseBackup({ format: 'ChosuTab_ExportFile', format_version: 1, settings: {
        widgetColor: '#0055ff', widgetOpacity: '39', font: 'mushin',
        shortcuts: [{ name: 'Example', url: 'https://EXAMPLE.com' }, { name: 'Example', url: 'https://example.org' }],
        showMusic: false, memo: 'omitted', musicVolume: '14'
    } });
    assert.equal(settings.themeColor, '#0055ff');
    assert.equal(settings.widgetOpacity, 39);
    assert.equal(settings.font, 'mushin');
    assert.equal(settings.shortcuts[0].url, 'https://example.com/');
    assert.notEqual(settings.shortcuts[0].id, settings.shortcuts[1].id);
    assert.equal(Neo.valid('shortcuts', settings.shortcuts), true);
    assert.equal(Object.hasOwn(settings, 'memo'), false);
});

test('raw settings without format metadata are rejected, including otherwise valid settings', () => {
    const { Neo } = setup();
    assert.throws(() => Neo.parseBackup({ backgroundImages: null, showGreeting: true, showMemo: false, showMusic: false, showTip: false }), /形式情報/);
    assert.throws(() => Neo.parseBackup({ font: 'yomogi', widgetColor: '#0055ff' }), /形式情報/);
    const settings = Neo.parseBackup({ format: 'ChosuTab_ExportFile', format_version: 1, settings: { widgetColor: null, widgetOpacity: null, shortcuts: null, font: 'keifont' } });
    assert.equal(settings.font, 'yomogi');
});

test('legacy imports preserve validation and Neo numeric types remain strict', () => {
    const { Neo } = setup();
    for (const settings of [{}, { unknown: true }, { showMusic: 'yes' }, { memo: {} }, { widgetOpacity: '' }, { widgetOpacity: '101' }, { font: 'unknown' }, { shortcuts: [{ name: 'bad', url: 'javascript:alert(1)' }] }]) assert.throws(() => Neo.parseBackup({ format: 'ChosuTab_ExportFile', format_version: 1, settings }));
    assert.throws(() => Neo.parseBackup({ format: 'Anything', format_version: 1, settings: { font: 'yomogi' } }));
    assert.throws(() => Neo.parseBackup({ format: 'ChosuTabNeo_Backup', formatVersion: 1, settings: { widgetOpacity: '39' } }));
    assert.throws(() => Neo.parseBackup({ format: 'ChosuTab_ExportFile', format_version: 99, settings: { font: 'yomogi' } }));
});

test('Edit backup format_version is required and must be the numeric version 1', () => {
    const { Neo } = setup();
    for (const version of [undefined, null, '1', 0, 2]) assert.throws(() => Neo.parseBackup({ format: 'ChosuTab_ExportFile', format_version: version, settings: { font: 'yomogi' } }));
    assert.throws(() => Neo.parseBackup({ format_version: 1, settings: { font: 'yomogi' } }));
    assert.equal(Neo.parseBackup({ format: 'ChosuTab_ExportFile', format_version: 1, settings: { font: 'yomogi' } }).font, 'yomogi');
});
