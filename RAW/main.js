document.addEventListener('DOMContentLoaded', () => {
    const body = document.body;
    const openBtn = document.getElementById('openMenu');
    const overlay = document.createElement('div');
    
    overlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; z-index:1500; display:none; background:rgba(0,0,0,0.02); backdrop-filter:blur(2px);";
    document.body.appendChild(overlay);

    function toggleMenu() {
        body.classList.toggle('sidebar-open');
        overlay.style.display = body.classList.contains('sidebar-open') ? 'block' : 'none';
    }

    if(openBtn) openBtn.addEventListener('click', toggleMenu);
    overlay.addEventListener('click', toggleMenu);
});