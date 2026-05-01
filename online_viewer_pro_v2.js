(function() {
    'use strict';
    
    console.log('🎬 [Мій Плагін] Початок завантаження скрипта...');

    var balancers = [
        { id: 'ashdi', name: 'Ashdi (UaKino)' },
        { id: 'hdrezka', name: 'HDRezka' },
        { id: 'collaps', name: 'Collaps' },
        { id: 'videocdn', name: 'VideoCDN' },
        { id: 'filmix', name: 'Filmix' }
    ];

    Lampa.Listener.follow('full', function (e) {
        if (e.type == 'complite') {
            console.log('🎬 [Мій Плагін] Відкрито картку фільму. Спроба додати кнопку...');
            
            // Захист від дублювання кнопок при перемальовуванні інтерфейсу
            if(e.object.activity.render().find('.my-custom-online-btn').length > 0) {
                console.log('🎬 [Мій Плагін] Кнопка вже існує, пропускаємо.');
                return;
            }

            // Створюємо кнопку з унікальним класом .my-custom-online-btn
            var btn = $('<div class="full-item__button selector my-custom-online-btn"><span>🎬 Власний Онлайн</span></div>');
            
            btn.on('hover:enter', function () {
                console.log('🎬 [Мій Плагін] Кнопку натиснуто!');
                openBalancersMenu(e.data.movie);
            });

            // Шукаємо контейнер для кнопок. У різних версіях та темах Lampa він може називатися по-різному
            var buttons_container = e.object.activity.render().find('.info__buttons');
            
            if (buttons_container.length === 0) {
                buttons_container = e.object.activity.render().find('.view--buttons'); // Альтернативний клас
            }

            if (buttons_container.length > 0) {
                buttons_container.append(btn);
                console.log('🎬 [Мій Плагін] УСПІХ: Кнопку додано в інтерфейс!');
            } else {
                console.error('🎬 [Мій Плагін] ПОМИЛКА: Не знайдено місце (контейнер) для додавання кнопки!');
            }
        }
    });

    function openBalancersMenu(movie) {
        var items = [];
        balancers.forEach(function(balancer) {
            items.push({ title: balancer.name, balancer_id: balancer.id });
        });

        Lampa.Select.show({
            title: 'Оберіть джерело',
            items: items,
            onSelect: function (a) {
                Lampa.Noty.show('Тестовий запуск: ' + a.title);
            },
            onBack: function () {
                Lampa.Controller.toggle('full');
            }
        });
    }

    console.log('🎬 [Мій Плагін] Ініціалізацію завершено успішно!');
})();
