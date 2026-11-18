# Cat-Meet

Cat-Meet is a self-hosted video meeting system based on the open-source
[Galène](https://galene.org/) WebRTC server. It includes Chinese/English
meeting pages, independent microphone and camera controls, configurable
high-resolution screen sharing, with meeting participants joining directly from their web browsers.

## Web interface (v2.2 · kawaii Cat-Meet)

Cat-Meet now uses the uploaded `chaofan.png` Cat Studio branding across the
homepage, meeting header, empty stage, and browser favicon. The meeting UI keeps
the independent audio/video lobby controls and responsive participant/chat
layout while switching the visual system to a warm cream, pink, rounded style.

Chat now supports selecting files, pasting images directly from the clipboard,
and sending the selected attachment to every participant currently in the
meeting. Received attachments appear as chat cards with progress, image
previews, and an explicit download/save action. Transfers remain peer-to-peer;
future joiners do not receive files sent before they joined.

## 管理员后台与安全初始化

部署或升级后，可使用 **`https://你的域名/admin.html`** 打开管理员后台，
创建/编辑/删除会议室，创建/删除会议室成员，以及设置成员身份、重置密码。
管理员账号为 **全局服务器管理员**，与会议室成员账号是两个不同概念。

首次部署（**请以运行 Cat-Meet 服务的专用 Linux 用户操作**）：

```sh
mkdir -p data groups
chmod 700 data groups
./cat-meetctl bootstrap-admin -config ./data/config.json -user admin
```

命令需要交互式终端，输入两次密码（12–72 字节），不会在屏幕回显或命令行参数、
环境变量、`galenectl.json` 中保存管理员明文密码。它在 `data/config.json`
中写入 bcrypt（cost 12）哈希，并将权限设置为 **0600**，启用
`"writableGroups": true`。已有服务器设置会保留；如果全局管理员已存在，
初始化会拒绝覆盖，以免误伤已有部署。此时应直接使用原管理员账号，
必要时由服务器所有者审慎修改配置。

**切勿将 `data/`、`groups/`、私钥、管理员配置上传到网页 `static/` 目录。**
使用受信任的 HTTPS 证书，并在反向代理中仅以 HTTPS 访问管理员后台。
升级时先备份 `data/`、`groups/`、录制文件和证书，保留这些目录；
更换新 `cat-meet`、`cat-meetctl` 以及完整 `static/` 目录。

新后台不在浏览器持久化管理员密码，请勿在公共电脑上登录。
服务器对每次管理操作单独鉴权，使用同源请求、ETag 并发校验、
受控跳转、CSP 和输出文本化来降低注入与恶意跳转风险。
当前使用 JSON 文件存储会议室和成员，**没有 SQL 数据库，因此没有 SQL 查询注入入口**。
但不存在能保证所有网页攻击都被彻底消除的单一防护措施。

## Cat-Meet v1.2.2-cat.10

- Exit confirmation dialog for both the main leave button and settings logout, with best-effort mobile Back-gesture and page-close guards.
- When sharing a screen, the screen stream becomes the large centered tile. Cameras appear as smaller edge thumbnails, while audio-only members use compact labels instead of blank video tiles.
- Media optimization: screen sharing is not renegotiated when participant counts change; reduce frequent per-peer audio activity statistics and lower the resolution requested for peripheral camera streams during sharing. Actual WebRTC performance still depends on network and hardware.
- An explicitly selected **Remember this login for 7 days** option stores a room-scoped, expiring bearer token from the server in this browser. The password is never saved in localStorage. Password changes and account deletion invalidate remembered sessions.
- Remembered login is available for named room-password accounts; external auth-server accounts and wildcard guest credentials still need their normal login flow.

## Cat-Meet v1.2.2-cat.9

- Moved the participant panel from the right side to a left-side drawer.
- The participant drawer is hidden by default and opens from the top-left list button; clicking the backdrop or pressing Escape closes it.
- The meeting stage and bottom control bar stay centered across the full available width instead of reserving space for the participant list.
- The Chat tab opens the conversation over the same left drawer, keeping both panels on the left.

## Cat-Meet v1.2.2-cat.8

- Moved the conversation into a left-side drawer that slides in from the left and stays collapsed by default.
- Added close-button, backdrop-click, and Escape-key dismissal.
- Kept the participant list on the right and prevented the chat drawer from shrinking the meeting video stage.
- Mobile devices open the chat drawer from the left and automatically collapse the participant drawer to avoid overlap.

## Cat-Meet v1.2.2-cat.7

- Fixed the broken logo and favicon by placing the uploaded image at `static/chaofan.png`, the actual web static root.
- Matched the participant drawer and chat drawer widths on desktop and narrow screens.
- Fixed chat composer overflow: the textarea no longer shows a resize handle, and attachment/send controls stay inside the rounded input bar.
- Kept clipboard image paste, group file sending, previews, and downloads.

## Cat-Meet v1.2.2-cat.6

- Added Cat Studio branding from `chaofan.png` to the web UI and favicon.
- Added chat attachment controls, clipboard image paste, and group-wide file sending.
- Received files now appear in the conversation with progress and download/save controls.
- Reworked the meeting palette into a softer, rounded kawaii style.
- The Linux release package includes `static/chaofan.png`, where the web server
  serves browser assets from. The repository-root upload is retained as the source copy.

## Cat-Meet v1.2.2-cat.3

The homepage is reduced to a single meeting-room input and join action. Joining
always shows the room account/password form; invitation tokens no longer skip
that form. Camera capture refreshes device lists on device changes, retries stale
mobile device IDs with browser defaults, and keeps an existing working camera
stream when a replacement request fails. If one track ends, the other live media
track is kept running. These browser/device behaviours still need validation on
the target Android/iOS devices and webcams.

## Cat-Meet v1.2.2-cat.4

- The room login form is visible immediately while room metadata loads, avoiding a blank meeting stage before authentication.
- Unexpected microphone track mute/end triggers bounded exponential-backoff recovery. Manual mute and explicit microphone-off choices are respected; camera tracks are kept when possible.
- Dark meeting participant menus and native dropdown options use explicit high-contrast colors.

Physical microphone/browser testing is still required for device/OS-specific capture failures.

## Downloads

Get the **Cat-Meet Linux server** from the [Releases page](https://github.com/luoquan0/Cat-galene/releases).

- **Linux**: the `cat-meet` video meeting server and `cat-meetctl`
  administrative tool. Compatibility commands `galene` and `galenectl`
  are included for existing installations.
- **Participants**: open the meeting HTTPS link directly in a modern browser
  (Chrome, Edge, Firefox or Safari) on Windows, macOS, Linux or mobile.
  No Windows desktop client or installer is required.

The Linux server hosts the actual WebRTC conference pages. When upgrading,
update the Linux server package and refresh the browser UI.

## Quick start (source)

```sh
git clone https://github.com/luoquan0/Cat-galene.git
cd Cat-galene
CGO_ENABLED=0 go build -o cat-meet .
mkdir -p groups
echo '{"users":{"vimes":{"password":"sybil","permissions":"op"}}}' > groups/night-watch.json
./cat-meet &
```

Visit <https://localhost:8443/group/night-watch/>. Use a trusted HTTPS
certificate for any Internet-facing deployment.

## Screen share and zoom

Under meeting settings, choose native/720p/1080p/2K/4K/custom resolution,
a frame rate (15–120 FPS or custom), and an independent screen-share bitrate.
These preferences are stored in your browser and restored when you return.

Each screen-sharing video has local viewing controls: **– / 100% / + / Reset**.
Zoom between **50% and 400%** in 25% steps, and drag the video to inspect
details while enlarged. **Ctrl + mouse wheel** also zooms. Viewing zoom does
not change the shared stream's resolution or the bandwidth used.

## Documentation

- [Installation and deployment](galene-install.md)
- [Server administration](galene.md)
- [Writing a client](galene-client.md)
- [Compatible signaling protocol](galene-protocol.md)
- [Administrative API](galene-api.md)

## Upstream acknowledgements and compatibility

Cat-Meet integrates upstream Galène **1.2.2**, by **Juliusz Chroboczek**. The original source
and protocol documentation are at <https://galene.org/>.

We preserve the upstream Go module import path
`github.com/jech/galene`, public URLs such as `/galene-api/v0/`, and
existing configuration filenames. Renaming those internal identifiers
would break established clients and user configurations. Original license
notices and upstream authorship remain in place.

This repository is a downstream Cat-Meet product fork; please report
Cat-Meet issues in this repository rather than the upstream Galène mailing
list.