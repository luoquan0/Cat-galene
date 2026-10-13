package webserver

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/time/rate"
)

// Limit expensive unauthenticated entrypoints without trusting spoofable
// X-Forwarded-For headers. A generous burst accommodates meetings behind
// one reverse proxy while slowing bulk login and connection attempts.
type addressLimiter struct {
	mu      sync.Mutex
	clients map[string]struct {
		limiter *rate.Limiter
		seen    time.Time
	}
}

var entryLimiter addressLimiter

func (l *addressLimiter) allow(addr string) bool {
	ip, _, err := net.SplitHostPort(addr)
	if err != nil {
		ip = addr
	}
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.clients == nil {
		l.clients = make(map[string]struct {
			limiter *rate.Limiter
			seen    time.Time
		})
	}
	if v, ok := l.clients[ip]; ok {
		v.seen = now
		l.clients[ip] = v
		return v.limiter.Allow()
	}
	if len(l.clients) >= 4096 {
		for ip, v := range l.clients {
			if now.Sub(v.seen) > 10*time.Minute {
				delete(l.clients, ip)
			}
		}
		if len(l.clients) >= 4096 {
			return false
		}
	}
	limiter := rate.NewLimiter(10, 100)
	l.clients[ip] = struct {
		limiter *rate.Limiter
		seen    time.Time
	}{limiter, now}
	return limiter.Allow()
}

func checkEntryRate(w http.ResponseWriter, r *http.Request) bool {
	if entryLimiter.allow(r.RemoteAddr) {
		return true
	}
	w.Header().Set("Retry-After", "1")
	http.Error(w, "Too many requests", http.StatusTooManyRequests)
	return false
}

// The key is created on process startup and is never exposed to clients.
var recordingCSRFKey = func() [32]byte {
	var key [32]byte
	if _, err := rand.Read(key[:]); err != nil {
		panic(err)
	}
	return key
}()

func recordingCSRFToken(r *http.Request, group, filename string) string {
	username, password, _ := r.BasicAuth()
	mac := hmac.New(sha256.New, recordingCSRFKey[:])
	for _, s := range []string{username, password, group, filename} {
		mac.Write([]byte(s))
		mac.Write([]byte{0})
	}
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func validRecordingCSRF(r *http.Request, group, filename, provided string) bool {
	expected := recordingCSRFToken(r, group, filename)
	return subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

// Cross-origin form submissions should never be able to change recordings.
// A token is checked separately so older clients without Origin headers
// cannot forge a recording deletion.
func sameSiteRecordingRequest(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return r.Header.Get("Sec-Fetch-Site") != "cross-site"
	}
	o, err := url.Parse(origin)
	if err != nil || (o.Scheme != "http" && o.Scheme != "https") ||
		o.User != nil || o.Path != "" || o.RawQuery != "" || o.Fragment != "" {
		return false
	}
	base, err := baseURL(r)
	if err != nil || !strings.EqualFold(o.Host, base.Host) {
		return false
	}
	if (r.TLS != nil || base.Scheme == "https") && o.Scheme != "https" {
		return false
	}
	return true
}