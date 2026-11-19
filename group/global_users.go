package group

import (
	"errors"
	"maps"
	"os"
	"slices"
	"strings"
)

var ErrProtectedGlobalAdmin = errors.New("global administrator accounts are managed separately")

func isGlobalAdminUser(user UserDescription) bool {
	return slices.Contains(user.Permissions.Permissions(nil), "admin")
}

func validGlobalUserName(username string) bool {
	return username != "" && len(username) <= 64 &&
		validUsername(username) && !strings.Contains(username, "/")
}

func validGlobalUserRole(user UserDescription) bool {
	switch user.Permissions.name {
	case "present", "op", "message", "observe":
		return true
	default:
		return false
	}
}

// GetGlobalUsers returns server-wide meeting accounts, excluding the
// administrator credentials used to access the administration console.
func GetGlobalUsers() ([]string, string, error) {
	conf, err := GetConfiguration()
	if err != nil {
		return nil, "", err
	}
	users := make([]string, 0, len(conf.Users))
	for username, user := range conf.Users {
		if !isGlobalAdminUser(user) {
			users = append(users, username)
		}
	}
	slices.Sort(users)
	return users, makeETag(conf.fileSize, conf.modTime), nil
}

// GetSanitisedGlobalUser returns a global account without its password hash.
func GetSanitisedGlobalUser(username string) (UserDescription, string, error) {
	if !validGlobalUserName(username) {
		return UserDescription{}, "", os.ErrNotExist
	}
	conf, err := GetConfiguration()
	if err != nil {
		return UserDescription{}, "", err
	}
	user, ok := conf.Users[username]
	if !ok {
		return UserDescription{}, "", os.ErrNotExist
	}
	if isGlobalAdminUser(user) {
		return UserDescription{}, "", ErrProtectedGlobalAdmin
	}
	user.Password = Password{}
	return user, makeETag(conf.fileSize, conf.modTime), nil
}

func GetGlobalUserTag(username string) (string, error) {
	_, etag, err := GetSanitisedGlobalUser(username)
	return etag, err
}

// UpdateGlobalUser creates or updates a global meeting account. Passwords
// are set through SetGlobalUserPassword and are never accepted in this body.
func UpdateGlobalUser(username, etag string, user *UserDescription) error {
	if !validGlobalUserName(username) {
		return errors.New("invalid global username")
	}
	if user == nil || user.Password.Type != "" || user.Password.Key != nil {
		return errors.New("global user description must not contain a password")
	}
	if !validGlobalUserRole(*user) {
		return errors.New("global accounts may use present, op, message or observe roles only")
	}

	configuration.mu.Lock()
	defer configuration.mu.Unlock()
	conf, err := getConfigurationUnlocked()
	if err != nil {
		return err
	}
	nextConfig := *conf
	nextConfig.Users = maps.Clone(conf.Users)
	if nextConfig.Users == nil {
		nextConfig.Users = make(map[string]UserDescription)
	}
	old, exists := nextConfig.Users[username]
	if exists && isGlobalAdminUser(old) {
		return ErrProtectedGlobalAdmin
	}
	oldTag := ""
	if exists {
		oldTag = makeETag(conf.fileSize, conf.modTime)
	}
	if oldTag != etag {
		return ErrTagMismatch
	}
	next := *user
	next.Password = old.Password
	nextConfig.Users[username] = next
	return writeConfigurationUnlocked(&nextConfig)
}

func DeleteGlobalUser(username, etag string) error {
	if !validGlobalUserName(username) {
		return os.ErrNotExist
	}
	configuration.mu.Lock()
	defer configuration.mu.Unlock()
	conf, err := getConfigurationUnlocked()
	if err != nil {
		return err
	}
	user, exists := conf.Users[username]
	if !exists {
		return os.ErrNotExist
	}
	if isGlobalAdminUser(user) {
		return ErrProtectedGlobalAdmin
	}
	if makeETag(conf.fileSize, conf.modTime) != etag {
		return ErrTagMismatch
	}
	nextConfig := *conf
	nextConfig.Users = maps.Clone(conf.Users)
	delete(nextConfig.Users, username)
	return writeConfigurationUnlocked(&nextConfig)
}

func SetGlobalUserPassword(username string, password Password) error {
	if !validGlobalUserName(username) {
		return os.ErrNotExist
	}
	configuration.mu.Lock()
	defer configuration.mu.Unlock()
	conf, err := getConfigurationUnlocked()
	if err != nil {
		return err
	}
	user, exists := conf.Users[username]
	if !exists {
		return os.ErrNotExist
	}
	if isGlobalAdminUser(user) {
		return ErrProtectedGlobalAdmin
	}
	nextConfig := *conf
	nextConfig.Users = maps.Clone(conf.Users)
	user.Password = password
	nextConfig.Users[username] = user
	return writeConfigurationUnlocked(&nextConfig)
}
