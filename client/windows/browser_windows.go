//go:build windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func browserPath() (string, error) {
	var candidates []string
	if p := os.Getenv("ProgramFiles(x86)"); p != "" {
		candidates = append(candidates, filepath.Join(p, "Microsoft", "Edge", "Application", "msedge.exe"))
	}
	if p := os.Getenv("ProgramFiles"); p != "" {
		candidates = append(candidates,
			filepath.Join(p, "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(p, "Google", "Chrome", "Application", "chrome.exe"))
	}
	if p := os.Getenv("LOCALAPPDATA"); p != "" {
		candidates = append(candidates,
			filepath.Join(p, "Microsoft", "Edge", "Application", "msedge.exe"),
			filepath.Join(p, "Google", "Chrome", "Application", "chrome.exe"))
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, nil
		}
	}
	for _, name := range []string{"msedge.exe", "chrome.exe"} {
		if executable, err := exec.LookPath(name); err == nil {
			return executable, nil
		}
	}
	return "", errors.New("请先安装 Microsoft Edge 或 Google Chrome 浏览器")
}

func openMeeting(raw string) error {
	url, origin, err := normaliseMeetingURL(raw)
	if err != nil {
		return err
	}
	browser, err := browserPath()
	if err != nil {
		return err
	}

	// Edge/Chrome app windows retain WebRTC, webcam/microphone permissions,
	// and browser-native screen sharing. No server starts on Windows.
	cmd := exec.Command(browser, "--new-window", "--app="+url)
	if err := cmd.Start(); err != nil {
		return err
	}
	// Save the HTTPS origin, never the room token or meeting invite.
	// Failure to save must not prevent joining.
	if executable, err := os.Executable(); err == nil {
		_ = os.WriteFile(filepath.Join(filepath.Dir(executable),
			"last-server.txt"), []byte(origin+"\n"), 0600)
	}
	return nil
}

func lastServer() string {
	executable, err := os.Executable()
	if err != nil {
		return "https://"
	}
	b, err := os.ReadFile(filepath.Join(filepath.Dir(executable), "last-server.txt"))
	if err != nil {
		return "https://"
	}
	s := strings.TrimSpace(string(b))
	if _, _, err = normaliseMeetingURL(s); err != nil {
		return "https://"
	}
	return s
}