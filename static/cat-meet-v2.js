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
        const chatBackdrop = document.getElementById('cm-chat-backdrop');
        const peopleBackdrop = document.getElementById('cm-people-backdrop');
        const sidebarToggle = document.getElementById('sidebarCollapse');
        const mainrow = document.getElementById('mainrow');
        const leave = document.getElementById('cm-leave-button');
        const originalLeave = document.getElementById('disconnectbutton');
        const leaveDialog = document.getElementById('cm-leave-confirm');
        if(!lobby || !sidebar || !chat || !usersTab || !chatTab ||
           !closeButton || !chatBackdrop || !peopleBackdrop ||
           !sidebarToggle || !mainrow || !leave || !originalLeave || !leaveDialog)
            return;

        function closeChat() {
            root.classList.remove('cm-chat-open');
            chat.classList.remove('invisible');
            usersTab.setAttribute('aria-selected', 'true');
            chatTab.setAttribute('aria-selected', 'false');
        }

        function openPeople() {
            sidebar.classList.add('active');
            mainrow.classList.add('full-width-active');
        }

        function closePeople() {
            closeChat();
            sidebar.classList.remove('active');
            mainrow.classList.remove('full-width-active');
        }

        function syncPeoplePanel() {
            const open = sidebar.classList.contains('active');
            root.classList.toggle('cm-people-open', open);
            sidebarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        }

        function openChat() {
            openPeople();
            chat.classList.remove('invisible');
            root.classList.add('cm-chat-open');
            usersTab.setAttribute('aria-selected', 'false');
            chatTab.setAttribute('aria-selected', 'true');
        }

        function selectTab(tab) {
            if(tab === 'chat') {
                if(root.classList.contains('cm-chat-open'))
                    closeChat();
                else
                    openChat();
                return;
            }

            closeChat();
            openPeople();
        }

        // The hamburger toggles the participant panel on the LEFT. Galene's
        // existing click handler owns the toggle; this bridge only synchronises
        // accessibility state and closes chat if the user toggles the panel.
        sidebarToggle.addEventListener('click', () => {
            if(root.classList.contains('cm-chat-open'))
                closeChat();
            queueMicrotask(syncPeoplePanel);
        });

        sidebarToggle.addEventListener('keydown', event => {
            if(event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                sidebarToggle.click();
            }
        });

        usersTab.addEventListener('click', () => selectTab('users'));
        chatTab.addEventListener('click', () => selectTab('chat'));

        let allowExit = false;
        let backRequested = false;
        let historyGuardArmed = false;
        function meetingJoined() {
            return typeof serverConnection !== 'undefined' &&
                !!serverConnection?.group;
        }

        function confirmLeave(fromBack) {
            backRequested = fromBack;
            if(typeof leaveDialog.showModal !== 'function') {
                if(window.confirm('确定退出会议吗？')) {
                    allowExit = true;
                    originalLeave.click();
                    if(fromBack)
                        location.assign('/');
                }
                return;
            }
            if(!leaveDialog.open)
                leaveDialog.showModal();
        }

        leave.addEventListener('click', event => {
            event.preventDefault();
            confirmLeave(false);
        });

        // The Settings -> Logout path must have exactly the same confirmation.
        originalLeave.addEventListener('click', event => {
            if(allowExit)
                return;
            event.preventDefault();
            event.stopImmediatePropagation();
            confirmLeave(false);
        }, true);

        leaveDialog.addEventListener('close', () => {
            const leaveConfirmed = leaveDialog.returnValue === 'leave';
            const goHome = backRequested;
            backRequested = false;
            if(!leaveConfirmed)
                return;
            allowExit = true;
            originalLeave.click();
            if(goHome)
                location.assign('/');
        });

        // Browser history is guarded separately from explicit Leave buttons.
        // On mobile a Back swipe should open our confirmation, not lose the
        // meeting instantly. Some browsers may still suppress beforeunload.
        window.addEventListener('cat-meet-session-joined', () => {
            allowExit = false;
            if(historyGuardArmed)
                return;
            history.pushState({catMeetLeaveGuard: true}, '', location.href);
            historyGuardArmed = true;
        });
        window.addEventListener('popstate', () => {
            if(!meetingJoined() || allowExit)
                return;
            history.pushState({catMeetLeaveGuard: true}, '', location.href);
            confirmLeave(true);
        });
        window.addEventListener('beforeunload', event => {
            if(!meetingJoined() || allowExit)
                return;
            event.preventDefault();
            event.returnValue = '';
        });

        closeButton.addEventListener('click', event => {
            event.preventDefault();
            event.stopImmediatePropagation();
            closeChat();
        }, true);

        chatBackdrop.addEventListener('click', closeChat);
        peopleBackdrop.addEventListener('click', closePeople);

        document.addEventListener('keydown', event => {
            if(event.key !== 'Escape')
                return;
            if(root.classList.contains('cm-chat-open')) {
                closeChat();
                return;
            }
            if(sidebar.classList.contains('active'))
                closePeople();
            const settingsNav = document.getElementById('sidebarnav');
            if(settingsNav && settingsNav.classList.contains('is-open'))
                settingsNav.classList.remove('is-open');
        });

        const sidebarObserver = new MutationObserver(syncPeoplePanel);
        sidebarObserver.observe(sidebar, {attributes: true, attributeFilter: ['class']});
        const lobbyObserver = new MutationObserver(() => {
            const prejoin = !lobby.classList.contains('invisible');
            root.classList.toggle('cm-prejoin', prejoin);
            if(prejoin)
                closePeople();
        });
        sidebar.classList.remove('active');
        mainrow.classList.remove('full-width-active');
        syncPeoplePanel();
        lobbyObserver.observe(lobby, {attributes: true, attributeFilter: ['class']});
        const prejoin = !lobby.classList.contains('invisible');
        root.classList.toggle('cm-prejoin', prejoin);
    }

    if(document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded', setup, {once: true});
    else
        setup();
})();
