# Cat-Meet

Cat-Meet is a self-hosted video meeting system based on the open-source
[Galène](https://galene.org/) WebRTC server. It includes Chinese/English
meeting pages, independent microphone and camera controls, configurable
high-resolution screen sharing, and a Windows meeting client.

## Downloads

Get the latest **Cat-Meet Linux server** or **Cat-Meet Windows client**
from the [Releases page](https://github.com/luoquan0/Cat-galene/releases).

- **Linux**: the `cat-meet` video meeting server and `cat-meetctl`
  administrative tool. Compatibility commands `galene` and `galenectl`
  are included for existing installations.
- **Windows**: `Cat-Meet-Client.exe`, a small standalone launcher that
  opens a remote meeting URL using Microsoft Edge or Google Chrome.
  Windows is a **client**, not an additional server.

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
- [Windows meeting client](client/windows/README.md)

## Upstream acknowledgements and compatibility

Cat-Meet is built on Galène by **Juliusz Chroboczek**. The original source
and protocol documentation are at <https://galene.org/>.

We preserve the upstream Go module import path
`github.com/jech/galene`, public URLs such as `/galene-api/v0/`, and
existing configuration filenames. Renaming those internal identifiers
would break established clients and user configurations. Original license
notices and upstream authorship remain in place.

This repository is a downstream Cat-Meet product fork; please report
Cat-Meet issues in this repository rather than the upstream Galène mailing
list.