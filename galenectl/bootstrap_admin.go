package main

import (
 "bytes"
 "encoding/json"
 "errors"
 "flag"
 "fmt"
 "os"
 "path/filepath"
 "regexp"

 "github.com/jech/galene/group"
 "golang.org/x/crypto/bcrypt"
 "golang.org/x/term"
)

var bootstrapName = regexp.MustCompile("^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")

// bootstrapAdmin stores only a bcrypt hash. It never creates a credential file
// for cat-meetctl, and never replaces an existing administrator.
func bootstrapAdmin(filename, username string, password []byte) error {
 if !bootstrapName.MatchString(username) {
  return errors.New("username must contain only ASCII letters, digits, dot, dash or underscore (1-64)")
 }
 if len(password) < 12 || len(password) > 72 {
  return errors.New("password must be 12-72 bytes")
 }
 dir := filepath.Dir(filename)
 if err := os.MkdirAll(dir, 0700); err != nil { return err }
 config := make(map[string]json.RawMessage)
 info, err := os.Lstat(filename)
 exists := err == nil
 if err != nil && !errors.Is(err, os.ErrNotExist) { return err }
 if exists {
  if !info.Mode().IsRegular() { return errors.New("config must be a regular file, not a symlink") }
  if info.Size() > 1024*1024 { return errors.New("config file too large") }
  b, err := os.ReadFile(filename)
  if err != nil { return err }
  if err := json.Unmarshal(b, &config); err != nil { return fmt.Errorf("invalid config: %w", err) }
  if config == nil { return errors.New("config must be a JSON object") }
 }
 users := make(map[string]json.RawMessage)
 if value, ok := config["users"]; ok {
  if err := json.Unmarshal(value, &users); err != nil { return err }
  if users == nil { users = make(map[string]json.RawMessage) }
 }
 if _, ok := users[username]; ok { return errors.New("username already exists; refusing to overwrite it") }
 for name, value := range users {
  var u group.UserDescription
  if err := json.Unmarshal(value, &u); err != nil { return fmt.Errorf("invalid user %q: %w", name, err) }
  for _, p := range u.Permissions.Permissions(nil) {
   if p == "admin" { return errors.New("global admin already exists; refusing to replace it") }
  }
 }
 hash, err := bcrypt.GenerateFromPassword(password, 12)
 if err != nil { return err }
 permissions, err := group.NewPermissions("admin")
 if err != nil { return err }
 key := string(hash)
 entry, err := json.Marshal(group.UserDescription{Password: group.Password{Type:"bcrypt", Key:&key},Permissions:permissions})
 if err != nil { return err }
 users[username] = entry
 encoded, err := json.Marshal(users)
 if err != nil { return err }
 config["users"] = encoded
 config["writableGroups"] = json.RawMessage("true")
 data, err := json.MarshalIndent(config, "", "  ")
 if err != nil { return err }
 data = append(data, '\n')
 tmp, err := os.CreateTemp(dir, ".cat-meet-config-*.tmp")
 if err != nil { return err }
 defer os.Remove(tmp.Name())
 if err := tmp.Chmod(0600); err != nil { tmp.Close(); return err }
 if _, err := tmp.Write(data); err != nil { tmp.Close(); return err }
 if err := tmp.Sync(); err != nil { tmp.Close(); return err }
 if err := tmp.Close(); err != nil { return err }
 if exists {
  latest, err := os.Lstat(filename)
  if err != nil { return err }
  if !latest.Mode().IsRegular() || latest.Size() != info.Size() || !latest.ModTime().Equal(info.ModTime()) {
   return errors.New("config changed during setup, refusing overwrite")
  }
 } else if _, err := os.Lstat(filename); !errors.Is(err, os.ErrNotExist) {
  return errors.New("config appeared during setup, refusing overwrite")
 }
 return os.Rename(tmp.Name(), filename)
}

func bootstrapAdminCmd(cmdname string, args []string) {
 flags := flag.NewFlagSet(cmdname, flag.ExitOnError)
 filename := flags.String("config", filepath.Join("data", "config.json"), "server data/config.json")
 username := flags.String("user", "", "new global administrator username")
 flags.Parse(args)
 if flags.NArg()!=0 || *username=="" { flags.Usage(); os.Exit(2) }
 if !term.IsTerminal(int(os.Stdin.Fd())) {
  fmt.Fprintln(os.Stderr, "Run from a real terminal; never put a password in arguments or environment.")
  os.Exit(2)
 }
 fmt.Fprint(os.Stderr, "New admin password (12-72 bytes): ")
 first, err := term.ReadPassword(int(os.Stdin.Fd()))
 fmt.Fprintln(os.Stderr)
 if err != nil { fmt.Fprintln(os.Stderr,err);os.Exit(1) }
 defer wipe(first)
 fmt.Fprint(os.Stderr, "Confirm password: ")
 second, err := term.ReadPassword(int(os.Stdin.Fd()))
 fmt.Fprintln(os.Stderr)
 if err != nil { fmt.Fprintln(os.Stderr,err);os.Exit(1) }
 defer wipe(second)
 if !bytes.Equal(first,second) { fmt.Fprintln(os.Stderr,"Passwords do not match");os.Exit(1) }
 if err := bootstrapAdmin(*filename,*username,first);err!=nil {
  fmt.Fprintln(os.Stderr,"Setup failed:",err);os.Exit(1)
 }
 fmt.Printf("Administrator %q created. Configuration: %s (0600); password stored as bcrypt hash.\n",*username,*filename)
 fmt.Println("Open https://YOUR-HOST/admin.html to manage rooms and users.")
}

func wipe(b []byte) { for i := range b { b[i]=0 } }
