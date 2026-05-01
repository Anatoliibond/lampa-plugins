/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║          LAMPA PLUGIN — Online Viewer PRO                    ║
 * ║          Версія: 3.0.0 (Professional Edition)                ║
 * ║          Архітектура: Modular, DOM-Observer Fallback         ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

(function () {
    "use strict";

    // --- 1. CONFIGURATION ---
    const CONFIG = {
        name: "OnlineViewerPro",
        title: "Онлайн PRO",
        version: "3.0.0",
        storageKey: "ov_pro_progress",
        resumeThreshold: 0.92,
        api: {
            kinobox: "https://kinobox.tv/api/players",
            rezka: "https://hdrezka.ag/engine/ajax/getEmbedPlayer.php",
            kpHD: "https://kinopoiskHD.ru/engine/ajax/translation.php"
        },
        defaultSources: ["kinobox", "alloha", "collaps", "videocdn", "bazon", "hdvb"]
    };

    // --- 2. UTILS ---
    const Utils = {
        log: function (...args) {
            console.log(`[${CONFIG.name}]`, ...args);
        },
        notify: function (msg, type = "info") {
            if (window.Lampa && Lampa.Noty) Lampa.Noty.show(msg, { type: type });
        },
        getSetting: function (key, def) {
            try { return Lampa.Storage.get(key, def); } catch (e) { return def; }
        },
        formatTime: function (sec) {
            if (!sec || isNaN(sec)) return "";
            let s = Math.floor(sec);
            let h = Math.floor(s / 3600);
            let m = Math.floor((s % 3600) / 60);
            let rs = s % 60;
            return (h > 0 ? h + ":" : "") + (m < 10 && h > 0 ? "0" : "") + m + ":" + (rs < 10 ? "0" : "") + rs;
        },
        request: function (url, params, method = "GET") {
            return new Promise((resolve, reject) => {
                let query = url;
                let body = null;

                if (params && method === "GET") {
                    const qs = Object.keys(params).map(k => encodeURIComponent(k) + "=" + encodeURIComponent(params[k])).join("&");
                    query += (url.includes("?") ? "&" : "?") + qs;
                } else if (params && method === "POST") {
                    body = Object.keys(params).map(k => encodeURIComponent(k) + "=" + encodeURIComponent(params[k])).join("&");
                }

                const xhr = new XMLHttpRequest();
                xhr.open(method, query, true);
                xhr.timeout = 10000;
                if (method === "POST") xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
                
                xhr.onload = () => {
                    if (xhr.status === 200) {
                        try { resolve(JSON.parse(xhr.responseText)); } catch (e) { resolve(xhr.responseText); }
                    } else {
                        reject(new Error(`HTTP ${xhr.status}`));
                    }
                };
                xhr.onerror = () => reject(new Error("Network Error"));
                xhr.ontimeout = () => reject(new Error("Timeout"));
                xhr.send(body);
            });
        }
    };

    // --- 3. PROGRESS MANAGER ---
    const Progress = {
        _getDB: function() {
            try { return JSON.parse(localStorage.getItem(CONFIG.storageKey) || "{}"); } catch (e) { return {}; }
        },
        _saveDB: function(db) {
            try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(db)); } catch (e) { Utils.log("Save error", e); }
        },
        _key: function(card) {
            return String(card.imdb_id || card.kinopoisk_id || card.id || "unknown");
        },
        get: function (card) {
            return this._getDB()[this._key(card)] || null;
        },
        set: function (card, data) {
            const db = this._getDB();
            const key = this._key(card);
            db[key] = { ...(db[key] || {}), ...data, ts: Date.now() };
            this._saveDB(db);
        },
        remove: function (card) {
            const db = this._getDB();
            delete db[this._key(card)];
            this._saveDB(db);
        },
        clearAll: function () {
            try { localStorage.removeItem(CONFIG.storageKey); } catch (e) {}
        },
        isWatched: function (card) {
            const p = this.get(card);
            return p && p.ratio && p.ratio >= CONFIG.resumeThreshold;
        }
    };

    // --- 4. STREAM PROVIDERS ---
    const Providers = {
        fetchAll: async function (card) {
            const promises = [];
            
            // Kinobox
            const kbSources = Utils.getSetting("ov_pro_kb_sources", CONFIG.defaultSources.join(","));
            promises.push(this._fetchKinobox(card, kbSources));

            // Rezka
            const rezkaToken = Utils.getSetting("ov_pro_rezka_token", "");
            if (rezkaToken) promises.push(this._fetchRezka(card, rezkaToken));

            // KinopoiskHD
            const kpToken = Utils.getSetting("ov_pro_kp_token", "");
            if (kpToken) promises.push(this._fetchKinopoisk(card, kpToken));

            const results = await Promise.allSettled(promises);
            let streams = [];
            results.forEach(res => {
                if (res.status === "fulfilled" && Array.isArray(res.value)) {
                    streams = streams.concat(res.value);
                }
            });
            return streams;
        },
        _fetchKinobox: async function (card, sources) {
            try {
                const data = await Utils.request(CONFIG.api.kinobox, { imdb_id: card.imdb_id || "", kinopoisk: card.kinopoisk_id || "", sources: sources });
                if (!Array.isArray(data)) return [];
                return data.filter(i => i.iframeUrl || i.stream).map(i => ({
                    source: i.source || "KinoBox", quality: i.quality || "auto",
                    url: i.iframeUrl || i.stream, type: i.iframeUrl ? "iframe" : "hls",
                    translation: i.translation || "", subtitles: i.subtitles || []
                }));
            } catch (e) { Utils.log("Kinobox err:", e); return []; }
        },
        _fetchRezka: async function (card, token) {
            try {
                const data = await Utils.request(CONFIG.api.rezka, { id: card.rezka_id || card.id || "", token: token, imdb_id: card.imdb_id || "" }, "POST");
                const list = Array.isArray(data) ? data : (data.translations || []);
                return list.filter(tr => tr.url || tr.stream).map(tr => ({
                    source: "Rezka", quality: tr.quality || "1080p", url: tr.url || tr.stream, type: "hls",
                    translation: tr.name || tr.translator || "", subtitles: tr.subtitles || []
                }));
            } catch (e) { Utils.log("Rezka err:", e); return []; }
        },
        _fetchKinopoisk: async function (card, token) {
            try {
                const data = await Utils.request(CONFIG.api.kpHD, { kinopoisk_id: card.kinopoisk_id || "", token: token, imdb_id: card.imdb_id || "" });
                const list = Array.isArray(data) ? data : (data.results || []);
                return list.filter(i => i.stream || i.url).map(i => ({
                    source: "KinopoiskHD", quality: i.quality || "1080p", url: i.stream || i.url, type: "hls",
                    translation: i.translation || "", subtitles: i.subtitles || []
                }));
            } catch (e) { Utils.log("KP err:", e); return []; }
        }
    };

    // --- 5. PLAYER INTEGRATION ---
    const Player = {
        play: function (stream, card, subTrack) {
            if (!stream) return;
            const prog = Progress.get(card);
            const startFrom = (prog && prog.time && !Progress.isWatched(card)) ? prog.time : 0;

            if (startFrom > 10) Utils.notify("▶ Продовжуємо з " + Utils.formatTime(startFrom));

            const params = { url: stream.url, title: card.title || "Відео", card: card, startFrom: startFrom, subtitle: subTrack ? subTrack.url : null };

            if (stream.type === "iframe") {
                if (window.Lampa && Lampa.PlayerPanel && Lampa.PlayerPanel.open) Lampa.PlayerPanel.open(params);
                else window.open(stream.url, "_blank");
                return;
            }

            if (window.Lampa && Lampa.Player) {
                const listener = (e) => {
                    if (e.type === "timeupdate" && e.current && e.duration) {
                        Progress.set(card, { time: e.current, total: e.duration, ratio: e.current / e.duration });
                    }
                    if (e.type === "destroy" || e.type === "end") {
                        Lampa.Listener.remove("player", listener);
                        if (e.type === "end") { Progress.set(card, { ratio: 1.0, time: 0 }); Utils.notify("✓ Переглянуто", "success"); }
                    }
                };
                Lampa.Listener.follow("player", listener);
                Lampa.Player.play(params);
            }
        },
        pickAndPlay: function(streams, idx, card) {
            const stream = streams[idx];
            if (!stream) return;

            // Simple subtitle picker
            if (stream.subtitles && stream.subtitles.length > 0 && window.Lampa && Lampa.Select) {
                const items = [{ title: "Без субтитрів", url: null }].concat(
                    stream.subtitles.map(s => ({ title: s.label || s.lang || "Субтитри", url: s.url || s.src }))
                );
                Lampa.Select.show({
                    title: "Субтитри", items: items, onBack: () => {},
                    onSelect: (item) => this.play(stream, card, item.url ? item : null)
                });
            } else {
                this.play(stream, card, null);
            }
        }
    };

    // --- 6. UI COMPONENT ---
    function UIComponent(object) {
        this.card = object.card || object.data || {};
        this.$wrap = $('<div class="ov-pro-container" style="padding: 1.5em;"></div>');
        this.streams = [];

        this.create = function () {
            this.injectCSS();
            this.showLoading();
            Providers.fetchAll(this.card).then(streams => {
                this.streams = streams;
                this.renderContent();
            });
            return this.$wrap[0];
        };

        this.render = function () { return this.$wrap; }; // Lampa API requirement

        this.showLoading = function () {
            this.$wrap.html('<div style="text-align:center; padding:3em; color:#aaa;">⏳ Шукаємо найкращі джерела...</div>');
        };

        this.renderContent = function () {
            let html = '';
            
            // Progress Bar
            const prog = Progress.get(this.card);
            if (prog && prog.time > 10) {
                if (Progress.isWatched(this.card)) {
                    html += '<div style="background:#1a6b3c; color:#a8f0c6; padding:0.5em 1em; border-radius:0.5em; margin-bottom:1em; display:inline-block;">✓ Переглянуто повністю</div>';
                } else {
                    const pct = Math.round((prog.ratio || 0) * 100);
                    html += `
                        <div class="ov-resume-box" style="background:rgba(229,56,59,.15); border:1px solid #e5383b; padding:1em; border-radius:0.5em; margin-bottom:1em; display:flex; align-items:center; gap:1em;">
                            <div style="flex:1;">
                                <div style="color:#e5383b; font-weight:bold; font-size:0.9em; text-transform:uppercase;">Продовжити перегляд</div>
                                <div style="color:#ddd; font-size:0.85em; margin-top:0.3em;">Зупинились на ${Utils.formatTime(prog.time)}</div>
                                <div style="height:4px; background:#333; margin-top:0.5em; border-radius:2px; overflow:hidden;"><div style="width:${pct}%; height:100%; background:#e5383b;"></div></div>
                            </div>
                            <div class="ov-btn-clear selector" style="padding:0.5em; border:1px solid #666; border-radius:0.3em; cursor:pointer;">✕</div>
                        </div>`;
                }
            }

            // Streams List
            if (this.streams.length === 0) {
                html += '<div style="text-align:center; padding:3em; color:#666; font-size:1.1em;">😔 Потоків не знайдено.<br>Перевірте налаштування джерел або спробуйте інший фільм.</div>';
            } else {
                html += `<div style="color:#888; font-size:0.85em; text-transform:uppercase; margin-bottom:1em;">Знайдено джерел: ${this.streams.length}</div>`;
                html += '<div style="display:flex; flex-direction:column; gap:0.5em;">';
                
                this.streams.forEach((s, idx) => {
                    const hasSub = s.subtitles && s.subtitles.length > 0;
                    html += `
                        <div class="ov-stream-item selector" data-idx="${idx}" style="display:flex; align-items:center; background:rgba(255,255,255,0.05); padding:1em; border-radius:0.5em; gap:1em; transition:background 0.2s;">
                            <div style="color:#e5383b; font-size:1.2em;">▶</div>
                            <div style="flex:1;">
                                <div style="color:#fff; font-weight:bold;">${s.source} <span style="background:#444; color:#eee; font-size:0.7em; padding:0.1em 0.5em; border-radius:0.3em; margin-left:0.5em;">${s.quality}</span></div>
                                ${s.translation ? `<div style="color:#aaa; font-size:0.85em; margin-top:0.3em;">${s.translation}</div>` : ''}
                            </div>
                            ${hasSub ? '<div style="color:#60e0d0; font-size:0.8em; font-weight:bold; border:1px solid #60e0d0; padding:0.1em 0.4em; border-radius:0.3em;">SUB</div>' : ''}
                        </div>`;
                });
                html += '</div>';
            }

            this.$wrap.html(html);

            // Events
            this.$wrap.find('.ov-stream-item').on('hover:enter click', (e) => {
                const idx = parseInt($(e.currentTarget).data('idx'));
                Player.pickAndPlay(this.streams, idx, this.card);
            });

            this.$wrap.find('.ov-btn-clear').on('hover:enter click', (e) => {
                e.stopPropagation();
                Progress.remove(this.card);
                Utils.notify("Прогрес очищено");
                this.renderContent();
            });
        };

        this.injectCSS = function() {
            if ($('#ov-pro-styles').length) return;
            $('<style id="ov-pro-styles">.ov-stream-item.focus, .ov-stream-item:hover { background: rgba(229,56,59,0.2) !important; box-shadow: inset 0 0 0 1px #e5383b; } .ov-btn-clear.focus, .ov-btn-clear:hover { border-color: #e5383b !important; color: #e5383b; }</style>').appendTo('head');
        };

        this.start = () => {}; this.pause = () => {}; this.resume = () => {}; this.stop = () => {};
        this.destroy = () => { this.$wrap.remove(); };
    }

    // --- 7. LAMPA INTEGRATION ---
    function registerPlugin() {
        if (!window.Lampa) {
            setTimeout(registerPlugin, 500);
            return;
        }

        // Register UI Component
        if (Lampa.Component) {
            Lampa.Component.add(CONFIG.name.toLowerCase(), UIComponent);
        }

        // Robust Button Injection
        if (Lampa.Listener) {
            Lampa.Listener.follow("full", function (e) {
                if (e.type !== "complite") return;
                
                const card = e.object.card || e.object.data || {};
                const prog = Progress.get(card);
                let label = "🎬 " + CONFIG.title;
                if (prog && prog.time > 10 && !Progress.isWatched(card)) label = "▶ Продовжити (" + Utils.formatTime(prog.time) + ")";

                const $btn = $(`<div class="full-start__button selector" data-ov-pro="1"><div>${label}</div></div>`);
                $btn.on("hover:enter click", function () {
                    Lampa.Activity.push({ url: "", title: CONFIG.title, component: CONFIG.name.toLowerCase(), card: card, page: 1 });
                });

                // Method A: Official Lampa API
                if (e.object.append) {
                    e.object.append($btn);
                } 
                // Method B: Aggressive DOM Polling (Fallback for modified skins)
                else {
                    let attempts = 0;
                    const timer = setInterval(() => {
                        attempts++;
                        const $container = $('.full-start__buttons, .view--buttons, .info__buttons, .card-full__buttons').last();
                        if ($container.length) {
                            if (!$container.find('[data-ov-pro]').length) $container.append($btn);
                            clearInterval(timer);
                        }
                        if (attempts > 30) clearInterval(timer); // Stop after 15 seconds
                    }, 500);
                }
            });
        }

        // Settings API Registration
        if (Lampa.SettingsApi) {
            const addParam = (param, field, onChange) => {
                Lampa.SettingsApi.addParam({ component: "plugins", param, field, onChange });
            };

            addParam({ name: "ov_pro_header", type: "title" }, { name: "🎬 " + CONFIG.title });
            addParam({ name: "ov_pro_rezka_token", type: "input", default: "" }, { name: "Rezka API Token", description: "Токен для HDrezka (необов'язково)" });
            addParam({ name: "ov_pro_kp_token", type: "input", default: "" }, { name: "KinopoiskHD Token", description: "Токен KinopoiskHD (необов'язково)" });
            addParam({ name: "ov_pro_kb_sources", type: "input", default: CONFIG.defaultSources.join(",") }, { name: "Джерела KinoBox", description: "Через кому (kinobox, alloha, collaps...)" });
            addParam({ name: "ov_pro_clear_progress", type: "button" }, { name: "Очистити історію переглядів", description: "Скинути час для всіх фільмів" }, () => {
                Progress.clearAll();
                Utils.notify("Історію очищено ✓", "success");
            });
            // Fake card test button
            addParam({ name: "ov_pro_test", type: "button" }, { name: "🛠 Тестовий запуск", description: "Перевірка роботи плагіна (на прикладі 'Матриці')" }, () => {
                Lampa.Activity.push({ url: "", title: CONFIG.title, component: CONFIG.name.toLowerCase(), card: { id: 603, title: "Матриця", imdb_id: "tt0133093", kinopoisk_id: "301" }, page: 1 });
            });
        }

        Utils.notify(CONFIG.title + " v" + CONFIG.version + " завантажено", "success");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", registerPlugin);
    } else {
        registerPlugin();
    }
})();