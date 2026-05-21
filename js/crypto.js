/**
 * End-to-End Encryption Module
 * Handles ECDH key generation, key exchange public key export/import,
 * shared secret derivation, and AES-256-GCM encryption/decryption.
 */

/**
 * Generates an ECDH key pair on the P-256 curve.
 * @returns {Promise<CryptoKeyPair>}
 */
export async function generateKeyPair() {
  return await window.crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true, // extractable (necessary to share public key)
    ["deriveKey"]
  );
}

/**
 * Exports a public CryptoKey into a standard raw ArrayBuffer, then converts to Base64.
 * @param {CryptoKey} publicKey
 * @returns {Promise<string>}
 */
export async function exportPublicKey(publicKey) {
  const exported = await window.crypto.subtle.exportKey("raw", publicKey);
  const bytes = new Uint8Array(exported);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Imports a Base64 public key back into a CryptoKey object.
 * @param {string} base64Key
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKey(base64Key) {
  const binary = atob(base64Key);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  
  return await window.crypto.subtle.importKey(
    "raw",
    bytes.buffer,
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true,
    []
  );
}

/**
 * Derives a shared AES-GCM 256-bit key using my private key and the peer's public key.
 * @param {CryptoKey} privateKey
 * @param {CryptoKey} peerPublicKey
 * @returns {Promise<CryptoKey>}
 */
export async function deriveSharedKey(privateKey, peerPublicKey) {
  return await window.crypto.subtle.deriveKey(
    {
      name: "ECDH",
      public: peerPublicKey
    },
    privateKey,
    {
      name: "AES-GCM",
      length: 256
    },
    false, // not extractable for security
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts a plaintext string using the derived shared AES-GCM key.
 * The IV is prepended to the ciphertext.
 * @param {CryptoKey} sharedKey
 * @param {string} plaintext
 * @returns {Promise<string>} base64 representation of [12-byte IV + ciphertext]
 */
export async function encrypt(sharedKey, plaintext) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(plaintext);
  
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    sharedKey,
    encodedText
  );
  
  // Combine IV and ciphertext
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  
  // Convert combined to Base64
  let binary = '';
  for (let i = 0; i < combined.byteLength; i++) {
    binary += String.fromCharCode(combined[i]);
  }
  return btoa(binary);
}

/**
 * Decrypts a combined IV + ciphertext Base64 string using the shared AES-GCM key.
 * @param {CryptoKey} sharedKey
 * @param {string} combinedBase64
 * @returns {Promise<string>} decrypted plaintext
 */
export async function decrypt(sharedKey, combinedBase64) {
  const binary = atob(combinedBase64);
  const combined = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    combined[i] = binary.charCodeAt(i);
  }
  
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  
  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    sharedKey,
    ciphertext
  );
  
  return new TextDecoder().decode(decrypted);
}

/**
 * Encrypts an ArrayBuffer using the shared AES-GCM key.
 * @param {CryptoKey} sharedKey
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<string>} Base64 combined [IV + ciphertext]
 */
export async function encryptBinary(sharedKey, arrayBuffer) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    sharedKey,
    arrayBuffer
  );
  
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  
  let binary = '';
  for (let i = 0; i < combined.byteLength; i++) {
    binary += String.fromCharCode(combined[i]);
  }
  return btoa(binary);
}

/**
 * Decrypts a combined IV + ciphertext Base64 string using the shared AES-GCM key.
 * @param {CryptoKey} sharedKey
 * @param {string} combinedBase64
 * @returns {Promise<ArrayBuffer>} Decrypted binary data
 */
export async function decryptBinary(sharedKey, combinedBase64) {
  const binary = atob(combinedBase64);
  const combined = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    combined[i] = binary.charCodeAt(i);
  }
  
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  
  return await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    sharedKey,
    ciphertext
  );
}

