package main

import "testing"

func TestNormaliseMeetingURL(t *testing.T) {
	tests := []struct {
		in, want, origin string
		ok               bool
	}{
		{"meet.example.com/group/abc/", "https://meet.example.com/group/abc/", "https://meet.example.com", true},
		{"https://meet.example.com/group/abc/?token=SECRET", "https://meet.example.com/group/abc/?token=SECRET", "https://meet.example.com", true},
		{"http://localhost:8443/group/test/", "http://localhost:8443/group/test/", "http://localhost:8443", true},
		{"http://127.0.0.1:8443/", "http://127.0.0.1:8443/", "http://127.0.0.1:8443", true},
		{"http://[::1]:8443/", "http://[::1]:8443/", "http://[::1]:8443", true},
		{"http://meet.example.com/group/", "", "", false},
		{"https://user:pass@meet.example.com/", "", "", false},
		{"javascript:alert(1)", "", "", false},
		{"file:///C:/Windows/System32/", "", "", false},
		{"http://example.com:abc/", "", "", false},
		{"", "", "", false},
		{"ftp://meet.example.com/", "", "", false},
	}
	for _, tc := range tests {
		u, origin, err := normaliseMeetingURL(tc.in)
		if tc.ok {
			if err != nil || u != tc.want || origin != tc.origin {
				t.Errorf("%q => %q, %q, %v; want %q, %q", tc.in, u, origin, err, tc.want, tc.origin)
			}
		} else if err == nil {
			t.Errorf("%q was unexpectedly accepted as %q", tc.in, u)
		}
	}
}