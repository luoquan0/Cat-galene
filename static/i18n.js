// Cat-galene interface translations. Original English text is kept for switching back.
'use strict';
(() => {
    const dictionary = {
        'Language':'语言','Group:':'会议室：','Join':'加入','Public groups':'公开会议室',
        'Enable':'启用','Disable':'关闭','Camera':'摄像头','Mute':'静音',
        'Share Screen':'共享屏幕','Username':'用户名','Password':'密码',
        'Enable at start:':'入会时启用：','Nothing':'全部关闭','Microphone':'麦克风',
        'Camera and microphone':'摄像头和麦克风','Connect':'连接',
        'Test camera and microphone':'测试摄像头和麦克风','Camera:':'摄像头：',
        'Microphone:':'麦克风：','Settings':'设置','Change password':'修改密码',
        'Logout':'退出登录','Media Options':'媒体设置','off':'关闭',
        'Mirror view':'镜像画面','Blackboard mode':'黑板模式',
        'Noise suppression':'噪声抑制','Cancel':'取消','Invite':'邀请',
        'Username (optional):':'用户名（可选）：','Not before:':'生效时间：',
        'Expires:':'过期时间：','Picture In Picture':'画中画',
        'Fullscreen':'全屏','Stop video':'关闭视频',
        'Hide chat':'隐藏聊天','Show chat':'显示聊天',
        'Hide video and show chat':'隐藏视频并显示聊天',
        'Collapse left panel':'折叠侧栏','English':'English',
        'Send':'发送','Audio':'音频','Video':'视频','Display':'显示',
        'Resolution':'分辨率','Filter':'滤镜','High quality audio':'高质量音频',
        'Activity detection':'活动检测','Show all':'显示全部',
        'Disconnect':'断开连接'
    };
    const originals = new WeakMap();
    function translateNode(root, zh) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while((node = walker.nextNode())) {
            if(!node.parentElement || /^(SCRIPT|STYLE|TEXTAREA)$/.test(node.parentElement.tagName)) continue;
            const original = originals.has(node) ? originals.get(node) : node.nodeValue;
            const key = original.trim();
            if(!Object.prototype.hasOwnProperty.call(dictionary, key)) continue;
            if(!originals.has(node)) originals.set(node, original);
            const value = zh ? dictionary[key] : original.trim();
            node.nodeValue = original.replace(key, value);
        }
        for(const el of root.querySelectorAll('[title],[placeholder],input[type=submit],input[type=button]')) {
            for(const attr of ['title','placeholder','value']) {
                if(!el.hasAttribute(attr)) continue;
                const cacheKey = 'i18nOriginal' + attr;
                const base = el.dataset[cacheKey] || el.getAttribute(attr);
                if(!Object.prototype.hasOwnProperty.call(dictionary, base)) continue;
                el.dataset[cacheKey] = base;
                el.setAttribute(attr, zh ? dictionary[base] : base);
            }
        }
    }
    function setLanguage(locale) {
        const zh = locale === 'zh-CN';
        document.documentElement.lang = zh ? 'zh-CN' : 'en';
        try { localStorage.setItem('cat-galene-language', zh ? 'zh-CN' : 'en'); } catch(e) {}
        const select = document.getElementById('language-select');
        if(select) select.value = zh ? 'zh-CN' : 'en';
        translateNode(document.body, zh);
    }
    document.addEventListener('DOMContentLoaded', () => {
        let locale = 'en';
        try { locale = localStorage.getItem('cat-galene-language') || (navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'); } catch(e) {}
        const select = document.getElementById('language-select');
        if(select) select.addEventListener('change', () => setLanguage(select.value));
        setLanguage(locale);
    });
})();
