package webserver

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jech/galene/group"
)

func TestRecordingCSRF(t *testing.T) {
	req := httptest.NewRequest("POST", "https://example.org/recordings/test/", nil)
	req.SetBasicAuth("alice", "secret")
	token := recordingCSRFToken(req, "test", "meeting.webm")
	if !validRecordingCSRF(req, "test", "meeting.webm", token) {
		t.Fatal("generated recording token was rejected")
	}
	if validRecordingCSRF(req, "test", "other.webm", token) ||
		validRecordingCSRF(req, "other", "meeting.webm", token) ||
		validRecordingCSRF(req, "test", "meeting.webm", "") {
		t.Fatal("CSRF token is not bound to group and filename")
	}
	req.SetBasicAuth("bob", "secret")
	if validRecordingCSRF(req, "test", "meeting.webm", token) {
		t.Fatal("CSRF token was valid for another user")
	}
}

func TestEntryRateLimit(t *testing.T) {
	var limiter addressLimiter
	for i := 0; i < 100; i++ {
		if !limiter.allow("192.0.2.1:1234") {
			t.Fatalf("request %d rejected before burst limit", i)
		}
	}
	if limiter.allow("192.0.2.1:9999") {
		t.Fatal("limiter did not share IP budget between ports")
	}
	if !limiter.allow("192.0.2.2:1234") {
		t.Fatal("unrelated host was unexpectedly throttled")
	}
}

func TestRecordingOrigin(t *testing.T) {
	oldDir := group.DataDirectory
	group.DataDirectory = t.TempDir()
	defer func() { group.DataDirectory = oldDir }()
	cases := []struct {
		origin, site string
		allow        bool
	}{
		{"https://example.org", "same-origin", true},
		{"https://attacker.example", "cross-site", false},
		{"http://example.org", "cross-site", false},
		{"null", "cross-site", false},
		{"", "cross-site", false},
		{"", "same-origin", true},
	}
	for _, tc := range cases {
		req := httptest.NewRequest("POST", "https://example.org/recordings/test/", nil)
		if tc.origin != "" {
			req.Header.Set("Origin", tc.origin)
		}
		if tc.site != "" {
			req.Header.Set("Sec-Fetch-Site", tc.site)
		}
		if got := sameSiteRecordingRequest(req); got != tc.allow {
			t.Errorf("Origin %q / site %q allowed: %v, want %v",
				tc.origin, tc.site, got, tc.allow)
		}
	}
}

func TestAdminAPIOrigin(t *testing.T) {
	oldDir := group.DataDirectory
	group.DataDirectory = t.TempDir()
	defer func() { group.DataDirectory = oldDir }()
	for _, origin := range []string{"https://evil.example", "null", "http://example.org"} {
		r := httptest.NewRequest("POST", "https://example.org/galene-api/v0/.groups/", nil)
		r.Header.Set("Origin", origin)
		w := httptest.NewRecorder()
		if !apiCORS(w, r, "POST") || w.Code != http.StatusForbidden {
			t.Errorf("Unexpected response for origin %q: %v", origin, w.Code)
		}
	}
	req := httptest.NewRequest("POST", "https://example.org/galene-api/v0/.groups/", nil)
	req.Header.Set("Origin", "https://example.org")
	w := httptest.NewRecorder()
	if apiCORS(w, req, "POST") {
		t.Fatal("Allowed same-origin request was rejected")
	}
}

func TestRecordingPageEscapesGroupAndIncludesToken(t *testing.T) {
	dir := t.TempDir()
	filename := "meeting.webm"
	if err := os.WriteFile(filepath.Join(dir, filename), []byte("video"), 0600); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	req := httptest.NewRequest("GET", "https://example.org/recordings/test/", nil)
	req.SetBasicAuth("alice", "pw")
	w := httptest.NewRecorder()
	serveGroupRecordings(w, req, f, "<svg onload=alert(1)>")
	body := w.Body.String()
	if strings.Contains(body, "<title>Recordings for group <svg") ||
		!strings.Contains(body, "&lt;svg onload=alert(1)&gt;") {
		t.Fatal("Group name was not HTML-escaped")
	}
	if !strings.Contains(body, "name=\"csrf\"") ||
		!strings.Contains(w.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") {
		t.Fatal("CSRF token or page security headers missing")
	}
}