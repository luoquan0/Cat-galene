package main

import (
	"errors"
	"net"
	"net/url"
	"strings"
)

// normaliseMeetingURL accepts HTTPS meeting links and local development
// addresses. The second result is a token-free origin to remember between
// launches; invitation tokens are never written to the portable folder.
func normaliseMeetingURL(input string) (meetingURL, origin string, err error) {
	raw := strings.TrimSpace(input)
	if raw == "" || len(raw) > 4096 {
		return "", "", errors.New("请输入有效的会议地址")
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u == nil {
		return "", "", errors.New("会议链接格式不正确")
	}
	scheme := strings.ToLower(u.Scheme)
	if (scheme != "https" && scheme != "http") || u.Hostname() == "" ||
		u.User != nil || u.Opaque != "" {
		return "", "", errors.New("只支持有效的 HTTP 或 HTTPS 会议地址")
	}
	if u.Port() != "" {
		// Go rejects invalid ports while parsing, but make that explicit.
		if _, err := net.LookupPort("tcp", u.Port()); err != nil {
			return "", "", errors.New("会议链接的端口无效")
		}
	}
	if scheme == "http" {
		host := strings.ToLower(u.Hostname())
		ip := net.ParseIP(host)
		if host != "localhost" && !strings.HasSuffix(host, ".localhost") &&
			(ip == nil || !ip.IsLoopback()) {
			return "", "", errors.New("远程会议必须使用 HTTPS；HTTP 仅允许本机地址")
		}
	}
	if strings.ContainsAny(raw, "\r\n\x00") {
		return "", "", errors.New("会议地址包含无效字符")
	}
	u.Scheme = scheme
	// The Cat-Meet client uses the existing Galene-compatible meeting paths.
	u.Fragment = ""
	u.RawFragment = ""
	return u.String(), u.Scheme + "://" + u.Host, nil
}