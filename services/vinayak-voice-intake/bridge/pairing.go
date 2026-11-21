package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"rsc.io/qr"
)

// Pairing credentials are served only over loopback and never logged as text.
type pairingState struct {
	mu         sync.RWMutex
	phase      string
	generation int
	lastFour   string
	png        []byte
	qrPath     string
}

func newPairingState(qrPath string) *pairingState {
	return &pairingState{phase: "waiting", qrPath: qrPath}
}

func (p *pairingState) setQR(code string) error {
	image, err := qr.Encode(code, qr.L)
	if err != nil {
		return fmt.Errorf("could not render the pairing QR")
	}
	image.Scale = 8
	png := image.PNG()
	if err := os.MkdirAll(filepath.Dir(p.qrPath), 0700); err != nil {
		return err
	}
	if err := os.WriteFile(p.qrPath+".tmp", png, 0600); err != nil {
		return err
	}
	if err := os.Rename(p.qrPath+".tmp", p.qrPath); err != nil {
		return err
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.png = png
	p.phase = "scan"
	p.generation++
	return nil
}

func (p *pairingState) setPhase(phase string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.phase = phase
	p.png = nil
	_ = os.Remove(p.qrPath)
}

func (p *pairingState) markConnected(number string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.phase = "connected"
	if len(number) > 4 {
		p.lastFour = number[len(number)-4:]
	}
	p.png = nil
	_ = os.Remove(p.qrPath)
}

func (p *pairingState) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host, _, err := net.SplitHostPort(r.Host)
		if err != nil || (host != "127.0.0.1" && host != "localhost") {
			http.Error(w, "Local access only", http.StatusForbidden)
			return
		}
		if origin := r.Header.Get("Origin"); origin != "" && origin != "http://"+r.Host {
			http.Error(w, "Local access only", http.StatusForbidden)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		p.mu.RLock()
		defer p.mu.RUnlock()
		switch r.URL.Path {
		case "/":
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			fmt.Fprint(w, pairingPage)
		case "/status":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"phase": p.phase, "generation": p.generation,
				"accountLastFour": p.lastFour,
				"outboundEnabled": os.Getenv("WHATSAPP_ALLOW_SEND") == "true",
				"sendScope":       "configured_staff_only",
			})
		case "/qr.png":
			if len(p.png) == 0 || p.phase != "scan" {
				http.Error(w, "No active pairing QR", http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "image/png")
			w.Write(p.png)
		default:
			http.NotFound(w, r)
		}
	})
}

func startPairingServer() (*pairingState, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:8766")
	if err != nil {
		return nil, fmt.Errorf("pairing page could not bind to 127.0.0.1:8766: %w", err)
	}
	p := newPairingState("store/pairing-qr.png")
	server := &http.Server{Handler: p.handler(), ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			fmt.Println("The local pairing page stopped.")
		}
	}()
	fmt.Println("WhatsApp pairing page: http://127.0.0.1:8766")
	fmt.Println("Outgoing WhatsApp messages are disabled unless WHATSAPP_ALLOW_SEND=true.")
	return p, nil
}

const pairingPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vinayak · Link WhatsApp agent</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f1f6f3;color:#18382b;font:16px system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:24px}
main{max-width:720px;width:100%;padding:30px;background:white;border:1px solid #dce8df;border-radius:20px;text-align:center;box-shadow:0 18px 70px #1234210d}
h1{font-size:27px;margin:12px 0}p{line-height:1.6;color:#52695d}.label{font-size:12px;letter-spacing:2px;font-weight:700;color:#377857}
#qr{display:block;width:min(100%,440px);height:auto;margin:18px auto;image-rendering:pixelated}#qr[hidden]{display:none}
#status{padding:12px 16px;border-radius:10px;background:#eef7f1;font-weight:600}.steps{text-align:left;line-height:1.8;max-width:480px;margin:20px auto}
.note{font-size:13px;border-top:1px solid #e2eae5;padding-top:16px}#retry{font-size:14px;color:#885c12}
</style></head><body><main>
<div class="label">VINAYAK PROCUREMENT · LOCAL CONNECTION</div>
<h1>Link the WhatsApp agent number</h1>
<div id="status" role="status">Preparing a secure pairing code…</div>
<img id="qr" hidden alt="Live WhatsApp linked-device pairing QR code">
<ol class="steps"><li>Open WhatsApp on the phone with your <strong>dedicated agent number</strong>.</li>
<li>Choose <strong>Settings → Linked devices → Link a device</strong>.<br>On Android: <strong>⋮ → Linked devices → Link a device</strong>.</li>
<li>Scan the QR code on this screen. It refreshes automatically.</li></ol>
<p id="retry"></p>
<p class="note">Only scan this using the account intended for the procurement agent. Linking permits the bridge to sync that account's chats locally. This is an unofficial linked-device integration. Staff-only AI conversations run separately at http://127.0.0.1:8767. Procurement approvals are not automatic.</p>
<p class="note" id="sending">Outgoing messages are disabled during setup. Keep this QR private.</p>
</main><script>
const statusEl=document.getElementById('status'),image=document.getElementById('qr'),retry=document.getElementById('retry');let generation=-1;
async function update(){try{const response=await fetch('/status',{cache:'no-store'});if(!response.ok)throw new Error();const state=await response.json();
document.getElementById('sending').textContent=state.outboundEnabled?'Live sending is restricted to the configured staff phone-number allowlist. Keep this QR private.':'Outgoing messages are disabled during setup. Keep this QR private.';
if(state.phase==='scan'){statusEl.textContent='Ready to scan — waiting for your phone';retry.textContent='';if(generation!==state.generation){generation=state.generation;image.src='/qr.png?v='+generation;}image.hidden=false;}
else{image.hidden=true;if(state.phase==='connected'){statusEl.textContent='WhatsApp linked successfully'+(state.accountLastFour?' · account ending '+state.accountLastFour:'');retry.textContent='Keep the bridge running. The procurement conversation agent is a separate next step.';}
else if(state.phase==='connecting'){statusEl.textContent='QR accepted — finishing the connection…';retry.textContent='';}
else if(state.phase==='waiting'){statusEl.textContent='Connecting to WhatsApp to obtain a pairing code…';}
else{statusEl.textContent='Pairing is not active: '+state.phase;retry.textContent='The code may have expired. Ask to restart pairing; refreshing this page alone does not generate a new code.';}}}
catch{image.hidden=true;statusEl.textContent='The local bridge is not reachable';retry.textContent='Keep the bridge terminal running, then refresh this page.';}}
update();setInterval(update,1500);
</script></body></html>`
