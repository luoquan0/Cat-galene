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
