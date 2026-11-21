package main

import (
	"bytes"
	"encoding/json"
	"image/png"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestPairingQRIsPrivateAndClearedAfterLinking(t *testing.T) {
	path := filepath.Join(t.TempDir(), "pairing.png")
	state := newPairingState(path)
	if err := state.setQR("local-test-pairing-payload"); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	state.handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8766/qr.png", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("QR returned %d", response.Code)
	}
	if _, err := png.Decode(bytes.NewReader(response.Body.Bytes())); err != nil {
		t.Fatal("QR endpoint did not return a valid PNG")
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatal("Pairing image must be owner-readable only")
	}
	state.markConnected("919876543210")
	response = httptest.NewRecorder()
	state.handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8766/qr.png", nil))
	if response.Code != http.StatusNotFound {
		t.Fatal("A paired account must not expose the old QR")
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("The paired QR must be removed from disk")
	}
}

func TestPairingStatusDoesNotExposeCredentials(t *testing.T) {
	t.Setenv("WHATSAPP_ALLOW_SEND", "")
	state := newPairingState(filepath.Join(t.TempDir(), "pairing.png"))
	state.markConnected("919876543210")
	response := httptest.NewRecorder()
	state.handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8766/status", nil))
	var status map[string]interface{}
	if err := json.Unmarshal(response.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if status["phase"] != "connected" || status["accountLastFour"] != "3210" || status["outboundEnabled"] != false {
		t.Fatal("Unexpected pairing status")
	}
	if bytes.Contains(response.Body.Bytes(), []byte("919876543210")) {
		t.Fatal("Status must not expose the full account number")
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("Pairing responses must not be cached")
	}
}

func TestPairingRejectsRemoteOriginsAndHosts(t *testing.T) {
	state := newPairingState(filepath.Join(t.TempDir(), "pairing.png"))
	for _, tc := range []struct{ url, origin string }{
		{"http://attacker.example:8766/status", ""},
		{"http://127.0.0.1:8766/status", "https://attacker.example"},
	} {
		request := httptest.NewRequest(http.MethodGet, tc.url, nil)
		request.Header.Set("Origin", tc.origin)
		response := httptest.NewRecorder()
		state.handler().ServeHTTP(response, request)
		if response.Code != http.StatusForbidden {
			t.Fatal("Non-local access must be rejected")
		}
	}
}

func TestWhatsAppSendingIsDisabledByDefault(t *testing.T) {
	t.Setenv("WHATSAPP_ALLOW_SEND", "")
	success, _ := sendWhatsAppMessage(nil, "919876543210", "must not send", "")
	if success {
		t.Fatal("Setup must never send a WhatsApp message")
	}
}
