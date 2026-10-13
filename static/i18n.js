// Bilingual user interface for Cat-galene. Strings are text, never HTML.
'use strict';
(() => {
    const chinese = {
    "Unraise hand": "放下手",
    "Invite user": "邀请用户",
    "Broadcast file": "播放文件",
    "Restart media": "重新连接音视频",
    "Forbid presenting": "禁止发言",
    "Allow presenting": "允许发言",
    "Kick out": "移出会议室",
    "Identify": "查看身份",
    "Delete message": "删除消息",
    "You don't have permission to create tokens": "你没有创建邀请链接的权限",
    "You don't have permission to edit or list tokens": "你没有管理邀请链接的权限",
    "Couldn't find user": "找不到用户",
    "Invalid date": "日期无效",
    "Unknown join message": "未知入会消息",
    "Unknown user": "未知用户",
    "Stop screensharing": "停止屏幕共享",
    "Play": "播放",
    "Stop": "停止",
    "operator": "管理员",
    "presenter": "发言者",
    "(op, presenter)": "（管理员、发言者）",
    "Unknown filter": "未知滤镜",
    "Delete all from": "删除所有消息",
    "Time": "时间",
    "Size": "大小",
    "Loading...": "加载中…",
    "Camera settings": "摄像头设置",
    "Microphone settings": "麦克风设置",
    "Language": "语言",
    "Group:": "会议室：",
    "Join": "加入会议",
    "Public groups": "公开会议室",
    "Enable": "开启",
    "Disable": "关闭",
    "Camera": "摄像头",
    "Camera:": "摄像头：",
    "Microphone": "麦克风",
    "Microphone:": "麦克风：",
    "Mute": "静音",
    "Share Screen": "共享屏幕",
    "Username": "用户名",
    "Password": "密码",
    "Enable at start:": "入会时启用：",
    "Nothing": "均不开启",
    "Camera and microphone": "摄像头和麦克风",
    "Connect": "连接",
    "Test camera and microphone": "测试摄像头和麦克风",
    "Settings": "设置",
    "Change password": "修改密码",
    "Logout": "退出登录",
    "Media Options": "媒体选项",
    "Default camera": "默认摄像头",
    "Default microphone": "默认麦克风",
    "off": "关闭",
    "on": "开启",
    "auto": "自动",
    "Mirror view": "镜像预览",
    "Blackboard mode": "黑板模式",
    "Noise suppression": "噪声抑制",
    "High-quality audio": "高质量音频",
    "Other Settings": "其他设置",
    "Filter:": "滤镜：",
    "none": "无",
    "Send:": "发送画质：",
    "lowest": "最低",
    "low": "较低",
    "normal": "标准",
    "unlimited": "无限制",
    "Screen share (next share):": "下次屏幕共享：",
    "Capture resolution:": "采集分辨率：",
    "Original (no scaling)": "原始分辨率（不缩放）",
    "Custom resolution": "自定义分辨率",
    "Width (px):": "宽度（像素）：",
    "Height (px):": "高度（像素）：",
    "Frame rate:": "帧率：",
    "Default (30 FPS)": "默认（30 FPS）",
    "Custom FPS": "自定义帧率",
    "Custom FPS:": "自定义 FPS：",
    "Share bitrate:": "共享码率：",
    "Automatic (recommended)": "自动（推荐）",
    "Custom bitrate": "自定义码率",
    "Custom bitrate (Mbps):": "自定义码率（Mbps）：",
    "Resolution and FPS apply to the next share. Bitrate changes apply immediately. Actual quality depends on the browser and source.": "分辨率和帧率在下次开始共享时生效；码率更改立即生效。实际画质受浏览器和共享内容限制。",
    "Simulcast:": "分层编码：",
    "Receive:": "接收内容：",
    "nothing": "不接收",
    "audio only": "仅音频",
    "screenshare only": "仅屏幕共享",
    "low quality": "低画质",
    "everything": "全部音视频",
    "Activity detection": "活动检测",
    "Display audio-only users": "显示仅音频用户",
    "Cancel": "取消",
    "Invite": "邀请",
    "Username (optional):": "用户名（可选）：",
    "Not before:": "生效时间：",
    "Expires:": "过期时间：",
    "Picture In Picture": "画中画",
    "Fullscreen": "全屏",
    "Stop video": "停止视频",
    "Volume": "音量",
    "Play video": "播放视频",
    "Hide chat": "隐藏聊天",
    "Show chat": "显示聊天",
    "Hide video and show chat": "隐藏视频并显示聊天",
    "Collapse left panel": "折叠左侧边栏",
    "Type /help for help": "输入 /help 查看帮助",
    "No microphone available": "没有可用的麦克风",
    "No camera available": "没有可用的摄像头",
    "Connect to a meeting before enabling your microphone": "请先加入会议，再开启麦克风",
    "Press Enable to enable your camera or microphone": "点击“开启”以启用摄像头或麦克风",
    "Please use Enable to enable your camera or microphone.": "请点击“开启”以启用摄像头或麦克风",
    "You have been muted": "你已被静音",
    "This group is locked": "此会议室已锁定",
    "This browser doesn't support WebRTC": "此浏览器不支持 WebRTC",
    "This browser doesn't support file playback": "此浏览器不支持文件播放",
    "This browser doesn't support modal dialogs": "此浏览器不支持弹窗对话框",
    "Picture in Picture not supported.": "不支持画中画",
    "Full screen not supported!": "不支持全屏",
    "Not connected.": "尚未连接",
    "Unknown join message": "未知入会消息",
    "Accept": "接受",
    "Reject": "拒绝",
    "Connecting...": "连接中…",
    "Sending...": "发送中…",
    "Receiving...": "接收中…",
    "Done.": "已完成",
    "Cancelled.": "已取消",
    "Anonymous": "匿名用户",
    "The Server": "服务器",
    "(anon)": "（匿名）",
    "Horizontal mirror": "水平镜像",
    "Vertical mirror": "垂直镜像",
    "Rotate": "旋转",
    "Background blur": "背景虚化",
    "No such group": "会议室不存在",
    "(No groups found.)": "（暂无会议室）",
    "(No group found.)": "（没有找到会议室）",
    "(remote)": "（远程）",
    "Page not Found": "页面未找到",
    "Page not found!": "页面未找到！",
    "We can't find the page you're looking for.": "找不到你访问的页面。",
    "Back to home": "返回首页",
    "Galène statistics": "Galène 统计",
    "Old password:": "原密码：",
    "New password:": "新密码：",
    "New password (repeat):": "确认新密码：",
    "Submit": "提交",
    "Passwords don't match.": "两次输入的密码不一致",
    "Couldn't determine group": "无法确定会议室",
    "Couldn't determine username": "无法确定用户名",
    "Receive": "接收",
    "Send": "发送",
    "Video": "视频",
    "Audio": "音频",
    "Display": "显示",
    "Resolution": "分辨率",
    "Filter": "滤镜",
    "High quality audio": "高质量音频",
    "Show all": "显示全部",
    "Disconnect": "断开连接",
    "Invitation": "邀请",
    "Invitation link": "邀请链接",
    "Kick": "移除",
    "Warn": "警告",
    "Clear chat": "清空聊天",
    "Lock": "锁定",
    "Unlock": "解锁",
    "Raise hand": "举手",
    "Lower hand": "放下手",
    "Record": "录制",
    "Stop recording": "停止录制",
    "Start recording": "开始录制",
    "Send file": "发送文件",
    "Share file": "分享文件",
    "Copy link": "复制链接",
    "Open link": "打开链接",
    "Statistics": "统计",
    "User information": "用户信息",
    "Request": "请求",
    "Grant": "授予",
    "Revoke": "撤销",
    "Close": "关闭",
    "Log in": "登录",
    "Log out": "退出登录",
    "Password required": "需要密码",
    "Waiting for connection": "等待连接",
    "Not supported": "不支持",
    "Reconnecting...": "正在重新连接…",
    "Please wait...": "请稍候…",
    "Media": "媒体",
    "Users": "用户",
    "User": "用户",
    "Recording": "录制中",
    "Locked": "已锁定",
    "Unmute": "取消静音",
    "Enable camera": "开启摄像头",
    "Disable camera": "关闭摄像头",
    "Share": "共享",
    "Stop sharing": "停止共享",
    "Connecting": "连接中",
    "Connected": "已连接",
    "Disconnected": "已断开",
    "File": "文件",
    "Help": "帮助",
    "Change Password": "修改密码",
    "Remove": "移除",
    "Low": "低",
    "Normal": "标准",
    "High": "高",
    "Unlimited": "无限制",
    "automatic": "自动",
    "start a screen share": "开始屏幕共享",
    "stop screen share": "停止屏幕共享",
    "display this help": "显示帮助",
    "leave group": "离开会议室",
    "clear the chat history": "清空聊天记录",
    "lock this group": "锁定会议室",
    "unlock this group, revert the effect of /lock": "解除会议室锁定",
    "start recording": "开始录制",
    "stop recording": "停止录制",
    "list subgroups": "列出子会议室",
    "create an invitation link": "创建邀请链接",
    "extend an invitation link": "延长邀请链接有效期",
    "revoke an invitation link": "撤销邀请链接",
    "list invitation links": "列出邀请链接",
    "renegotiate media streams": "重新协商媒体流",
    "send a private message": "发送私信",
    "kick out a user": "移除用户",
    "identify a user": "识别用户",
    "give operator status": "授予管理员权限",
    "revoke operator status": "撤销管理员权限",
    "give user the right to present": "授予发言权限",
    "revoke the right to present": "撤销发言权限",
    "revoke the right to send chat messages": "禁止发送聊天消息",
    "give the right to send chat messages": "允许发送聊天消息",
    "mute a remote user": "将其他用户静音",
    "mute all remote users": "将所有其他用户静音",
    "send a warning to a user": "向用户发送警告",
    "send a warning to all users": "向所有用户发送警告",
    "raise hand": "举手",
    "unraise hand": "放下手",
    "broadcast a video or audio file": "播放本地音视频文件",
    "send a file (this will disclose your IP address)": "发送文件（将暴露你的 IP 地址）",
    "user message": "用户 消息"
};
    let language = 'en';
    const textSources = new WeakMap();
    const attributeSources = new WeakMap();
    const patterns = [
        [/^Delete all from (.+)$/, m => '删除来自 ' + m[1] + ' 的所有消息'],
        [/^Identify (.+)$/, m => '查看 ' + m[1] + ' 的身份'],
        [/^Kick out (.+)$/, m => '移出 ' + m[1]],
        [/^Camera (\d+)$/, m => '摄像头 ' + m[1]],
        [/^Microphone (\d+)$/, m => '麦克风 ' + m[1]],
        [/^\((\d+) clients?(, locked)?\)$/, m =>
            '（' + m[1] + ' 人' + (m[2] ? '，已锁定' : '') + '）'],
        [/^Couldn't connect: (.+)$/, m => '无法连接：' + m[1]],
        [/^Couldn't fetch groups: (.+)$/, m => '无法获取会议室列表：' + m[1]],
        [/^Couldn't fetch stats: (.+)$/, m => '无法获取统计信息：' + m[1]],
        [/^Couldn't fetch status: (.+)$/, m => '无法获取会议状态：' + m[1]],
        [/^Couldn't connect to (.+)$/, m => '无法连接到 ' + m[1]],
        [/^The server said: (.+)$/, m => '服务器返回：' + m[1]],
        [/^Cancelled: (.+)$/, m => '已取消：' + m[1]],
        [/^You have been muted by (.+)$/, m => '你已被 ' + m[1] + ' 静音'],
        [/^Cannot receive media (.+), still trying\.\.\.$/, m =>
            '暂时无法接收媒体 ' + m[1] + '，正在重试…'],
        [/^Token operation failed: (.+)$/, m => '邀请链接操作失败：' + m[1]]
    ];

    function translateString(value, toChinese) {
        if(typeof value !== 'string' || !toChinese) return value;
        const key = value.trim();
        let result = Object.prototype.hasOwnProperty.call(chinese, key) ?
            chinese[key] : null;
        if(result === null) {
            for(const [regexp, render] of patterns) {
                const match = key.match(regexp);
                if(match) {result = render(match); break;}
            }
        }
        return result === null ? value : value.replace(key, result);
    }

    function translateText(node) {
        if(!node.parentElement ||
           /^(SCRIPT|STYLE|TEXTAREA)$/.test(node.parentElement.tagName)) return;
        // Do not translate participant names or the content of chat messages.
        if(node.parentElement.closest('#users, #captions, #box')) return;
        const previous = textSources.get(node);
        const original = previous && node.nodeValue === previous.last ?
            previous.original : node.nodeValue;
        const translated = translateString(original, language === 'zh-CN');
        textSources.set(node, {original, last: translated});
        if(node.nodeValue !== translated) node.nodeValue = translated;
    }

    const attrs = ['title', 'aria-label', 'placeholder', 'label'];
    function translateAttributes(element) {
        if(!(element instanceof Element)) return;
        let sources = attributeSources.get(element);
        if(!sources) {sources = {}; attributeSources.set(element, sources);}
        for(const key of attrs) {
            if(!element.hasAttribute(key)) continue;
            const current = element.getAttribute(key);
            const saved = sources[key];
            const original = saved && current === saved.last ? saved.original : current;
            const translated = translateString(original, language === 'zh-CN');
            sources[key] = {original, last: translated};
            if(current !== translated) element.setAttribute(key, translated);
        }
        if(element instanceof HTMLInputElement &&
           (element.type === 'submit' || element.type === 'button')) {
            const current = element.value;
            const saved = sources.value;
            const original = saved && current === saved.last ? saved.original : current;
            const translated = translateString(original, language === 'zh-CN');
            sources.value = {original, last: translated};
            if(current !== translated) element.value = translated;
        }
    }

    function applyTo(node) {
        if(node.nodeType === Node.TEXT_NODE) {
            translateText(node);
            return;
        }
        if(node.nodeType !== Node.ELEMENT_NODE) return;
        translateAttributes(node);
        const walker = document.createTreeWalker(node,
            NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
        let child;
        while((child = walker.nextNode())) {
            if(child.nodeType === Node.TEXT_NODE)
                translateText(child);
            else
                translateAttributes(child);
        }
    }

    let observer;
    function watch() {
        if(!observer || !document.body) return;
        observer.observe(document.body, {
            subtree: true, childList: true, characterData: true,
            attributes: true, attributeFilter: attrs,
        });
    }
    function setLanguage(locale) {
        language = locale === 'zh-CN' ? 'zh-CN' : 'en';
        try {localStorage.setItem('cat-galene-language', language);} catch(e) {}
        if(observer) observer.disconnect();
        document.documentElement.lang = language;
        const select = document.getElementById('language-select');
        if(select) select.value = language;
        if(document.body) applyTo(document.body);
        const pageTitle = document.head?.querySelector('title');
        if(pageTitle) applyTo(pageTitle);
        watch();
    }

    // Also translate labels inserted after join and toast/error messages.
    document.addEventListener('DOMContentLoaded', () => {
        if(typeof MutationObserver !== 'undefined') {
            observer = new MutationObserver(changes => {
                for(const change of changes) {
                    if(change.type === 'characterData')
                        translateText(change.target);
                    else if(change.type === 'attributes')
                        translateAttributes(change.target);
                    else
                        for(const added of change.addedNodes) applyTo(added);
                }
            });
        }
        const picker = document.getElementById('language-select');
        if(picker) picker.addEventListener('change', () => setLanguage(picker.value));
        let selected;
        try {selected = localStorage.getItem('cat-galene-language');} catch(e) {}
        if(!selected)
            selected = navigator.language?.toLowerCase().startsWith('zh') ?
                'zh-CN' : 'en';
        setLanguage(selected);
    });

    window.CatGaleneI18n = {
        setLanguage,
        translate: (value, locale) => translateString(value,
            (locale || language) === 'zh-CN'),
    };
})();
