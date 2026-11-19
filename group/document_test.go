package group

import (
	"errors"
	"net"
	"testing"

	"github.com/jech/galene/conn"
)

type documentTestClient struct { id string }
func (c *documentTestClient) Group() *Group { return nil }
func (c *documentTestClient) Addr() net.Addr { return nil }
func (c *documentTestClient) Id() string { return c.id }
func (c *documentTestClient) Username() string { return c.id }
func (c *documentTestClient) Init(string, []string) {}
func (c *documentTestClient) Permissions() []string { return []string{"message"} }
func (c *documentTestClient) Data() map[string]interface{} { return nil }
func (c *documentTestClient) PushConn(*Group, string, conn.Up, []conn.UpTrack, string) error { return nil }
func (c *documentTestClient) RequestConns(Client, *Group, string) error { return nil }
func (c *documentTestClient) Joined(string, string) error { return nil }
func (c *documentTestClient) PushClient(string, string, string, string, []string, map[string]interface{}) error { return nil }
func (c *documentTestClient) Kick(string, *string, string) error { return nil }

func TestSharedDocumentPermissionsAndAnnotations(t *testing.T) {
	g := &Group{
		name: "room", description: &Description{},
		clients: map[string]Client{
			"owner": &documentTestClient{id: "owner"},
			"alice": &documentTestClient{id: "alice"},
			"bob": &documentTestClient{id: "bob"},
		},
	}
	start, dest, err := g.ApplyDocumentAction("owner", map[string]interface{}{
		"action": "start", "id": "doc-1", "name": "notes.txt",
		"mime": "text/plain", "size": float64(20),
	})
	if err != nil || dest != "" || start["action"] != "start" {
		t.Fatalf("start document: event=%v dest=%q err=%v", start, dest, err)
	}
	op := map[string]interface{}{
		"id": "stroke-1", "tool": "pen",
		"points": []interface{}{
			map[string]interface{}{"x": float64(.1), "y": float64(.2)},
			map[string]interface{}{"x": float64(.3), "y": float64(.4)},
		},
	}
	event, _, err := g.ApplyDocumentAction("alice", map[string]interface{}{
		"action": "annotate", "docId": "doc-1", "operation": op,
	})
	if err != nil || event["action"] != "operation" {
		t.Fatalf("default participant annotation should be allowed: %v", err)
	}
	if _, _, err := g.ApplyDocumentAction("alice", map[string]interface{}{
		"action": "undo", "docId": "doc-1", "opId": "stroke-1",
	}); err != nil { t.Fatalf("participant should undo own annotation: %v", err) }
	if _, _, err := g.ApplyDocumentAction("owner", map[string]interface{}{
		"action": "grant-editor", "target": "alice",
	}); err != nil { t.Fatalf("owner should grant editor: %v", err) }
	if _, _, err := g.ApplyDocumentAction("alice", map[string]interface{}{
		"action": "clear", "docId": "doc-1",
	}); err != nil { t.Fatalf("granted editor should manage annotations: %v", err) }
	if _, _, err := g.ApplyDocumentAction("owner", map[string]interface{}{
		"action": "block-annotations", "target": "bob",
	}); err != nil { t.Fatalf("owner should be able to restrict a participant: %v", err) }
	if _, _, err := g.ApplyDocumentAction("bob", map[string]interface{}{
		"action": "annotate", "docId": "doc-1", "operation": op,
	}); err == nil { t.Fatal("restricted participant must not annotate") }
	if _, _, err := g.ApplyDocumentAction("alice", map[string]interface{}{
		"action": "end", "docId": "doc-1",
	}); err == nil { t.Fatal("editor must not end owner's document session") }
	if _, _, err := g.ApplyDocumentAction("owner", map[string]interface{}{
		"action": "end", "docId": "doc-1",
	}); err != nil { t.Fatalf("owner should end sharing: %v", err) }
	if g.DocumentSnapshot() != nil { t.Fatal("document session should be cleared") }
}

func TestSharedDocumentRejectsInvalidActions(t *testing.T) {
	g := &Group{name:"room", description:&Description{}, clients:map[string]Client{
		"owner": &documentTestClient{id:"owner"},
	}}
	_, _, err := g.ApplyDocumentAction("owner", map[string]interface{}{
		"action":"start", "id":"doc", "name":"archive.exe",
		"mime":"application/octet-stream", "size":float64(10),
	})
	if err == nil { t.Fatal("unsupported document type must be rejected") }
	_, _, err = g.ApplyDocumentAction("unknown", map[string]interface{}{"action":"start"})
	if err == nil || !errors.As(err, new(UserError)) {
		t.Fatalf("unknown participant should be rejected, got %v", err)
	}
}
