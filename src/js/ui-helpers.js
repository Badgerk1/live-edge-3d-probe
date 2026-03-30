function _panelStorageKey(panelId) {
    return 'edgeProbePanel.' + panelId;
}

function _shouldPersistControl(el) {
    return el.dataset.noPersist !== '1';
}

function _getControlPersistValue(el) {
    return localStorage.getItem(_panelStorageKey(el.id));
}

function _setControlPersistValue(el, val) {
    localStorage.setItem(_panelStorageKey(el.id), val);
}

function savePanelSettings(panelElOrId) {
    const panelEl = typeof panelElOrId === 'string' ? document.getElementById(panelElOrId) : panelElOrId;
    const controls = panelEl.querySelectorAll('[data-persist]');
    controls.forEach(el => {
        if (_shouldPersistControl(el)) {
            _setControlPersistValue(el, el.value);
        }
    });
}

function loadPanelSettings(panelElOrId) {
    const panelEl = typeof panelElOrId === 'string' ? document.getElementById(panelElOrId) : panelElOrId;
    const controls = panelEl.querySelectorAll('[data-persist]');
    controls.forEach(el => {
        if (_shouldPersistControl(el)) {
            const value = _getControlPersistValue(el);
            if (value !== null) {
                el.value = value;
            }
        }
    });
}

function clearPanelSettings(panelElOrId) {
    const panelEl = typeof panelElOrId === 'string' ? document.getElementById(panelElOrId) : panelElOrId;
    const controls = panelEl.querySelectorAll('[data-persist]');
    controls.forEach(el => {
        if (_shouldPersistControl(el)) {
            localStorage.removeItem(_panelStorageKey(el.id));
        }
    });
}