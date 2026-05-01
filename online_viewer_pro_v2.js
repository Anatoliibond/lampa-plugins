/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║          LAMPA PLUGIN — Custom Balancers PRO                 ║
 * ║          Версія: 3.0.0 (Custom Edition)                      ║
 * ║          Балансери: Ashdi, Rezka, Collaps, VideoCDN, Filmix  ║
 * ║          Функції: озвучення · субтитри · resume              ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

(function () {
    "use strict";

    // ═══════════════════════════════════════════════════════════
    //  КОНФІГУРАЦІЯ
    // ═══════════════════════════════════════════════════════════

    var PLUGIN_NAME    = "CustomBalancersPro";
    var PLUGIN_TITLE   = "🎬 Власний Онлайн PRO";
    var PLUGIN_VERSION = "3.0.0";
    var STORAGE_KEY    = "cb_pro_progress";   
    var RESUME_THRESHOLD = 0.92;              

    var API = {
        // Kinobox використовуємо як проксі для Collaps та VideoCDN
        kinobox:   "https://kinobox.tv/api/players",
        rezka:     "https://hdrezka.ag/engine/ajax/getEmbedPlayer.php"
        // Ashdi та Filmix будуть братися з налаштувань Lampa
    };

    var PROXY_SOURCES = ["collaps", "videocdn"];

    // ═══════════════════════════════════════════════════════════
    //  УТИЛІТИ
    // ═══════════════════════════════════════════════════════════

    function log() {
        var a = Array.prototype.slice.call(arguments);
        a.unshift("[" + PLUGIN_NAME + "]");
        console.log.apply(console, a);
    }

    function notify(msg, type) {
        if (window.Lampa && Lampa.Noty) Lampa.Noty.show(msg, { type: type || "info" });
    }

    function getSetting(key, def) {
        try {
            return Lampa.Storage.get(key, def);
        } catch (e) {
            return def;
        }
    }

    function xhr(url, params, callback, method) {
        if (!url) { callback(new Error("Empty URL")); return; }
        
        var query = url;
        method = method || "GET";
        var body = null;

        if (params && method === "GET") {
            var qs = Object.keys(params)
                .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); })
                .join("&");
            query += (url.indexOf("?") === -1 ? "?" : "&") + qs;
        } else if (params && method === "POST") {
            body = Object.keys(params)
                .map(function (k) { return encodeURIComponent(k) + "=" + encodeURIComponent(params[k]); })
                .join("&");
        }

        var req = new XMLHttpRequest();
        req.open(method, query, true);
        req.timeout = 10000;
        if (method === "POST") req.setRequestHeader("Content-Type", "application/x-www-form-urlencoded");
        req.onload = function () {
            if (req.status === 200) {
                try   { callback(null, JSON.parse(req.responseText)); }
                catch (e) { callback(null, req.responseText); }
            } else {
                callback(new Error("HTTP " + req.status));
            }
        };
        req.onerror   = function () { callback(new Error("Network error")); };
        req.ontimeout = function () { callback(new Error("Timeout")); };
        req.send(body);
    }

    // ═══════════════════════════════════════════════════════════
    //  МОДУЛЬ ПРОГРЕСУ (resume)
    // ═══════════════════════════════════════════════════════════

    var Progress = {
        _db: null,
        _load: function () {
            if (this._db) return this._db;
            try { this._db = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"); } 
            catch (e) { this._db = {}; }
            return this._db;
        },
        _save: function () {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._db)); } 
            catch (e) { log("Progress save error:", e); }
        },
        key: function (card) {
            return (card.imdb_id || card.kinopoisk_id || card.id || card.title || "unknown") + "";
        },
        get: function (card) {
            var db = this._load();
            return db[this.key(card)] || null;
        },
        set: function (card, data) {
            var db = this._load();
            var k  = this.key(card);
            db[k]  = Object.assign(db[k] || {}, data, { ts: Date.now() });
            this._save();
        },
        remove: function (card) {
            var db = this._load();
            delete db[this.key(card)];
            this._save();
        },
        clearAll: function () {
            this._db = {};
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
        },
        isWatched: function (card) {
            var p = this.get(card);
            return p && p.ratio && p.ratio >= RESUME_THRESHOLD;
        },
        formatTime: function (sec) {
            if (!sec || isNaN(sec)) return "";
            sec = Math.floor(sec);
            var h = Math.floor(sec / 3600);
            var m = Math.floor((sec % 3600) / 60);
            var s = sec % 60;
            if (h > 0) return h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
            return m + ":" + (s < 10 ? "0" : "") + s;
        }
    };

    // ═══════════════════════════════════════════════════════════
    //  МОДУЛЬ ДЖЕРЕЛ
    // ═══════════════════════════════════════════════════════════

    var Sources = {
        fetch: function (card, callback) {
            var all     = [];
            var pending = 0;
            var done    = false;

            function finish() {
                if (done) return;
                pending--;
                if (pending <= 0) { done = true; callback(all); }
            }
            function add(streams) { Array.prototype.push.apply(all, streams); }

            // 1. Collaps та VideoCDN (через публічний проксі)
            pending++;
            this._fetchProxySources(card, function (s) { add(s); finish(); });

            // 2. HDRezka (якщо є токен)
            var rezkaToken = getSetting("cb_pro_rezka_token", "");
            if (rezkaToken) {
                pending++;
                this._fetchRezka(card, rezkaToken, function (s) { add(s); finish(); });
            }

            // 3. Ashdi (Власний API)
            var ashdiApi = getSetting("cb_pro_ashdi_api", "");
            if (ashdiApi) {
                pending++;
                this._fetchCustom(card, "Ashdi (UaKino)", ashdiApi, function (s) { add(s); finish(); });
            }

            // 4. Filmix (Власний API)
            var filmixApi = getSetting("cb_pro_filmix_api", "");
            if (filmixApi) {
                pending++;
                this._fetchCustom(card, "Filmix", filmixApi, function (s) { add(s); finish(); });
            }

            if (pending === 0) { done = true; callback([]); }
        },

        _fetchProxySources: function (card, callback) {
            var params = {
                imdb_id:   card.imdb_id        || "",
                kinopoisk: card.kinopoisk_id   || "",
                sources:   PROXY_SOURCES.join(",")
            };

            xhr(API.kinobox, params, function (err, data) {
                var streams = [];
                if (!err && Array.isArray(data)) {
                    data.forEach(function (item) {
                        if (!item.iframeUrl && !item.stream) return;
                        
                        // Робимо красиві назви для Collaps та VideoCDN
                        var sourceName = item.source.charAt(0).toUpperCase() + item.source.slice(1);
                        if (item.source === 'videocdn') sourceName = "VideoCDN";
                        
                        streams.push({
                            source:       sourceName,
                            quality:      item.quality     || "1080p",
                            url:          item.iframeUrl   || item.stream,
                            type:         item.iframeUrl   ? "iframe" : "hls",
                            translation:  item.translation || "",
                            subtitles:    item.subtitles   || [],
                            seasons:      item.seasons     || null
                        });
                    });
                }
                callback(streams);
            });
        },

        _fetchRezka: function (card, token, callback) {
            var params = { id: card.rezka_id || card.id || "", token: token, imdb_id: card.imdb_id || "" };
            xhr(API.rezka, params, function (err, data) {
                var streams = [];
                if (!err && data) {
                    var list = Array.isArray(data) ? data : (data.translations || []);
                    list.forEach(function (tr) {
                        if (!tr.url && !tr.stream) return;
                        streams.push({
                            source:      "HDRezka",
                            quality:     tr.quality    || "1080p",
                            url:         tr.url        || tr.stream,
                            type:        "hls",
                            translation: tr.name       || tr.translator || "",
                            subtitles:   tr.subtitles  || [],
                            seasons:     tr.seasons    || null
                        });
                    });
                }
                callback(streams);
            }, "POST");
        },

        // Універсальна функція для ваших власних бекендів Ashdi та Filmix
        _fetchCustom: function (card, sourceName, apiUrl, callback) {
            var params = { tmdb_id: card.id, type: card.type || "movie" };
            xhr(apiUrl, params, function (err, data) {
                var streams = [];
                if (!err && Array.isArray(data)) {
                    data.forEach(function (item) {
                        if (!item.url) return;
                        streams.push({
                            source:      sourceName,
                            quality:     item.quality || "1080p",
                            url:         item.url,
                            type:        "hls",
                            translation: item.translation || "Оригінал",
                            subtitles:   item.subtitles || []
                        });
                    });
                }
                callback(streams);
            });
        }
    };

    // ═══════════════════════════════════════════════════════════
    //  МОДУЛЬ ВИБОРУ ОЗВУЧЕННЯ / СУБТИТРІВ
    // ═══════════════════════════════════════════════════════════

    var TranslationPicker = {
        open: function (streams, currentIdx, onSelect) {
            var translations = [];
            streams.forEach(function (s, idx) {
                if (s.translation) translations.push({ label: s.translation, idx: idx, source: s.source });
            });

            if (translations.length === 0 && streams.length === 1) {
                onSelect(streams[0], null); return;
            }

            if (window.Lampa && Lampa.Select) {
                var items = translations.map(function (t) {
                    return { title: t.label + " [" + t.source + "]", idx: t.idx };
                });

                streams.forEach(function (s, idx) {
                    if (!s.translation) items.push({ title: s.source + " (" + (s.quality || "auto") + ")", idx: idx });
                });

                Lampa.Select.show({
                    title:   "Оберіть озвучення",
                    items:   items,
                    onBack:  function () { Lampa.Controller.toggle("full"); },
                    onSelect: function (item) {
                        var chosen = streams[item.idx];
                        if (!chosen) return;
                        if (chosen.subtitles && chosen.subtitles.length > 0) {
                            TranslationPicker._pickSubtitle(chosen.subtitles, function (sub) { onSelect(chosen, sub); });
                        } else {
                            onSelect(chosen, null);
                        }
                    }
                });
            } else {
                onSelect(streams[currentIdx] || streams[0], null);
            }
        },
        _pickSubtitle: function (subtitles, onSelect) {
            if (!subtitles || subtitles.length === 0) { onSelect(null); return; }
            var items = [{ title: "Без субтитрів", url: null }].concat(
                subtitles.map(function (s) { return { title: s.label || s.lang || s.language || "Субтитри", url: s.url || s.src || "" }; })
            );
            if (window.Lampa && Lampa.Select) {
                Lampa.Select.show({
                    title: "Субтитри", items: items, onBack: function () {},
                    onSelect: function (item) { onSelect(item.url ? item : null); }
                });
            } else { onSelect(null); }
        }
    };

    // ═══════════════════════════════════════════════════════════
    //  ПЛЕЄР
    // ═══════════════════════════════════════════════════════════

    var PlayerWrapper = {
        play: function (stream, card, subtitleTrack) {
            if (!stream) return;
            var progressData = Progress.get(card);
            var startFrom    = (progressData && progressData.time && !Progress.isWatched(card)) ? progressData.time : 0;

            if (startFrom > 10) notify("▶ Продовжуємо з " + Progress.formatTime(startFrom), "info");

            var playParams = {
                url:       stream.url,
                title:     card.title || card.name || "Перегляд",
                card:      card,
                startFrom: startFrom,
                subtitle:  subtitleTrack ? subtitleTrack.url : null
            };

            if (stream.type === "iframe") {
                if (window.Lampa && Lampa.PlayerPanel && Lampa.PlayerPanel.open) Lampa.PlayerPanel.open(playParams);
                else window.open(stream.url, "_blank");
                return;
            }

            if (!window.Lampa || !Lampa.Player) return;

            Lampa.Listener.follow("player", function handler(e) {
                if (e.type === "timeupdate" && e.current && e.duration) {
                    Progress.set(card, { time: e.current, total: e.duration, ratio: e.current / e.duration, title: card.title || card.name || "" });
                }
                if (e.type === "destroy" || e.type === "end") {
                    Lampa.Listener.remove("player", handler);
                    if (e.type === "end") {
                        Progress.set(card, { ratio: 1.0, time: 0 });
                        notify("✓ Фільм переглянуто", "success");
                    }
                }
            });
            Lampa.Player.play(playParams);
        }
    };

    // ═══════════════════════════════════════════════════════════
    //  CSS
    // ═══════════════════════════════════════════════════════════

    var STYLES = "\
.ov-wrap { padding: 1.2em; }\
.ov-loading { display: flex; align-items: center; gap: .8em; color: #aaa; font-size: .95em; padding: 2em 0; }\
.ov-spinner { width: 1.4em; height: 1.4em; border: 3px solid #333; border-top-color: #e5383b; border-radius: 50%; animation: ov-spin .7s linear infinite; flex-shrink:0; }\
@keyframes ov-spin { to { transform: rotate(360deg); } }\
.ov-empty { text-align: center; padding: 3em 1em; color: #666; }\
.ov-empty-icon { font-size: 2.5em; margin-bottom: .4em; }\
.ov-resume-bar { display: flex; align-items: center; gap: .7em; background: rgba(229,56,59,.12); border: 1px solid rgba(229,56,59,.35); border-radius: .5em; padding: .65em 1em; margin-bottom: .9em; }\
.ov-resume-icon { font-size: 1.3em; flex-shrink:0; }\
.ov-resume-info { flex: 1; }\
.ov-resume-label { font-size: .8em; color: #e5383b; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; }\
.ov-resume-time { font-size: .9em; color: #eee; margin-top: .15em; }\
.ov-progress-bar { height: 3px; background: #333; border-radius: 2px; margin-top: .4em; overflow: hidden; }\
.ov-progress-fill { height: 100%; background: #e5383b; border-radius: 2px; transition: width .3s; }\
.ov-resume-clear { font-size: .75em; color: #888; cursor: pointer; flex-shrink:0; padding: .2em .5em; border: 1px solid #444; border-radius: .3em; }\
.ov-resume-clear:hover { color: #e5383b; border-color: #e5383b; }\
.ov-watched-badge { display: inline-block; background: #1a6b3c; color: #a8f0c6; font-size: .72em; padding: .1em .6em; border-radius: .25em; font-weight: 700; margin-bottom: .9em; }\
.ov-section-title { font-size: .75em; color: #666; text-transform: uppercase; letter-spacing: .08em; margin-bottom: .5em; }\
.ov-list { display: flex; flex-direction: column; gap: .5em; }\
.ov-item { display: flex; align-items: center; gap: 1em; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.08); border-radius: .5em; padding: .7em 1em; cursor: pointer; transition: background .15s, border-color .15s; }\
.ov-item:hover, .ov-item.focus { background: rgba(229,56,59,.15); border-color: #e5383b; }\
.ov-item-icon { font-size: 1.2em; color: #e5383b; flex-shrink:0; }\
.ov-item-info { flex: 1; min-width: 0; }\
.ov-item-source { font-weight: 600; font-size: .95em; color: #eee; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }\
.ov-item-badges { display: flex; gap: .35em; margin-top: .2em; flex-wrap: wrap; }\
.ov-badge { font-size: .7em; padding: .1em .5em; border-radius: .25em; font-weight: 700; letter-spacing: .04em; }\
.ov-badge--1080p,.ov-badge--1080 { background:#1a6b3c;color:#a8f0c6; }\
.ov-badge--720p,.ov-badge--720   { background:#1a4b6b;color:#a8d8f0; }\
.ov-badge--4k,.ov-badge--2160    { background:#6b1a6b;color:#f0a8f0; }\
.ov-badge--auto                  { background:#444;color:#ccc; }\
.ov-badge--trans                 { background:#3b3b00;color:#f0d060; }\
.ov-badge--sub                   { background:#003b3b;color:#60e0d0; }\
.ov-item-right { display:flex;flex-direction:column;align-items:flex-end;gap:.3em;flex-shrink:0; }\
.ov-item-play { color:#e5383b;font-size:.82em;font-weight:600; }\
.ov-item-sub-icon { font-size:.75em;color:#60e0d0; }\
";

    // ═══════════════════════════════════════════════════════════
    //  КОМПОНЕНТ LAMPA
    // ═══════════════════════════════════════════════════════════

    function OnlineViewerProComponent(object) {
        var self    = this;
        var streams = [];
        var card    = object.card || object.data || {};
        var $wrap;

        self.create = function () {
            injectStyles();
            $wrap = $('<div class="ov-scroll-wrap"></div>');
            self._showLoading();
            self._loadStreams();
            return $wrap[0];
        };

        self._showLoading = function () {
            $wrap.html('<div class="ov-wrap"><div class="ov-loading"><div class="ov-spinner"></div><span>Шукаємо на ваших балансерах…</span></div></div>');
        };

        self._loadStreams = function () {
            Sources.fetch(card, function (found) { streams = found; self._render(); });
        };

        self._render = function () {
            var html = '<div class="ov-wrap">';
            var prog = Progress.get(card);
            
            if (prog) {
                if (Progress.isWatched(card)) html += '<div class="ov-watched-badge">✓ Переглянуто</div>';
                else if (prog.time > 10) {
                    var pct = Math.round((prog.ratio || 0) * 100);
                    html += '<div class="ov-resume-bar" id="ov-resume-bar"><div class="ov-resume-icon">⏯</div><div class="ov-resume-info"><div class="ov-resume-label">Продовжити перегляд</div><div class="ov-resume-time">Зупинились на ' + Progress.formatTime(prog.time) + (prog.total ? " з " + Progress.formatTime(prog.total) : "") + '</div><div class="ov-progress-bar"><div class="ov-progress-fill" style="width:' + pct + '%"></div></div></div><div class="ov-resume-clear selector" id="ov-clear-progress" title="Скинути">✕</div></div>';
                }
            }

            if (!streams || streams.length === 0) {
                html += '<div class="ov-empty"><div class="ov-empty-icon">📡</div><div>Потоки не знайдено.<br>Перевірте налаштування API для балансерів.</div></div>';
            } else {
                html += '<div class="ov-section-title">Доступні джерела (' + streams.length + ')</div><div class="ov-list">';
                streams.forEach(function (s, idx) {
                    var qCls   = (s.quality || "auto").toLowerCase().replace(/[^a-z0-9]/g, "");
                    var qBadge = '<span class="ov-badge ov-badge--' + qCls + '">' + (s.quality || "auto") + '</span>';
                    var trBadge = s.translation ? '<span class="ov-badge ov-badge--trans">' + s.translation + '</span>' : "";
                    var subBadge = (s.subtitles && s.subtitles.length) ? '<span class="ov-badge ov-badge--sub">SUB ' + s.subtitles.length + '</span>' : "";
                    var subIcon = (s.subtitles && s.subtitles.length) ? '<div class="ov-item-sub-icon">CC</div>' : "";
                    html += '<div class="ov-item selector" data-idx="' + idx + '"><div class="ov-item-icon">▶</div><div class="ov-item-info"><div class="ov-item-source">' + (s.source || "Невідомо") + '</div><div class="ov-item-badges">' + qBadge + trBadge + subBadge + '</div></div><div class="ov-item-right">' + subIcon + '<div class="ov-item-play">Дивитись</div></div></div>';
                });
                html += '</div>';
            }

            html += '</div>';
            $wrap.html(html);

            $wrap.find(".ov-item").on("click", function () {
                var idx = parseInt($(this).data("idx"), 10);
                if (!isNaN(idx)) self._handlePlay(idx);
            });

            $wrap.find("#ov-clear-progress").on("click", function (e) {
                e.stopPropagation();
                Progress.remove(card);
                notify("Прогрес скинуто", "info");
                self._render();
            });
        };

        self._handlePlay = function (idx) {
            TranslationPicker.open(streams, idx, function (chosenStream, subtitleTrack) {
                PlayerWrapper.play(chosenStream, card, subtitleTrack);
            });
        };

        self.start = self.pause = self.resume = self.stop = function () {};
        self.destroy = function () { if ($wrap) $wrap.remove(); };
    }

    var _stylesInjected = false;
    function injectStyles() {
        if (_stylesInjected) return;
        _stylesInjected = true;
        var el = document.createElement("style");
        el.textContent = STYLES;
        document.head.appendChild(el);
    }

    // ═══════════════════════════════════════════════════════════
    //  РЕЄСТРАЦІЯ
    // ═══════════════════════════════════════════════════════════

    function register() {
        if (!window.Lampa) { setTimeout(register, 500); return; }

        if (Lampa.Component) Lampa.Component.add(PLUGIN_NAME.toLowerCase(), OnlineViewerProComponent);

        if (Lampa.Listener) {
            Lampa.Listener.follow("full", function (event) {
                if (event.type !== "complite") return;

                var card      = event.object.card || event.object.data || {};
                var prog      = Progress.get(card);
                var btnLabel  = PLUGIN_TITLE;

                if (prog && !Progress.isWatched(card) && prog.time > 10) {
                    btnLabel = "▶ Продовжити (" + Progress.formatTime(prog.time) + ")";
                } else if (Progress.isWatched(card)) {
                    btnLabel = "✓ Переглянуто — " + PLUGIN_TITLE;
                }

                var $btn = $(
                    '<div class="full-start__button selector" data-ov-pro="1" style="display:flex;align-items:center;gap:.4em">' +
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>' +
                    '<span>' + btnLabel + '</span>' +
                    '</div>'
                );

                $btn.on("click", function () {
                    if (Lampa.Activity) {
                        Lampa.Activity.push({
                            url:       "",
                            title:     PLUGIN_TITLE,
                            component: PLUGIN_NAME.toLowerCase(),
                            card:      card,
                            page:      1
                        });
                    }
                });

                var $render  = event.object.activity ? $(event.object.activity.render()) : $("body");
                var $actions = $render.find(".full-start__buttons, .actions-list");
                if ($actions.length) {
                    $actions.find("[data-ov-pro]").remove();
                    $actions.append($btn);
                }
            });
        }

        // ── Налаштування Lampa ─────────────────────────────────────
        if (Lampa.SettingsApi) {
            Lampa.SettingsApi.addParam({
                component: "main",
                param: { name: "cb_pro_header", type: "title" },
                field: { name: PLUGIN_TITLE }
            });

            Lampa.SettingsApi.addParam({
                component: "main",
                param: { name: "cb_pro_rezka_token", type: "input", default: "" },
                field: { name: "Rezka API Token", description: "Токен для доступу до HDRezka" }
            });

            Lampa.SettingsApi.addParam({
                component: "main",
                param: { name: "cb_pro_ashdi_api", type: "input", default: "" },
                field: { name: "Ashdi (UaKino) API URL", description: "Посилання на ваш бекенд для Ashdi" }
            });

            Lampa.SettingsApi.addParam({
                component: "main",
                param: { name: "cb_pro_filmix_api", type: "input", default: "" },
                field: { name: "Filmix API URL", description: "Посилання на ваш бекенд для Filmix" }
            });

            Lampa.SettingsApi.addParam({
                component: "main",
                param: { name: "cb_pro_clear_progress", type: "button" },
                field: { name: "Очистити прогрес перегляду", description: "Видалити збережені позиції" },
                onChange: function () {
                    Progress.clearAll();
                    notify("Прогрес перегляду очищено ✓", "success");
                }
            });
        }

        log("Plugin v" + PLUGIN_VERSION + " loaded");
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", register);
    } else {
        register();
    }

})();
