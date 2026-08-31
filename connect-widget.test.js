// Run: node --test connect-widget.test.js
// Exercises the browser-side crypto in src/connect-widget/main.ts directly (no DOM
// needed — main() only auto-runs when `document` exists, see that file's guard).
// This MUST stay in lockstep with canopy/src-tauri/src/web_connections.rs; see the
// golden-vector regression test there (js_interop_check) which pins ciphertext
// produced by this exact module's encryptToInstance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToBase64, base64ToBytes, encryptToInstance } from './src/connect-widget/main.ts';

const HKDF_INFO = new TextEncoder().encode('canopy-web-connections-v1');

test('bytesToBase64 / base64ToBytes round-trip', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
});

test('encryptToInstance decrypts correctly when reversed with the recipient secret', () => {
  // Simulates the Canopy install's own side of the exchange, using the same
  // primitives Rust uses, to prove self-consistency of the JS half in isolation.
  const instance = x25519.keygen();
  const plaintext = 'sk_live_roundtrip_check';

  const { ciphertext, nonce, ephemeralPublicKey } = encryptToInstance(
    plaintext,
    bytesToBase64(instance.publicKey),
  );

  const shared = x25519.getSharedSecret(instance.secretKey, base64ToBytes(ephemeralPublicKey));
  const aeadKey = hkdf(sha256, shared, undefined, HKDF_INFO, 32);
  const decrypted = chacha20poly1305(aeadKey, base64ToBytes(nonce)).decrypt(base64ToBytes(ciphertext));

  assert.equal(new TextDecoder().decode(decrypted), plaintext);
});

test('encryptToInstance uses a fresh ephemeral key every call (no key reuse across submissions)', () => {
  const instance = x25519.keygen();
  const a = encryptToInstance('same-plaintext', bytesToBase64(instance.publicKey));
  const b = encryptToInstance('same-plaintext', bytesToBase64(instance.publicKey));
  assert.notEqual(a.ephemeralPublicKey, b.ephemeralPublicKey);
  assert.notEqual(a.nonce, b.nonce);
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test('tampered ciphertext fails AEAD verification instead of decrypting to garbage', () => {
  const instance = x25519.keygen();
  const { ciphertext, nonce, ephemeralPublicKey } = encryptToInstance(
    'sk_live_tamper_check',
    bytesToBase64(instance.publicKey),
  );
  const tampered = base64ToBytes(ciphertext);
  tampered[0] ^= 0xff;

  const shared = x25519.getSharedSecret(instance.secretKey, base64ToBytes(ephemeralPublicKey));
  const aeadKey = hkdf(sha256, shared, undefined, HKDF_INFO, 32);
  assert.throws(() => chacha20poly1305(aeadKey, base64ToBytes(nonce)).decrypt(tampered));
});
