'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { test } = require('node:test');

const galene = fs.readFileSync('static/galene.js', 'utf8');
const cameraTestSource = fs.readFileSync('static/camera-test.js', 'utf8');
const contextual = fs.readFileSync('static/third-party/contextual/contextual.js', 'utf8');

test('menu escapes participant-controlled names', () => {
    const sandbox = {};
    vm.runInNewContext(contextual + '\nthis.escapeMenu = contextualCore.EscapeText;', sandbox);
    const escaped = sandbox.escapeMenu('<img src=x onerror="alert(1)"> &');
    assert.equal(escaped, '&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp;');
    assert.match(contextual, /EscapeText\(label == undefined/);
});

test('joining with no devices selected never requests an empty media stream', async () => {
    const match = galene.match(/async function addLocalMedia\(localId\) \{[\s\S]*?\n\}\n\nlet safariScreenshareDone/);
    assert.ok(match, 'camera sender source was not found');
    let calls = 0;
    let updated = false;
    const sandbox = {
        getSettings: () => ({video: '', audio: ''}),
        serverConnection: {findByLocalId: () => null},
        findUpMedia: () => null,
        setButtonsVisibility: () => { updated = true; },
        setLocalMute: () => {},
        updateCameraButton: () => {},
        navigator: {mediaDevices: {getUserMedia: () => { calls++; throw Error('unexpected'); }}},
        console,
    };
    vm.runInNewContext(match[0].replace(/\n\nlet safariScreenshareDone$/, '') +
        '\nthis.addMedia = addLocalMedia;', sandbox);
    await sandbox.addMedia();
    assert.equal(calls, 0);
    assert.equal(updated, true);
});

test('Safari autoplay does not automatically ask for microphone permission', () => {
    assert.doesNotMatch(galene, /openSafariStream\(/);
    assert.doesNotMatch(galene, /getUserMedia\(\{audio:\s*true\}\)/);
});

test('camera test does not request disabled devices', async () => {
    let calls = 0;
    const sandbox = {
        getSettings: () => ({audio: '', video: ''}),
        navigator: {mediaDevices: {
            getUserMedia: async () => { calls++; throw Error('unexpected permission prompt'); },
            enumerateDevices: async () => [],
        }},
        console,
    };
    vm.runInNewContext(cameraTestSource, sandbox);
    const camera = new sandbox.CameraTest(
        {srcObject: null}, {width: 320, height: 50},
        {children: []}, {children: []},
    );
    await camera.setMediaChoices();
    await camera.setStream(true);
    assert.equal(calls, 0);
});

test('video-only device test does not create an audio analyser', async () => {
    const sandbox = {};
    vm.runInNewContext(cameraTestSource, sandbox);
    const camera = new sandbox.CameraTest(
        {srcObject: {getAudioTracks: () => []}}, {},
        {children: []}, {children: []},
    );
    let started = 0, stopped = 0;
    camera.startAnalyser = async () => { started++; };
    camera.stopAnalyser = async () => { stopped++; };
    await camera.setAnalyser();
    assert.equal(started, 0);
    assert.equal(stopped, 1);
});
test('audio-only joins without requesting the camera, even when devices are not enumerated', async () => {
    const match = galene.match(/async function addLocalMedia\(localId\) \{[\s\S]*?\n\}\n\nlet safariScreenshareDone/);
    assert.ok(match);
    const calls = [];
    const streams = [];
    class Stream {
        constructor(tracks) { this.tracks = tracks; }
        getTracks() { return this.tracks; }
        getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
        getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
    }
    const settings = {audio: 'default', video: '', localMute: false, preprocessing: true};
    const sandbox = {
        getSettings: () => settings,
        serverConnection: {
            permissions: ['present'],
            findByLocalId: () => null,
        },
        findUpMedia: () => null,
        navigator: {mediaDevices: {getUserMedia: async c => {
            calls.push(c);
            return new Stream([{kind: 'audio', readyState: 'live', stop() {}}]);
        }}},
        MediaStream: Stream,
        newUpStream: () => ({userdata: {}, localId: 'test', stream: null, close() {}}),
        setUpStream: async (c, s) => {c.stream = s; streams.push(s);},
        setMedia: async () => {},
        setMediaChoices: () => {},
        setButtonsVisibility: () => {},
        updateCameraButton: () => {},
        setLocalMute: () => {},
        filters: {},
        displayError: e => {throw e;},
        displayWarning: () => {},
        console,
    };
    vm.runInNewContext(match[0].replace(/\n\nlet safariScreenshareDone$/, '') +
        '\nthis.addMedia = addLocalMedia;', sandbox);
    await sandbox.addMedia();
    assert.equal(calls.length, 1);
    assert.equal(!!calls[0].audio, true);
    assert.equal(calls[0].video, false);
    assert.equal(streams[0].getAudioTracks().length, 1);
    assert.equal(streams[0].getVideoTracks().length, 0);
});

test('camera-only acquisition survives denied microphone access and later turns off without recapturing audio', async () => {
    const match = galene.match(/async function addLocalMedia\(localId\) \{[\s\S]*?\n\}\n\nlet safariScreenshareDone/);
    assert.ok(match);
    let active = null;
    const calls = [], errors = [];
    class Stream {
        constructor(tracks) { this.tracks = tracks; }
        getTracks() { return this.tracks; }
        getAudioTracks() { return this.tracks.filter(t => t.kind === 'audio'); }
        getVideoTracks() { return this.tracks.filter(t => t.kind === 'video'); }
    }
    const audioTrack = {kind: 'audio', readyState: 'live', stop() {this.readyState = 'ended';}};
    const videoTrack = {kind: 'video', readyState: 'live', stop() {this.readyState = 'ended';}};
    const settings = {audio: 'default', video: 'default', localMute: false, preprocessing: true};
    const sandbox = {
        getSettings: () => settings,
        serverConnection: {
            permissions: ['present'],
            findByLocalId: () => active,
        },
        findUpMedia: () => active,
        navigator: {mediaDevices: {getUserMedia: async c => {
            calls.push(c);
            if(c.audio) throw Error('microphone denied');
            return new Stream([videoTrack]);
        }}},
        MediaStream: Stream,
        newUpStream: id => {
            if(active) active.close(true);
            active = {userdata: {}, localId: id || 'test', stream: null,
                close(replace) {
                    if(!replace) {
                        if(this.stream) this.stream.getTracks().forEach(t => t.stop());
                        active = null;
                    }
                }};
            return active;
        },
        setUpStream: async (c, s) => {c.stream = s;},
        setMedia: async () => {},
        setMediaChoices: () => {},
        removeFilter: async () => {},
        setButtonsVisibility: () => {},
        updateCameraButton: () => {},
        setLocalMute: () => {},
        filters: {},
        displayError: e => errors.push(e.message),
        displayWarning: () => {},
        console,
    };
    vm.runInNewContext(match[0].replace(/\n\nlet safariScreenshareDone$/, '') +
        '\nthis.addMedia = addLocalMedia;', sandbox);
    await sandbox.addMedia();
    assert.equal(errors.length, 1);
    assert.equal(calls.length, 2);
    assert.equal(active.stream.getVideoTracks().length, 1);
    assert.equal(active.stream.getAudioTracks().length, 0);
    settings.audio = '';
    await sandbox.addMedia(active.localId);
    assert.equal(calls.length, 2, 'unchanged video track must be reused');
    assert.equal(active.stream.getVideoTracks()[0], videoTrack);
    settings.video = '';
    await sandbox.addMedia(active.localId);
    assert.equal(videoTrack.readyState, 'ended');
    assert.equal(active, null);
});

test('camera toolbar uses the same non-button structure as microphone toolbar', () => {
    const html = fs.readFileSync('static/galene.html', 'utf8');
    assert.match(html, /<div id="camerabutton" class="invisible nav-link nav-button"/);
    assert.doesNotMatch(html, /<button id="camerabutton"/);
});

test('Simplified Chinese translations cover all settings, option labels and English fallback', () => {
    const code = fs.readFileSync('static/i18n.js', 'utf8');
    const handlers = {};
    const sandbox = {window: {}, document: {addEventListener: (name, fn) => { handlers[name] = fn; }}};
    vm.runInNewContext(code, sandbox);
    const translate = sandbox.window.CatGaleneI18n.translate;
    const required = [
        ['High-quality audio', '高质量音频'],
        ['Other Settings', '其他设置'],
        ['Filter:', '滤镜：'],
        ['none', '无'],
        ['Send:', '发送画质：'],
        ['normal', '标准'],
        ['Screen share (next share):', '下次屏幕共享：'],
        ['smooth video', '流畅视频'],
        ['Simulcast:', '分层编码：'],
        ['auto', '自动'],
        ['Receive:', '接收内容：'],
        ['everything', '全部音视频'],
        ['Activity detection', '活动检测'],
        ['Display audio-only users', '显示仅音频用户'],
        ['Default camera', '默认摄像头'],
        ['Default microphone', '默认麦克风'],
        ['Share Screen', '共享屏幕'],
    ];
    for(const [english, chinese] of required) {
        assert.equal(translate(english, 'zh-CN'), chinese);
        assert.equal(translate(english, 'en'), english);
    }
    assert.equal(translate('Camera 2', 'zh-CN'), '摄像头 2');
    assert.equal(translate('(3 clients, locked)', 'zh-CN'), '（3 人，已锁定）');
});

test('join choices preserve fully independent device intents', () => {
    const match = galene.match(/function configureJoinDevices\(present\) \{[\s\S]*?\n\}\n/);
    assert.ok(match);
    const settings = {audio: 'default', video: 'default', localMute: false};
    const sandbox = {
        getSettings: () => settings,
        updateSettings: changed => Object.assign(settings, changed),
        reflectSettings: () => {},
        updateCameraButton: () => {},
    };
    vm.runInNewContext(match[0] + '\nthis.configure = configureJoinDevices;', sandbox);
    sandbox.configure(null);
    assert.equal(settings.audio, '');
    assert.equal(settings.video, '');
    assert.equal(settings.localMute, true);
    sandbox.configure('mike');
    assert.equal(settings.audio, 'default');
    assert.equal(settings.video, '');
    assert.equal(settings.localMute, false);
    sandbox.configure('both');
    assert.equal(settings.audio, 'default');
    assert.equal(settings.video, 'default');
    assert.equal(settings.localMute, false);
});

const settingsSource = fs.readFileSync('static/settings.js', 'utf8');

test('screen sharing profiles support native, presets, custom size, FPS and bitrate', () => {
    const source = galene.match(/function getScreenShareProfile\(settings\) \{[\s\S]*?\n\}\n/);
    assert.ok(source, 'screen share profile helper not found');
    const sandbox = {};
    vm.runInNewContext(source[0] + '\nthis.profile = getScreenShareProfile;', sandbox);
    const defaults = sandbox.profile({screenShareMode: 'motion'});
    assert.equal(defaults.video.frameRate.ideal, 30);
    assert.equal(defaults.video.width, undefined);
    assert.ok(defaults.bitrate > 15000000);

    const sharp = sandbox.profile({
        screenShareMode: 'detail', screenShareResolution: '720p',
        screenShareFPS: '15', screenShareBitrate: '8',
    });
    assert.equal(sharp.video.width.ideal, 1280);
    assert.equal(sharp.video.height.max, 720);
    assert.equal(sharp.video.frameRate.max, 15);
    assert.equal(sharp.bitrate, 8000000);
    assert.equal(sharp.contentHint, 'text');

    const custom = sandbox.profile({
        screenShareResolution: 'custom', screenShareWidth: 2001,
        screenShareHeight: 1125, screenShareFPS: 'custom',
        screenShareCustomFPS: 75, screenShareBitrate: 'custom',
        screenShareCustomBitrate: 42.5,
    });
    assert.equal(custom.video.width.max, 2002);
    assert.equal(custom.video.height.max, 1126);
    assert.equal(custom.video.frameRate.ideal, 75);
    assert.equal(custom.bitrate, 42500000);

    const twoK = sandbox.profile({screenShareResolution: '2k', screenShareFPS: '60'});
    assert.equal(twoK.video.width.ideal, 2560);
    assert.equal(twoK.video.height.ideal, 1440);
    assert.equal(twoK.video.frameRate.ideal, 60);
    assert.ok(twoK.bitrate > 30000000);
    const invalid = sandbox.profile({
        screenShareResolution: 'custom', screenShareWidth: 99999,
        screenShareHeight: -20, screenShareFPS: 'custom', screenShareCustomFPS: 0,
        screenShareBitrate: 'custom', screenShareCustomBitrate: 9000,
    });
    assert.equal(invalid.video.width.max, 1920);
    assert.equal(invalid.video.height.max, 1080);
    assert.equal(invalid.video.frameRate.max, 30);
    assert.ok(invalid.bitrate <= 100000000);
});

test('screen sharing bitrate is separate from webcam send bitrate', () => {
    const profile = galene.match(/function getScreenShareProfile\(settings\) \{[\s\S]*?\n\}\n/)[0];
    const throughput = galene.match(/function getMaxVideoThroughput\(label\) \{[\s\S]*?\n\}\n/)[0];
    const sandbox = {
        getSettings: () => ({
            send: 'normal', screenShareResolution: '1080p',
            screenShareFPS: '30', screenShareBitrate: 'custom',
            screenShareCustomBitrate: 28,
        }),
        console,
    };
    vm.runInNewContext(profile + throughput +
        '\nthis.maxVideo = getMaxVideoThroughput;', sandbox);
    assert.equal(sandbox.maxVideo('camera'), 700000);
    assert.equal(sandbox.maxVideo('screenshare'), 28000000);
});

test('capture passes chosen screen resolution and 60 FPS into getDisplayMedia', async () => {
    const profile = galene.match(/function getScreenShareProfile\(settings\) \{[\s\S]*?\n\}\n/)[0];
    const source = galene.match(/let safariScreenshareDone = false;[\s\S]*?\n\}\n\n\/\*\*\n \* @param \{File\} file/);
    assert.ok(source, 'screen capture implementation not found');
    let constraints, streamSent, status = false;
    const track = {kind: 'video', contentHint: ''};
    const stream = {getVideoTracks: () => [track], getTracks: () => [track]};
    const sandbox = {
        navigator: {mediaDevices: {getDisplayMedia: async request => {
            constraints = request;
            return stream;
        }}},
        getSettings: () => ({
            screenShareResolution: '2k', screenShareMode: 'motion',
            screenShareFPS: '60', screenShareBitrate: '35',
        }),
        isSafari: () => false,
        newUpStream: () => ({label: ''}),
        setUpStream: async (c, s) => {streamSent = s;},
        setMedia: async () => {},
        setButtonsVisibility: () => {status = true;},
        displayError: e => {throw e;},
        console,
    };
    vm.runInNewContext(profile +
        source[0].replace(/\n\n\/\*\*\n \* @param \{File\} file$/, '') +
        '\nthis.share = addShareMedia;', sandbox);
    await sandbox.share();
    assert.equal(constraints.audio, true);
    assert.equal(constraints.video.width.ideal, 2560);
    assert.equal(constraints.video.height.ideal, 1440);
    assert.equal(constraints.video.frameRate.max, 60);
    assert.equal(track.contentHint, 'motion');
    assert.equal(streamSent, stream);
    assert.equal(status, true);
});

test('preferences persist between browser sessions and migrate older session settings', () => {
    const local = new Map(), session = new Map();
    const createContext = (legacy) => {
        const sandbox = {
            window: {
                localStorage: {
                    getItem: key => local.get(key) || null,
                    setItem: (key, value) => local.set(key, value),
                },
                sessionStorage: {
                    getItem: key => (legacy || session).get(key) || null,
                    setItem: (key, value) => session.set(key, value),
                },
            },
        };
        vm.runInNewContext(settingsSource +
            '\nthis.getSaved = getSettings; this.changeSaved = updateSettings;', sandbox);
        return sandbox;
    };
    const first = createContext();
    first.changeSaved({
        screenShareResolution: '2k', screenShareFPS: '60',
        screenShareBitrate: 'custom', screenShareCustomBitrate: 35,
    });
    const second = createContext(new Map());
    assert.equal(second.getSaved().screenShareResolution, '2k');
    assert.equal(second.getSaved().screenShareFPS, '60');
    assert.equal(second.getSaved().screenShareCustomBitrate, 35);

    local.clear();
    const older = new Map([['settings', JSON.stringify({screenShareMode: 'detail'})]]);
    const migrated = createContext(older);
    assert.equal(migrated.getSaved().screenShareMode, 'detail');
    migrated.changeSaved({screenShareFPS: '24'});
    assert.equal(JSON.parse(local.get('cat-galene-settings')).screenShareFPS, '24');
});

test('sharing preference controls exist with translated labels', () => {
    const html = fs.readFileSync('static/galene.html', 'utf8');
    for(const id of ['screenresselect', 'screenwidth', 'screenheight',
        'screenfpsselect', 'screenfps', 'screenbitrateselect', 'screenbitrate'])
        assert.ok(html.includes('id="' + id + '"'), 'missing ' + id);
    const i18n = fs.readFileSync('static/i18n.js', 'utf8');
    assert.match(i18n, /"Capture resolution:": "采集分辨率："/);
    assert.match(i18n, /"Share bitrate:": "共享码率："/);
});

test('receiver never auto-downgrades shared screens when the player is small', () => {
    const found = galene.match(/function reconsiderDownRate\(id\) \{[\s\S]*?\n\}\n\nlet reconsiderDownRateTimer/);
    assert.ok(found, 'could not extract the receive-quality logic');
    const requests = [];
    const media = {scrollWidth: 160, scrollHeight: 90};
    const stream = {
        label: 'screenshare', localId: 'peer-one',
        userdata: {requested: {}},
        request(value) {requests.push(value);},
    };
    let preference = 'everything';
    const sandbox = {
        serverConnection: {down: {'one': stream}},
        getSettings: () => ({request: preference}),
        mapRequestLabel: value => value === 'everything-low' ?
            ['audio', 'video-low'] : ['audio', 'video'],
        mapVideoToLow: tracks => tracks.includes('video') ?
            tracks.map(t => t === 'video' ? 'video-low' : t) : null,
        document: {getElementById: () => media},
    };
    vm.runInNewContext(found[0].replace(/\n\nlet reconsiderDownRateTimer$/, '') +
        '\nthis.updateReceiveQuality = reconsiderDownRate;', sandbox);

    sandbox.updateReceiveQuality('one');
    assert.equal(requests.length, 0, 'small screen shares should remain high quality');
    assert.equal(stream.userdata.requested.low, undefined);

    // Old sessions might already have requested the low-resolution layer.
    stream.userdata.requested.low = true;
    sandbox.updateReceiveQuality('one');
    assert.equal(requests.length, 1);
    assert.equal(requests[0], null, 'reset prior low-quality stream override');
    assert.equal(stream.userdata.requested.low, false);
    sandbox.updateReceiveQuality('one');
    assert.equal(requests.length, 1, 'do not repeatedly renegotiate');

    // Keep existing quality-saving behaviour for participant webcams.
    stream.label = 'camera';
    sandbox.updateReceiveQuality('one');
    assert.deepEqual(Array.from(requests[1]), ['audio', 'video-low']);
    assert.equal(stream.userdata.requested.low, true);
    media.scrollWidth = 1280;
    media.scrollHeight = 720;
    sandbox.updateReceiveQuality('one');
    assert.equal(requests[2], null);
    assert.equal(stream.userdata.requested.low, false);

    // A user's explicit low-quality receive setting must still be honoured.
    stream.label = 'screenshare';
    preference = 'everything-low';
    media.scrollWidth = 160;
    media.scrollHeight = 90;
    sandbox.updateReceiveQuality('one');
    assert.equal(requests.length, 3);
});

test('screen sharing prioritises resolution without changing webcams or bitrate', async () => {
    const m = galene.match(/async function preferScreenShareResolution\(c\) \{[\s\S]*?\n\}\n/);
    assert.ok(m, 'missing sender resolution preference');
    assert.match(galene, /await preferScreenShareResolution\(c\);/);
    const updates = [];
    const video = {
        track: {kind: 'video'},
        getParameters: () => ({encodings: [{maxBitrate: 35000000}]}),
        setParameters: async p => updates.push(p),
    };
    const audio = {
        track: {kind: 'audio'},
        setParameters: () => {throw Error('must not change audio sender');},
    };
    const sandbox = {console};
    vm.runInNewContext(m[0] + '\nthis.prefer = preferScreenShareResolution;', sandbox);
    const c = {label: 'camera', pc: {getSenders: () => [video, audio]}};
    await sandbox.prefer(c);
    assert.equal(updates.length, 0);
    c.label = 'screenshare';
    await sandbox.prefer(c);
    assert.equal(updates.length, 1);
    assert.equal(updates[0].degradationPreference, 'maintain-resolution');
    assert.equal(updates[0].encodings[0].maxBitrate, 35000000);
    c.pc.getSenders = () => [{
        track: {kind: 'video'},
        getParameters: () => ({encodings: [{}]}),
        setParameters: async () => {throw Error('unsupported');},
    }];
    await assert.doesNotReject(sandbox.prefer(c));
});
