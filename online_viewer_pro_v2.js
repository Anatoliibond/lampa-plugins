(function() {
    'use strict';

    // Дані нашого кастомного плагіна
    var CustomOnlinePlugin = {
        name: 'My Custom Balancers',
        version: '1.0.0',
        description: 'Агрегатор баз: Ashdi, HDRezka, Collaps, VideoCDN, Filmix'
    };

    // Перелік наших джерел (балансерів)
    var balancers = [
        { id: 'ashdi', name: 'Ashdi (UaKino)' },
        { id: 'hdrezka', name: 'HDRezka' },
        { id: 'collaps', name: 'Collaps' },
        { id: 'videocdn', name: 'VideoCDN' },
        { id: 'filmix', name: 'Filmix' }
    ];

    // Відстежуємо відкриття повної картки фільму/серіалу
    Lampa.Listener.follow('full', function (e) {
        if (e.type == 'complite') {
            
            // Створюємо кнопку "Власний Онлайн"
            var btn = $('<div class="full-item__button selector"><span>🎬 Власний Онлайн</span></div>');
            
            // Логіка при натисканні на кнопку
            btn.on('hover:enter', function () {
                var movieData = e.data; // Дані про фільм (TMDB ID, назва, рік)
                openBalancersMenu(movieData.movie);
            });

            // Додаємо кнопку в інтерфейс після кнопки "Трейлер" або "Торренти"
            e.object.activity.render().find('.info__buttons').append(btn);
        }
    });

    // Функція відкриття меню з вибором балансера
    function openBalancersMenu(movie) {
        var items = [];

        // Формуємо список кнопок для кожного балансера
        balancers.forEach(function(balancer) {
            items.push({
                title: balancer.name,
                balancer_id: balancer.id
            });
        });

        // Викликаємо стандартне меню вибору Lampa
        Lampa.Select.show({
            title: 'Оберіть джерело для: ' + (movie.title || movie.name),
            items: items,
            onSelect: function (a) {
                // Тут має бути запит до вашого сервера або API балансера
                fetchVideoFromAPI(a.balancer_id, movie);
            },
            onBack: function () {
                Lampa.Controller.toggle('full');
            }
        });
    }

    // Імітація запиту до API балансера
    function fetchVideoFromAPI(balancerId, movie) {
        Lampa.Noty.show('Шукаємо ' + (movie.title || movie.name) + ' на ' + balancerId + '...');

        /* ТУТ МАЄ БУТИ ВАШ РОБОЧИЙ ФЕТЧ ЗАПИТ (FETCH/AJAX)
        Приклад логіки:
        1. Відправляємо TMDB ID та тип (movie/tv) на ваш сервер.
        2. Сервер опитує Ashdi/Rezka/Collaps.
        3. Сервер повертає пряме посилання на .m3u8 файл.
        4. Передаємо це посилання у вбудований плеєр Lampa.
        */

        // Демонстрація запуску плеєра з тестовим відео (заглушка)
        setTimeout(function() {
            var testVideoUrl = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"; // Тестовий стрім
            
            var video = {
                title: movie.title || movie.name,
                url: testVideoUrl
            };

            var playlist = [video];

            Lampa.Player.play(video);
            Lampa.Player.playlist(playlist);
        }, 1000);
    }

    // Реєстрація плагіна в системі Lampa
    Lampa.Manifest.plugins = Lampa.Manifest.plugins || [];
    Lampa.Manifest.plugins.push(CustomOnlinePlugin);

    console.log('Plugin Custom Balancers initialized');

})();
