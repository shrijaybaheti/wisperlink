/**
 * Micro-SDP Codec
 * Compresses WebRTC Session Descriptions to ~90-120 characters by stripping
 * browser SDP boilerplate, keeping only essential ICE, DTLS, and candidate data,
 * and reconstructing the SDP on the receiving end.
 */

/**
 * Strips colons from a hex string (fingerprint).
 * @param {string} fp
 * @returns {string}
 */
function stripFingerprint(fp) {
  return fp.replace(/:/g, '').toLowerCase();
}

/**
 * Restores colons to a hex string to reconstruct a valid fingerprint.
 * @param {string} hex
 * @returns {string}
 */
function restoreFingerprint(hex) {
  const matches = hex.match(/.{1,2}/g);
  if (!matches) return '';
  return matches.join(':').toUpperCase();
}

/**
 * Compresses a string using the native CompressionStream.
 * @param {string} str
 * @returns {Promise<ArrayBuffer>}
 */
async function compressString(str) {
  const bytes = new TextEncoder().encode(str);
  const stream = new Blob([bytes]).stream();
  const compressedStream = stream.pipeThrough(new CompressionStream("deflate-raw"));
  return await new Response(compressedStream).arrayBuffer();
}

/**
 * Decompresses an ArrayBuffer using native DecompressionStream.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string>}
 */
async function decompressString(buffer) {
  const stream = new Blob([buffer]).stream();
  const decompressedStream = stream.pipeThrough(new DecompressionStream("deflate-raw"));
  const decompressedBytes = await new Response(decompressedStream).arrayBuffer();
  return new TextDecoder().decode(decompressedBytes);
}

/**
 * Encodes an ArrayBuffer into a URL-safe Base64 string.
 * @param {ArrayBuffer} buffer
 * @returns {string}
 */
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decodes a URL-safe Base64 string into an ArrayBuffer.
 * @param {string} base64
 * @returns {ArrayBuffer}
 */
function base64ToBuffer(base64) {
  let b64 = base64.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) {
    b64 += '=';
  }
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Parses a raw SDP string, extracting only the critical connection tokens.
 * @param {string} sdp
 * @returns {object} compact connection object
 */
function parseSdp(sdp) {
  const lines = sdp.split('\r\n');
  let ufrag = '';
  let pwd = '';
  let fingerprint = '';
  const candidates = [];

  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('a=ice-ufrag:')) {
      ufrag = line.split('a=ice-ufrag:')[1];
    } else if (line.startsWith('a=ice-pwd:')) {
      pwd = line.split('a=ice-pwd:')[1];
    } else if (line.startsWith('a=fingerprint:sha-256 ')) {
      fingerprint = stripFingerprint(line.split('a=fingerprint:sha-256 ')[1]);
    } else if (line.startsWith('a=candidate:')) {
      const parts = line.split(' ');
      if (parts.length >= 8) {
        // Essential candidate parameters:
        // parts[0]: a=candidate:<foundation>
        // parts[1]: <component-id>
        // parts[2]: <transport>
        // parts[3]: <priority>
        // parts[4]: <connection-address>
        // parts[5]: <port>
        // parts[7]: <candidate-type>
        const foundation = parts[0].split(':')[1];
        const componentId = parts[1];
        const transport = parts[2];
        const priority = parts[3];
        const address = parts[4];
        const port = parts[5];
        const type = parts[7];
        
        candidates.push([
          foundation,
          componentId,
          transport,
          priority,
          address,
          port,
          type
        ]);
      }
    }
  }

  return {
    u: ufrag,
    p: pwd,
    f: fingerprint,
    c: candidates
  };
}

/**
 * Reconstructs a full, standard WebRTC SDP string using the parsed tokens.
 * @param {string} type 'offer' | 'answer'
 * @param {object} parsed
 * @returns {string} reconstructed raw SDP string
 */
function reconstructSdp(type, parsed) {
  const setupMode = type === 'offer' ? 'actpass' : 'active';
  
  // Reconstruct standard media-level bundle boilerplate for data channel
  const sdpLines = [
    'v=0',
    'o=- 4605991823906497746 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    'a=mid:0',
    `a=setup:${setupMode}`,
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    `a=ice-ufrag:${parsed.u}`,
    `a=ice-pwd:${parsed.p}`,
    `a=fingerprint:sha-256 ${restoreFingerprint(parsed.f)}`
  ];

  // Append reconstructed candidate lines
  parsed.c.forEach(cand => {
    const [foundation, componentId, transport, priority, address, port, type] = cand;
    sdpLines.push(`a=candidate:${foundation} ${componentId} ${transport} ${priority} ${address} ${port} typ ${type}`);
  });

  // End with trailing empty lines as per SDP specs
  return sdpLines.join('\r\n') + '\r\n';
}

/**
 * Encodes an RTCSessionDescription to a tiny, URL-safe Base64 token.
 * @param {RTCSessionDescription} sessionDescription
 * @returns {Promise<string>}
 */
export async function encode(sessionDescription) {
  if (!sessionDescription || !sessionDescription.sdp || !sessionDescription.type) {
    throw new Error("Invalid session description");
  }

  const compactObj = parseSdp(sessionDescription.sdp);
  
  // Set code identifier prefix: 'o' for offer, 'a' for answer
  const payload = {
    t: sessionDescription.type === 'offer' ? 'o' : 'a',
    d: compactObj
  };

  const jsonStr = JSON.stringify(payload);
  const compressed = await compressString(jsonStr);
  return bufferToBase64(compressed);
}

/**
 * Decodes a tiny URL-safe Base64 token back into an RTCSessionDescription.
 * @param {string} code
 * @returns {Promise<RTCSessionDescription>}
 */
export async function decode(code) {
  try {
    const cleanCode = code.trim();
    const buffer = base64ToBuffer(cleanCode);
    const jsonStr = await decompressString(buffer);
    const payload = JSON.parse(jsonStr);
    
    const type = payload.t === 'o' ? 'offer' : 'answer';
    const sdp = reconstructSdp(type, payload.d);
    
    return new RTCSessionDescription({
      type: type,
      sdp: sdp
    });
  } catch (err) {
    console.error("Micro-SDP Decoding error:", err);
    throw new Error("Invalid connection code. Confirm you copied it correctly.");
  }
}
