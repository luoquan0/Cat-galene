// Cat-Meet administration UI. All requests are same-origin and authenticated
// by the server; never persist the password or an authentication token.
'use strict';
(() => {
    const $ = id => document.getElementById(id);
    const API = '/galene-api/v0/.groups';
    const roles = new Set(['present', 'op', 'message', 'observe', 'admin']);
    const roomNamePattern = /^[\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*$/u;
    const userNamePattern = /^[\p{L}\p{N}_][\p{L}\p{N}_.-]*$/u;
    const state = {
        authorization: '',
        username: '',
        writable: false,
        groups: [],
        group: '',
        groupEntry: null,
        users: [],
        user: '',
        userEntry: null,
    };

    function validRoom(value) {
        return typeof value === 'string' && value.length <= 128 &&
            roomNamePattern.test(value) &&
            value.split('/').every(s => s.length <= 64 && s !== '.' && s !== '..');
    }
    function validUser(value) {
        return typeof value === 'string' && value.length <= 64 &&
            userNamePattern.test(value) && value !== '.' && value !== '..';
    }
    function roomPath(value) {
        if(!validRoom(value))
            throw new Error('会议室标识不合法，不能包含 URL 或路径控制字符。');
        return value.split('/').map(encodeURIComponent).join('/');
    }
    function userPath(value) {
        if(!validUser(value))
            throw new Error('用户名不合法，不能包含 URL 或路径控制字符。');
        return encodeURIComponent(value);
    }
    function rootPath(room) {
        return API + '/' + roomPath(room);
    }
    function memberPath(room, user) {
        return rootPath(room) + '/.users/' + userPath(user);
    }
    function credentialValue(user, password) {
        const encoded = new TextEncoder().encode(user + ':' + password);
        let binary = '';
        for(const byte of encoded)
            binary += String.fromCharCode(byte);
        return 'Basic ' + btoa(binary);
    }
    function verifyPassword(password) {
        const length = new TextEncoder().encode(password).length;
        if(length < 12 || length > 72)
            throw new Error('密码长度须为 12–72 字节，以符合 bcrypt 安全限制。');
    }
    function requireWritable() {
        if(!state.writable)
            throw new Error('服务器尚未启用 writableGroups，无法保存更改。');
    }
    function notify(message, kind = 'success') {
        const node = $('action-message');
        node.textContent = message || '';
        node.className = 'notification ' + (message ? kind : '');
    }
    function errorText(error) {
        if(error instanceof Error)
            return error.message;
        return String(error);
    }
    function submitError(error) {
        notify(errorText(error), 'error');
    }
    function showLogin() {
        state.authorization = '';
        state.username = '';
        state.groupEntry = null;
        state.userEntry = null;
        $('dashboard').hidden = true;
        $('login-panel').hidden = false;
        $('logout').hidden = true;
        $('admin-identity').hidden = true;
        $('login-password').value = '';
    }
    async function api(path, {method = 'GET', data, password, etag, create = false} = {}) {
        // Relative, structured paths only: never fetch a URL from server data.
        if(!path.startsWith('/galene-api/v0/') || path.includes('://') ||
           path.includes(String.fromCharCode(92)) || /(^|\/)\.\.?($|\/)/.test(path) || path.includes('?') ||
           path.includes('#'))
            throw new Error('禁止访问不合法的管理 API 路径。');
        const headers = new Headers({Authorization: state.authorization, Accept: 'application/json'});
        if(etag)
            headers.set('If-Match', etag);
        if(create)
            headers.set('If-None-Match', '*');
        let body;
        if(data !== undefined) {
            headers.set('Content-Type', 'application/json');
            body = JSON.stringify(data);
        } else if(password !== undefined) {
            headers.set('Content-Type', 'text/plain;charset=UTF-8');
            body = password;
        }
        let response;
        try {
            response = await fetch(path, {
                method, headers, body, mode: 'same-origin',
                credentials: 'omit', redirect: 'error',
                referrerPolicy: 'no-referrer', cache: 'no-store',
            });
        } catch (_) {
            throw new Error('无法连接到管理接口。请检查服务器地址、HTTPS 证书或代理设置。');
        }
        if(!response.ok) {
            if(response.status === 401 && path !== '/galene-api/v0/.admin-session')
                showLogin();
            const reasons = {401:'身份认证失效，请重新登录',403:'无权限或用户名/密码错误',
                404:'目标不存在',409:'内容已被其他管理员修改',412:'内容已被修改，请刷新后重试',
                413:'提交内容过大',429:'请求过于频繁',500:'服务端处理失败'};
            throw new Error(reasons[response.status] || ('请求失败 HTTP ' + response.status));
        }
        if(method === 'GET') {
            return {data: await response.json(), etag: response.headers.get('ETag')};
        }
        return {etag: response.headers.get('ETag')};
    }
    function setReadonly() {
        $('readonly-notice').hidden = state.writable;
        $('server-status').textContent = state.writable ? '● 已连接 · 可管理' : '● 已连接 · 只读';
        document.querySelectorAll('#dashboard form button, #delete-group, #delete-user')
            .forEach(button => { button.disabled = !state.writable; });
    }
    function selectView(name) {
        const room = name === 'rooms';
        $('rooms-view').hidden = !room;
        $('users-view').hidden = room;
        $('nav-rooms').classList.toggle('active', room);
        $('nav-users').classList.toggle('active', !room);
        $('nav-rooms').setAttribute('aria-current', room ? 'page' : 'false');
        $('nav-users').setAttribute('aria-current', room ? 'false' : 'page');
        if(!room)
            refreshUsers().catch(submitError);
    }
    function emptyList(node, message) {
        node.replaceChildren();
        const div = document.createElement('div');
        div.className = 'empty';
        div.textContent = message;
        node.appendChild(div);
    }
    function listButton(label, sublabel, active, callback) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = active ? 'active' : '';
        const left = document.createElement('span');
        const heading = document.createElement('strong');
        heading.textContent = label;
        const details = document.createElement('small');
        details.textContent = sublabel;
        left.append(heading, details);
        const arrow = document.createElement('span');
        arrow.textContent = '›';
        button.append(left, arrow);
        button.addEventListener('click', callback);
        return button;
    }
    function renderGroups() {
        const list = $('group-list'), select = $('users-group');
        list.replaceChildren();
        select.replaceChildren();
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '请选择会议室';
        select.append(placeholder);
        let found = 0;
        for(const group of state.groups) {
            if(!validRoom(group))
                continue;
            found++;
            list.append(listButton(group, '点击管理会议室', group === state.group,
                () => selectGroup(group).catch(submitError)));
            const option = document.createElement('option');
            option.value = group;
            option.textContent = group;
            select.append(option);
        }
        if(!found)
            emptyList(list, '暂无可管理的会议室。可以在右侧创建。');
        select.value = state.group && validRoom(state.group) ? state.group : '';
        $('stat-rooms').textContent = String(state.groups.length);
        $('stat-selected').textContent = state.group || '未选择';
    }
    async function refreshGroups(preferred) {
        const reply = await api(API + '/');
        if(!Array.isArray(reply.data))
            throw new Error('服务器返回的会议室列表不合法。');
        state.groups = reply.data.filter(v => typeof v === 'string');
        const next = preferred && state.groups.includes(preferred) ? preferred :
            state.groups.includes(state.group) ? state.group :
            state.groups.find(validRoom) || '';
        if(next)
            await selectGroup(next);
        else {
            state.group = '';
            state.groupEntry = null;
            state.user = '';
            state.users = [];
            $('edit-group-panel').hidden = true;
            $('edit-user-panel').hidden = true;
            $('users-group').value = '';
            renderGroups();
            renderUsers();
        }
    }
    function numberValue(id) {
        const raw = $(id).value.trim();
        if(!raw)
            return undefined;
        const value = Number(raw);
        if(!Number.isSafeInteger(value) || value < 1 || value > 10000)
            throw new Error('人数上限必须是 1–10000 的整数。');
        return value;
    }
    function groupFields(prefix) {
        const displayName = $(prefix + '-title').value.trim();
        const description = $(prefix + '-description').value.trim();
        if(displayName.length > 100 || description.length > 500)
            throw new Error('会议室名称或简介过长。');
        const max = numberValue(prefix + '-max');
        const value = {
            displayName: displayName,
            description: description,
            public: $(prefix + '-public').checked,
            'allow-recording': $(prefix + '-recording').checked,
        };
        if(max !== undefined)
            value['max-clients'] = max;
        return value;
    }
    async function selectGroup(group) {
        const path = rootPath(group);
        state.group = group;
        state.groupEntry = null;
        state.user = '';
        state.userEntry = null;
        const result = await api(path);
        if(state.group !== group)
            return;
        state.groupEntry = result;
        const data = result.data;
        $('edit-group-label').textContent = group;
        $('edit-group-title').value = data.displayName || '';
        $('edit-group-description').value = data.description || '';
        $('edit-group-max').value = data['max-clients'] || '';
        $('edit-group-public').checked = !!data.public;
        $('edit-group-recording').checked = !!data['allow-recording'];
        $('open-group-link').href = '/group/' + roomPath(group) + '/';
        $('edit-group-panel').hidden = false;
        $('edit-user-panel').hidden = true;
        renderGroups();
        if(!$('users-view').hidden)
            await refreshUsers();
    }
    async function createGroup(event) {
        event.preventDefault();
        requireWritable();
        const group = $('new-group-name').value.trim();
        const path = rootPath(group);
        await api(path, {method:'PUT', data: groupFields('new-group'), create:true});
        $('create-group-form').reset();
        await refreshGroups(group);
        notify('会议室 ' + group + ' 已创建。');
    }
    async function updateGroup(event) {
        event.preventDefault();
        requireWritable();
        if(!state.groupEntry || !state.group)
            throw new Error('请先选择会议室。');
        if(!state.groupEntry.etag)
            throw new Error('服务器未返回版本标识，无法安全修改。');
        const values = {...state.groupEntry.data, ...groupFields('edit-group')};
        if(!$('edit-group-max').value.trim())
            delete values['max-clients'];
        const group = state.group;
        await api(rootPath(group), {method:'PUT', data:values, etag:state.groupEntry.etag});
        await selectGroup(group);
        notify('会议室设置已保存。');
    }
    async function deleteGroup() {
        requireWritable();
        const group = state.group;
        if(!group || !state.groupEntry || !state.groupEntry.etag)
            throw new Error('请先选择要删除的会议室。');
        const typed = window.prompt('删除后无法恢复。请输入会议室标识确认：' + group);
        if(typed !== group)
            return;
        await api(rootPath(group), {method:'DELETE', etag:state.groupEntry.etag});
        state.group = '';
        state.groupEntry = null;
        await refreshGroups();
        notify('会议室 ' + group + ' 已删除。');
    }
    function renderUsers() {
        const list = $('user-list');
        list.replaceChildren();
        if(!state.group) {
            emptyList(list, '请先选择会议室。');
            return;
        }
        let count = 0;
        for(const username of state.users) {
            if(!validUser(username))
                continue;
            count++;
            list.append(listButton(username, '会议室成员', state.user === username,
                () => selectUser(username).catch(submitError)));
        }
        if(!count)
            emptyList(list, '该会议室尚未创建成员账号。');
    }
    async function refreshUsers(preferred) {
        state.user = '';
        state.userEntry = null;
        $('edit-user-panel').hidden = true;
        if(!state.group) {
            state.users = [];
            renderUsers();
            return;
        }
        const group = state.group;
        const response = await api(rootPath(group) + '/.users/');
        if(state.group !== group)
            return;
        if(!Array.isArray(response.data))
            throw new Error('服务器返回的用户列表不合法。');
        state.users = response.data.filter(x => typeof x === 'string');
        renderUsers();
        if(preferred && state.users.includes(preferred))
            await selectUser(preferred);
    }
    async function selectUser(username) {
        const group = state.group;
        const path = memberPath(group, username);
        state.user = username;
        state.userEntry = null;
        const response = await api(path);
        if(state.group !== group || state.user !== username)
            return;
        state.userEntry = response;
        $('edit-user-label').textContent = username;
        const role = response.data.permissions;
        $('edit-user-role').value = roles.has(role) ? role : '';
        $('reset-user-password').value = '';
        $('edit-user-panel').hidden = false;
        renderUsers();
    }
    async function createUser(event) {
        event.preventDefault();
        requireWritable();
        if(!state.group)
            throw new Error('请先选择会议室。');
        const username = $('new-user-name').value.trim();
        const password = $('new-user-password').value;
        const role = $('new-user-role').value;
        const path = memberPath(state.group, username);
        if(!roles.has(role))
            throw new Error('成员身份不合法。');
        verifyPassword(password);
        $('new-user-password').value = '';
        await api(path, {method:'PUT', data:{permissions:role},create:true});
        try {
            await api(path + '/.password', {method:'POST',password});
        } catch(error) {
            await refreshUsers(username);
            throw new Error('成员已创建，但密码设置失败。请在成员设置中重置密码：' + errorText(error));
        }
        const group = state.group;
        $('create-user-form').reset();
        await refreshUsers(username);
        notify('已在会议室 ' + group + ' 创建成员 ' + username + '，密码已由服务器加密保存。');
    }
    async function updateUser(event) {
        event.preventDefault();
        requireWritable();
        if(!state.userEntry || !state.group || !state.user)
            throw new Error('请选择成员账号。');
        const role = $('edit-user-role').value;
        if(!roles.has(role))
            throw new Error('当前账号使用自定义权限，不能覆盖为未知身份。');
        if(!state.userEntry.etag)
            throw new Error('服务器未返回版本标识，无法安全修改。');
        const username = state.user;
        await api(memberPath(state.group,username), {
            method:'PUT',
            data:{...state.userEntry.data,permissions:role},
            etag:state.userEntry.etag,
        });
        await selectUser(username);
        notify('成员 ' + username + ' 的身份权限已更新。');
    }
    async function resetPassword(event) {
        event.preventDefault();
        requireWritable();
        if(!state.group || !state.user)
            throw new Error('请先选择成员账号。');
        const password = $('reset-user-password').value;
        verifyPassword(password);
        const username = state.user;
        const path = memberPath(state.group,username);
        $('reset-user-password').value = '';
        await api(path + '/.password', {method:'POST',password});
        notify('成员 ' + username + ' 的密码已重置并在服务器上哈希保存。');
    }
    async function deleteUser() {
        requireWritable();
        if(!state.group || !state.user || !state.userEntry || !state.userEntry.etag)
            throw new Error('请选择要删除的成员。');
        const username = state.user;
        const typed = window.prompt('删除后该账号将无法再次登录。请输入用户名确认：' + username);
        if(typed !== username)
            return;
        await api(memberPath(state.group,username),{method:'DELETE',etag:state.userEntry.etag});
        await refreshUsers();
        notify('成员 ' + username + ' 已删除。');
    }
    function protect(callback) {
        return async event => {
            try {
                await callback(event);
            } catch(error) {
                submitError(error);
            }
        };
    }
    async function login(event) {
        event.preventDefault();
        $('login-error').textContent = '';
        const username = $('login-username').value.trim();
        const password = $('login-password').value;
        $('login-password').value = '';
        if(!validUser(username)) {
            $('login-error').textContent = '管理员用户名格式不正确。';
            return;
        }
        state.authorization = credentialValue(username, password);
        try {
            const reply = await api('/galene-api/v0/.admin-session');
            state.username = username;
            state.writable = !!reply.data.writableGroups;
            $('login-panel').hidden = true;
            $('dashboard').hidden = false;
            $('admin-identity').textContent = '管理员 · ' + username;
            $('admin-identity').hidden = false;
            $('logout').hidden = false;
            setReadonly();
            selectView('rooms');
            await refreshGroups();
            notify('管理员身份验证成功。');
        } catch(error) {
            if(!$('login-panel').hidden)
                $('login-error').textContent = errorText(error);
            else
                submitError(error);
            // Reject invalid credentials without retaining the Basic header.
            if(!$('login-panel').hidden)
                state.authorization = '';
        }
    }
    function init() {
        $('login-form').addEventListener('submit', login);
        $('logout').addEventListener('click', showLogin);
        $('nav-rooms').addEventListener('click', () => selectView('rooms'));
        $('nav-users').addEventListener('click', () => selectView('users'));
        $('refresh-groups').addEventListener('click', protect(() => refreshGroups()));
        $('create-group-form').addEventListener('submit', protect(createGroup));
        $('edit-group-form').addEventListener('submit', protect(updateGroup));
        $('delete-group').addEventListener('click', protect(deleteGroup));
        $('users-group').addEventListener('change', protect(async () => {
            const group = $('users-group').value;
            if(!group) {
                state.group = '';
                state.groupEntry = null;
                await refreshUsers();
                renderGroups();
                return;
            }
            await selectGroup(group);
        }));
        $('create-user-form').addEventListener('submit', protect(createUser));
        $('edit-user-form').addEventListener('submit', protect(updateUser));
        $('reset-password-form').addEventListener('submit', protect(resetPassword));
        $('delete-user').addEventListener('click', protect(deleteUser));
    }
    if(document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', init, {once:true});
    else
        init();
})();
