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
        const closeButton = document.getElementById('close-chat');
        const backdrop = document.getElementById('cm-chat-backdrop');
        const leave = document.getElementById('cm-leave-button');
        const originalLeave = document.getElementById('disconnectbutton');
        if(!lobby || !sidebar || !chat || !usersTab || !chatTab ||
           !closeButton || !backdrop || !leave || !originalLeave)
            return;

        function isMobile() {
            return window.matchMedia('(max-width: 900px)').matches;
        }

        function closeChat() {
            root.classList.remove('cm-chat-open');
            chat.classList.remove('invisible');
            usersTab.setAttribute('aria-selected', 'true');
            chatTab.setAttribute('aria-selected', 'false');
        }

        function openChat() {
            chat.classList.remove('invisible');
            root.classList.add('cm-chat-open');
            usersTab.setAttribute('aria-selected', 'false');
            chatTab.setAttribute('aria-selected', 'true');
            if(isMobile())
                sidebar.classList.remove('active');
        }

        // Chat is a left-side drawer. Clicking Chat again collapses it.
        function selectTab(tab, openPeopleOnMobile) {
            if(tab === 'chat') {
                if(root.classList.contains('cm-chat-open'))
                    closeChat();
                else
                    openChat();
                return;
            }

            closeChat();
            if(openPeopleOnMobile && isMobile())
                sidebar.classList.add('active');
        }

        // The server controls when the pre-join form is shown; UI follows it.
        function reflectLobby() {
            const prejoin = !lobby.classList.contains('invisible');
            root.classList.toggle('cm-prejoin', prejoin);
            if(prejoin)
                selectTab('users', false);
        }

        usersTab.addEventListener('click', () => selectTab('users', true));
        chatTab.addEventListener('click', () => selectTab('chat', true));
        leave.addEventListener('click', () => originalLeave.click());

        // Capture the close action before Galene's legacy handler. Keep the
        // drawer mounted off-canvas so CSS can animate it fully to the left.
        closeButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeChat();
        }, true);

        backdrop.addEventListener('click', closeChat);

        document.addEventListener('keydown', event => {
            if(event.key !== 'Escape')
                return;
            if(root.classList.contains('cm-chat-open')) {
                closeChat();
                return;
            }
            const settingsNav = document.getElementById('sidebarnav');
            if(isMobile() && sidebar.classList.contains('active') &&
               (!settingsNav || !settingsNav.classList.contains('is-open')))
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
