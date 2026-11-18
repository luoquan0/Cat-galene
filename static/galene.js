// Copyright (c) 2020 by Juliusz Chroboczek.

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
// THE SOFTWARE.

'use strict';

/**
 * The name of the group that we join.
 *
 * @type {string}
 */
let group;

/**
 * The connection to the server.
 *
 * @type {ServerConnection}
 */
let serverConnection;

/**
 * The group status.  This is set twice, once over HTTP in the start
 * function in order to obtain the WebSocket address, and a second time
 * after joining.
 *
 * @type {Record<string,any>}
 */
let groupStatus = {};

/**
 * True if we need to request a password.
 *
 * @type {boolean}
 */
let pwAuth = false;

/**
 * The token we use to login.  This is erased as soon as possible.
 *
 * @type {string}
 */
let token = null;

/**
 * The state of the login automaton.
 *
 * @type {"probing" | "need-username" | "success"}
 */
let probingState = null;

// A server-issued, room-scoped bearer token; never persist the password.
const rememberedLoginPrefix = 'cat-meet:remember:';
const rememberedLoginMaxAge = 7 * 24 * 60 * 60 * 1000;
let pendingRememberedLogin = null;
let triedRememberedLogin = false;

function rememberedLoginKey() {
    return rememberedLoginPrefix + encodeURIComponent(group);
}

function forgetRememberedLogin() {
    try {
        localStorage.removeItem(rememberedLoginKey());
    } catch(e) {
        // Private browsing and disabled storage must not block room login.
    }
}

function readRememberedLogin() {
    try {
        const item = JSON.parse(localStorage.getItem(rememberedLoginKey()) || 'null');
        if(!item || item.group !== group || !item.username ||
           typeof item.token !== 'string' || item.token.length < 32 ||
           !Number.isFinite(item.expires) || Date.now() >= item.expires ||
           item.expires - Date.now() > rememberedLoginMaxAge + 60000)
            return null;
        return item;
    } catch(e) {
        return null;
    }
}

function gotRememberedLogin(groupName, username, bearer, expires) {
    if(groupName !== group || !serverConnection ||
       typeof username !== 'string' || typeof bearer !== 'string' ||
       bearer.length < 32)
        return;
    const expiry = Date.parse(expires);
    if(!Number.isFinite(expiry) || expiry <= Date.now() ||
       expiry > Date.now() + rememberedLoginMaxAge + 60000)
        return;
    try {
        localStorage.setItem(rememberedLoginKey(), JSON.stringify({
            group: groupName, username, token: bearer, expires: expiry,
        }));
    } catch(e) {
        // Successful logins still work when browser storage is unavailable.
    }
}


/**
 * getElementById, then assert that the result is an HTMLSelectElement.
 *
 * @param {string} id
 */
function getSelectElement(id) {
    let elt = document.getElementById(id);
    if(!elt || !(elt instanceof HTMLSelectElement))
        throw new Error(`Couldn't find ${id}`);
    return elt;
}

/**
 * getElementById, then assert that the result is an HTMLInputElement.
 *
 * @param {string} id
 */
function getInputElement(id) {
    let elt = document.getElementById(id);
    if(!elt || !(elt instanceof HTMLInputElement))
        throw new Error(`Couldn't find ${id}`);
    return elt;
}

/**
 * getElementById, then assert that the result is an HTMLButtonElement.
 *
 * @param {string} id
 */
function getButtonElement(id) {
    let elt = document.getElementById(id);
    if(!elt || !(elt instanceof HTMLButtonElement))
        throw new Error(`Couldn't find ${id}`);
    return elt;
}

/**
 * Ensure that the UI reflects the stored settings.
 */
function reflectSettings() {
    let settings = getSettings();
    let store = false;

    setLocalMute(settings.localMute);

    let videoselect = getSelectElement('videoselect');
    if(!settings.hasOwnProperty('video') ||
       !selectOptionAvailable(videoselect, settings.video)) {
        settings.video = selectOptionDefault(videoselect);
        store = true;
    }
    videoselect.value = settings.video;

    let audioselect = getSelectElement('audioselect');
    if(!settings.hasOwnProperty('audio') ||
       !selectOptionAvailable(audioselect, settings.audio)) {
        settings.audio = selectOptionDefault(audioselect);
        store = true;
    }
    audioselect.value = settings.audio;

    if(settings.hasOwnProperty('filter')) {
        getSelectElement('filterselect').value = settings.filter;
    } else {
        let s = getSelectElement('filterselect').value;
        if(s) {
            settings.filter = s;
            store = true;
        }
    }

    if(settings.hasOwnProperty('request')) {
        getSelectElement('requestselect').value = settings.request;
    } else {
        settings.request = getSelectElement('requestselect').value;
        store = true;
    }

    if(settings.hasOwnProperty('send')) {
        getSelectElement('sendselect').value = settings.send;
    } else {
        settings.send = getSelectElement('sendselect').value;
        store = true;
    }

    // Drop the obsolete video/text mode, keeping all custom share settings.
    if(settings.hasOwnProperty('screenShareMode')) {
        delete settings.screenShareMode;
        store = true;
    }

    const shareSelects = [
        ['screenresselect', 'screenShareResolution'],
        ['screenfpsselect', 'screenShareFPS'],
        ['screenbitrateselect', 'screenShareBitrate'],
    ];
    for(const [id, key] of shareSelects) {
        const select = getSelectElement(id);
        if(!settings.hasOwnProperty(key) ||
           !selectOptionAvailable(select, settings[key])) {
            settings[key] = select.value;
            store = true;
        }
        select.value = settings[key];
    }
    const shareNumbers = [
        ['screenwidth', 'screenShareWidth'],
        ['screenheight', 'screenShareHeight'],
        ['screenfps', 'screenShareCustomFPS'],
        ['screenbitrate', 'screenShareCustomBitrate'],
    ];
    for(const [id, key] of shareNumbers) {
        const input = getInputElement(id);
        if(typeof settings[key] !== 'number' || !Number.isFinite(settings[key]) ||
           settings[key] < Number(input.min) || settings[key] > Number(input.max)) {
            settings[key] = Number(input.value);
            store = true;
        }
        input.value = String(settings[key]);
    }
    reflectScreenShareCustomFields();

    if(settings.hasOwnProperty('simulcast')) {
        getSelectElement('simulcastselect').value = settings.simulcast
    } else {
        settings.simulcast = getSelectElement('simulcastselect').value;
        store = true;
    }

    if(settings.hasOwnProperty('blackboardMode')) {
        getInputElement('blackboardbox').checked = settings.blackboardMode;
    } else {
        settings.blackboardMode = getInputElement('blackboardbox').checked;
        store = true;
    }

    if(settings.hasOwnProperty('mirrorView')) {
        getInputElement('mirrorbox').checked = settings.mirrorView;
    } else {
        settings.mirrorView = getInputElement('mirrorbox').checked;
        store = true;
    }

    if(settings.hasOwnProperty('activityDetection')) {
        getInputElement('activitybox').checked = settings.activityDetection;
    } else {
        settings.activityDetection = getInputElement('activitybox').checked;
        store = true;
    }

    if(settings.hasOwnProperty('displayAll')) {
        getInputElement('displayallbox').checked = settings.displayAll;
    } else {
        settings.displayAll = getInputElement('displayallbox').checked;
        store = true;
    }

    if(settings.hasOwnProperty('preprocessing')) {
        getInputElement('preprocessingbox').checked = settings.preprocessing;
    } else {
        settings.preprocessing = getInputElement('preprocessingbox').checked;
        store = true;
    }

    if(settings.hasOwnProperty('hqaudio')) {
        getInputElement('hqaudiobox').checked = settings.hqaudio;
    } else {
        settings.hqaudio = getInputElement('hqaudiobox').checked;
        store = true;
    }

    if(store)
        storeSettings(settings);
}

/**
 * Returns true if we should use the mobile layout.  This should be kept
 * in sync with the CSS.
 */
function isMobileLayout() {
    return !!window.matchMedia('only screen and (max-width: 1024px)').matches
}

/**
 * Conditionally hide the video pane.  If force is true, hide it even if
 * there are videos.
 *
 * @param {boolean} [force]
 */
function hideVideo(force) {
    let mediadiv = document.getElementById('peers');
    if(mediadiv.childElementCount > 0 && !force)
        return;
    setVisibility('video-container', false);
    scheduleReconsiderDownRate();
}

/**
 * Show the video pane.
 */
function showVideo() {
    let hasmedia = document.getElementById('peers').childElementCount > 0;
    if(isMobileLayout()) {
        setVisibility('show-video', false);
        setVisibility('collapse-video', hasmedia);
    }
    setVisibility('video-container', hasmedia);
    scheduleReconsiderDownRate();
}

/**
 * Returns true if we are running on Safari.
 */
function isSafari() {
    let ua = navigator.userAgent.toLowerCase();
    return ua.indexOf('safari') >= 0 && ua.indexOf('chrome') < 0;
}

/**
 * Returns true if we are running on Firefox.
 */
function isFirefox() {
    let ua = navigator.userAgent.toLowerCase();
    return ua.indexOf('firefox') >= 0;
}

/**
 * setConnected is called whenever we connect or disconnect to the server.
 *
 * @param{boolean} connected
 */
function setConnected(connected) {
    let userbox = document.getElementById('profile');
    let connectionbox = document.getElementById('login-container');
    if(connected) {
        clearChat();
        let testCamera =  /** @type{HTMLDetailsElement} */
            (document.getElementById('test-camera'));
        // this causes the camera test to stop running
        testCamera.open = false;
        userbox.classList.remove('invisible');
        connectionbox.classList.add('invisible');
        displayUsername();
        window.onresize = function(e) {
            scheduleReconsiderDownRate();
        }
    } else {
        userbox.classList.add('invisible');
        connectionbox.classList.remove('invisible');
        hideVideo();
        window.onresize = null;
    }
}

/**
 * Called when we connect to the server.
 *
 * @this {ServerConnection}
 */
async function gotConnected() {
    setConnected(true);
    await join();
}

/**
 * Sets the href field of the "change password" link.
 *
 * @param {string} username
 */
function setChangePassword(username) {
    let s = document.getElementById('chpwspan');
    let a = s.children[0];
    if(!(a instanceof HTMLAnchorElement))
        throw new Error('Bad type for chpwspan');
    if(username) {
        a.href = `/change-password.html?group=${encodeURIComponent(group)}&username=${encodeURIComponent(username)}`;
        a.target = '_blank';
        s.classList.remove('invisible');
    } else {
        a.href = null;
        s.classList.add('invisible');
    }
}

/**
 * Join a group.
 */
async function join() {
    let username = getInputElement('username').value.trim();
    let credentials;
    if(pendingRememberedLogin) {
        // A remembered login is a server-issued, seven-day room credential.
        // Never use an invitation URL token to bypass the login form.
        username = pendingRememberedLogin.username;
        credentials = {
            type: 'token',
            token: pendingRememberedLogin.token,
        };
        pwAuth = false;
        triedRememberedLogin = true;
        pendingRememberedLogin = null;
    } else if(token) {
        pwAuth = false;
        credentials = {
            type: 'token',
            token: token,
        };
        switch(probingState) {
        case null:
            // when logging in with a token, we need to give the user
            // a chance to interact with the page in order to enable
            // autoplay.  Probe the group first in order to determine if
            // we need a username.  We should really extend the protocol
            // to have a simpler protocol for probing.
            probingState = 'probing';
            username = null;
            break;
        case 'need-username':
        case 'success':
            probingState = null;
            break
        default:
            console.warn(`Unexpected probing state ${probingState}`);
            probingState = null;
            break;
        }
    } else {
        if(probingState !== null) {
            console.warn(`Unexpected probing state ${probingState}`);
            probingState = null;
        }
        let pw = getInputElement('password').value;
        getInputElement('password').value = '';
        if(!groupStatus.authServer) {
            pwAuth = true;
            credentials = {
                type: 'password',
                password: pw,
                remember: getInputElement('remember-login').checked,
            };
        } else {
            pwAuth = false;
            credentials = {
                type: 'authServer',
                authServer: groupStatus.authServer,
                location: location.href,
                password: pw,
            };
        }
    }

    try {
        await serverConnection.join(group, username, credentials);
    } catch(e) {
        console.error(e);
        displayError(e);
        serverConnection.close();
    }
}

/**
 * @this {ServerConnection}
 */
function onPeerConnection() {
    if(!getSettings().forceRelay)
        return null;
    let old = this.rtcConfiguration;
    /** @type {RTCConfiguration} */
    let conf = {};
    for(let key in old)
        conf[key] = old[key];
    conf.iceTransportPolicy = 'relay';
    return conf;
}

/**
 * @this {ServerConnection}
 * @param {number} code
 * @param {string} reason
 */
function gotClose(code, reason) {
    cancelAudioRecovery();
    closeUpMedia();
    setConnected(false);
    if(code !== 1000) {
        console.warn('Socket close', code, reason);
    }
    let form = document.getElementById('loginform');
    if(!(form instanceof HTMLFormElement))
        throw new Error('Bad type for loginform');
}

/**
 * @this {ServerConnection}
 * @param {Stream} c
 */
function gotDownStream(c) {
    c.onclose = function(replace) {
        if(!replace)
            delMedia(c.localId);
    };
    c.onerror = function(e) {
        console.error(e);
        displayError(e);
    };
    c.ondowntrack = function(track, transceiver, stream) {
        setMedia(c);
    };
    c.onnegotiationcompleted = function() {
        resetMedia(c);
    }
    c.onstatus = function(status) {
        setMediaStatus(c);
    };
    c.onstats = gotDownStats;
    if(getSettings().activityDetection && c.label !== 'screenshare')
        c.setStatsInterval(activityDetectionInterval);

    setMedia(c);
}

// Store current browser viewport height in css variable
function setViewportHeight() {
    document.documentElement.style.setProperty(
        '--vh', `${window.innerHeight/100}px`,
    );
    if (!getVisibility('left')) {
        showVideo();
    }
    // Ajust video component size
    resizePeers();
}

// On resize and orientation change, we update viewport height
addEventListener('resize', setViewportHeight);
addEventListener('orientationchange', setViewportHeight);

getButtonElement('presentbutton').onclick = async function(e) {
    e.preventDefault();
    let button = this;
    if(!(button instanceof HTMLButtonElement))
        throw new Error('Unexpected type for this.');
    // there's a potential race condition here: the user might click the
    // button a second time before the stream is set up and the button hidden.
    button.disabled = true;
    try {
        let id = findUpMedia('camera');
        if(!id) {
            if(!getSettings().audio && !getSettings().video) {
                // The generic Enable button deliberately starts both devices.
                // The adjacent camera/microphone controls remain independent.
                updateSettings({audio: 'default', video: 'default', localMute: false});
                reflectSettings();
            }
            await addLocalMedia();
        }
    } finally {
        button.disabled = false;
    }
};

getButtonElement('unpresentbutton').onclick = function(e) {
    e.preventDefault();
    cancelAudioRecovery();
    closeUpMedia('camera');
    // Prevent a later click on one device from silently reopening the other.
    updateSettings({audio: '', video: '', localMute: true});
    reflectSettings();
    updateCameraButton();
    setButtonsVisibility();
    resizePeers();
};

/**
 * @param {string} id
 * @param {boolean} visible
 */
function setVisibility(id, visible) {
    let elt = document.getElementById(id);
    if(visible)
        elt.classList.remove('invisible');
    else
        elt.classList.add('invisible');
}

/**
 * getVisibility tells whether specified element is visible.
 *
 * @param {string} id
 */
function getVisibility(id) {
    let elt = document.getElementById(id);
    return !elt.classList.contains('invisible');
}

/**
 * Shows and hides various UI elements depending on the protocol state.
 */
function setButtonsVisibility() {
    let connected = serverConnection && serverConnection.socket;
    let permissions = serverConnection.permissions;
    let canWebrtc = !(typeof RTCPeerConnection === 'undefined');
    let canPresent = canWebrtc &&
        ('mediaDevices' in navigator) &&
        ('getUserMedia' in navigator.mediaDevices) &&
        permissions.indexOf('present') >= 0;
    let canShare = canWebrtc &&
        ('mediaDevices' in navigator) &&
        ('getDisplayMedia' in navigator.mediaDevices) &&
        permissions.indexOf('present') >= 0;
    let local = !!findUpMedia('camera');
    let mediacount = document.getElementById('peers').childElementCount;
    let mobilelayout = isMobileLayout();

    // don't allow multiple presentations
    setVisibility('camerabutton', canPresent);
    setVisibility('presentbutton', canPresent && !local);
    setVisibility('unpresentbutton', local);

    setVisibility('mutebutton', !connected || canPresent);

    // allow multiple shared documents
    setVisibility('sharebutton', canShare);

    setVisibility('mediaoptions', canPresent);
    setVisibility('sendform', canPresent);
    setVisibility('simulcastform', canPresent);

    setVisibility('collapse-video', mediacount && mobilelayout);
}

/**
 * Sets the local mute state.  If reflect is true, updates the stored settings.
 *
 * @param {boolean} mute
 * @param {boolean} [reflect]
 */
function setLocalMute(mute, reflect) {
    muteLocalTracks(mute);
    let button = document.getElementById('mutebutton');
    let icon = button.querySelector("span .fas");
    if(mute){
        icon.classList.add('fa-microphone-slash');
        icon.classList.remove('fa-microphone');
        button.classList.add('muted');
    } else {
        icon.classList.remove('fa-microphone-slash');
        icon.classList.add('fa-microphone');
        button.classList.remove('muted');
    }
    if(reflect)
        updateSettings({localMute: mute});
}


// Keep device menus current when mobile cameras are attached, removed or
// become available after the browser grants permission.
if(navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', async () => {
        try {
            if(!cameraTest)
                return;
            await cameraTest.setMediaChoices();
            cameraTest.reflectSettings();
        } catch(e) {
            console.warn('Could not refresh camera devices', e);
        }
    });
}

getSelectElement('videoselect').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({video: this.value});
    if(serverConnection?.permissions?.includes('present'))
        addLocalMedia(findUpMedia('camera')?.localId);
    updateCameraButton();
};

getSelectElement('audioselect').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({audio: this.value});
    if(!this.value)
        cancelAudioRecovery();
    if(serverConnection?.permissions?.includes('present'))
        addLocalMedia(findUpMedia('camera')?.localId);
};

getInputElement('mirrorbox').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({mirrorView: this.checked});
    // no need to reopen the camera
    replaceUpStreams('camera');
};

getInputElement('blackboardbox').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({blackboardMode: this.checked});
    replaceCameraStream();
};

getInputElement('preprocessingbox').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({preprocessing: this.checked});
    replaceCameraStream();
};

getInputElement('hqaudiobox').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({hqaudio: this.checked});
    replaceCameraStream();
};

document.getElementById('mutebutton').onclick = async function(e) {
    e.preventDefault();
    if(!serverConnection?.permissions?.includes('present')) {
        displayMessage('Connect to a meeting before enabling your microphone');
        return;
    }
    let c = findUpMedia('camera');
    let audio = c?.stream?.getAudioTracks().find(t => t.readyState === 'live');
    if(audio && !audio.muted) {
        setLocalMute(!getSettings().localMute, true);
        return;
    }
    if(audio && audio.muted) {
        setLocalMute(false, true);
        await addLocalMedia(c?.localId, true);
        return;
    }
    // Device enumeration is not guaranteed until after the permission prompt.
    // "default" requests the browser's preferred microphone without a device ID.
    if(!getSettings().audio) {
        updateSettings({audio: 'default'});
        getSelectElement('audioselect').value = 'default';
    }
    setLocalMute(false, true);
    await addLocalMedia(c?.localId, true);
};

function updateCameraButton() {
    const button = document.getElementById('camerabutton');
    if(!button) return;
    const stream = findUpMedia('camera')?.stream;
    const enabled = !!stream?.getVideoTracks().some(t => t.readyState === 'live');
    button.classList.toggle('muted', !enabled);
    button.querySelector('i').className = enabled ? 'fas fa-video' : 'fas fa-video-slash';
    button.setAttribute('aria-pressed', String(enabled));
}

document.getElementById('camerabutton').onclick = async function(e) {
    e.preventDefault();
    if(!serverConnection?.permissions?.includes('present')) return;
    const c = findUpMedia('camera');
    const enabled = !!c?.stream?.getVideoTracks().some(t => t.readyState === 'live');
    const select = getSelectElement('videoselect');
    updateSettings({video: enabled ? '' : (getSettings().video || 'default')});
    select.value = getSettings().video;
    await addLocalMedia(c?.localId);
    updateCameraButton();
};

// Keep the camera control accessible without introducing a native button's
// default padding, borders and line-height into the existing toolbar.
document.getElementById('camerabutton').addEventListener('keydown', e => {
    if(e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.currentTarget.click();
    }
});

document.getElementById('sharebutton').onclick = function(e) {
    e.preventDefault();
    addShareMedia();
};

getSelectElement('filterselect').onchange = async function(e) {
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({filter: this.value});
    let c = findUpMedia('camera');
    if(c) {
        let filter = (this.value && filters[this.value]) || null;
        if(filter)
            c.userdata.filterDefinition = filter;
        else
            delete c.userdata.filterDefinition;
        replaceUpStream(c);
    }
};

/**
 * Returns the desired max video throughput depending on the settings.
 * Screen sharing gets a larger budget to preserve movement and text detail.
 *
 * @param {string} [label]
 * @returns {number}
 */
/**
 * Build capture constraints and the independent screen-share video bitrate.
 * These are preferred targets, not guarantees about the browser's output.
 *
 * @param {settings} settings
 */
function getScreenShareProfile(settings) {
    const sizes = {
        '1k': [1024, 576],
        '720p': [1280, 720],
        '1080p': [1920, 1080],
        '2k': [2560, 1440],
        '4k': [3840, 2160],
    };
    function bounded(value, fallback, min, max) {
        const n = Number(value);
        return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
    }

    const selected = settings.screenShareResolution || 'native';
    let size = sizes[selected] || null;
    if(selected === 'custom') {
        const width = bounded(settings.screenShareWidth, 1920, 320, 7680);
        const height = bounded(settings.screenShareHeight, 1080, 180, 4320);
        size = [Math.round(width / 2) * 2, Math.round(height / 2) * 2];
    }

    // The FPS dropdown is the only frame-rate control. The default is 30.
    let fps = 30;
    if(settings.screenShareFPS === 'custom')
        fps = Math.round(bounded(settings.screenShareCustomFPS, fps, 1, 120));
    else if(['15', '24', '30', '60', '90', '120'].includes(settings.screenShareFPS))
        fps = Number(settings.screenShareFPS);

    const video = {frameRate: {ideal: fps, max: fps}};
    if(size) {
        video.width = {ideal: size[0], max: size[0]};
        video.height = {ideal: size[1], max: size[1]};
    }

    // Native capture has unknown dimensions before the user picks a screen.
    // Use a 1440p estimate so the default is not capped at 2.1 Mbps.
    const estimatedPixels = size ? size[0] * size[1] : 2560 * 1440;
    const automaticMbps = Math.max(4, Math.min(100,
        Math.ceil(12 * (estimatedPixels / (1920 * 1080)) * (fps / 30))));
    let bitrateMbps = automaticMbps;
    if(settings.screenShareBitrate === 'custom')
        bitrateMbps = bounded(settings.screenShareCustomBitrate, automaticMbps, 0.5, 100);
    else if(['4', '8', '12', '20', '35', '50'].includes(settings.screenShareBitrate))
        bitrateMbps = Number(settings.screenShareBitrate);

    return {
        video: video,
        bitrate: Math.round(bitrateMbps * 1000000),
        contentHint: 'text',
    };
}

function getMaxVideoThroughput(label) {
    if(label === 'screenshare')
        return getScreenShareProfile(getSettings()).bitrate;
    let v = getSettings().send;
    let bps;
    switch(v) {
    case 'lowest':
        bps = 150000;
        break;
    case 'low':
        bps = 300000;
        break;
    case 'normal':
        bps = 700000;
        break;
    case 'unlimited':
        return null;
    default:
        console.error('Unknown video quality', v);
        bps = 700000;
    }
    return bps;
}

getSelectElement('sendselect').onchange = async function(e) {
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({send: this.value});
    await reconsiderSendParameters();
};

/** Show custom fields without changing the existing sidebar layout. */
function reflectScreenShareCustomFields() {
    setVisibility('screencustomsize',
        getSelectElement('screenresselect').value === 'custom');
    setVisibility('screencustomfps',
        getSelectElement('screenfpsselect').value === 'custom');
    setVisibility('screencustombitrate',
        getSelectElement('screenbitrateselect').value === 'custom');
}

for(const [id, key] of [
    ['screenresselect', 'screenShareResolution'],
    ['screenfpsselect', 'screenShareFPS'],
    ['screenbitrateselect', 'screenShareBitrate'],
]) {
    getSelectElement(id).onchange = function(e) {
        e.preventDefault();
        updateSetting(key, this.value);
        reflectScreenShareCustomFields();
        if(key === 'screenShareBitrate' && serverConnection?.up)
            reconsiderSendParameters().catch(displayError);
    };
}

for(const [id, key] of [
    ['screenwidth', 'screenShareWidth'],
    ['screenheight', 'screenShareHeight'],
    ['screenfps', 'screenShareCustomFPS'],
    ['screenbitrate', 'screenShareCustomBitrate'],
]) {
    getInputElement(id).onchange = function(e) {
        e.preventDefault();
        if(!this.checkValidity() || !this.value) {
            this.reportValidity();
            return;
        }
        updateSetting(key, Number(this.value));
        if(key === 'screenShareCustomBitrate' && serverConnection?.up)
            reconsiderSendParameters().catch(displayError);
    };
}

getSelectElement('simulcastselect').onchange = async function(e) {
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({simulcast: this.value});
    await reconsiderSendParameters();
};

/**
 * Maps the state of the receive UI element to a protocol request.
 *
 * @param {string} what
 * @returns {Record<string,Array<string>>}
 */

function mapRequest(what) {
    switch(what) {
    case '':
        return {'': []};
    case 'audio':
        return {'': ['audio']};
    case 'screenshare':
        return {screenshare: ['audio','video'], '': ['audio']};
    case 'everything-low':
        return {'': ['audio','video-low']};
    case 'everything':
        return {'': ['audio','video']}
    default:
        throw new Error(`Unknown value ${what} in request`);
    }
}

/**
 * Like mapRequest, but for a single label.
 *
 * @param {string} what
 * @param {string} label
 * @returns {Array<string>}
 */

function mapRequestLabel(what, label) {
    let r = mapRequest(what);
    if(label in r)
        return r[label];
    else
        return r[''];
}


getSelectElement('requestselect').onchange = function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    updateSettings({request: this.value});
    serverConnection.request(mapRequest(this.value));
    reconsiderDownRate();
};

// getStats on every downstream PeerConnection is expensive at 5Hz,
// especially during 4K sharing and while participants add microphones.
const activityDetectionInterval = 1000;
const activityDetectionPeriod = 2000;
const activityDetectionThreshold = 0.2;

getInputElement('activitybox').onchange = function(e) {
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({activityDetection: this.checked});
    for(let id in serverConnection.down) {
        let c = serverConnection.down[id];
        if(this.checked && c.label !== 'screenshare')
            c.setStatsInterval(activityDetectionInterval);
        else {
            c.setStatsInterval(0);
            setActive(c, false);
        }
    }
};

getInputElement('displayallbox').onchange = function(e) {
    if(!(this instanceof HTMLInputElement))
        throw new Error('Unexpected type for this');
    updateSettings({displayAll: this.checked});
    for(let id in serverConnection.down) {
        let c = serverConnection.down[id];
        let elt = document.getElementById('peer-' + c.localId);
        showHideMedia(c, elt);
    }
};


/**
 * Summarise actual outbound encoder stats for the local screen-share panel.
 * These metrics can differ substantially from the requested capture profile.
 *
 * @param {Record<string,any>} stats
 * @returns {string}
 */
function formatScreenShareStats(stats) {
    let video = null;
    for(const entry of Object.values(stats)) {
        const candidate = entry && entry['outbound-rtp'];
        if(candidate && candidate.kind === 'video' &&
           (!video || (candidate.rate || 0) > (video.rate || 0)))
            video = candidate;
    }
    if(!video)
        return 'Waiting for encoder statistics';

    const info = [];
    if(Number.isFinite(video.frameWidth) && video.frameWidth > 0 &&
       Number.isFinite(video.frameHeight) && video.frameHeight > 0)
        info.push(Math.round(video.frameWidth) + ' × ' +
                  Math.round(video.frameHeight));
    if(Number.isFinite(video.framesPerSecond) && video.framesPerSecond >= 0)
        info.push(Math.round(video.framesPerSecond) + ' FPS');
    if(Number.isFinite(video.rate) && video.rate >= 0)
        info.push((video.rate / 1000000).toFixed(1) + ' Mbps');

    const limitation = {
        cpu: 'CPU limit',
        bandwidth: 'Network limit',
        other: 'Encoding limit',
    }[video.qualityLimitationReason];
    if(limitation) {
        const translate = window.CatMeetI18n?.translate;
        info.push(translate ? translate(limitation) : limitation);
    }
    return info.length ? info.join(' · ') : 'Waiting for encoder statistics';
}

/**
 * @this {Stream}
 * @param {Record<string,any>} stats
 */
function gotUpStats(stats) {
    let c = this;

    if(c.label === 'screenshare') {
        const status = document.getElementById('screen-share-stats');
        if(status)
            status.textContent = formatScreenShareStats(stats);
    }

    let values = [];

    for(let id in stats) {
        if(stats[id] && stats[id]['outbound-rtp']) {
            let rate = stats[id]['outbound-rtp'].rate;
            if(typeof rate === 'number') {
                values.push(rate);
            }
        }
    }

    if(values.length === 0) {
        setUpLabel(c, '');
    } else {
        values.sort((x,y) => x - y);
        setUpLabel(c, values
                 .map(x => Math.round(x / 1000).toString())
                 .reduce((x, y) => x + '+' + y));
    }
}

/**
 * @param {Stream} c
 * @param {boolean} value
 */
function setActive(c, value) {
    let peer = document.getElementById('peer-' + c.localId);
    if(value)
        peer.classList.add('peer-active');
    else
        peer.classList.remove('peer-active');

    let user = document.getElementById('user-' + c.source);
    if(user) {
        if(value)
            user.classList.add('user-status-active');
        else
            user.classList.remove('user-status-active');
    }
}

/**
 * @this {Stream}
 * @param {Record<string,any>} stats
 */
function gotDownStats(stats) {
    if(!getInputElement('activitybox').checked)
        return;

    let c = this;

    let maxEnergy = 0;

    c.pc.getReceivers().forEach(r => {
        let tid = r.track && r.track.id;
        let s = tid && stats[tid];
        let energy = s && s['inbound-rtp'] && s['inbound-rtp'].audioEnergy;
        if(typeof energy === 'number')
            maxEnergy = Math.max(maxEnergy, energy);
    });

    // totalAudioEnergy is defined as the integral of the square of the
    // volume, so square the threshold.
    if(maxEnergy > activityDetectionThreshold * activityDetectionThreshold) {
        c.userdata.lastVoiceActivity = Date.now();
        setActive(c, true);
    } else {
        let last = c.userdata.lastVoiceActivity;
        if(!last || Date.now() - last > activityDetectionPeriod)
            setActive(c, false);
    }
}

/**
 * Add an option to an HTMLSelectElement.
 *
 * @param {HTMLSelectElement} select
 * @param {string} label
 * @param {string} [value]
 */
function addSelectOption(select, label, value) {
    if(!value)
        value = label;
    for(let i = 0; i < select.children.length; i++) {
        let child = select.children[i];
        if(!(child instanceof HTMLOptionElement)) {
            console.warn('Unexpected select child');
            continue;
        }
        if(child.value === value) {
            if(child.label !== label) {
                child.label = label;
            }
            return;
        }
    }

    let option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
}

/**
 * Returns true if an HTMLSelectElement has an option with a given value.
 *
 * @param {HTMLSelectElement} select
 * @param {string} value
 */
function selectOptionAvailable(select, value) {
    let children = select.children;
    for(let i = 0; i < children.length; i++) {
        let child = select.children[i];
        if(!(child instanceof HTMLOptionElement)) {
            console.warn('Unexpected select child');
            continue;
        }
        if(child.value === value)
            return true;
    }
    return false;
}

/**
 * @param {HTMLSelectElement} select
 * @returns {string}
 */
function selectOptionDefault(select) {
    /* First non-empty option. */
    for(let i = 0; i < select.children.length; i++) {
        let child = select.children[i];
        if(!(child instanceof HTMLOptionElement)) {
            console.warn('Unexpected select child');
            continue;
        }
        if(child.value)
            return child.value;
    }
    /* The empty option is always available. */
    return '';
}

/**
  * True if we already went through setMediaChoices twice.
  *
  * @type {boolean}
  */
let mediaChoicesDone = false;

/**
 * Populate the media choices menu.
 *
 * Since media names might not be available before we call
 * getDisplayMedia, we call this function twice, the second time in order
 * to update the menu with user-readable labels.
 *
 * @param{boolean} done
 */
async function setMediaChoices(done) {
    if(mediaChoicesDone)
        return;

    let devices = [];
    try {
        if('mediaDevices' in navigator)
            devices = await navigator.mediaDevices.enumerateDevices();
    } catch(e) {
        console.error(e);
        return;
    }

    let cn = 1, mn = 1;

    devices.forEach(d => {
        let label = d.label;
        if(d.kind === 'videoinput') {
            if(!label)
                label = `Camera ${cn}`;
            addSelectOption(getSelectElement('videoselect'),
                            label, d.deviceId);
            cn++;
        } else if(d.kind === 'audioinput') {
            if(!label)
                label = `Microphone ${mn}`;
            addSelectOption(getSelectElement('audioselect'),
                            label, d.deviceId);
            mn++;
        }
    });

    mediaChoicesDone = done;
}


/**
 * @param {string} [localId]
 */
function newUpStream(localId) {
    if(!serverConnection)
        throw new Error("Not connected");
    let c = serverConnection.newUpStream(localId);
    c.onstatus = function(status) {
        setMediaStatus(c);
    };
    c.onerror = function(e) {
        console.error(e);
        displayError(e);
    };
    return c;
}

/**
 * Sets an up stream's video throughput and simulcast parameters.
 *
 * @param {Stream} c
 * @param {number} bps
 * @param {boolean} simulcast
 */
async function setSendParameters(c, bps, simulcast) {
    if(!c.up)
        throw new Error('Setting throughput of down stream');
    if(c.label === 'screenshare')
        simulcast = false;
    let senders = c.pc.getSenders();
    for(let i = 0; i < senders.length; i++) {
        let s = senders[i];
        if(!s.track || s.track.kind !== 'video')
            continue;
        let p = s.getParameters();
        if((!p.encodings ||
            !simulcast && p.encodings.length !== 1) ||
           (simulcast && p.encodings.length !== 2)) {
            await replaceUpStream(c);
            return;
        }
        p.encodings.forEach(e => {
            if(!e.rid || e.rid === 'h')
                e.maxBitrate = bps || unlimitedRate;
        });
        await s.setParameters(p);
    }
}

let reconsiderParametersTimer = null;

/**
 * Sets the send parameters for all up streams.
 */
async function reconsiderSendParameters() {
    cancelReconsiderParameters();
    let s = doSimulcast();
    let promises = [];
    // Joining users or toggling microphones must not rebuild an active 4K
    // screen-share encoder or camera PeerConnection.
    if(findUpMedia('screenshare'))
        return;
    for(let id in serverConnection.up) {
        let c = serverConnection.up[id];
        if(c.label === 'screenshare')
            continue;
        promises.push(setSendParameters(
            c, getMaxVideoThroughput(c.label), s,
        ));
    }
    await Promise.all(promises);
}

/**
 * Schedules a call to reconsiderSendParameters after a delay.
 * The delay avoids excessive flapping.
 */
function scheduleReconsiderParameters() {
    cancelReconsiderParameters();
    reconsiderParametersTimer =
        setTimeout(reconsiderSendParameters, 10000 + Math.random() * 10000);
}

function cancelReconsiderParameters() {
    if(reconsiderParametersTimer) {
        clearTimeout(reconsiderParametersTimer);
        reconsiderParametersTimer = null;
    }
}

const unlimitedRate = 1000000000;
const simulcastRate = 100000;
const hqAudioRate = 128000;

/**
 * Decide whether we want to send simulcast.
 *
 * @returns {boolean}
 */
function doSimulcast() {
    switch(getSettings().simulcast) {
    case 'on':
        return true;
    case 'off':
        return false;
    default:
        let count = 0;
        for(let n in serverConnection.users) {
            if(!serverConnection.users[n].permissions.includes('system')) {
                count++;
                if(count > 2)
                    break;
            }
        }
        if(count <= 2)
            return false;
        let bps = getMaxVideoThroughput();
        return bps <= 0 || bps >= 2 * simulcastRate;
    }
}

/**
 * Prefer readable screen-share text under congestion.  Browsers may
 * reduce FPS rather than downscale the shared desktop.  Unsupported
 * implementations continue with the default WebRTC adaptation.
 *
 * @param {Stream} c
 */
async function preferScreenShareResolution(c) {
    if(c.label !== 'screenshare')
        return;
    for(const sender of c.pc.getSenders()) {
        if(!sender.track || sender.track.kind !== 'video')
            continue;
        try {
            const parameters = sender.getParameters();
            parameters.degradationPreference = 'maintain-resolution';
            await sender.setParameters(parameters);
        } catch(e) {
            console.warn('Could not prioritise screen-share resolution', e);
        }
    }
}

/**
 * Sets up c to send the given stream.  Some extra parameters are stored
 * in c.userdata.
 *
 * @param {Stream} c
 * @param {MediaStream} stream
 */

// Recover a microphone capture that the browser or mobile OS unexpectedly ends
// or mutes. A user-muted microphone is never restarted or unmuted automatically.
const audioRecoveryState = {
    timer: null,
    attempts: 0,
    force: false,
    warned: false,
};

function cancelAudioRecovery() {
    if(audioRecoveryState.timer !== null)
        clearTimeout(audioRecoveryState.timer);
    audioRecoveryState.timer = null;
    audioRecoveryState.attempts = 0;
    audioRecoveryState.force = false;
    audioRecoveryState.warned = false;
}

function scheduleAudioRecovery(force) {
    const settings = getSettings();
    if(!settings.audio || settings.localMute ||
       !serverConnection?.permissions?.includes('present'))
        return;
    if(force)
        audioRecoveryState.force = true;
    if(audioRecoveryState.timer !== null)
        return;

    const delay = audioRecoveryState.force ? 8000 :
        Math.min(1000 * (2 ** Math.min(audioRecoveryState.attempts, 5)), 30000);
    audioRecoveryState.timer = setTimeout(async () => {
        audioRecoveryState.timer = null;
        const currentSettings = getSettings();
        if(!currentSettings.audio || currentSettings.localMute ||
           !serverConnection?.permissions?.includes('present')) {
            cancelAudioRecovery();
            return;
        }

        const current = findUpMedia('camera');
        const existing = current?.stream?.getAudioTracks().find(track =>
            track.readyState === 'live');
        if(existing && !existing.muted && !audioRecoveryState.force) {
            cancelAudioRecovery();
            return;
        }

        const forceCapture = audioRecoveryState.force || !existing || existing.muted;
        audioRecoveryState.force = false;
        try {
            // forceCapture obtains a fresh audio track even if an old track is
            // still marked live but has stopped delivering samples. Video is
            // reused, so microphone recovery does not interrupt the camera.
            await addLocalMedia(current?.localId, forceCapture, true);
        } catch(error) {
            console.warn('Automatic microphone recovery failed', error);
        }

        const updated = findUpMedia('camera');
        const restored = updated?.stream?.getAudioTracks().some(track =>
            track.readyState === 'live' && !track.muted);
        if(restored) {
            cancelAudioRecovery();
            setLocalMute(currentSettings.localMute, false);
            return;
        }

        audioRecoveryState.attempts++;
        if(!audioRecoveryState.warned) {
            displayWarning('Microphone interrupted; reconnecting automatically');
            audioRecoveryState.warned = true;
        }
        // Continue with a capped 30-second backoff while the user still wants
        // the microphone. Selecting "off" or leaving the room cancels retries.
        scheduleAudioRecovery(false);
    }, delay);
}

async function setUpStream(c, stream) {
    if(c.stream !== null)
        throw new Error("Setting nonempty stream");

    c.setStream(stream);

    // set up the handler early, in case setFilter fails.
    c.onclose = async replace => {
        await removeFilter(c);
        if(!replace) {
            stopStream(c.stream);
            if(c.userdata.onclose)
                c.userdata.onclose.call(c);
            if(c.label === 'screenshare') {
                const status = document.getElementById('screen-share-stats');
                if(status)
                    status.textContent = 'Not sharing';
            }
            delMedia(c.localId);
        }
    }

    await setFilter(c);

    /**
     * @param {MediaStreamTrack} t
     */
    function addUpTrack(t) {
        let settings = getSettings();
        if(c.label === 'camera') {
            if(t.kind === 'audio') {
                if(settings.localMute)
                    t.enabled = false;
            } else if(t.kind === 'video') {
                if(settings.blackboardMode) {
                    t.contentHint = 'detail';
                }
            }
        }
        if(c.label === 'camera' && t.kind === 'audio') {
            // Preserve the user's mute preference across capture recovery.
            t.enabled = !settings.localMute;
            if(!settings.localMute)
                cancelAudioRecovery();
            t.onmute = () => {
                if(getSettings().audio && !getSettings().localMute) {
                    setLocalMute(true, false);
                    scheduleAudioRecovery(true);
                }
            };
            t.onunmute = () => {
                if(!getSettings().localMute) {
                    cancelAudioRecovery();
                    setLocalMute(false, false);
                }
            };
        }
        t.onended = () => {
            // A mobile OS may suspend or revoke one capture track. Keep
            // other live tracks and recover the microphone separately.
            if(c.label === 'camera' && t.kind === 'audio') {
                setLocalMute(true, false);
                if(getSettings().audio && !getSettings().localMute)
                    scheduleAudioRecovery(false);
            }
            const liveTracks = c.stream ? c.stream.getTracks().filter(track =>
                track.readyState === 'live') : [];
            if(liveTracks.length === 0) {
                stream.onaddtrack = null;
                stream.onremovetrack = null;
                c.close();
            } else {
                updateCameraButton();
                setButtonsVisibility();
            }
        };

        let encodings = [];
        let simulcast = c.label !== 'screenshare' && doSimulcast();
        if(t.kind === 'video') {
            let bps = getMaxVideoThroughput(c.label);
            // Firefox doesn't like us setting the RID if we're not
            // simulcasting.
            if(simulcast) {
                encodings.push({
                    rid: 'h',
                    maxBitrate: bps || unlimitedRate,
                });
                encodings.push({
                    rid: 'l',
                    scaleResolutionDownBy: 2,
                    maxBitrate: simulcastRate,
                });
            } else {
                encodings.push({
                    maxBitrate: bps || unlimitedRate,
                });
            }
        } else {
            if(settings.hqaudio) {
                encodings.push({
                    maxBitrate: hqAudioRate,
                });
            }
        }
        let tr = c.pc.addTransceiver(t, {
            direction: 'sendonly',
            streams: [stream],
            sendEncodings: encodings,
        });

        // Firefox before 110 does not implement sendEncodings, and
        // requires this hack, which throws an exception on Chromium.
        try {
            let p = tr.sender.getParameters();
            if(!p.encodings) {
                p.encodings = encodings;
                tr.sender.setParameters(p);
            }
        } catch(e) {
        }
    }

    // c.stream might be different from stream if there's a filter
    c.stream.getTracks().forEach(addUpTrack);

    stream.onaddtrack = function(e) {
        addUpTrack(e.track);
    };

    stream.onremovetrack = function(e) {
        let t = e.track;

        /** @type {RTCRtpSender} */
        let sender;
        c.pc.getSenders().forEach(s => {
            if(s.track === t)
                sender = s;
        });
        if(sender) {
            c.pc.removeTrack(sender);
        } else {
            console.warn('Removing unknown track');
        }

        let found = false;
        c.pc.getSenders().forEach(s => {
            if(s.track)
                found = true;
        });
        if(!found) {
            stream.onaddtrack = null;
            stream.onremovetrack = null;
            c.close();
        }
    };

    await preferScreenShareResolution(c);
    c.onstats = gotUpStats;
    c.setStatsInterval(2000);
}

/**
 * Replaces c with a freshly created stream, duplicating any relevant
 * parameters in c.userdata.
 *
 * @param {Stream} c
 * @returns {Promise<Stream>}
 */
async function replaceUpStream(c) {
    await removeFilter(c);
    let cn = newUpStream(c.localId);
    cn.label = c.label;
    if(c.userdata.filterDefinition)
        cn.userdata.filterDefinition = c.userdata.filterDefinition;
    if(c.userdata.onclose)
        cn.userdata.onclose = c.userdata.onclose;
    let media = /** @type{HTMLVideoElement} */
        (document.getElementById('media-' + c.localId));
    try {
        await setUpStream(cn, c.stream);
    } catch(e) {
        console.error(e);
        displayError(e);
        cn.close();
        c.close();
        return null;
    }

    await setMedia(cn,
                   cn.label === 'camera' && getSettings().mirrorView,
                   cn.label === 'video' && media);

    return cn;
}

/**
 * Replaces all up streams with the given label.  If label is null,
 * replaces all up stream.
 *
 * @param {string} label
 */
async function replaceUpStreams(label) {
    let promises = [];
    for(let id in serverConnection.up) {
        let c = serverConnection.up[id];
        if(label && c.label !== label)
            continue
        promises.push(replaceUpStream(c));
    }
    await Promise.all(promises);
}

/**
 * Closes and reopens the camera then replaces the camera stream.
 */
function replaceCameraStream() {
    let c = findUpMedia('camera');
    if(c)
        addLocalMedia(c.localId);
}

/**
 * @param {string} [localId]
 */
/**
 * Rebuild the outgoing stream while keeping unchanged audio/video tracks.
 * Permissions are requested per media kind: a blocked camera must never
 * prevent microphone-only use (or vice versa).
 *
 * @param {string} [localId]
 */
async function addLocalMedia(localId) {
    const forceAudio = arguments[1] === true;
    const silent = arguments[2] === true;
    const settings = getSettings();
    const choice = {
        audio: JSON.stringify([settings.audio, settings.preprocessing, settings.hqaudio]),
        video: JSON.stringify([settings.video, settings.resolution, settings.blackboardMode]),
    };

    /** @type {boolean|MediaTrackConstraints} */
    let audio = settings.audio ?
        (settings.audio === 'default' ? {} : {deviceId: settings.audio}) : false;
    /** @type {boolean|MediaTrackConstraints} */
    let video = settings.video ?
        (settings.video === 'default' ? {} : {deviceId: settings.video}) : false;
    if(video) {
        if(settings.resolution) {
            video.width = {ideal: settings.resolution[0]};
            video.height = {ideal: settings.resolution[1]};
        } else if(settings.blackboardMode) {
            video.width = {min: 640, ideal: 1920};
            video.height = {min: 400, ideal: 1080};
        } else {
            video.aspectRatio = {ideal: 4 / 3};
        }
    }
    if(audio && !settings.preprocessing) {
        audio.echoCancellation = false;
        audio.noiseSuppression = false;
        audio.autoGainControl = false;
    }

    if(!serverConnection) return;
    let old = localId ? serverConnection.findByLocalId(localId) :
        findUpMedia('camera');
    // In a receive-only session never ask the browser for an empty stream.
    if(!audio && !video) {
        if(old) old.close();
        setLocalMute(true, true);
        updateCameraButton();
        setButtonsVisibility();
        return;
    }
    if(!serverConnection.permissions?.includes('present')) return;

    if(old)
        await removeFilter(old);

    const tracks = [];
    for(const [kind, constraints] of [['audio', audio], ['video', video]]) {
        const previous = old?.stream?.getTracks()
            .find(t => t.kind === kind && t.readyState === 'live');
        if(!constraints) {
            if(previous) previous.stop();
            continue;
        }
        if(previous && old.userdata?.captureSelection?.[kind] === choice[kind] &&
           !(kind === 'audio' && forceAudio)) {
            tracks.push(previous);
            continue;
        }
        try {
            const requested = kind === 'audio' ?
                {audio: constraints, video: false} :
                {audio: false, video: constraints};
            let captured;
            try {
                captured = await navigator.mediaDevices.getUserMedia(requested);
            } catch(error) {
                // Retry stale mobile device IDs and overly strict camera
                // constraints with the browser's current default device.
                if(error.name !== 'OverconstrainedError' &&
                   error.name !== 'NotFoundError' &&
                   error.name !== 'DevicesNotFoundError')
                    throw error;
                captured = await navigator.mediaDevices.getUserMedia({
                    audio: kind === 'audio',
                    video: kind === 'video',
                });
            }
            const track = captured.getTracks().find(t => t.kind === kind);
            if(!track) {
                stopStream(captured);
                throw new Error('No ' + kind + ' track returned');
            }
            if(previous)
                previous.stop();
            tracks.push(track);
        } catch(e) {
            console.error(e);
            if(!silent)
                displayError(e);
            // Keep the old source alive when a device switch fails. Cloning
            // lets the old PeerConnection close without killing the fallback.
            if(previous && previous.readyState === 'live')
                tracks.push(previous.clone());
        }
    }

    if(!tracks.length) {
        if(old) old.close();
        // Preserve the intended microphone state while capture is recovering.
        if(settings.audio)
            setLocalMute(true, false);
        else
            setLocalMute(true, true);
        updateCameraButton();
        setButtonsVisibility();
        return;
    }

    const stream = new MediaStream(tracks);
    setMediaChoices(true);
    let c;
    try {
        c = newUpStream(old?.localId || localId);
        c.label = 'camera';
        c.userdata.captureSelection = choice;
        if(video && settings.filter) {
            const filter = filters[settings.filter];
            if(filter)
                c.userdata.filterDefinition = filter;
            else
                displayWarning(`Unknown filter ${settings.filter}`);
        }
        await setUpStream(c, stream);
        await setMedia(c, settings.mirrorView);
    } catch(e) {
        console.error(e);
        displayError(e);
        if(c) c.close();
        else stopStream(stream);
    }
    if(!stream.getAudioTracks().some(track => track.readyState === 'live')) {
        if(settings.audio)
            setLocalMute(true, false);
        else
            setLocalMute(true, true);
    } else {
        setLocalMute(settings.localMute, false);
    }
    updateCameraButton();
    setButtonsVisibility();
}

let safariScreenshareDone = false;

async function addShareMedia() {
    if(!safariScreenshareDone) {
        if(isSafari()) {
            let ok = confirm(
                'Screen sharing in Safari is broken.  ' +
                    'It will work at first, ' +
                    'but then your video will randomly freeze.  ' +
                    'Are you sure that you wish to enable screensharing?'
            );
            if(!ok)
                return
        }
        safariScreenshareDone = true;
    }

    /** @type {MediaStream} */
    let stream = null;
    const profile = getScreenShareProfile(getSettings());
    try {
        if(!navigator.mediaDevices ||
           !('getDisplayMedia' in navigator.mediaDevices))
            throw new Error('Your browser does not support screen sharing');
        stream = await navigator.mediaDevices.getDisplayMedia({
            video: profile.video,
            audio: true,
        });
    } catch(e) {
        console.error(e);
        displayError(e);
        return;
    }

    stream.getVideoTracks().forEach(t => {
        if('contentHint' in t)
            t.contentHint = profile.contentHint;
    });

    let c = newUpStream();
    c.label = 'screenshare';
    await setUpStream(c, stream);
    await setMedia(c);
    setButtonsVisibility();
}

/**
 * @param {File} file
 */
async function addFileMedia(file) {
    let url = URL.createObjectURL(file);
    let video = document.createElement('video');
    video.src = url;
    video.controls = true;
    let stream;
    /** @ts-ignore */
    if(video.captureStream)
        /** @ts-ignore */
        stream = video.captureStream();
    /** @ts-ignore */
    else if(video.mozCaptureStream)
        /** @ts-ignore */
        stream = video.mozCaptureStream();
    else {
        displayError("This browser doesn't support file playback");
        return;
    }

    let c = newUpStream();
    c.label = 'video';
    c.userdata.onclose = function() {
        let media = /** @type{HTMLVideoElement} */
            (document.getElementById('media-' + this.localId));
        if(media && media.src) {
            URL.revokeObjectURL(media.src);
            media.src = null;
        }
    };
    await setUpStream(c, stream);

    let presenting = !!findUpMedia('camera');
    let muted = getSettings().localMute;
    if(presenting && !muted) {
        setLocalMute(true, true);
        displayWarning('You have been muted');
    }

    await setMedia(c, false, video);
    c.userdata.play = true;
    setButtonsVisibility();
}

/**
 * @param {MediaStream} s
 */
function stopStream(s) {
    s.getTracks().forEach(t => {
        try {
            t.stop();
        } catch(e) {
            console.warn(e);
        }
    });
}

/**
 * closeUpMedia closes all up connections with the given label.  If label
 * is null, it closes all up connections.
 *
 * @param {string} [label]
*/
function closeUpMedia(label) {
    for(let id in serverConnection.up) {
        let c = serverConnection.up[id];
        if(label && c.label !== label)
            continue
        c.close();
    }
}

/**
 * @param {string} label
 * @returns {Stream}
 */
function findUpMedia(label) {
    if(!serverConnection)
        return null;
    for(let id in serverConnection.up) {
        let c = serverConnection.up[id];
        if(c.label === label)
            return c;
    }
    return null;
}

/**
 * @param {boolean} mute
 */
function muteLocalTracks(mute) {
    if(!serverConnection)
        return;
    for(let id in serverConnection.up) {
        let c = serverConnection.up[id];
        if(c.label === 'camera') {
            let stream = c.stream;
            stream.getTracks().forEach(t => {
                if(t.kind === 'audio') {
                    t.enabled = !mute;
                }
            });
        }
    }
}

/**
 * @param {string} id
 * @param {boolean} force
 * @param {boolean} [value]
 */
function forceDownRate(id, force, value) {
    let c = serverConnection.down[id];
    if(!c)
        throw new Error("Unknown down stream");
    if('requested' in c.userdata) {
        if(force)
            c.userdata.requested.force = !!value;
        else
            delete(c.userdata.requested.force);
    } else {
        if(force)
            c.userdata.requested = {force: value};
    }
    reconsiderDownRate(id);
}

/**
 * Maps 'video' to 'video-low'.  Returns null if nothing changed.
 *
 * @param {string[]} requested
 * @returns {string[]}
 */
function mapVideoToLow(requested) {
    let result = [];
    let found = false;
    for(let i = 0; i < requested.length; i++) {
        let r = requested[i];
        if(r === 'video') {
            r = 'video-low';
            found = true;
        }
        result.push(r);
    }
    if(!found)
        return null;
    return result;
}

/**
 * Reconsider the video track requested for a given down stream.
 *
 * @param {string} [id] - the id of the track to reconsider, all if null.
 */
function reconsiderDownRate(id) {
    if(!serverConnection)
        return;
    if(!id) {
        for(let id in serverConnection.down) {
            reconsiderDownRate(id);
        }
        return;
    }
    let c = serverConnection.down[id];
    if(!c)
        throw new Error("Unknown down stream");
    let normalrequest = mapRequestLabel(getSettings().request, c.label);

    let requestlow = mapVideoToLow(normalrequest);
    if(requestlow === null)
        return;

    let old = c.userdata.requested;
    // Even when shown as a small tile, a screen share must stay on the
    // full-resolution stream.  Scaling an entire desktop down makes its
    // text unreadable.  Keep explicit "low quality" receive preferences.
    if(c.label === 'screenshare') {
        if(old && old.low) {
            old.low = false;
            c.request(null);
        }
        return;
    }

    let low = false;
    if(c.label === 'camera' &&
       Object.values(serverConnection.down).some(stream =>
           stream.label === 'screenshare')) {
        // Keep the desktop readable while decoding tiny camera thumbnails.
        low = true;
    } else if(old && ('force' in old)) {
        low = old.force;
    } else {
        let media = /** @type {HTMLVideoElement} */
            (document.getElementById('media-' + c.localId));
        if(!media)
            throw new Error("No media for stream");
        let w = media.scrollWidth;
        let h = media.scrollHeight;
        if(w && h && w * h <= 320 * 240) {
            low = true;
        }
    }

    if(low !== !!(old && old.low)) {
        if('requested' in c.userdata)
            c.userdata.requested.low = low;
        else
            c.userdata.requested = {low: low};
        c.request(low ? requestlow : null);
    }
}

let reconsiderDownRateTimer = null;

/**
 * Schedules reconsiderDownRate() to be run later.  The delay avoids too
 * much recomputations when resizing the window.
 */
function scheduleReconsiderDownRate() {
    if(reconsiderDownRateTimer)
        return;
    reconsiderDownRateTimer =
        setTimeout(() => {
            reconsiderDownRateTimer = null;
            reconsiderDownRate();
        }, 200);
}

/**
 * setMedia adds a new media element corresponding to stream c.
 *
 * @param {Stream} c
 * @param {boolean} [mirror]
 *     - whether to mirror the video
 * @param {HTMLVideoElement} [video]
 *     - the video element to add.  If null, a new element with custom
 *       controls will be created.
 */
async function setMedia(c, mirror, video) {
    let div = document.getElementById('peer-' + c.localId);
    if(!div) {
        div = document.createElement('div');
        div.id = 'peer-' + c.localId;
        div.classList.add('peer');
        let peersdiv = document.getElementById('peers');
        peersdiv.appendChild(div);
    }

    showHideMedia(c, div)

    let media = /** @type {HTMLVideoElement} */
        (document.getElementById('media-' + c.localId));
    if(!media) {
        if(video) {
            media = video;
        } else {
            media = document.createElement('video');
            if(c.up)
                media.muted = true;
        }

        media.classList.add('media');
        media.autoplay = true;
        media.playsInline = true;
        media.id = 'media-' + c.localId;
        div.appendChild(media);
        addCustomControls(media, div, c, !!video);
    }

    if(c.label === 'screenshare')
        enableScreenShareZoom(media, div);

    if(mirror)
        media.classList.add('mirror');
    else
        media.classList.remove('mirror');

    if(!video && media.srcObject !== c.stream)
        media.srcObject = c.stream;

    if(!c.up) {
        media.onfullscreenchange = function(e) {
            forceDownRate(c.id, document.fullscreenElement === media, false);
        }
    }

    let label = document.getElementById('label-' + c.localId);
    if(!label) {
        label = document.createElement('div');
        label.id = 'label-' + c.localId;
        label.classList.add('label');
        label.classList.add(c.up ? 'up-stream' : 'down-stream');
        label.dataset.defaultText = '';
        label.dataset.fallbackText = '';
        label.dataset.showFallback = 'false';
        label.onclick = function() {
            let showFallback = (label.dataset.showFallback === 'true');
            label.dataset.showFallback = showFallback ? 'false' : 'true';
            updateLabelElement(label);
        };
        div.appendChild(label);
    }

    setUpLabel(c, '');
    setMediaStatus(c);

    showVideo();
    resizePeers();
}


/**
 * @param {Stream} c
 * @param {HTMLElement} elt
 */
function showHideMedia(c, elt) {
    let display = c.up || getSettings().displayAll;
    if(!display && c.stream) {
        let tracks = c.stream.getTracks();
        for(let i = 0; i < tracks.length; i++) {
            let t = tracks[i];
            if(t.kind === 'video') {
                display = true;
                break;
            }
        }
    }
    if(display)
        elt.classList.remove('peer-hidden');
    else
        elt.classList.add('peer-hidden');
}

/**
 * resetMedia resets the source stream of the media element associated
 * with c.  This has the side-effect of resetting any frozen frames.
 *
 * @param {Stream} c
 */
function resetMedia(c) {
    let media = /** @type {HTMLVideoElement} */
        (document.getElementById('media-' + c.localId));
    if(!media) {
        console.error("Resetting unknown media element")
        return;
    }
    media.srcObject = media.srcObject;
}

/**
 * @param {Element} elt
 */
function cloneHTMLElement(elt) {
    if(!(elt instanceof HTMLElement))
        throw new Error('Unexpected element type');
    return /** @type{HTMLElement} */(elt.cloneNode(true));
}

/**
 * @param {HTMLVideoElement} media
 * @param {HTMLElement} container
 * @param {Stream} c
 * @param {boolean} toponly
 */
function addCustomControls(media, container, c, toponly) {
    if(!toponly && !document.getElementById('controls-' + c.localId)) {
        media.controls = false;

        let template =
            document.getElementById('videocontrols-template').firstElementChild;
        let controls = cloneHTMLElement(template);
        controls.id = 'controls-' + c.localId;

        let volume = getVideoButton(controls, 'volume');

        if(c.up && c.label === 'camera') {
            volume.remove();
        } else {
            setVolumeButton(media.muted,
                            getVideoButton(controls, "volume-mute"),
                            getVideoButton(controls, "volume-slider"));
        }
        container.appendChild(controls);
    }

    if(c.up && !document.getElementById('topcontrols-' + c.localId)) {
        let toptemplate =
            document.getElementById('topvideocontrols-template').firstElementChild;
        let topcontrols = cloneHTMLElement(toptemplate);
        topcontrols.id = 'topcontrols-' + c.localId;
        container.appendChild(topcontrols);
    }
    registerControlHandlers(c.localId, media, container);
}

/**
 * @param {HTMLElement} container
 * @param {string} name
 */
function getVideoButton(container, name) {
    return /** @type {HTMLElement} */(container.getElementsByClassName(name)[0]);
}

/**
 * @param {boolean} muted
 * @param {HTMLElement} button
 * @param {HTMLElement} slider
 */
function setVolumeButton(muted, button, slider) {
    if(!muted) {
        button.classList.remove("fa-volume-mute");
        button.classList.add("fa-volume-up");
    } else {
        button.classList.remove("fa-volume-up");
        button.classList.add("fa-volume-mute");
    }

    if(!(slider instanceof HTMLInputElement))
        throw new Error("Couldn't find volume slider");
    slider.disabled = muted;
}

/**
 * @param {string} localId
 * @param {HTMLVideoElement} media
 * @param {HTMLElement} container
 */
function registerControlHandlers(localId, media, container) {
    let play = getVideoButton(container, 'video-play');
    if(play) {
        play.onclick = function(event) {
            event.preventDefault();
            media.play();
        };
    }

    let stop = getVideoButton(container, 'video-stop');
    if(stop) {
        stop.onclick = function(event) {
            event.preventDefault();
            try {
                let c = serverConnection.findByLocalId(localId);
                if(!c)
                    throw new Error('Closing unknown stream');
                c.close();
            } catch(e) {
                console.error(e);
                displayError(e);
            }
        };
    }

    let volume = getVideoButton(container, 'volume');
    if (volume) {
        volume.onclick = function(event) {
            let target = /** @type{HTMLElement} */(event.target);
            if(!target.classList.contains('volume-mute'))
                // if click on volume slider, do nothing
                return;
            event.preventDefault();
            media.muted = !media.muted;
            setVolumeButton(media.muted, target,
                            getVideoButton(volume, "volume-slider"));
        };
        volume.oninput = function() {
          let slider = /** @type{HTMLInputElement} */
              (getVideoButton(volume, "volume-slider"));
          media.volume = parseFloat(slider.value)/100;
        };
    }

    let pip = getVideoButton(container, 'pip');
    if(pip) {
        if(HTMLVideoElement.prototype.requestPictureInPicture) {
            pip.onclick = function(e) {
                e.preventDefault();
                if(media.requestPictureInPicture) {
                    media.requestPictureInPicture();
                } else {
                    displayWarning('Picture in Picture not supported.');
                }
            };
        } else {
            pip.style.display = 'none';
        }
    }

    let fs = getVideoButton(container, 'fullscreen');
    if(fs) {
        if(HTMLVideoElement.prototype.requestFullscreen ||
           /** @ts-ignore */
           HTMLVideoElement.prototype.webkitRequestFullscreen) {
            fs.onclick = function(e) {
                e.preventDefault();
                if(media.requestFullscreen) {
                    media.requestFullscreen();
                /** @ts-ignore */
                } else if(media.webkitRequestFullscreen) {
                    /** @ts-ignore */
                    media.webkitRequestFullscreen();
                } else {
                    displayWarning('Full screen not supported!');
                }
            };
        } else {
            fs.style.display = 'none';
        }
    }
}

/**
 * @param {string} localId
 */
function delMedia(localId) {
    let mediadiv = document.getElementById('peers');
    let peer = document.getElementById('peer-' + localId);
    if(!peer)
        throw new Error('Removing unknown media');

    let media = /** @type{HTMLVideoElement} */
        (document.getElementById('media-' + localId));

    media.srcObject = null;
    mediadiv.removeChild(peer);

    setButtonsVisibility();
    resizePeers();
    hideVideo();
}

/**
 * @param {Stream} c
 */
function setMediaStatus(c) {
    let state = c && c.pc && c.pc.iceConnectionState;
    let good = state === 'connected' || state === 'completed';

    let media = document.getElementById('media-' + c.localId);
    if(!media) {
        console.warn('Setting status of unknown media.');
        return;
    }
    if(good) {
        media.classList.remove('media-failed');
        if(c.userdata.play) {
            if(media instanceof HTMLMediaElement)
                media.play().catch(e => {
                    console.error(e);
                    displayError(e);
                });
            delete(c.userdata.play);
        }
    } else {
        media.classList.add('media-failed');
    }

    if(!c.up && state === 'failed') {
        let from = c.username ?
            `from user ${c.username}` :
            'from anonymous user';
        displayWarning(`Cannot receive media ${from}, still trying...`);
    }
}


/**
 * @param {Stream} c
 * @param {string} [fallback]
 */
function setUpLabel(c, fallback) {
    let label = document.getElementById('label-' + c.localId);
    if(!label)
        return;
    label.dataset.defaultText = c.username;
    label.dataset.fallbackText = fallback;
    updateLabelElement(label);
}

/**
 * @param {HTMLElement} label
 */
function updateLabelElement(label) {
    let defaultText = label.dataset.defaultText;
    let fallbackText = label.dataset.fallbackText;
    let showFallback = (label.dataset.showFallback === 'true');
    if(showFallback) {
        label.textContent = fallbackText || '(unknown)';
        label.classList.add('label-fallback');
    } else {
        label.textContent = defaultText;
        label.classList.remove('label-fallback');
    }
}

function resizePeers() {
    if(!serverConnection)
        return;
    const peers = document.getElementById('peers');
    const container = document.getElementById('video-container');
    if(!peers || !container)
        return;

    const streams = Object.values(serverConnection.up)
        .concat(Object.values(serverConnection.down));
    const visuals = [];
    const voices = [];

    for(const c of streams) {
        const peer = document.getElementById('peer-' + c.localId);
        if(!peer)
            continue;
        const tracks = c.stream?.getTracks?.() || [];
        const video = tracks.some(t => t.kind === 'video' &&
            t.readyState !== 'ended' && t.enabled !== false);
        const audio = tracks.some(t => t.kind === 'audio' &&
            t.readyState !== 'ended');
        peer.classList.remove('cm-peer-audio', 'cm-peer-main',
                              'cm-peer-thumb');
        peer.style.removeProperty('--cm-audio-index');
        peer.style.removeProperty('--cm-thumb-index');
        if(video && !peer.classList.contains('peer-hidden')) {
            visuals.push({c, peer});
        } else if(audio && !video) {
            peer.classList.remove('peer-hidden');
            peer.classList.add('cm-peer-audio');
            peer.style.setProperty('--cm-audio-index', String(voices.length));
            voices.push(peer);
        }
    }

    const shares = visuals.filter(item => item.c.label === 'screenshare');
    const mainShare = shares[0];
    const cameras = visuals.filter(item => item !== mainShare);
    peers.classList.toggle('cm-has-share', !!mainShare);
    peers.classList.toggle('cm-no-thumbnails', cameras.length === 0);
    container.classList.toggle('cm-audio-only', visuals.length === 0);

    if(mainShare) {
        mainShare.peer.classList.add('cm-peer-main');
        cameras.forEach((item, i) => {
            item.peer.classList.add('cm-peer-thumb');
            item.peer.style.setProperty('--cm-thumb-index', String(i));
        });
        // Screen share stays at full negotiated resolution, camera tracks
        // appear as small overlays instead of equal-sized black tiles.
        peers.style.gridTemplateColumns = '';
        peers.querySelectorAll('.media').forEach(media => {
            media.style.maxHeight = '';
        });
    } else {
        const count = visuals.length;
        if(count) {
            let columns = Math.ceil(Math.sqrt(count));
            if(count <= 2 && container.offsetHeight > container.offsetWidth)
                columns = 1;
            peers.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
            const rows = Math.ceil(count / columns);
            const maxHeight = Math.max(0,
                (peers.offsetHeight - (rows - 1) * 5 - 40) / rows);
            visuals.forEach(item => {
                const media = document.getElementById('media-' + item.c.localId);
                if(media)
                    media.style.maxHeight = count <= 1 ? '' : maxHeight + 'px';
            });
        } else {
            peers.style.gridTemplateColumns = '1fr';
        }
    }
    scheduleReconsiderDownRate();
}

/**
 * Lexicographic order, with case differences secondary.
 * @param{string} a
 * @param{string} b
 */
function stringCompare(a, b) {
    let la = a.toLowerCase();
    let lb = b.toLowerCase();
    if(la < lb)
        return -1;
    else if(la > lb)
        return +1;
    else if(a < b)
        return -1;
    else if(a > b)
        return +1;
    return 0
}

/**
 * @param {string} v
 */
function dateFromInput(v) {
    let d = new Date(v);
    if(d.toString() === 'Invalid Date')
        throw new Error('Invalid date');
    return d;
}

/**
 * @param {Date} d
 */
function dateToInput(d) {
    let dd = new Date(d);
    dd.setMinutes(dd.getMinutes() - dd.getTimezoneOffset());
    return dd.toISOString().slice(0, -1);
}

function inviteMenu() {
    let d = /** @type {HTMLDialogElement} */
        (document.getElementById('invite-dialog'));
    if(!('HTMLDialogElement' in window) || !d.showModal) {
        displayError("This browser doesn't support modal dialogs");
        return;
    }
    d.returnValue = '';
    let c = getButtonElement('invite-cancel');
    c.onclick = function(e) { d.close('cancel'); };
    let u = getInputElement('invite-username');
    u.value = '';
    let now = new Date();
    now.setMilliseconds(0);
    now.setSeconds(0);
    let nb = getInputElement('invite-not-before');
    nb.min = dateToInput(now);
    let ex = getInputElement('invite-expires');
    let expires = new Date(now);
    expires.setDate(expires.getDate() + 2);
    ex.min = dateToInput(now);
    ex.value = dateToInput(expires);
    d.showModal();
}

document.getElementById('invite-dialog').onclose = function(e) {
    if(!(this instanceof HTMLDialogElement))
        throw new Error('Unexpected type for this');
    let dialog = /** @type {HTMLDialogElement} */(this);
    if(dialog.returnValue !== 'invite')
        return;
    let u = getInputElement('invite-username');
    let username = u.value.trim() || null;
    let nb = getInputElement('invite-not-before');
    let notBefore = null;
    if(nb.value) {
        try {
            notBefore = dateFromInput(nb.value);
        } catch(e) {
            displayError(`Couldn't parse ${nb.value}: ${e.message}`);
            return;
        }
    }
    let ex = getInputElement('invite-expires');
    let expires = null;
    if(ex.value) {
        try {
            expires = dateFromInput(ex.value);
        } catch(e) {
            displayError(`Couldn't parse ${ex.value}: ${e.message}`);
            return;
        }
    }
    let template = {}
    if(username)
        template.username = username;
    if(notBefore)
        template['not-before'] = notBefore;
    if(expires)
        template.expires = expires;
    makeToken(template);
};

/**
 * @param {HTMLElement} elt
 */
function userMenu(elt) {
    if(!elt.id.startsWith('user-'))
        throw new Error('Unexpected id for user menu');
    let id = elt.id.slice('user-'.length);
    let user = serverConnection.users[id];
    if(!user)
        throw new Error("Couldn't find user")
    let items = [];
    if(id === serverConnection.id) {
        let mydata = serverConnection.users[serverConnection.id].data;
        if(mydata['raisehand'])
            items.push({label: 'Unraise hand', onClick: () => {
                serverConnection.userAction(
                    'setdata', serverConnection.id, {'raisehand': null},
                );
            }});
        else
            items.push({label: 'Raise hand', onClick: () => {
                serverConnection.userAction(
                    'setdata', serverConnection.id, {'raisehand': true},
                );
            }});
        if(serverConnection.version !== "1" &&
           serverConnection.permissions.indexOf('token') >= 0) {
            items.push({label: 'Invite user', onClick: () => {
                inviteMenu();
            }});
        }
        if(serverConnection.permissions.indexOf('present') >= 0 && canFile())
            items.push({label: 'Broadcast file', onClick: presentFile});
        items.push({label: 'Restart media', onClick: renegotiateStreams});
    } else {
        items.push({label: 'Send file', onClick: () => {
            sendFile(id);
        }});
        if(serverConnection.permissions.indexOf('op') >= 0) {
            items.push({type: 'seperator'}); // sic
            if(user.permissions.indexOf('present') >= 0)
                items.push({label: 'Forbid presenting', onClick: () => {
                    serverConnection.userAction('unpresent', id);
                }});
            else
                items.push({label: 'Allow presenting', onClick: () => {
                    serverConnection.userAction('present', id);
                }});
            items.push({label: 'Mute', onClick: () => {
                serverConnection.userMessage('mute', id);
            }});
            items.push({label: 'Kick out', onClick: () => {
                serverConnection.userAction('kick', id);
            }});
            items.push({label: 'Identify', onClick: () => {
                serverConnection.userAction('identify', id);
            }});
        }
    }
    /** @ts-ignore */
    new Contextual({
        items: items,
    });
}

/**
 * @param {string} id
 * @param {user} userinfo
 */
function addUser(id, userinfo) {
    let div = document.getElementById('users');
    let user = document.createElement('div');
    user.id = 'user-' + id;
    user.classList.add("user-p");
    setUserStatus(id, user, userinfo);
    user.addEventListener('click', function(e) {
        let elt = e.currentTarget;
        if(!elt || !(elt instanceof HTMLElement))
            throw new Error("Couldn't find user div");
        userMenu(elt);
    });

    let us = div.children;

    if(id === serverConnection.id) {
        if(us.length === 0)
            div.appendChild(user);
        else
            div.insertBefore(user, us[0]);
        return;
    }

    if(userinfo.username) {
        for(let i = 0; i < us.length; i++) {
            let child = us[i];
            let childid = child.id.slice('user-'.length);
            if(childid === serverConnection.id)
                continue;
            let childuser = serverConnection.users[childid] || null;
            let childname = (childuser && childuser.username) || null;
            if(!childname || stringCompare(childname, userinfo.username) > 0) {
                div.insertBefore(user, child);
                return;
            }
        }
    }

    div.appendChild(user);
}

 /**
  * @param {string} id
  * @param {user} userinfo
  */
function changeUser(id, userinfo) {
    let elt = document.getElementById('user-' + id);
    if(!elt) {
        console.warn('Unknown user ' + id);
        return;
    }
    setUserStatus(id, elt, userinfo);
}

/**
 * @param {string} id
 * @param {HTMLElement} elt
 * @param {user} userinfo
 */
function setUserStatus(id, elt, userinfo) {
    elt.textContent = userinfo.username ? userinfo.username : '(anon)';
    if(userinfo.data.raisehand)
        elt.classList.add('user-status-raisehand');
    else
        elt.classList.remove('user-status-raisehand');

    let microphone=false, camera = false;
    for(let label in userinfo.streams) {
        for(let kind in userinfo.streams[label]) {
            if(kind === 'audio')
                microphone = true;
            else
                camera = true;
        }
    }
    if(camera) {
        elt.classList.remove('user-status-microphone');
        elt.classList.add('user-status-camera');
    } else if(microphone) {
        elt.classList.add('user-status-microphone');
        elt.classList.remove('user-status-camera');
    } else {
        elt.classList.remove('user-status-microphone');
        elt.classList.remove('user-status-camera');
    }
}

/**
 * @param {string} id
 */
function delUser(id) {
    let div = document.getElementById('users');
    let user = document.getElementById('user-' + id);
    div.removeChild(user);
}

/**
 * @param {string} id
 * @param {string} kind
 */
function gotUser(id, kind) {
    switch(kind) {
    case 'add':
        addUser(id, serverConnection.users[id]);
        if(Object.keys(serverConnection.users).length === 3)
            reconsiderSendParameters();
        break;
    case 'delete':
        delUser(id);
        if(Object.keys(serverConnection.users).length < 3)
            scheduleReconsiderParameters();
        break;
    case 'change':
        changeUser(id, serverConnection.users[id]);
        break;
    default:
        console.warn('Unknown user kind', kind);
        break;
    }
}

function displayUsername() {
    document.getElementById('userspan').textContent = serverConnection.username;
    let op = serverConnection.permissions.indexOf('op') >= 0;
    let present = serverConnection.permissions.indexOf('present') >= 0;
    let text = '';
    if(op && present)
        text = '(op, presenter)';
    else if(op)
        text = 'operator';
    else if(present)
        text = 'presenter';
    document.getElementById('permspan').textContent = text;
}

let presentRequested = null;

/**
 * @param {string} s
 */
function capitalise(s) {
    if(s.length <= 0)
        return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * @param {string} title
 */
function setTitle(title) {
    function set(title) {
        document.title = title;
        document.getElementById('title').textContent = title;
    }
    if(title)
        set(title);
    else
        set('Cat-Meet');
}

/**
 * Apply the three entry choices before acquiring any local media.
 * The "Nothing" choice must not retain stored defaults that would
 * turn a microphone-only or camera-only click into a combined request.
 *
 * @param {string} present
 */
function configureJoinDevices(present) {
    const settings = getSettings();
    if(present === 'mike') {
        updateSettings({audio: settings.audio || 'default',
                        video: '', localMute: false});
    } else if(present === 'camera') {
        updateSettings({audio: '',
                        video: settings.video || 'default', localMute: true});
    } else if(present === 'both') {
        updateSettings({audio: settings.audio || 'default',
                        video: settings.video || 'default', localMute: false});
    } else {
        updateSettings({audio: '', video: '', localMute: true});
    }
    reflectSettings();
    updateCameraButton();
}

/**
 * @this {ServerConnection}
 * @param {string} kind
 * @param {string} group
 * @param {Array<string>} perms
 * @param {Record<string,any>} status
 * @param {Record<string,any>} data
 * @param {string} error
 * @param {string} message
 */
async function gotJoined(kind, group, perms, status, data, error, message) {
    let present = presentRequested;
    presentRequested = null;

    switch(kind) {
    case 'fail':
        if(triedRememberedLogin) {
            forgetRememberedLogin();
            triedRememberedLogin = false;
            displayWarning('7 天登录记录已失效，请重新输入会议室密码。');
        }
        if(probingState === 'probing' && error === 'need-username') {
            probingState = 'need-username';
            setVisibility('passwordform', false);
        } else {
            token = null;
            displayError('The server said: ' + message);
        }
        this.close();
        setButtonsVisibility();
        return;
    case 'redirect':
        triedRememberedLogin = false;
        this.close();
        token = null;
        if(typeof message !== 'string' || !message.startsWith('/') || message.startsWith('//')) {
            displayError('服务器返回了不安全的跳转地址');
            setVisibility('login-container', true);
            return;
        }
        document.location.assign(message);
        return;
    case 'leave':
        this.close();
        setButtonsVisibility();
        setChangePassword(null);
        return;
    case 'join':
    case 'change':
        triedRememberedLogin = false;
        if(probingState === 'probing') {
            probingState = 'success';
            setVisibility('userform', false);
            setVisibility('passwordform', false);
            this.close();
            setButtonsVisibility();
            return;
        } else {
            token = null;
        }
        // don't discard endPoint and friends
        for(let key in status)
            groupStatus[key] = status[key];
        setTitle((status && status.displayName) || capitalise(group));
        displayUsername();
        setButtonsVisibility();
        setChangePassword(pwAuth && !!groupStatus.canChangePassword &&
                          serverConnection.username
        );
        // A successful room join also enables mobile-back navigation protection.
        if(kind === 'join')
            window.dispatchEvent(new Event('cat-meet-session-joined'));
        // Do not request microphone access merely to enable Safari autoplay.
        if(kind === 'change')
            return;
        break;
    default:
        token = null;
        displayError('Unknown join message');
        this.close();
        return;
    }

    let input = /** @type{HTMLTextAreaElement} */
        (document.getElementById('input'));
    input.placeholder = 'Type /help for help';
    setTimeout(() => {input.placeholder = '';}, 8000);

    if(status.locked)
        displayWarning('This group is locked');

    if(typeof RTCPeerConnection === 'undefined')
        displayWarning("This browser doesn't support WebRTC");
    else
        this.request(mapRequest(getSettings().request));

    if(('mediaDevices' in navigator) &&
       ('getUserMedia' in navigator.mediaDevices) &&
       serverConnection.permissions.indexOf('present') >= 0 &&
       !findUpMedia('camera')) {
        configureJoinDevices(present);
        if(present) {
            let button = getButtonElement('presentbutton');
            button.disabled = true;
            try {
                await addLocalMedia();
            } finally {
                button.disabled = false;
            }
        } else {
            displayMessage(
                "Press Enable to enable your camera or microphone"
            );
        }
    }
}

/**
 * @param {TransferredFile} f
 */
function formatFileSize(size) {
    if(!Number.isFinite(size) || size < 0)
        return '';
    if(size < 1024)
        return `${size} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = size;
    let unit = -1;
    while(value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function isImageFileType(mimetype) {
    return typeof mimetype === 'string' && mimetype.startsWith('image/');
}

function createFileAttachmentCard(f) {
    let card = document.createElement('div');
    card.className = 'cm-file-card';

    let preview = document.createElement('div');
    preview.className = 'cm-file-preview';
    card.appendChild(preview);

    let body = document.createElement('div');
    body.className = 'cm-file-body';

    let name = document.createElement('div');
    name.className = 'cm-file-name';
    name.textContent = f.name || '未命名文件';
    body.appendChild(name);

    let meta = document.createElement('div');
    meta.className = 'cm-file-meta';
    meta.textContent =
        `${isImageFileType(f.mimetype) ? '图片' : '文件'} · ${formatFileSize(f.size)}`;
    if(f.up)
        meta.textContent += ` · 发送给 ${f.username || '成员'}`;
    body.appendChild(meta);

    let status = document.createElement('div');
    status.className = 'cm-file-status';
    status.textContent = f.up ? '正在发送…' : '等待接收';
    body.appendChild(status);

    let progress = document.createElement('progress');
    progress.className = 'cm-file-progress';
    progress.max = Math.max(1, f.size || 1);
    progress.value = 0;
    progress.hidden = true;
    body.appendChild(progress);

    let actions = document.createElement('div');
    actions.className = 'cm-file-actions';

    if(!f.up) {
        let accept = document.createElement('button');
        accept.type = 'button';
        accept.className = 'cm-file-primary';
        accept.textContent = isImageFileType(f.mimetype) ? '查看图片' : '接收文件';
        accept.onclick = function() {
            accept.disabled = true;
            f.receive().catch(e => {
                console.error(e);
                f.cancel(e);
            });
        };
        actions.appendChild(accept);

        let reject = document.createElement('button');
        reject.type = 'button';
        reject.className = 'cm-file-secondary';
        reject.textContent = '拒绝';
        reject.onclick = function() {
            f.cancel();
        };
        actions.appendChild(reject);
    } else {
        let cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'cm-file-secondary';
        cancel.textContent = '取消';
        cancel.onclick = function() {
            f.cancel();
        };
        actions.appendChild(cancel);
    }

    card.appendChild(body);
    card.appendChild(actions);
    card.cmStatus = status;
    card.cmProgress = progress;
    card.cmPreview = preview;
    card.cmActions = actions;
    return card;
}

function addFileCardToChat(f, card) {
    const peerId = f.up ? serverConnection.id : f.userid;
    const nick = f.up ? serverConnection.username : f.username;
    addToChatbox(null, peerId, null, nick, new Date(),
                 false, false, '', card);
}

function updateFileCardStatus(f, status, value) {
    const card = f.cmCard;
    if(!card)
        return;
    card.cmStatus.textContent = status;
    if(typeof value === 'number') {
        card.cmProgress.hidden = false;
        card.cmProgress.value = Math.max(0, Math.min(card.cmProgress.max, value));
    }
}

function finishIncomingFileCard(f, data) {
    const card = f.cmCard;
    if(!card)
        return;

    const blob = data instanceof Blob ?
        data : new Blob([data], {type: f.mimetype || 'application/octet-stream'});
    const url = URL.createObjectURL(blob);
    f.cmObjectUrl = url;

    card.cmStatus.textContent = '已接收，可以下载';
    card.cmProgress.hidden = true;

    if(isImageFileType(f.mimetype)) {
        const img = document.createElement('img');
        img.className = 'cm-file-image';
        img.src = url;
        img.alt = f.name || '聊天图片';
        img.loading = 'lazy';
        card.cmPreview.replaceChildren(img);
    }

    const download = document.createElement('a');
    download.className = 'cm-file-download';
    download.href = url;
    download.download = f.name || 'Cat-Meet-file';
    download.textContent = isImageFileType(f.mimetype) ? '保存图片' : '下载文件';
    card.cmActions.replaceChildren(download);
}

let activeFileBatch = null;

function createFileBatchCard(file, total) {
    const card = document.createElement('div');
    card.className = 'cm-file-card cm-file-batch';

    const preview = document.createElement('div');
    preview.className = 'cm-file-preview';
    if(file.type && file.type.startsWith('image/')) {
        const img = document.createElement('img');
        img.className = 'cm-file-image';
        img.src = URL.createObjectURL(file);
        img.alt = file.name || '聊天图片';
        img.loading = 'lazy';
        preview.appendChild(img);
    } else {
        preview.textContent = '📎';
    }
    card.appendChild(preview);

    const body = document.createElement('div');
    body.className = 'cm-file-body';
    const name = document.createElement('div');
    name.className = 'cm-file-name';
    name.textContent = file.name || '未命名文件';
    body.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'cm-file-meta';
    meta.textContent =
        `${file.type && file.type.startsWith('image/') ? '图片' : '文件'} · ${formatFileSize(file.size)} · ${total} 位成员`;
    body.appendChild(meta);

    const status = document.createElement('div');
    status.className = 'cm-file-status';
    status.textContent = `发送中 · 0/${total}`;
    body.appendChild(status);

    card.appendChild(body);
    card.cmStatus = status;
    return card;
}

function updateFileBatchCard(batch) {
    if(!batch || !batch.card)
        return;
    const completed = batch.done + batch.failed;
    if(batch.failed) {
        batch.card.cmStatus.textContent =
            `已完成 ${completed}/${batch.total}` +
            ` · ${batch.done} 成功 · ${batch.failed} 失败`;
    } else if(batch.done >= batch.total) {
        batch.card.cmStatus.textContent = `已发送给 ${batch.total} 位成员`;
    } else {
        batch.card.cmStatus.textContent =
            `发送中 · ${batch.done}/${batch.total}`;
    }
}

function sendFileToEveryone(file) {
    if(!(file instanceof File))
        return;
    if(!serverConnection || !serverConnection.socket) {
        displayError('请先加入会议后再发送文件');
        return;
    }

    const ids = Object.keys(serverConnection.users).filter(id =>
        id !== serverConnection.id
    );
    if(ids.length === 0) {
        displayMessage('当前会议还没有其他参会者');
        return;
    }

    const batch = {
        file: file,
        total: ids.length,
        done: 0,
        failed: 0,
        transfers: [],
        card: createFileBatchCard(file, ids.length),
    };
    addToChatbox(null, serverConnection.id, null, serverConnection.username,
                 new Date(), false, false, '', batch.card);

    activeFileBatch = batch;
    for(const id of ids) {
        try {
            serverConnection.sendFile(id, file);
        } catch(e) {
            console.error(e);
            batch.failed++;
        }
    }
    activeFileBatch = null;
    updateFileBatchCard(batch);
}

function gotFileTransfer(f) {
    if(f.up && activeFileBatch) {
        const batch = activeFileBatch;
        batch.transfers.push(f);
        f.onevent = function(state) {
            if(state === 'done')
                batch.done++;
            else if(state === 'cancelled')
                batch.failed++;
            updateFileBatchCard(batch);
        };
        return;
    }

    const card = createFileAttachmentCard(f);
    f.cmCard = card;
    f.onevent = gotFileTransferEvent;
    addFileCardToChat(f, card);
}

/**
 * @this {TransferredFile}
 * @param {string} state
 * @param {any} [data]
 */
function gotFileTransferEvent(state, data) {
    const f = this;
    switch(state) {
    case 'inviting':
        updateFileCardStatus(f, f.up ? '等待对方接收…' : '等待接收…');
        break;
    case 'connecting':
        updateFileCardStatus(f, f.up ? '正在建立连接…' : '正在接收…', f.datalen);
        break;
    case 'connected':
        updateFileCardStatus(f, f.up ? '正在发送…' : '正在接收…', f.datalen);
        break;
    case 'done':
        if(f.up) {
            updateFileCardStatus(f, '已发送');
        } else {
            finishIncomingFileCard(f, data);
        }
        break;
    case 'cancelled':
        updateFileCardStatus(f,
            data ? `已取消：${data.toString()}` : '传输已取消');
        break;
    case 'closed':
        break;
    default:
        console.error(`Unexpected state "${state}"`);
        f.cancel(`unexpected state "${state}" (this shouldn't happen)`);
        break;
    }
}

function groupsBase() {
    let url = window.location.href;
    if(!url.endsWith(group + '/'))
       return '';
    return url.slice(0, -(group.length + 1));
}

/**
 * @param {string} id
 * @param {string} dest
 * @param {string} username
 * @param {Date} time
 * @param {boolean} privileged
 * @param {string} kind
 * @param {string} error
 * @param {any} message
 */
function gotUserMessage(id, dest, username, time, privileged, kind, error, message) {
    switch(kind) {
    case 'kicked':
    case 'error':
    case 'warning':
    case 'info': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        let from = id ? (username || 'Anonymous') : 'The Server';
        displayError(`${from} said: ${message}`, kind);
        break;
    }
    case 'mute': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        setLocalMute(true, true);
        let by = username ? ' by ' + username : '';
        displayWarning(`You have been muted${by}`);
        break;
    }
    case 'clearchat': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        let id = message && message.id;
        let userId = message && message.userId;
        clearChat(id, userId);
        break;
    }
    case 'token': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        if(error) {
            displayError(`Token operation failed: ${message}`)
            return
        }
        if(typeof message !== 'object') {
            displayError('Unexpected type for token');
            return;
        }
        let f = formatToken(message, false);
        localMessage(f[0] + ': ' + f[1]);
        if('share' in navigator) {
            try {
                navigator.share({
                    title: `Invitation to Cat-Meet room ${message.group}`,
                    text: f[0],
                    url: f[1],
                });
            } catch(e) {
                console.warn("Share failed", e);
            }
        }
        break;
    }
    case 'tokenlist': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        if(error) {
            displayError(`Token operation failed: ${message}`)
            return
        }
        let s = '';
        for(let i = 0; i < message.length; i++) {
            let f = formatToken(message[i], true);
            s = s + f[0] + ': ' + f[1] + "\n";
        }
        localMessage(s);
        break;
    }
    case 'userinfo': {
        if(!privileged) {
            console.error(`Got unprivileged message of kind ${kind}`);
            return;
        }
        let u = message.username ?
            'username ' + message.username :
            'unknown username';
        let a = message.address ?
            'address ' + message.address :
            'unknown address';
        localMessage(`User ${message.id} has ${u} and ${a}.`);
        break;
    }
    case 'subgrouplist': {
        if(id) {
            console.error(`Got message kind ${kind} not from server`);
            return;
        }
        let div = document.createElement('div');
        if(message.length == 0) {
            div.textContent = window.CatMeetI18n?.translate('No subgroups.') || 'No subgroups.';
        } else {
            let base = groupsBase();
            for(let i = 0; i < message.length; i++) {
                if(i != 0)
                    div.appendChild(document.createElement('br'));
                let sg = message[i];
                let g;
                if(base) {
                    g = document.createElement('a');
                    g.textContent = sg.name;
                    g.href = base + sg.name + '/';
                    g.target = '_blank';
                } else {
                    g = document.createTextNode(sg.name);
                }
                div.appendChild(g);
                let count =
                    !(sg.clientCount) ? ': empty' :
                    sg.clientCount == 1 ? ': 1 client' :
                    `: ${sg.clientCount} clients`
                div.appendChild(document.createTextNode(window.CatMeetI18n?.translate(count) || count));
            }
        }
        localMessage(div);
        break;
    }
    default:
        console.warn(`Got unknown user message ${kind}`);
        break;
    }
};

/**
 * @param {Object} token
 * @param {boolean} [details]
 */
function formatToken(token, details) {
    let url = new URL(window.location.href);
    let params = new URLSearchParams();
    params.append('token', token.token);
    url.search = params.toString();
    let foruser = '', by = '', togroup = '';
    if(token.username)
        foruser = ` for user ${token.username}`;
    if(details) {
        if(token.issuedBy)
            by = ' issued by ' + token.issuedBy;
        if(token.issuedAt) {
            if(by === '')
                by = ' issued at ' + (new Date(token.issuedAt)).toLocaleString();
            else
                by = by + ' at ' + (new Date(token.issuedAt)).toLocaleString();
        }
    } else {
        if(token.group)
            togroup = ' to group ' + token.group;
    }
    let since = '';
    if(token["not-before"])
        since = ` since ${(new Date(token['not-before'])).toLocaleString()}`
    /** @type{Date} */
    let expires = null;
    let until = '';
    if(token.expires) {
        expires = new Date(token.expires)
        until = ` until ${expires.toLocaleString()}`;
    }
    return [
        (expires && (expires >= new Date())) ?
            `Invitation${foruser}${togroup}${by} valid${since}${until}` :
            `Expired invitation${foruser}${togroup}${by}`,
        url.toString(),
    ];
}

const urlRegexp = /https?:\/\/[-a-zA-Z0-9@:%/._\\+~#&()=?]+[-a-zA-Z0-9@:%/_\\+~#&()=]/g;

/**
 * @param {string} text
 * @returns {HTMLDivElement}
 */
function formatText(text) {
    let r = new RegExp(urlRegexp);
    let result = [];
    let pos = 0;
    while(true) {
        let m = r.exec(text);
        if(!m)
            break;
        result.push(document.createTextNode(text.slice(pos, m.index)));
        let a = document.createElement('a');
        a.href = m[0];
        a.textContent = m[0];
        a.target = '_blank';
        a.rel = 'noreferrer noopener';
        result.push(a);
        pos = m.index + m[0].length;
    }
    result.push(document.createTextNode(text.slice(pos)));

    let div = document.createElement('div');
    result.forEach(e => {
        div.appendChild(e);
    });
    return div;
}

/**
 * @param {Date} time
 * @returns {string}
 */
function formatTime(time) {
    let delta = Date.now() - time.getTime();
    let m = time.getMinutes();
    if(delta > -30000)
        return time.getHours() + ':' + ((m < 10) ? '0' : '') + m;
    return time.toLocaleString();
}

/**
 * @typedef {Object} lastMessage
 * @property {string} [nick]
 * @property {string} [peerId]
 * @property {string} [dest]
 * @property {Date} [time]
 */

/** @type {lastMessage} */
let lastMessage = {};

/**
 * @param {string} id
 * @param {string} peerId
 * @param {string} dest
 * @param {string} nick
 * @param {Date} time
 * @param {boolean} privileged
 * @param {boolean} history
 * @param {string} kind
 * @param {string|HTMLElement} message
 */
function addToChatbox(id, peerId, dest, nick, time, privileged, history, kind, message) {
    if(kind === 'caption') {
        displayCaption(message);
        return;
    }

    let row = document.createElement('div');
    row.classList.add('message-row');
    let container = document.createElement('div');
    container.classList.add('message');
    row.appendChild(container);
    let footer = document.createElement('p');
    footer.classList.add('message-footer');
    if(!peerId)
        container.classList.add('message-system');
    if(serverConnection && peerId === serverConnection.id)
        container.classList.add('message-sender');
    if(dest)
        container.classList.add('message-private');

    if(id)
        container.dataset.id = id;
    if(peerId) {
        container.dataset.peerId = peerId;
        container.dataset.username = nick;
        container.addEventListener('click', function(e) {
            if(e.detail !== 2)
                return;
            let elt = e.currentTarget;
            if(!elt || !(elt instanceof HTMLElement))
                throw new Error("Couldn't find chat message div");
            chatMessageMenu(elt);
        });
    }

    /** @type{HTMLElement} */
    let body;
    if(message instanceof HTMLElement) {
        body = message;
    } else if(typeof message === 'string') {
        body = formatText(message);
    } else {
        throw new Error('Cannot add element to chatbox');
    }

    if(kind !== 'me') {
        let doHeader = true;
        if(lastMessage.nick !== (nick || null) ||
           lastMessage.peerId !== (peerId || null) ||
           lastMessage.dest !== (dest || null) ||
           !time || !lastMessage.time) {
            doHeader = true;
        } else {
            let delta = time.getTime() - lastMessage.time.getTime();
            doHeader = delta < 0 || delta > 60000;
        }

        if(doHeader) {
            let header = document.createElement('p');
            let u = dest && serverConnection.users[dest];
            let name = (u && u.username);
            // messages with null id are sent by the server
            if(id || nick) {
                let user = document.createElement('span');
                if(dest)
                    user.textContent =
                        `${nick || '(anon)'} \u2192 ${name || '(anon)'}`;
                else
                    user.textContent = (nick || '(anon)');
                user.classList.add('message-user');
                header.appendChild(user);
            }
            header.classList.add('message-header');
            container.appendChild(header);
            if(time) {
                let tm = document.createElement('span');
                tm.textContent = formatTime(time);
                tm.classList.add('message-time');
                header.appendChild(tm);
            }
        }

        let p = document.createElement('p');
        p.appendChild(body);
        p.classList.add('message-content');
        container.appendChild(p);
        lastMessage.nick = (nick || null);
        lastMessage.peerId = peerId;
        lastMessage.dest = (dest || null);
        lastMessage.time = (time || null);
    } else {
        let asterisk = document.createElement('span');
        asterisk.textContent = '*';
        asterisk.classList.add('message-me-asterisk');
        let user = document.createElement('span');
        user.textContent = nick || '(anon)';
        user.classList.add('message-me-user');
        body.classList.add('message-me-content');
        container.appendChild(asterisk);
        container.appendChild(user);
        container.appendChild(body);
        container.classList.add('message-me');
        lastMessage = {};
    }
    container.appendChild(footer);

    let box = document.getElementById('box');
    box.appendChild(row);
    if(box.scrollHeight > box.clientHeight) {
        box.scrollTop = box.scrollHeight - box.clientHeight;
    }

    return;
}

/**
 * @param {HTMLElement} elt
 */
function chatMessageMenu(elt) {
    if(!(serverConnection && serverConnection.permissions &&
         serverConnection.permissions.indexOf('op') >= 0))
        return;

    let messageId = elt.dataset.id;
    let peerId = elt.dataset.peerId;
    if(!peerId)
        return;
    let username = elt.dataset.username;
    let u = username || 'user';

    let items = [];
    if(messageId)
        items.push({label: 'Delete message', onClick: () => {
            serverConnection.groupAction('clearchat', {
                id: messageId,
                userId: peerId,
            });
        }});
    items.push({label: `Delete all from ${u}`,
                onClick: () => {
                    serverConnection.groupAction('clearchat', {
                        userId: peerId,
                    });
                }});
    items.push({label: `Identify ${u}`, onClick: () => {
        serverConnection.userAction('identify', peerId);
    }});
    items.push({label: `Kick out ${u}`, onClick: () => {
        serverConnection.userAction('kick', peerId);
    }});

    /** @ts-ignore */
    new Contextual({
        items: items,
    });
}

/**
 * @param {string|HTMLElement} message
 */
function setCaption(message) {
    let container = document.getElementById('captions-container');
    let captions = document.getElementById('captions');
    if(!message) {
        captions.replaceChildren();
        container.classList.add('invisible');
    } else {
        if(message instanceof HTMLElement)
            captions.replaceChildren(message);
        else
            captions.textContent = message;
        container.classList.remove('invisible');
    }
}

let captionsTimer = null;

/**
 * @param {string|HTMLElement} message
 */
function displayCaption(message) {
    if(captionsTimer !== null) {
        clearTimeout(captionsTimer);
        captionsTimer = null;
    }
    setCaption(message);
    captionsTimer = setTimeout(() => setCaption(null), 3000);
}

/**
 * @param {string|HTMLElement} message
 */
function localMessage(message) {
    return addToChatbox(null, null, null, null, new Date(), false, false, '', message);
}

/**
 * @param {string} [id]
 * @param {string} [userId]
 */
function clearChat(id, userId) {
    lastMessage = {};

    let box = document.getElementById('box');
    if(!id && !userId) {
        box.textContent = '';
        return;
    }

    let elts = box.children;
    let i = 0;
    while(i < elts.length) {
        let row = elts.item(i);
        if(row instanceof HTMLDivElement) {
            let div = row.firstChild;
            if(div instanceof HTMLDivElement)
                if((!id || div.dataset.id === id) &&
                   div.dataset.peerId === userId) {
                    box.removeChild(row);
                    continue;
                }
        }
        i++;
    }
}

/**
 * A command known to the command-line parser.
 *
 * @typedef {Object} command
 * @property {string} [parameters]
 *     - A user-readable list of parameters.
 * @property {string} [description]
 *     - A user-readable description, null if undocumented.
 * @property {() => string} [predicate]
 *     - Returns null if the command is available.
 * @property {(c: string, r: string) => void} f
 */

/**
 * The set of commands known to the command-line parser.
 *
 * @type {Object.<string,command>}
 */
let commands = {};

function operatorPredicate() {
    if(serverConnection && serverConnection.permissions &&
       serverConnection.permissions.indexOf('op') >= 0)
        return null;
    return 'You are not an operator';
}

function recordingPredicate() {
    if(serverConnection && serverConnection.permissions &&
       serverConnection.permissions.indexOf('record') >= 0)
        return null;
    return 'You are not allowed to record';
}

commands.help = {
    description: 'display this help',
    f: (c, r) => {
        /** @type {string[]} */
        let cs = [];
        for(let cmd in commands) {
            let c = commands[cmd];
            if(!c.description)
                continue;
            if(c.predicate && c.predicate())
                continue;
            cs.push(`/${cmd}${c.parameters?' ' + c.parameters:''}: ${c.description}`);
        }
        localMessage(cs.sort().join('\n'));
    }
};

commands.me = {
    f: (c, r) => {
        // handled as a special case
        throw new Error("this shouldn't happen");
    }
};

commands.set = {
    f: (c, r) => {
        if(!r) {
            let settings = getSettings();
            let s = "";
            for(let key in settings)
                s = s + `${key}: ${JSON.stringify(settings[key])}\n`;
            localMessage(s);
            return;
        }
        let p = parseCommand(r);
        let value;
        if(p[1]) {
            value = JSON.parse(p[1]);
        } else {
            value = true;
        }
        updateSetting(p[0], value);
        reflectSettings();
    }
};

commands.unset = {
    f: (c, r) => {
        delSetting(r.trim());
        return;
    }
};

commands.leave = {
    description: "leave group",
    f: (c, r) => {
        if(!serverConnection)
            throw new Error('Not connected');
        serverConnection.close();
    }
};

commands.clear = {
    predicate: operatorPredicate,
    description: 'clear the chat history',
    f: (c, r) => {
        serverConnection.groupAction('clearchat');
    }
};

commands.lock = {
    predicate: operatorPredicate,
    description: 'lock this group',
    parameters: '[message]',
    f: (c, r) => {
        serverConnection.groupAction('lock', r);
    }
};

commands.unlock = {
    predicate: operatorPredicate,
    description: 'unlock this group, revert the effect of /lock',
    f: (c, r) => {
        serverConnection.groupAction('unlock');
    }
};

commands.record = {
    predicate: recordingPredicate,
    description: 'start recording',
    f: (c, r) => {
        serverConnection.groupAction('record');
    }
};

commands.unrecord = {
    predicate: recordingPredicate,
    description: 'stop recording',
    f: (c, r) => {
        serverConnection.groupAction('unrecord');
    }
};

commands.subgroups = {
    predicate: operatorPredicate,
    description: 'list subgroups',
    f: (c, r) => {
        serverConnection.groupAction('subgroups');
    }
};

commands.touchsubgroup = {
    f: (c, r) => {
        let p = parseCommand(r);
        if(!p[0])
            throw new Error(`/${c} requires parameters`);
        let url = document.location.href + p[0];
        fetch(url, {"method": "HEAD"})
            .then(r => {
                if(r.status >= 300) {
                    displayError(`Group ${p[0]}: ${r.status} ${r.statusText}`);
                }
            })
            .catch(e => displayError(e));
    }
}

commands.msgsubgroup = {
    f: (c, r) => {
        let p = parseCommand(r);
        if(!p[0] || !p[1])
            throw new Error(`/${c} requires parameters`);
        let id = findUserId(p[0]);
        if(!id)
            throw new Error(`Unknown user ${p[0]}`);
        let url = document.location.href + p[1];
        let m = `Please join the group at <${encodeURI(url)}/>.`;
        serverConnection.chat('', id, m);
        addToChatbox(serverConnection.id, null, id, serverConnection.username,
                     new Date(), false, false, '', m);
    }
}

/**
 * @type {Record<string,number>}
 */
const units = {
    s: 1000,
    min: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    mon: 31 * 24 * 60 * 60 * 1000,
    yr: 365 * 24 * 60 * 60 * 1000,
};

/**
 * @param {string} s
 * @returns {Date|number}
 */
function parseExpiration(s) {
    if(!s)
        return null;
    let re = /^([0-9]+)(s|min|h|d|mon|yr)$/
    let e = re.exec(s)
    if(e) {
        let unit = units[e[2]];
        if(!unit)
            throw new Error(`Couldn't find unit ${e[2]}`);
        return parseInt(e[1]) * unit;
    }
    let d = new Date(s);
    if(d.toString() === 'Invalid Date')
        throw new Error("Couldn't parse expiration date");
    return d;
}

function makeTokenPredicate() {
    return (serverConnection.permissions.indexOf('token') < 0 ?
            "You don't have permission to create tokens" : null);
}

function editTokenPredicate() {
    return (serverConnection.permissions.indexOf('token') < 0 ||
            serverConnection.permissions.indexOf('op') < 0 ?
            "You don't have permission to edit or list tokens" : null);
}

/**
 * @param {Object} [template]
 */
function makeToken(template) {
    if(!template)
        template = {};
    let v = {
        group: group,
    }
    if('username' in template)
        v.username = template.username;
    if('expires' in template)
        v.expires = template.expires;
    else
        v.expires = units.d;
    if('not-before' in template)
        v["not-before"] = template["not-before"];
    if('permissions' in template)
        v.permissions = template.permissions;
    else {
        v.permissions = [];
        if(serverConnection.permissions.indexOf('present') >= 0)
            v.permissions.push('present');
        if(serverConnection.permissions.indexOf('message') >= 0)
            v.permissions.push('message');
    }
    serverConnection.groupAction('maketoken', v);
}

commands.invite = {
    predicate: makeTokenPredicate,
    description: "create an invitation link",
    parameters: "[username] [expiration]",
    f: (c, r) => {
        let p = parseCommand(r);
        let template = {};
        if(p[0])
            template.username = p[0];
        let expires = parseExpiration(p[1]);
        if(expires)
            template.expires = expires;
        makeToken(template);
    }
}

/**
 * @param {string} t
 */
function parseToken(t) {
    let m = /^https?:\/\/.*?token=([^?]+)/.exec(t);
    if(m) {
        return m[1];
    } else if(!/^https?:\/\//.exec(t)) {
        return t
    } else {
        throw new Error("Couldn't parse link");
    }
}

commands.reinvite = {
    predicate: editTokenPredicate,
    description: "extend an invitation link",
    parameters: "link [expiration]",
    f: (c, r) => {
        let p = parseCommand(r);
        let v = {}
        v.token = parseToken(p[0]);
        if(p[1])
            v.expires = parseExpiration(p[1]);
        else
            v.expires = units.d;
        serverConnection.groupAction('edittoken', v);
    }
}

commands.revoke = {
    predicate: editTokenPredicate,
    description: "revoke an invitation link",
    parameters: "link",
    f: (c, r) => {
        let token = parseToken(r);
        serverConnection.groupAction('edittoken', {
            token: token,
            expires: -units.s,
        });
    }
}

commands.listtokens = {
    predicate: editTokenPredicate,
    description: "list invitation links",
    f: (c, r) => {
        serverConnection.groupAction('listtokens');
    }
}

function renegotiateStreams() {
    for(let id in serverConnection.up)
        serverConnection.up[id].restartIce();
    for(let id in serverConnection.down)
        serverConnection.down[id].restartIce();
}

commands.renegotiate = {
    description: 'renegotiate media streams',
    f: (c, r) => {
        renegotiateStreams();
    }
};

commands.replace = {
    f: (c, r) => {
        replaceUpStreams(null);
    }
};

commands.sharescreen = {
    description: 'start a screen share',
    f: (c, r) => {
        addShareMedia();
    }
}

commands.unsharescreen = {
    description: 'stop screen share',
    f: (c, r) => {
        closeUpMedia('screenshare');
    }
}

/**
 * parseCommand splits a string into two space-separated parts.  The first
 * part may be quoted and may include backslash escapes.
 *
 * @param {string} line
 * @returns {string[]}
 */
function parseCommand(line) {
    let i = 0;
    while(i < line.length && line[i] === ' ')
        i++;
    let start = ' ';
    if(i < line.length && (line[i] === '"' || line[i] === "'")) {
        start = line[i];
        i++;
    }
    let first = "";
    while(i < line.length) {
        if(line[i] === start) {
            if(start !== ' ')
                i++;
            break;
        }
        if(line[i] === '\\' && i < line.length - 1)
            i++;
        first = first + line[i];
        i++;
    }

    while(i < line.length && line[i] === ' ')
        i++;
    return [first, line.slice(i)];
}

/**
 * @param {string} user
 */
function findUserId(user) {
    if(user in serverConnection.users)
        return user;

    for(let id in serverConnection.users) {
        let u = serverConnection.users[id];
        if(u && u.username === user)
            return id;
    }
    return null;
}

commands.msg = {
    parameters: 'user message',
    description: 'send a private message',
    f: (c, r) => {
        let p = parseCommand(r);
        if(!p[0])
            throw new Error('/msg requires parameters');
        let id = findUserId(p[0]);
        if(!id)
            throw new Error(`Unknown user ${p[0]}`);
        serverConnection.chat('', id, p[1]);
        addToChatbox(serverConnection.id, null, id, serverConnection.username,
                     new Date(), false, false, '', p[1]);
    }
};

/**
   @param {string} c
   @param {string} r
*/
function userCommand(c, r) {
    let p = parseCommand(r);
    if(!p[0])
        throw new Error(`/${c} requires parameters`);
    let id = findUserId(p[0]);
    if(!id)
        throw new Error(`Unknown user ${p[0]}`);
    serverConnection.userAction(c, id, p[1]);
}

function userMessage(c, r) {
    let p = parseCommand(r);
    if(!p[0])
        throw new Error(`/${c} requires parameters`);
    let id = findUserId(p[0]);
    if(!id)
        throw new Error(`Unknown user ${p[0]}`);
    serverConnection.userMessage(c, id, p[1]);
}

commands.kick = {
    parameters: 'user [message]',
    description: 'kick out a user',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.identify = {
    parameters: 'user [message]',
    description: 'identify a user',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.op = {
    parameters: 'user',
    description: 'give operator status',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.unop = {
    parameters: 'user',
    description: 'revoke operator status',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.present = {
    parameters: 'user',
    description: 'give user the right to present',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.unpresent = {
    parameters: 'user',
    description: 'revoke the right to present',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.shutup = {
    parameters: 'user',
    description: 'revoke the right to send chat messages',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.unshutup = {
    parameters: 'user',
    description: 'give the right to send chat messages',
    predicate: operatorPredicate,
    f: userCommand,
};

commands.mute = {
    parameters: 'user',
    description: 'mute a remote user',
    predicate: operatorPredicate,
    f: userMessage,
};

commands.muteall = {
    description: 'mute all remote users',
    predicate: operatorPredicate,
    f: (c, r) => {
        serverConnection.userMessage('mute', null, null, true);
    }
}

commands.warn = {
    parameters: 'user message',
    description: 'send a warning to a user',
    predicate: operatorPredicate,
    f: (c, r) => {
        userMessage('warning', r);
    },
};

commands.wall = {
    parameters: 'message',
    description: 'send a warning to all users',
    predicate: operatorPredicate,
    f: (c, r) => {
        if(!r)
            throw new Error('empty message');
        serverConnection.userMessage('warning', '', r);
    },
};

commands.raise = {
    description: 'raise hand',
    f: (c, r) => {
        serverConnection.userAction(
            "setdata", serverConnection.id, {"raisehand": true},
        );
    }
}

commands.unraise = {
    description: 'unraise hand',
    f: (c, r) => {
        serverConnection.userAction(
            "setdata", serverConnection.id, {"raisehand": null},
        );
    }
}

/** @returns {boolean} */
function canFile() {
    let v =
        /** @ts-ignore */
        !!HTMLVideoElement.prototype.captureStream ||
        /** @ts-ignore */
        !!HTMLVideoElement.prototype.mozCaptureStream;
    return v;
}

function presentFile() {
    let input = document.createElement('input');
    input.type = 'file';
    input.accept="audio/*,video/*";
    input.onchange = function(e) {
        if(!(this instanceof HTMLInputElement))
            throw new Error('Unexpected type for this');
        let files = this.files;
        for(let i = 0; i < files.length; i++) {
            addFileMedia(files[i]).catch(e => {
                console.error(e);
                displayError(e);
            });
        }
    };
    input.click();
}

commands.presentfile = {
    description: 'broadcast a video or audio file',
    f: (c, r) => {
        presentFile();
    },
    predicate: () => {
        if(!canFile())
            return 'Your browser does not support presenting arbitrary files';
        if(!serverConnection || !serverConnection.permissions ||
           serverConnection.permissions.indexOf('present') < 0)
            return 'You are not authorised to present.';
        return null;
    }
};


/**
 * @param {string} id
 */
function sendFile(id) {
    let input = document.createElement('input');
    input.type = 'file';
    input.onchange = function(e) {
        if(!(this instanceof HTMLInputElement))
            throw new Error('Unexpected type for this');
        let files = this.files;
        for(let i = 0; i < files.length; i++) {
            try {
                serverConnection.sendFile(id, files[i]);
            } catch(e) {
                console.error(e);
                displayError(e);
            }
        }
    };
    input.click();
}

commands.sendfile = {
    parameters: 'user',
    description: 'send a file (this will disclose your IP address)',
    f: (c, r) => {
        let p = parseCommand(r);
        if(!p[0])
            throw new Error(`/${c} requires parameters`);
        let id = findUserId(p[0]);
        if(!id)
            throw new Error(`Unknown user ${p[0]}`);
        sendFile(id);
    },
};

/**
 * Test loopback through a TURN relay.
 *
 * @returns {Promise<number>}
 */
async function relayTest() {
    if(!serverConnection)
        throw new Error('not connected');
    let conf = Object.assign({}, serverConnection.getRTCConfiguration());
    conf.iceTransportPolicy = 'relay';
    let pc1 = new RTCPeerConnection(conf);
    let pc2 = new RTCPeerConnection(conf);
    pc1.onicecandidate = e => {e.candidate && pc2.addIceCandidate(e.candidate);};
    pc2.onicecandidate = e => {e.candidate && pc1.addIceCandidate(e.candidate);};
    try {
        return await new Promise(async (resolve, reject) => {
            let d1 = pc1.createDataChannel('loopbackTest');
            d1.onopen = e => {
                d1.send(Date.now().toString());
            };

            let offer = await pc1.createOffer();
            await pc1.setLocalDescription(offer);
            await pc2.setRemoteDescription(pc1.localDescription);
            let answer = await pc2.createAnswer();
            await pc2.setLocalDescription(answer);
            await pc1.setRemoteDescription(pc2.localDescription);

            pc2.ondatachannel = e => {
                let d2 = e.channel;
                d2.onmessage = e => {
                    let t = parseInt(e.data);
                    if(isNaN(t))
                        reject(new Error('corrupt data'));
                    else
                        resolve(Date.now() - t);
                }
            }

            setTimeout(() => reject(new Error('timeout')), 5000);
        })
    } finally {
        pc1.close();
        pc2.close();
    }
}

commands['relay-test'] = {
    f: async (c, r) => {
        localMessage('Relay test in progress...');
        try {
            let s = Date.now();
            let rtt = await relayTest();
            let e = Date.now();
            localMessage(`Relay test successful in ${e-s}ms, RTT ${rtt}ms`);
        } catch(e) {
            localMessage(`Relay test failed: ${e}`);
        }
    }
}

function handleInput() {
    let input = /** @type {HTMLTextAreaElement} */
        (document.getElementById('input'));
    let data = input.value;
    input.value = '';

    let message, me;

    if(data === '')
        return;

    if(data[0] === '/') {
        if(data.length > 1 && data[1] === '/') {
            message = data.slice(1);
            me = false;
        } else {
            let cmd, rest;
            let space = data.indexOf(' ');
            if(space < 0) {
                cmd = data.slice(1);
                rest = '';
            } else {
                cmd = data.slice(1, space);
                rest = data.slice(space + 1);
            }

            if(cmd === 'me') {
                message = rest;
                me = true;
            } else {
                let c = commands[cmd];
                if(!c) {
                    displayError(
                        `Unknown command /${cmd}, type /help for help`
                    );
                    return;
                }
                if(c.predicate) {
                    let s = c.predicate();
                    if(s) {
                        displayError(s);
                        return;
                    }
                }
                try {
                    c.f(cmd, rest);
                } catch(e) {
                    console.error(e);
                    displayError(e);
                }
                return;
            }
        }
    } else {
        message = data;
        me = false;
    }

    if(!serverConnection || !serverConnection.socket) {
        displayError("Not connected.");
        return;
    }

    try {
        serverConnection.chat(me ? 'me' : '', '', message);
    } catch(e) {
        console.error(e);
        displayError(e);
    }
}

document.getElementById('inputform').onsubmit = function(e) {
    e.preventDefault();
    handleInput();
};

document.getElementById('attachbutton').onclick = function() {
    const input = document.getElementById('attachment-input');
    if(!(input instanceof HTMLInputElement))
        return;
    input.click();
};

document.getElementById('attachment-input').onchange = function() {
    if(!(this instanceof HTMLInputElement))
        return;
    const files = Array.from(this.files || []);
    for(const file of files)
        sendFileToEveryone(file);
    this.value = '';
};

document.getElementById('input').addEventListener('paste', function(e) {
    if(!e.clipboardData)
        return;
    const files = Array.from(e.clipboardData.files || [])
        .filter(file => file.type && file.type.startsWith('image/'));
    if(files.length === 0)
        return;

    e.preventDefault();
    for(const file of files)
        sendFileToEveryone(file);

    const text = e.clipboardData.getData('text/plain');
    if(text)
        this.setRangeText(text, this.selectionStart, this.selectionEnd, 'end');
});


document.getElementById('input').onkeypress = function(e) {
    if(e.key === 'Enter' && !e.ctrlKey && !e.shiftKey && !e.metaKey) {
        e.preventDefault();
        handleInput();
    }
};

function chatResizer(e) {
    e.preventDefault();
    let full_width = document.getElementById("mainrow").offsetWidth;
    let left = document.getElementById("left");
    let right = document.getElementById("right");

    let start_x = e.clientX;
    let start_width = left.offsetWidth;

    function start_drag(e) {
        let left_width = (start_width + e.clientX - start_x) * 100 / full_width;
        // set min chat width to 300px
        let min_left_width = 300 * 100 / full_width;
        if (left_width < min_left_width) {
          return;
        }
        left.style.flex = left_width.toString();
        right.style.flex = (100 - left_width).toString();
    }
    function stop_drag(e) {
        document.documentElement.removeEventListener(
            'mousemove', start_drag, false,
        );
        document.documentElement.removeEventListener(
            'mouseup', stop_drag, false,
        );
    }

    document.documentElement.addEventListener(
        'mousemove', start_drag, false,
    );
    document.documentElement.addEventListener(
        'mouseup', stop_drag, false,
    );
}

document.getElementById('resizer').addEventListener('mousedown', chatResizer, false);

/**
 * @param {unknown} message
 * @param {string} [level]
 */
function displayError(message, level) {
    if(message instanceof Error)
        message = message.message;
    if(!level)
        level = "error";
    let position = 'center';
    let gravity = 'top';

    switch(level) {
    case "info":
        position = 'right';
        gravity = 'bottom';
        break;
    case "warning":
        break;
    case "kicked":
        level = "error";
        break;
    }

    /** @ts-ignore */
    Toastify({
        text: message,
        duration: 4000,
        close: true,
        position: position,
        gravity: gravity,
        className: level,
    }).showToast();
}

/**
 * @param {unknown} message
 */
function displayWarning(message) {
    return displayError(message, "warning");
}

/**
 * @param {unknown} message
 */
function displayMessage(message) {
    return displayError(message, "info");
}

document.getElementById('loginform').onsubmit = async function(e) {
    e.preventDefault();

    let form = this;
    if(!(form instanceof HTMLFormElement))
        throw new Error('Bad type for loginform');

    setVisibility('passwordform', true);
    pendingRememberedLogin = null;
    triedRememberedLogin = false;
    if(!getInputElement('remember-login').checked)
        forgetRememberedLogin();

    if(getInputElement('presentboth').checked)
        presentRequested = 'both';
    else if(getInputElement('presentmike').checked)
        presentRequested = 'mike';
    else if(getInputElement('presentcamera').checked)
        presentRequested = 'camera';
    else
        presentRequested = null;
    getInputElement('presentoff').checked = true;

    // Connect to the server, gotConnected will join.
    serverConnect();
};


/** @type{CameraTest} */
let cameraTest = null;

document.getElementById('test-camera').ontoggle = async function(e) {
    let details = this;
    if(!(details instanceof HTMLDetailsElement))
        throw new Error('Unexpected type for this');
    if(details.open) {
        if(!cameraTest) {
            let video = document.getElementById('test-video');
            if(!(video instanceof HTMLVideoElement))
                throw new Error('Bad type for video');
            let canvas = document.getElementById('test-fft');
            if(!(canvas instanceof HTMLCanvasElement))
                throw new Error('Bad type for FFT canvas');
            cameraTest = new CameraTest(
                video, canvas,
                getSelectElement('test-videoselect'),
                getSelectElement('test-audioselect'),
            );
        }
        try {
            await cameraTest.setMediaChoices();
            cameraTest.reflectSettings();
            if(cameraTest.video.srcObject != null)
                return;
            await cameraTest.setStream(true);
            await cameraTest.setMediaChoices();
            cameraTest.reflectSettings();
            await cameraTest.setAnalyser();
        } catch(e) {
            displayError(e);
            await cameraTest.stopStream();
            await cameraTest.setAnalyser();
        }
    } else {
        if(!cameraTest)
            return;
        try {
            await cameraTest.stopStream();
            await cameraTest.setAnalyser();
        } catch(e) {
            displayError(e);
        }
    }
}

getSelectElement('test-videoselect').onchange = async function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    if(!cameraTest)
        throw new Error('Camera test not started');
    updateSettings({video: this.value});
    try {
        await cameraTest.setStream();
        await cameraTest.setAnalyser();
    } catch(e) {
        displayError(e);
    }
};

getSelectElement('test-audioselect').onchange = async function(e) {
    e.preventDefault();
    if(!(this instanceof HTMLSelectElement))
        throw new Error('Unexpected type for this');
    if(!cameraTest)
        throw new Error('Camera test not started');
    updateSettings({audio: this.value});
    try {
        await cameraTest.setStream();
        await cameraTest.setAnalyser();
    } catch(e) {
        displayError(e);
    }
};

document.getElementById('disconnectbutton').onclick = function(e) {
    serverConnection.close();
    closeNav();
};

function openNav() {
    document.getElementById("sidebarnav").classList.add("is-open");
}

function closeNav() {
    document.getElementById("sidebarnav").classList.remove("is-open");
}

document.getElementById('sidebarCollapse').onclick = function(e) {
    document.getElementById("left-sidebar").classList.toggle("active");
    document.getElementById("mainrow").classList.toggle("full-width-active");
};

document.getElementById('openside').onclick = function(e) {
    e.preventDefault();
    if(document.getElementById("sidebarnav").classList.contains("is-open"))
        closeNav();
    else
        openNav();
};


document.getElementById('clodeside').onclick = function(e) {
    e.preventDefault();
    closeNav();
};

document.getElementById('collapse-video').onclick = function(e) {
    e.preventDefault();
    setVisibility('collapse-video', false);
    setVisibility('show-video', true);
    hideVideo(true);
};

document.getElementById('show-video').onclick = function(e) {
    e.preventDefault();
    setVisibility('video-container', true);
    setVisibility('collapse-video', true);
    setVisibility('show-video', false);
};

document.getElementById('close-chat').onclick = function(e) {
    e.preventDefault();
    setVisibility('left', false);
    setVisibility('show-chat', true);
    resizePeers();
};

document.getElementById('show-chat').onclick = function(e) {
    e.preventDefault();
    setVisibility('left', true);
    setVisibility('show-chat', false);
    resizePeers();
};

async function serverConnect() {
    if(serverConnection && serverConnection.socket)
        serverConnection.close();
    serverConnection = new ServerConnection();
    serverConnection.onconnected = gotConnected;
    serverConnection.onerror = function(e) {
        console.error(e);
        displayError(e);
    };
    serverConnection.onpeerconnection = onPeerConnection;
    serverConnection.onclose = gotClose;
    serverConnection.ondownstream = gotDownStream;
    serverConnection.onuser = gotUser;
    serverConnection.onjoined = gotJoined;
    serverConnection.onremember = gotRememberedLogin;
    serverConnection.onchat = addToChatbox;
    serverConnection.onusermessage = gotUserMessage;
    serverConnection.onfiletransfer = gotFileTransfer;

    let url = groupStatus.endpoint;
    if(!url) {
        console.warn("no endpoint in status");
        url = `ws${location.protocol === 'https:' ? 's' : ''}://${location.host}/ws`;
    }

    try {
        await serverConnection.connect(url);
    } catch(e) {
        console.error(e);
        displayError(`Couldn't connect to ${url}: ${e.message}`);
    }
}

async function start() {
    try {
        let r = await fetch(".status")
        if(!r.ok)
            throw new Error(`${r.status} ${r.statusText}`);
        groupStatus = await r.json()
    } catch(e) {
        console.error(e);
        displayWarning("Couldn't fetch status: " + e);
        groupStatus = {};
    }

    if(groupStatus.name) {
        group = groupStatus.name;
    } else {
        console.warn("no group name in status");
        group = decodeURIComponent(
            location.pathname.replace(/^\/[a-z]*\//, '').replace(/\/$/, ''),
        );
    }

    // Disable simulcast on Firefox by default, it's buggy.
    if(isFirefox())
        getSelectElement('simulcastselect').value = 'off';

    let parms = new URLSearchParams(window.location.search);
    if(window.location.search)
        window.history.replaceState(null, '', window.location.pathname);
    setTitle(groupStatus.displayName || capitalise(group));

    addFilters();
    await setMediaChoices(false);
    reflectSettings();
    updateCameraButton();

    // Always show the local account/password form. Do not silently join via
    // invitation tokens or redirect around the room's credential prompt.
    token = null;
    if(parms.has('token')) {
        displayWarning('请使用会议室账号和密码登录，邀请链接不会跳过验证。');
        parms.delete('token');
        window.history.replaceState(null, '', window.location.pathname);
    }
    setVisibility('login-container', true);
    getInputElement('username').required = true;
    getInputElement('password').required = true;
    getInputElement('username').focus();
    getInputElement('connectbutton').disabled = false;
    setViewportHeight();

    // Auto-login applies only to a password-verified, non-expired room session.
    // Untrusted invitation URL tokens never enter this path.
    if(!groupStatus.authServer && !parms.has('token')) {
        const saved = readRememberedLogin();
        if(saved) {
            pendingRememberedLogin = saved;
            getInputElement('username').value = saved.username;
            // Preserve the default receive-only state; no camera/mic prompt.
            presentRequested = null;
            serverConnect();
            return;
        }
    }
    getInputElement('username').focus();
}

start();