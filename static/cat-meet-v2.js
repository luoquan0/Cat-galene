// Cat-Meet v2 interaction bridge: presentation only, never replaces Galene signaling.
'use strict';
(() => {
    function setup() {
        const root = document.body;
        if(!root.classList.contains('cm-v2-room'))
            return;
        const lobby = document.getElementById('login-container');
        const sidebar = document.getElementById('left-sidebar');
        const chat = document.getElementById('left');
        const usersTab = document.getElementById('cm-tab-users');
        const chatTab = document.getElementById('cm-tab-chat');
        const leave = document.getElementById('cm-leave-button');
        const originalLeave = document.getElementById('disconnectbutton');
        if(!lobby || !sidebar || !chat || !usersTab || !chatTab || !leave || !originalLeave)
            return;

        function isMobile() {
            return window.matchMedia('(max-width: 900px)').matches;
        }

        // The server controls when the pre-join form is shown; UI follows it.
        function reflectLobby() {
            const prejoin = !lobby.classList.contains('invisible');
            root.classList.toggle('cm-prejoin', prejoin);
            if(prejoin)
                selectTab('users', false);
        }

        function selectTab(tab, openMobile) {
            const showChat = tab === 'chat';
            root.classList.toggle('cm-chat-open', showChat);
            usersTab.setAttribute('aria-selected', showChat ? 'false' : 'true');
            chatTab.setAttribute('aria-selected', showChat ? 'true' : 'false');
            if(showChat)
                chat.classList.remove('invisible');
            if(openMobile && isMobile())
                sidebar.classList.add('active');
        }

        usersTab.addEventListener('click', () => selectTab('users', true));
        chatTab.addEventListener('click', () => selectTab('chat', true));
        leave.addEventListener('click', () => originalLeave.click());

        document.addEventListener('keydown', event => {
            if(event.key === 'Escape' && isMobile() &&
               !document.getElementById('sidebarnav').classList.contains('is-open'))
                sidebar.classList.remove('active');
        });

        const observer = new MutationObserver(reflectLobby);
        observer.observe(lobby, {attributes: true, attributeFilter: ['class']});
        reflectLobby();
    }

    if(document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', setup, {once: true});
    else
        setup();
})();
