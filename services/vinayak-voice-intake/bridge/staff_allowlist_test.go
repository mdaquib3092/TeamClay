package main

import "testing"

func TestStaffAllowlistRequiresExactPhoneAndRejectsGroups(t *testing.T) {
	t.Setenv("WHATSAPP_SEND_ALLOWLIST", "+919123456789,+919123456780")
	if !staffRecipientAllowed("919123456789") {
		t.Fatal("Configured staff number should be allowed")
	}
	for _, recipient := range []string{"91912345678", "9191234567890", "919123456789@s.whatsapp.net", "123@g.us", ""} {
		if staffRecipientAllowed(recipient) {
			t.Fatal("Non-exact recipient was allowed")
		}
	}
}

func TestLiveSendingWithoutStaffAllowlistFailsClosed(t *testing.T) {
	t.Setenv("WHATSAPP_ALLOW_SEND", "true")
	t.Setenv("WHATSAPP_SEND_ALLOWLIST", "")
	success, _ := sendWhatsAppMessage(nil, "919123456789", "must not send", "")
	if success {
		t.Fatal("Missing staff allowlist must block sending")
	}
}
