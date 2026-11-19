package group

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestGlobalAccountAuthenticatesAcrossRoomDescriptions(t *testing.T) {
	oldDirectory, oldDataDirectory := Directory, DataDirectory
	configuration.mu.Lock()
	oldConfiguration := configuration.configuration
	configuration.configuration = nil
	configuration.mu.Unlock()
	defer func() {
		Directory, DataDirectory = oldDirectory, oldDataDirectory
		configuration.mu.Lock()
		configuration.configuration = oldConfiguration
		configuration.mu.Unlock()
	}()

	Directory = t.TempDir()
	DataDirectory = t.TempDir()
	if err := os.MkdirAll(DataDirectory, 0700); err != nil {
		t.Fatal(err)
	}

	user := &UserDescription{Permissions: Permissions{name: "present"}}
	if err := UpdateGlobalUser("alice", "", user); err != nil {
		t.Fatalf("create global user: %v", err)
	}
	password := "global-password-123"
	if err := SetGlobalUserPassword("alice", Password{Type: "plain", Key: &password}); err != nil {
		t.Fatalf("set global password: %v", err)
	}

	for _, room := range []string{"team-a", "team-b", "team-c"} {
		desc := &Description{Users: map[string]UserDescription{}}
		username := "alice"
		gotUsername, perms, err := desc.GetPermission(room, ClientCredentials{
			Username: &username, Password: password,
		})
		if err != nil {
			t.Fatalf("global user failed to enter %s: %v", room, err)
		}
		if gotUsername != "alice" || !slices.Contains(perms, "present") {
			t.Fatalf("unexpected authentication result for %s: username=%q perms=%v", room, gotUsername, perms)
		}
	}
}

func TestGlobalAccountRememberBindingAndAdminProtection(t *testing.T) {
	oldDirectory, oldDataDirectory := Directory, DataDirectory
	configuration.mu.Lock()
	oldConfiguration := configuration.configuration
	configuration.configuration = nil
	configuration.mu.Unlock()
	defer func() {
		Directory, DataDirectory = oldDirectory, oldDataDirectory
		configuration.mu.Lock()
		configuration.configuration = oldConfiguration
		configuration.mu.Unlock()
	}()

	Directory = t.TempDir()
	DataDirectory = t.TempDir()
	if err := os.MkdirAll(DataDirectory, 0700); err != nil {
		t.Fatal(err)
	}
	password := "global-password-123"
	if err := UpdateGlobalUser("alice", "", &UserDescription{
		Permissions: Permissions{name: "op"},
	}); err != nil {
		t.Fatal(err)
	}
	if err := SetGlobalUserPassword("alice", Password{Type: "plain", Key: &password}); err != nil {
		t.Fatal(err)
	}
	desc := &Description{Users: map[string]UserDescription{}}
	if binding, ok := desc.rememberBinding("alice", "secret"); !ok || binding == "" {
		t.Fatal("global account must support the 7-day remembered-login binding")
	}
	if !desc.userExists("alice") {
		t.Fatal("global account should be reserved as an existing username")
	}

	configuration.mu.Lock()
	conf, err := getConfigurationUnlocked()
	if err == nil {
		conf.Users["root"] = UserDescription{
			Password: Password{Type: "plain", Key: &password},
			Permissions: Permissions{name: "admin"},
		}
		err = writeConfigurationUnlocked(conf)
	}
	configuration.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	if err := DeleteGlobalUser("root", ""); err == nil {
		t.Fatal("global administrator account must not be deletable as a meeting account")
	}
	if err := SetGlobalUserPassword("root", Password{}); err == nil {
		t.Fatal("global administrator password must not be editable here")
	}
	if _, err := os.Stat(filepath.Join(DataDirectory, "config.json")); err != nil {
		t.Fatal(err)
	}
}

func TestObserverCanUseDocumentCollaborationWithoutChatOrMedia(t *testing.T) {
	permissions := (Permissions{name: "observe"}).Permissions(&Description{})
	if !slices.Contains(permissions, "document") {
		t.Fatal("observer should be allowed to view and annotate shared documents")
	}
	if slices.Contains(permissions, "message") ||
		slices.Contains(permissions, "present") {
		t.Fatalf("observer must not gain chat or media permissions: %v", permissions)
	}
}
