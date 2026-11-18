package main

import (
 "encoding/json"
 "os"
 "path/filepath"
 "strings"
 "testing"
 "golang.org/x/crypto/bcrypt"
)

func TestBootstrapAdminHashAndFileProtection(t *testing.T) {
 path := filepath.Join(t.TempDir(),"data","config.json")
 secret := []byte("strong administrator passphrase")
 if err := bootstrapAdmin(path,"root_admin",secret); err != nil { t.Fatal(err) }
 raw,err := os.ReadFile(path);if err != nil { t.Fatal(err) }
 if strings.Contains(string(raw),string(secret)) || strings.Contains(string(raw),"galenectl.json") {
  t.Fatal("plaintext or local credential file leaked")
 }
 info,err := os.Stat(path);if err != nil || info.Mode().Perm()!=0600 { t.Fatalf("mode %v, err %v",info,err) }
 var config struct {
  Writable bool `json:"writableGroups"`
  Users map[string]struct {
   Password struct {
    Type string `json:"type"`
    Key string `json:"key"`
   } `json:"password"`
   Permissions string `json:"permissions"`
  } `json:"users"`
 }
 if err := json.Unmarshal(raw,&config);err!=nil {t.Fatal(err)}
 admin:=config.Users["root_admin"]
 if !config.Writable || admin.Permissions!="admin" || admin.Password.Type!="bcrypt" { t.Fatalf("bad config %+v",config) }
 if err := bcrypt.CompareHashAndPassword([]byte(admin.Password.Key),secret);err!=nil {t.Fatal(err)}
 if err := bootstrapAdmin(path,"other",secret);err==nil {t.Fatal("existing admin not protected")}
}

func TestBootstrapAdminPreservesSettingsAndRejectsAttacks(t *testing.T) {
 path := filepath.Join(t.TempDir(),"config.json")
 original:=[]byte(`{"proxyURL":"https://meet.example.org/","writableGroups":false}`)
 if err:=os.WriteFile(path,original,0644);err!=nil {t.Fatal(err)}
 if err:=bootstrapAdmin(path,"admin",[]byte("another-strong-password"));err!=nil {t.Fatal(err)}
 raw,_:=os.ReadFile(path)
 if !strings.Contains(string(raw),"meet.example.org") || !strings.Contains(string(raw),`"writableGroups": true`) {t.Fatalf("lost config: %s",raw)}
 for _,username:=range []string{"../root","https://evil.example","", "x/y"} {
  file:=filepath.Join(t.TempDir(),"config.json")
  if err:=bootstrapAdmin(file,username,[]byte("another-strong-password"));err==nil {t.Fatalf("accepted %q",username)}
 }
 for _,password:=range []string{"weak",strings.Repeat("x",73)} {
  file:=filepath.Join(t.TempDir(),"config.json")
  if err:=bootstrapAdmin(file,"admin",[]byte(password));err==nil {t.Fatal("bad password accepted")}
 }
 target:=filepath.Join(t.TempDir(),"target")
 if err:=os.WriteFile(target,[]byte("{}"),0600);err!=nil {t.Fatal(err)}
 link:=filepath.Join(filepath.Dir(target),"config.json")
 if err:=os.Symlink(target,link);err!=nil {t.Skip(err)}
 if err:=bootstrapAdmin(link,"admin",[]byte("another-strong-password"));err==nil {t.Fatal("symlink accepted")}
}
