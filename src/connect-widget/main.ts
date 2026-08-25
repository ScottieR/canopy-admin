// Client-side half of the web-hosted connection token capture flow. Served as a
// same-origin static bundle (see scripts/build-connect-widget.mjs) and loaded by
// the server-rendered /connect/:token page (connections-routes.js).
//
// Encrypts the pasted API key to the requesting Canopy install's X25519 public key
// before it ever leaves the browser: ECDH (fresh ephemeral keypair, this page's
// private half never leaves memory and is discarded after one use) -> HKDF-SHA256
// -> ChaCha20-Poly1305. canopy-admin only ever sees ciphertext. This MUST stay in
// lockstep with the decrypt half in canopy/src-tauri/src/web_connections.rs — same
// curve, same HKDF info string, same AEAD construction. See WEB_CONNECTIONS.md.
import { x25519 } from '@noble/curves/ed25519.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

// Domain-separation tag for HKDF — must match HKDF_INFO in web_connections.rs byte-for-byte.
const HKDF_INFO = new TextEncoder().encode('canopy-web-connections-v1');

type ConnectConfig = {
  token: string;
  providerName: string;
  instructions: string | null;
  placeholder: string;
  tokenUrl: string | null;
  publicKey: string; // base64, 32 bytes
  expiresAt: string; // ISO 8601
};

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function readConfig(): ConnectConfig | null {
  const el = document.getElementById('connect-config');
  if (!el || !el.textContent) return null;
  try {
    return JSON.parse(el.textContent) as ConnectConfig;
  } catch {
    return null;
  }
}

/** Encrypts `plaintext` to `serverPublicKeyB64` via a fresh, one-time ephemeral keypair. */
export function encryptToInstance(plaintext: string, serverPublicKeyB64: string) {
  const serverPublicKey = base64ToBytes(serverPublicKeyB64);
  const ephemeral = x25519.keygen();
  const shared = x25519.getSharedSecret(ephemeral.secretKey, serverPublicKey);
  const aeadKey = hkdf(sha256, shared, undefined, HKDF_INFO, 32);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = chacha20poly1305(aeadKey, nonce).encrypt(new TextEncoder().encode(plaintext));

  // Best-effort scrub of transient key material — GC-dependent, not a hard guarantee,
  // but there's no reason to hold these any longer than the encrypt call above.
  ephemeral.secretKey.fill(0);
  shared.fill(0);
  aeadKey.fill(0);

  return {
    ciphertext: bytesToBase64(ciphertext),
    nonce: bytesToBase64(nonce),
    ephemeralPublicKey: bytesToBase64(ephemeral.publicKey),
  };
}

function setStatus(el: HTMLElement, message: string, kind: 'idle' | 'error' | 'success') {
  el.textContent = message;
  el.dataset.kind = kind;
}

function main() {
  const config = readConfig();
  const root = document.getElementById('connect-root');
  const statusEl = document.getElementById('status-message');
  if (!root || !statusEl) return;

  if (!config) {
    setStatus(statusEl, 'This link is malformed. Ask the agent to send a new one.', 'error');
    return;
  }

  const providerNameEl = document.getElementById('provider-name');
  const instructionsEl = document.getElementById('instructions');
  const tokenLinkEl = document.getElementById('token-link') as HTMLAnchorElement | null;
  const form = document.getElementById('connect-form') as HTMLFormElement | null;
  const input = document.getElementById('key-input') as HTMLInputElement | null;
  const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement | null;

  // textContent, never innerHTML — providerName/instructions are agent-authored.
  if (providerNameEl) providerNameEl.textContent = config.providerName;
  if (instructionsEl) instructionsEl.textContent = config.instructions || '';
  if (tokenLinkEl) {
    if (config.tokenUrl) {
      tokenLinkEl.href = config.tokenUrl;
      tokenLinkEl.hidden = false;
    } else {
      tokenLinkEl.hidden = true;
    }
  }
  if (input) input.placeholder = config.placeholder;

  const expiresAt = new Date(config.expiresAt).getTime();
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    setStatus(statusEl, 'This link has expired. Ask the agent to send a new one.', 'error');
    if (form) form.hidden = true;
    return;
  }

  if (!form || !input || !submitBtn) return;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) {
      setStatus(statusEl, 'Paste the key first.', 'error');
      return;
    }

    submitBtn.disabled = true;
    input.disabled = true;
    setStatus(statusEl, 'Encrypting and sending…', 'idle');

    try {
      const payload = encryptToInstance(value, config.publicKey);
      // Clear the plaintext from the DOM the instant it's encrypted — don't wait
      // for the network round trip.
      input.value = '';

      const response = await fetch(`/api/connections/complete/${encodeURIComponent(config.token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.status === 404 || response.status === 410) {
        setStatus(statusEl, 'This link has expired or was already used.', 'error');
        form.hidden = true;
        return;
      }
      if (!response.ok) {
        setStatus(statusEl, 'Something went wrong. Try again.', 'error');
        submitBtn.disabled = false;
        input.disabled = false;
        return;
      }

      setStatus(statusEl, 'Connected! You can close this window — Canopy will pick it up shortly.', 'success');
      form.hidden = true;
    } catch {
      setStatus(statusEl, 'Network error — check your connection and try again.', 'error');
      submitBtn.disabled = false;
      input.disabled = false;
    }
  });
}

// Guarded so this module can be imported from a plain Node test (no DOM) to
// exercise encryptToInstance/bytesToBase64/base64ToBytes in isolation.
if (typeof document !== 'undefined') {
  main();
}
