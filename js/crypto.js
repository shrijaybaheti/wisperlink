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

/**
 * Encrypts an ArrayBuffer using the shared AES-GCM key and returns raw results.
 * @param {CryptoKey} sharedKey
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<{ iv: Uint8Array, ciphertext: ArrayBuffer }>}
 */
export async function encryptBinaryRaw(sharedKey, arrayBuffer) {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    sharedKey,
    arrayBuffer
  );
  return { iv, ciphertext };
}

/**
 * Decrypts a raw IV and ciphertext using the shared AES-GCM key.
 * @param {CryptoKey} sharedKey
 * @param {Uint8Array} iv
 * @param {Uint8Array} ciphertext
 * @returns {Promise<ArrayBuffer>}
 */
export async function decryptBinaryRaw(sharedKey, iv, ciphertext) {
  return await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    sharedKey,
    ciphertext
  );
}

/**
 * Packs metadata, IV, and ciphertext into a single ArrayBuffer.
 * @param {string} fileId
 * @param {number} chunkIndex
 * @param {number} totalChunks
 * @param {Uint8Array} iv
 * @param {ArrayBuffer} ciphertext
 * @returns {ArrayBuffer}
 */
export function createBinaryChunk(fileId, chunkIndex, totalChunks, iv, ciphertext) {
  const headerLen = 1 + 8 + 4 + 4 + 12; // 29 bytes
  const ciphertextBytes = new Uint8Array(ciphertext);
  const packet = new Uint8Array(headerLen + ciphertextBytes.length);
  
  // 1. Magic byte (0xFB)
  packet[0] = 0xFB;
  
  // 2. File ID (8 bytes)
  const fileIdBytes = new TextEncoder().encode(fileId);
  packet.set(fileIdBytes.subarray(0, 8), 1);
  
  // 3. Chunk Index (4 bytes) & Total Chunks (4 bytes)
  const view = new DataView(packet.buffer);
  view.setUint32(9, chunkIndex, false); // big-endian
  view.setUint32(13, totalChunks, false); // big-endian
  
  // 4. IV (12 bytes)
  packet.set(iv, 17);
  
  // 5. Ciphertext
  packet.set(ciphertextBytes, 29);
  
  return packet.buffer;
}

/**
 * Parses a packed ArrayBuffer chunk into its components.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {object} { fileId, chunkIndex, totalChunks, iv, ciphertext }
 */
export function parseBinaryChunk(arrayBuffer) {
  const view = new DataView(arrayBuffer);
  
  // 1. Magic byte
  const magic = view.getUint8(0);
  if (magic !== 0xFB) {
    throw new Error("Invalid binary chunk magic byte");
  }
  
  // 2. File ID (8 bytes)
  const fileIdBytes = new Uint8Array(arrayBuffer, 1, 8);
  // Trim any trailing null bytes
  let end = 0;
  while (end < 8 && fileIdBytes[end] !== 0) {
    end++;
  }
  const fileId = new TextDecoder().decode(fileIdBytes.subarray(0, end));
  
  // 3. Chunk Index (4 bytes) & Total Chunks (4 bytes)
  const chunkIndex = view.getUint32(9, false);
  const totalChunks = view.getUint32(13, false);
  
  // 4. IV (12 bytes)
  const iv = new Uint8Array(arrayBuffer, 17, 12);
  
  // 5. Ciphertext
  const ciphertext = new Uint8Array(arrayBuffer, 29);
  
  return {
    fileId,
    chunkIndex,
    totalChunks,
    iv,
    ciphertext
  };
}

/**
 * Helper to convert a hex string into a Uint8Array.
 * @param {string} hex
 * @returns {Uint8Array}
 */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Encrypts a plaintext string with a 16-byte raw hex key using AES-GCM-256.
 * Returns URL-safe Base64 of combined [12-byte IV + ciphertext].
 * @param {string} plaintext
 * @param {string} hexKey
 * @returns {Promise<string>}
 */
export async function encryptWithHexKey(plaintext, hexKey) {
  const keyData = hexToBytes(hexKey);
  const key = await window.crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encodedText = new TextEncoder().encode(plaintext);
  
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv
    },
    key,
    encodedText
  );
  
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  
  let binary = '';
  for (let i = 0; i < combined.byteLength; i++) {
    binary += String.fromCharCode(combined[i]);
  }
  
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decrypts a URL-safe Base64 combined IV + ciphertext string using a 16-byte hex key.
 * @param {string} combinedBase64
 * @param {string} hexKey
 * @returns {Promise<string>}
 */
export async function decryptWithHexKey(combinedBase64, hexKey) {
  const keyData = hexToBytes(hexKey);
  const key = await window.crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  
  let b64 = combinedBase64.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) {
    b64 += '=';
  }
  
  const binary = atob(b64);
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
    key,
    ciphertext
  );
  
  return new TextDecoder().decode(decrypted);
}



