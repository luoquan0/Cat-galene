# Cat-galene Windows 会议客户端

这份 Windows 程序是 **会议客户端**，不包含服务器，也不会在本机开设 Galene 服务。

## 使用方法

1. 将 ZIP 完整解压至任意目录。
2. 双击 Cat-galene-Client.exe。
3. 粘贴 Linux 服务器的会议链接，例如 https://meet.example.com/group/team/。
4. 点击“进入会议”。客户端会通过已安装的 Edge 或 Chrome 打开一个独立会议窗口。
5. 在会议窗口中加入会议；摄像头、麦克风、屏幕共享都沿用浏览器的 WebRTC 功能。

## 运行条件

- Windows 10/11（提供 x64 和 ARM64 版本）。
- 必须已安装 Microsoft Edge 或 Google Chrome。
- Linux 服务器正常运行并可通过 HTTPS 访问。
- 本客户端 **不包含浏览器内核**；它使用本机浏览器的独立应用窗口模式，因此 ZIP 很轻量。也无需安装 Go、Node.js 或 .NET。

## 隐私与安全

- 无需管理员权限；客户端不会在 Windows 上启动本地服务器。
- 为防止泄露会议邀请口令，客户端只在旁边的 last-server.txt 保存上次使用的服务器根地址，不存储完整会议链接或 token。
- 公网服务器必须提供 HTTPS，只有 localhost / 回环地址允许 HTTP。
- 会议的设备权限提示由 Edge / Chrome 管理。
- 删除 last-server.txt 可以清除上次使用的服务器地址。

此包与 Linux 服务器包互相独立。想要安装 Linux 服务器，请下载对应的 Linux tar.gz 文件。