'use strict';

// Per-participant viewing controls. These only transform the local video
// element, so zooming never changes the transmitted stream or bitrate.
function clampScreenSharePan(scale, x, y, width, height) {
    const maxX = Math.max(0, width * (scale - 1) / 2);
    const maxY = Math.max(0, height * (scale - 1) / 2);
    return {
        x: Math.max(-maxX, Math.min(maxX, x)),
        y: Math.max(-maxY, Math.min(maxY, y)),
    };
}

/**
 * @param {HTMLVideoElement} media
 * @param {HTMLElement} container
 */
function enableScreenShareZoom(media, container) {
    if(container.querySelector('.share-zoom-controls'))
        return;

    container.classList.add('peer-screen-share');
    const state = {scale: 1, x: 0, y: 0, drag: null};
    const toolbar = document.createElement('div');
    toolbar.className = 'share-zoom-controls';
    toolbar.setAttribute('role', 'group');
    toolbar.setAttribute('aria-label', 'Screen share zoom');

    function button(icon, title, callback) {
        const elt = document.createElement('button');
        elt.type = 'button';
        elt.title = title;
        elt.setAttribute('aria-label', title);
        const glyph = document.createElement('i');
        glyph.className = 'fas ' + icon;
        glyph.setAttribute('aria-hidden', 'true');
        elt.appendChild(glyph);
        elt.addEventListener('click', e => {
            e.preventDefault();
            callback();
        });
        toolbar.appendChild(elt);
        return elt;
    }

    const zoomOut = button('fa-minus', 'Zoom out', () =>
        changeScale(state.scale - 0.25));
    const percent = document.createElement('output');
    percent.className = 'share-zoom-percent';
    percent.setAttribute('aria-live', 'polite');
    toolbar.appendChild(percent);
    const zoomIn = button('fa-plus', 'Zoom in', () =>
        changeScale(state.scale + 0.25));
    const reset = button('fa-undo', 'Reset zoom', () => changeScale(1));

    function render() {
        const pan = clampScreenSharePan(
            state.scale, state.x, state.y, media.offsetWidth, media.offsetHeight);
        state.x = pan.x;
        state.y = pan.y;
        media.style.transform = 'translate(' + state.x + 'px, ' +
            state.y + 'px) scale(' + state.scale + ')';
        media.style.transformOrigin = 'center center';
        media.style.cursor = state.scale > 1 ? 'grab' : '';
        media.style.touchAction = state.scale > 1 ? 'none' : '';
        percent.textContent = Math.round(state.scale * 100) + '%';
        zoomOut.disabled = state.scale <= 0.5;
        zoomIn.disabled = state.scale >= 4;
        reset.disabled = state.scale === 1 && state.x === 0 && state.y === 0;
    }

    function changeScale(value) {
        state.scale = Math.max(0.5, Math.min(4, Math.round(value * 4) / 4));
        if(state.scale <= 1) {
            state.x = 0;
            state.y = 0;
        }
        render();
    }

    media.addEventListener('pointerdown', e => {
        if(state.scale <= 1 || e.button !== 0)
            return;
        e.preventDefault();
        state.drag = {id: e.pointerId, clientX: e.clientX, clientY: e.clientY,
                      x: state.x, y: state.y};
        media.style.cursor = 'grabbing';
        if(media.setPointerCapture)
            media.setPointerCapture(e.pointerId);
    });
    media.addEventListener('pointermove', e => {
        const drag = state.drag;
        if(!drag || drag.id !== e.pointerId)
            return;
        state.x = drag.x + e.clientX - drag.clientX;
        state.y = drag.y + e.clientY - drag.clientY;
        render();
        media.style.cursor = 'grabbing';
    });
    function stopDrag(e) {
        if(!state.drag || state.drag.id !== e.pointerId)
            return;
        state.drag = null;
        media.style.cursor = state.scale > 1 ? 'grab' : '';
        if(media.hasPointerCapture && media.hasPointerCapture(e.pointerId))
            media.releasePointerCapture(e.pointerId);
    }
    media.addEventListener('pointerup', stopDrag);
    media.addEventListener('pointercancel', stopDrag);
    media.addEventListener('wheel', e => {
        if(!e.ctrlKey)
            return;
        e.preventDefault();
        changeScale(state.scale + (e.deltaY < 0 ? 0.25 : -0.25));
    }, {passive: false});

    container.appendChild(toolbar);
    render();
}
