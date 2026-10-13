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
        setButtonsVisibility: () => { updated = true; },
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