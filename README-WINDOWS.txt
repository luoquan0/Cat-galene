Cat-Meet LEGACY Windows SERVER (not a meeting client)
================================

NOTE: This file documents the old Windows server package from v1.2.1-cat.2.
For a regular Windows meeting participant, download the NEW Windows client
from v1.2.1-cat.3 or later. It uses Cat-Meet-Client.exe and opens the
Linux-hosted meeting in Edge/Chrome. See client/windows/README.md.

1. Extract the entire ZIP to a writable folder (not just the EXE).
2. Double-click start-windows.cmd, or open PowerShell in this folder.
3. The first run creates administrator "admin" through galenectl.exe,
   prompts for a password and writes data/config.json and
   data/galenectl.json. Both configurations stay in the portable folder.
4. Open https://localhost:8443/ in a modern browser.

A self-signed TLS certificate may trigger a browser warning on first use.
For public use, configure a trusted TLS certificate and the appropriate
firewall/router ports for WebRTC.

Files that must stay together:
- galene.exe: video conference server
- galenectl.exe: administrative command-line utility
- static/: bundled browser UI
- data/ and groups/: user-generated configuration, created on first launch
- start-windows.cmd: local convenience launcher

Do not use a globally shared writable directory for configuration.
Do not use the -insecure flag for Internet-facing deployments.
Keep data/ and groups/ private; they are NOT included in Release archives.
For later administrative commands, use -config data\galenectl.json before
the command name, for example:
  galenectl.exe -config data\galenectl.json list-groups

For more information, see galene-install.md and galene.md.