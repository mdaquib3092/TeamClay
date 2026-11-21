package main

import (
	"os"
	"regexp"
	"strings"
)

var staffPhonePattern = regexp.MustCompile(`^[1-9][0-9]{7,14}$`)

func staffRecipientAllowed(recipient string) bool {
	// No arbitrary JIDs, groups, prefix matching, or model-selected recipients.
	if !staffPhonePattern.MatchString(recipient) {
		return false
	}
	for _, configured := range strings.Split(os.Getenv("WHATSAPP_SEND_ALLOWLIST"), ",") {
		if strings.TrimPrefix(strings.TrimSpace(configured), "+") == recipient {
			return true
		}
	}
	return false
}
