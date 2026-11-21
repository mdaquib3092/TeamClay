package main

import (
	"bytes"
	"testing"

	waProto "go.mau.fi/whatsmeow/binary/proto"
	"google.golang.org/protobuf/proto"
)

func TestStoredVoiceNoteUsesSignedRequestURI(t *testing.T) {
	// The query must survive both receipt and a later read of the stored locator.
	const direct = "/v/voice%2Fnote.enc?ccb=11-4&oh=a%2Bb%3D&oe=00FF&k=1&k=2"
	const legacy = "https://mmg.whatsapp.net" + direct
	for _, tc := range []struct{ name, native, url, want string }{
		{"new direct-path-only voice note", direct, "", direct},
		{"full URL in existing database row", "", legacy, direct},
		{"prefer native signature", direct, legacy + "&extra=x", direct},
		{"path-only native and signed URL", "/v/voice.enc", legacy, direct},
	} {
		t.Run(tc.name, func(t *testing.T) {
			key, hash := bytes.Repeat([]byte{1}, 32), bytes.Repeat([]byte{2}, 32)
			msg := &waProto.Message{AudioMessage: &waProto.AudioMessage{
				DirectPath: proto.String(tc.native), URL: proto.String(tc.url),
				MediaKey: key, FileSHA256: hash, FileEncSHA256: hash, FileLength: proto.Uint64(100),
			}}
			kind, _, saved, k, h, eh, size := extractMediaInfo(msg)
			if kind != "audio" || mediaDownloadPath(saved) != tc.want ||
				!bytes.Equal(k, key) || !bytes.Equal(h, hash) || !bytes.Equal(eh, hash) || size != 100 {
				t.Fatal("signed download path or media integrity metadata did not survive storage")
			}
		})
	}
}
