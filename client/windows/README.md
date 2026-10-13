# Cat-Meet Windows meeting client

This is a **desktop meeting client launcher** for a remote Linux Cat-Meet server, not a meeting server.
It launches the meeting URL in an Edge or Chrome application window. It keeps native Chromium WebRTC, camera/microphone permission handling and screen sharing.

## Quick start

1. Download the **Windows client** ZIP from the newest GitHub Release.
2. Extract and double-click `Cat-Meet-Client.exe`.
3. Paste the complete meeting URL, for example `https://meet.example.com/group/team/`.
4. Click **进入会议**. The meeting opens in a standalone browser app window.

**Requirements:** Windows 10/11, installed Microsoft Edge or Google Chrome, access to a separately hosted Cat-Meet meeting server over HTTPS. This package does not bundle a browser engine, and does not launch a local HTTP/WebRTC server.

**Privacy:** `last-server.txt` only remembers the server origin; room links and invitation tokens are not stored by the client. Webcam, microphone, and screen permissions continue to be managed by the browser.

The Linux tar.gz packages contain the server. Older Windows ZIP packages from versions before `v1.2.1-cat.3` contained the **server**, not this client.