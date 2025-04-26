/* Attach click handlers that load a new HTML file */
document.querySelectorAll('.banner button').forEach(btn => {
    btn.addEventListener('click', e => {
        window.location.href = e.currentTarget.dataset.target;
    });
});