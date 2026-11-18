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

func TestSafeGroupRedirect(t *testing.T) {
 for _, value := range []string{"/group/team/","/","https://meet.example.org/group/team/"} {
  if !safeGroupRedirect(value) { t.Errorf("safe redirect rejected: %q",value) }
 }
 for _, value := range []string{"","//evil.example/path","javascript:alert(1)","data:text/html,hi",
  "http://evil.example","https://user:pass@evil.example","\\evil.example", "https://evil.example/\r\nSet-Cookie: a=b",
  "https://evil.example/#fragment","../foo","./foo"} {
  if safeGroupRedirect(value) { t.Errorf("unsafe redirect accepted: %q",value) }
 }
}

func TestAdminSessionRequiresGlobalAdmin(t *testing.T) {
 old := group.DataDirectory
 dir := t.TempDir()
 group.DataDirectory = dir
 defer func(){group.DataDirectory=old}()
 if err:=os.WriteFile(filepath.Join(dir,"config.json"),[]byte(`{"writableGroups":true,"users":{"root":{"password":"test-secret","permissions":"admin"},"normal":{"password":"test-secret","permissions":"present"}}}`),0600);err!=nil{t.Fatal(err)}
 cases:=[]struct{user,password string;want int}{
  {"root","test-secret",200},
  {"root","wrong",403},
  {"normal","test-secret",403},
  {"","",403},
 }
 for _,tc:=range cases{
  req:=httptest.NewRequest("GET","https://example.org/galene-api/v0/.admin-session",nil)
  if tc.user!="" {req.SetBasicAuth(tc.user,tc.password)}
  w:=httptest.NewRecorder()
  apiHandler(w,req)
  if w.Code!=tc.want {t.Errorf("%q: HTTP %v, expected %v",tc.user,w.Code,tc.want)}
  if w.Header().Get("WWW-Authenticate")!="" {t.Fatal("admin JSON endpoint must not trigger browser basic-auth dialog")}
  if tc.want==200 && !strings.Contains(w.Body.String(),"writableGroups") {t.Fatal("missing admin capability status")}
 }
 req:=httptest.NewRequest("GET","https://example.org/galene-api/v0/.admin-session",nil)
 req.SetBasicAuth("root","test-secret")
 req.Header.Set("Origin","https://evil.example")
 w:=httptest.NewRecorder()
 apiHandler(w,req)
 if w.Code!=http.StatusForbidden {t.Fatalf("cross-site admin request was accepted: %v",w.Code)}
}


func TestAdminHTMLSecurityHeaders(t *testing.T) {
 dir:=t.TempDir()
 if err:=os.WriteFile(filepath.Join(dir,"admin.html"), []byte("<!doctype html><title>Admin</title>"),0600);err!=nil{t.Fatal(err)}
 root,err:=os.OpenRoot(dir);if err!=nil{t.Fatal(err)}
 defer root.Close()
 req:=httptest.NewRequest("GET","https://meet.example.org/admin.html",nil)
 w:=httptest.NewRecorder()
 (&fileHandler{root:root}).ServeHTTP(w,req)
 if w.Code!=http.StatusOK {t.Fatalf("admin page status: %v",w.Code)}
 if cache:=w.Header().Get("Cache-Control");cache!="no-store" {t.Fatalf("admin page cache: %q",cache)}
 policy:=w.Header().Get("Content-Security-Policy")
 for _,directive:=range []string{"script-src 'self'","object-src 'none'","frame-ancestors 'none'","base-uri 'none'"} {
  if !strings.Contains(policy,directive) {t.Errorf("CSP missing %q: %s",directive,policy)}
 }
 if w.Header().Get("X-Content-Type-Options")!="nosniff" {t.Fatal("nosniff missing")}
}
