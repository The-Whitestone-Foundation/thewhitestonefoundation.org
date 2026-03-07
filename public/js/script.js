const body = document.body;
        document.getElementById('openMenu').addEventListener('click', () => body.classList.add('sidebar-open'));
        document.getElementById('sidebar-overlay').addEventListener('click', () => body.classList.remove('sidebar-open'));
        document.querySelectorAll('.dropdown-trigger').forEach(trigger => {
            trigger.addEventListener('click', function() {
                const menu = this.nextElementSibling;
                menu.style.display = menu.style.display === "block" ? "none" : "block";
                this.querySelector('i').classList.toggle('fa-chevron-up');
            });
        });