import { 
  elements, 
  showLanding, 
  updateStatus, 
  logToConsole, 
  updatePeerList, 
  addMessage, 
  addSystemInfo, 
  showToast, 
  initConsoleDrawer,
  renderQrCode,
  toggleQrContainer,
  addFileMessage,
  initEmojiPicker,
  initEmojiAutocomplete,
  addFileProgressMessage,
  updateFileProgress,
  completeFileProgress
} from './ui.js';
import * as codec from './codec.js';
import * as crypto from './crypto.js';
import { PeerManager } from './peer.js';
import { TrackerSignaler } from './signaling.js';

// NAT Discovery STUN Servers
const iceConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Public trackers list for serverless WebRTC signaling
const trackerUrls = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.btorrent.xyz'
];

// Application State
let state = {
  nickname: 'Anonymous',
  isHost: false,
  localKeyPair: null,
  peers: [],            // List of active peer objects: { id, peerManager, sharedKey, nickname }
  pendingHostPeer: null, // Host-only: peer object currently in the handshake process
  signaler: null,       // WebSocket signaling manager
  signalingTimeoutId: null // Timeout tracker for fallback
};

// Concurrency locks to prevent double-execution during auto-paste or button double-clicks
let isConnectingHost = false;
let isProcessingJoiner = false;

// Keep track of incoming file transfers: { fileId: { filename, filetype, filesize, sender, totalChunks, chunks, receivedChunksCount } }
let fileReceivers = {};

// Check for URL invite parameters on load
const urlParams = new URLSearchParams(window.location.search);
const inviteParam = urlParams.get('invite');
const roomParam = urlParams.get('room');
const hashKey = window.location.hash ? window.location.hash.substring(1) : null;

// Initialize DOM Listeners
document.addEventListener('DOMContentLoaded', () => {
  // Initialize collapsible console drawer
  initConsoleDrawer();

  // Landing page routing actions
  elements.btnHostStart.addEventListener('click', () => startSetup(true));
  elements.btnJoinStart.addEventListener('click', () => startSetup(false));
  
  // Disconnect session action
  elements.btnDisconnect.addEventListener('click', disconnectChat);
  
  // Host invite generation triggers
  elements.btnHostGenInvite.addEventListener('click', generateInvite);
  
  // Copy and QR toggling listeners
  elements.btnHostCopyInvite.addEventListener('click', () => {
    copyToClipboard(elements.hostLocalCode.innerText);
  });
  elements.btnHostShowQr.addEventListener('click', () => {
    toggleQrContainer(elements.hostQrContainer);
  });
  
  elements.btnJoinerCopyAnswer.addEventListener('click', () => {
    copyToClipboard(elements.joinerLocalCode.innerText);
  });
  elements.btnJoinerShowQr.addEventListener('click', () => {
    toggleQrContainer(elements.joinerQrContainer);
  });
  
  // Monitor manual inputs to enable buttons and trigger AUTO-PROCESS on paste
  elements.hostRemoteCode.addEventListener('input', async (e) => {
    const val = e.target.value.trim();
    elements.btnHostConnect.disabled = !val;
    
    // Auto-detect answer code and connect instantly
    if (val.length >= 80) {
      logToConsole("Auto-detect: Answer code length detected. Establishing link...");
      await handleHostConnect();
    }
  });
  
  elements.joinerRemoteCode.addEventListener('input', async (e) => {
    const val = e.target.value.trim();
    elements.btnJoinerProcess.disabled = !val;
    
    // Auto-detect invite code and process instantly
    if (val.length >= 80) {
      logToConsole("Auto-detect: Invite code length detected. Processing setup...");
      await handleJoinerProcess();
    }
  });
  
  // Keyboard submits
  elements.hostRemoteCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleHostConnect();
    }
  });
  elements.joinerRemoteCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleJoinerProcess();
    }
  });
  
  // Manual button triggers
  elements.btnHostConnect.addEventListener('click', handleHostConnect);
  elements.btnJoinerProcess.addEventListener('click', handleJoinerProcess);
  
  // Chat typing inputs
  elements.inputMessage.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // If emoji autocomplete is visible, let it handle the Enter key
      const autocomplete = document.getElementById('emoji-autocomplete');
      if (autocomplete && autocomplete.style.display === 'block') {
        return;
      }
      e.preventDefault();
      sendMessage();
    }
  });
  elements.btnSendMessage.addEventListener('click', sendMessage);

  // Setup file attachment action and hidden input listener
  elements.btnAttachFile.addEventListener('click', () => {
    elements.fileInput.click();
  });
  elements.fileInput.addEventListener('change', handleFileSelected);

  // Initialize emoji grid click listeners and window toggling
  initEmojiPicker();
  initEmojiAutocomplete();

  // Mobile sidebar toggle
  if (elements.btnMobileMenu && elements.mobileSidebarBackdrop) {
    elements.btnMobileMenu.addEventListener('click', () => {
      elements.panelSidebar.classList.toggle('mobile-open');
      elements.mobileSidebarBackdrop.classList.toggle('active');
    });
    
    elements.mobileSidebarBackdrop.addEventListener('click', () => {
      elements.panelSidebar.classList.remove('mobile-open');
      elements.mobileSidebarBackdrop.classList.remove('active');
    });
  }

  // Check URL boarding params on load
  if (inviteParam) {
    logToConsole("Invite code detected in URL query params.");
    elements.joinerRemoteCode.value = inviteParam;
    elements.btnJoinerProcess.disabled = false;
    
    // Highlight UI that they are entering an invited session
    elements.btnJoinStart.innerText = "Join Invited Chat";
    elements.btnJoinStart.classList.add('orange');
    elements.btnHostStart.classList.remove('orange');
    
    if (roomParam && hashKey) {
      logToConsole("Detected automatic signaling parameters.");
    }
    
    showToast("Invite link detected in URL!", "info");
  }
});

/**
 * Dismisses the mobile sidebar drawer.
 */
function closeMobileSidebar() {
  if (elements.panelSidebar && elements.mobileSidebarBackdrop) {
    elements.panelSidebar.classList.remove('mobile-open');
    elements.mobileSidebarBackdrop.classList.remove('active');
  }
}

/**
 * Initializes keypair generation and routes to dashboard views.
 * @param {boolean} isHost
 */
async function startSetup(isHost) {
  state.isHost = isHost;
  closeMobileSidebar();
  
  // Reset inputs and fields
  elements.btnHostConnect.disabled = true;
  elements.btnJoinerProcess.disabled = true;
  elements.hostInviteSection.style.display = "none";
  elements.joinerAnswerSection.style.display = "none";
  elements.hostQrContainer.style.display = "none";
  elements.joinerQrContainer.style.display = "none";
  elements.hostSignalingStatus.style.display = "none";
  elements.joinerSignalingStatus.style.display = "none";
  elements.peerList.innerHTML = '';
  elements.eventLog.innerHTML = '';
  
  // Read name input or set default
  const nameInput = elements.inputNickname.value.trim();
  state.nickname = nameInput || (isHost ? 'Host' : 'Guest');
  
  showLanding(false);
  
  try {
    logToConsole(`Starting node session as "${state.nickname}"...`);
    logToConsole("Generating transient ECDH curve keypair...");
    state.localKeyPair = await crypto.generateKeyPair();
    logToConsole("Crypto keypair successfully set up.");
    
    if (isHost) {
      elements.panelHostControls.style.display = 'flex';
      elements.panelGuestControls.style.display = 'none';
      elements.chatRoomName.innerText = "Host Session (0 active)";
    } else {
      elements.panelHostControls.style.display = 'none';
      elements.panelGuestControls.style.display = 'flex';
      elements.chatRoomName.innerText = "Connecting to Grid...";
      
      // Auto-trigger joiner boarding if code was loaded from URL query param
      if (inviteParam) {
        logToConsole("Auto-processing invite code from URL...");
        await handleJoinerProcess();
      }
    }
    
    refreshMembersUI();
  } catch (err) {
    logToConsole(`Setup failed: ${err.message}`);
    showToast("Setup initiation failed.", "error");
    resetToLanding();
  }
}

/**
 * Host-only: creates a PeerManager and generates a shareable micro-invite code.
 */
async function generateInvite() {
  try {
    logToConsole("Opening new peer tunnel...");
    
    const peerId = Math.random().toString(36).substring(2, 9);
    const pm = new PeerManager(iceConfig);
    
    state.pendingHostPeer = {
      id: peerId,
      peerManager: pm,
      nickname: 'Connecting...'
    };
    
    setupPeerCallbacks(state.pendingHostPeer);
    
    elements.hostLocalCode.innerText = "Gathering routes (ICE)...";
    elements.hostInviteSection.style.display = "flex";
    elements.btnHostCopyInvite.disabled = true;
    
    updateStatus('gathering');
    
    // Set up WebRTC offer description
    const offer = await pm.createOffer();
    const shareableCode = await codec.encode(offer);
    
    // Generate ephemeral 20-byte room ID and 16-byte symmetric key for automatic signaling
    const generateRandomHex = (bytesCount) => {
      const arr = new Uint8Array(bytesCount);
      window.crypto.getRandomValues(arr);
      return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
    };
    const roomIdHex = generateRandomHex(20);
    const keyHex = generateRandomHex(16);
    
    // Encrypt the compressed offer code using the symmetric key
    logToConsole("Encrypting connection offer parameters...");
    const encryptedOffer = await crypto.encryptWithHexKey(shareableCode, keyHex);
    
    // Generate Invite URL with encrypted offer and key in hash
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${roomIdHex}&invite=${encodeURIComponent(encryptedOffer)}#${keyHex}`;
    
    elements.hostLocalCode.innerText = inviteUrl;
    elements.btnHostCopyInvite.disabled = false;
    
    // Draw QR Code
    renderQrCode(elements.hostQrContainer, inviteUrl);
    
    logToConsole(`Invite link generated [${peerId}]. QR Code set to URL.`);
    
    // Setup automatic WebSocket tracker signaling
    logToConsole("Initializing automatic signaling relay...");
    elements.hostSignalingStatus.style.display = "flex";
    
    const hostPeerIdHex = generateRandomHex(20);
    state.signaler = new TrackerSignaler(trackerUrls, roomIdHex, hostPeerIdHex);
    
    state.signaler.onLog = (msg) => logToConsole(`[Signaler] ${msg}`);
    
    state.signaler.onConnect = () => {
      state.signaler.sendOffer({ type: 'offer', sdp: encryptedOffer });
    };
    
    state.signaler.onAnswer = async (answerPayload, offerId, remotePeerId) => {
      try {
        logToConsole(`Received answer from Guest [${remotePeerId.substring(0, 8)}]. Decrypting...`);
        const decryptedAnswerCode = await crypto.decryptWithHexKey(answerPayload.sdp, keyHex);
        
        const answerDesc = await codec.decode(decryptedAnswerCode);
        logToConsole("Setting remote answer...");
        await state.pendingHostPeer.peerManager.acceptAnswer(answerDesc);
        
        elements.hostSignalingStatus.style.display = "none";
        
        if (state.signaler) {
          state.signaler.close();
          state.signaler = null;
        }
      } catch (err) {
        logToConsole(`Failed to process auto-signaled answer: ${err.message}`);
      }
    };
    
    state.signaler.onError = (err) => {
      logToConsole(`Host signaling failed: ${err.message}. Waiting for manual paste.`);
      showToast("Signaling failed. Paste guest answer manually.", "warning");
      elements.hostSignalingStatus.style.display = "none";
    };
    
    state.signaler.connect();
    updateStatus('connecting');
  } catch (err) {
    logToConsole(`Failed to generate offer: ${err.message}`);
    showToast("Failed to initialize invite.", "error");
  }
}

/**
 * Host-only: processes answer code sent by a guest.
 */
async function handleHostConnect() {
  if (isConnectingHost) return;
  const codeText = elements.hostRemoteCode.value.trim();
  if (!codeText || !state.pendingHostPeer) return;
  
  isConnectingHost = true;
  elements.hostRemoteCode.disabled = true;
  elements.btnHostConnect.disabled = true;
  closeMobileSidebar();
  
  try {
    logToConsole(`Reading answer code for guest tunnel [${state.pendingHostPeer.id}]...`);
    const answerDesc = await codec.decode(codeText);
    
    updateStatus('connecting');
    await state.pendingHostPeer.peerManager.acceptAnswer(answerDesc);
    
    elements.hostRemoteCode.value = '';
  } catch (err) {
    logToConsole(`WebRTC handshake exchange failed: ${err.message}`);
    showToast(err.message, "error");
  } finally {
    isConnectingHost = false;
    elements.hostRemoteCode.disabled = false;
    elements.btnHostConnect.disabled = !elements.hostRemoteCode.value.trim();
  }
}

/**
 * Guest-only: decodes Host invite and generates answer code.
 */
async function handleJoinerProcess() {
  if (isProcessingJoiner) return;
  const codeText = elements.joinerRemoteCode.value.trim();
  if (!codeText) return;
  
  isProcessingJoiner = true;
  elements.joinerRemoteCode.disabled = true;
  elements.btnJoinerProcess.disabled = true;
  closeMobileSidebar();
  
  try {
    let decryptedOfferCode = codeText;
    const isAutoSignaling = !!(roomParam && hashKey);
    
    if (isAutoSignaling) {
      logToConsole("Decrypting invite payload using URL hash key...");
      decryptedOfferCode = await crypto.decryptWithHexKey(codeText, hashKey);
      logToConsole("Invite payload decrypted successfully.");
    }
    
    logToConsole("Importing Host invite parameters...");
    const offerDesc = await codec.decode(decryptedOfferCode);
    
    logToConsole("Configuring peer tunnel...");
    const peerId = Math.random().toString(36).substring(2, 9);
    const pm = new PeerManager(iceConfig);
    
    const peerObj = {
      id: peerId,
      peerManager: pm,
      nickname: 'Host'
    };
    
    setupPeerCallbacks(peerObj);
    
    updateStatus('gathering');
    logToConsole("Preparing cryptographic answer...");
    const answer = await pm.acceptOffer(offerDesc);
    
    logToConsole("Compressing answer...");
    const answerCode = await codec.encode(answer);
    
    let encryptedAnswer = answerCode;
    if (isAutoSignaling) {
      logToConsole("Encrypting answer description...");
      encryptedAnswer = await crypto.encryptWithHexKey(answerCode, hashKey);
      logToConsole("Answer description encrypted.");
    }
    
    elements.joinerLocalCode.innerText = answerCode;
    
    // Hide manual instructions if auto signaling is attempted
    if (!isAutoSignaling) {
      elements.joinerAnswerSection.style.display = "flex";
      elements.btnJoinerCopyAnswer.disabled = false;
      renderQrCode(elements.joinerQrContainer, answerCode);
    }
    
    // Save host peer temporarily so callbacks have access
    state.peers = [peerObj];
    
    if (isAutoSignaling) {
      logToConsole("Initiating automatic WebRTC handshake via tracker...");
      updateStatus('connecting');
      elements.joinerSignalingStatus.style.display = "flex";
      
      const guestPeerIdHex = Array.from(window.crypto.getRandomValues(new Uint8Array(20)), b => b.toString(16).padStart(2, '0')).join('');
      state.signaler = new TrackerSignaler(trackerUrls, roomParam, guestPeerIdHex);
      state.signaler.onLog = (msg) => logToConsole(`[Signaler] ${msg}`);
      
      state.signaler.onOffer = (offerPayload, offerId, remotePeerId) => {
        logToConsole(`Sending encrypted WebRTC Answer to Host [${remotePeerId.substring(0, 8)}]...`);
        state.signaler.sendAnswer({ type: 'answer', sdp: encryptedAnswer }, remotePeerId, offerId);
      };
      
      state.signaler.onError = (err) => {
        logToConsole(`Automatic signaling failed: ${err.message}. Falling back to manual mode.`);
        showToast("Auto-link failed. Copy-paste code manually.", "warning");
        switchToManualFallback(answerCode);
      };
      
      // Safety timeout: fallback to manual mode after 8 seconds
      state.signalingTimeoutId = setTimeout(() => {
        logToConsole("Automatic signaling timed out. Falling back to manual mode.");
        showToast("Auto-link timed out. Copy-paste code manually.", "warning");
        switchToManualFallback(answerCode);
      }, 8000);
      
      state.signaler.connect();
    } else {
      logToConsole("Answer Code and QR generated. Send back to Host.");
      updateStatus('connecting');
    }
  } catch (err) {
    logToConsole(`Failed to process host invite: ${err.message}`);
    showToast(err.message, "error");
  } finally {
    isProcessingJoiner = false;
    elements.joinerRemoteCode.disabled = false;
    elements.btnJoinerProcess.disabled = !elements.joinerRemoteCode.value.trim();
  }
}

/**
 * Guest-only fallback helper: reveals the manual answer details when auto-signaling fails.
 * @param {string} answerCode
 */
function switchToManualFallback(answerCode) {
  if (state.signaler) {
    state.signaler.close();
    state.signaler = null;
  }
  if (state.signalingTimeoutId) {
    clearTimeout(state.signalingTimeoutId);
    state.signalingTimeoutId = null;
  }
  
  elements.joinerSignalingStatus.style.display = "none";
  elements.joinerLocalCode.innerText = answerCode;
  elements.joinerAnswerSection.style.display = "flex";
  elements.btnJoinerCopyAnswer.disabled = false;
  renderQrCode(elements.joinerQrContainer, answerCode);
  
  elements.joinerRemoteCode.disabled = false;
  elements.btnJoinerProcess.disabled = false;
  updateStatus('connecting');
}

/**
 * Hooks logs and message listeners onto a PeerManager instance.
 * @param {object} peerObj State peer representation
 */
function setupPeerCallbacks(peerObj) {
  const pm = peerObj.peerManager;
  
  pm.onLog = (msg) => {
    logToConsole(`[Tunnel:${peerObj.id}] ${msg}`);
  };
  
  pm.onIceGatheringChange = (gatheringState) => {
    logToConsole(`[Tunnel:${peerObj.id}] ICE state: ${gatheringState}`);
  };
  
  pm.onStateChange = (connState) => {
    logToConsole(`[Tunnel:${peerObj.id}] Connection: ${connState}`);
    if (connState === 'connected') {
      updateStatus('secure');
    }
  };
  
  pm.onConnected = async () => {
    try {
      logToConsole(`[Tunnel:${peerObj.id}] Data link open. Exchanging public keys...`);
      
      const myPubKey = await crypto.exportPublicKey(state.localKeyPair.publicKey);
      
      const handshake = {
        type: 'handshake',
        name: state.nickname,
        publicKey: myPubKey
      };
      
      pm.send(JSON.stringify(handshake));
      
      // Clean up signaling connections since WebRTC data channel is established
      if (state.signaler) {
        logToConsole("Automatic link secure. Closing signaling channels.");
        state.signaler.close();
        state.signaler = null;
      }
      if (state.signalingTimeoutId) {
        clearTimeout(state.signalingTimeoutId);
        state.signalingTimeoutId = null;
      }
      elements.hostSignalingStatus.style.display = "none";
      elements.joinerSignalingStatus.style.display = "none";
    } catch (err) {
      logToConsole(`[Tunnel:${peerObj.id}] Failed to dispatch handshake: ${err.message}`);
    }
  };
  
  pm.onMessage = async (data) => {
    try {
      if (data instanceof ArrayBuffer) {
        await handleBinaryFileChunk(peerObj, data);
        return;
      }
      
      const payload = JSON.parse(data);
      
      if (payload.type === 'handshake') {
        logToConsole(`[Tunnel:${peerObj.id}] Keys received. Verifying handshake with "${payload.name}"...`);
        
        const peerPubKey = await crypto.importPublicKey(payload.publicKey);
        const sharedKey = await crypto.deriveSharedKey(
          state.localKeyPair.privateKey,
          peerPubKey
        );
        
        peerObj.sharedKey = sharedKey;
        peerObj.nickname = payload.name || 'Anonymous Peer';
        
        if (state.isHost) {
          if (state.pendingHostPeer && state.pendingHostPeer.id === peerObj.id) {
            state.peers.push(peerObj);
            state.pendingHostPeer = null;
            
            elements.hostInviteSection.style.display = "none";
            elements.hostLocalCode.innerText = "";
            elements.hostQrContainer.style.display = "none";
          }
          
          broadcastMemberList();
        } else {
          // Guest: Connection is fully active now
          state.peers = [peerObj];
        }
        
        refreshMembersUI();
        
        addSystemInfo(`🔒 Link secured with ${peerObj.nickname}`);
        showToast(`Connected with ${peerObj.nickname}`, "info");
        
      } else if (payload.type === 'message') {
        if (!peerObj.sharedKey) {
          console.warn("Dropped raw transmission: key exchange incomplete.");
          return;
        }
        
        const decrypted = await crypto.decrypt(peerObj.sharedKey, payload.ciphertext);
        
        if (state.isHost) {
          addMessage(decrypted, peerObj.nickname, false);
          relayMessage(peerObj.id, peerObj.nickname, decrypted);
        } else {
          const senderName = payload.sender || peerObj.nickname;
          addMessage(decrypted, senderName, false);
        }
      } else if (payload.type === 'file-start') {
        const fileId = payload.fileId;
        const senderName = payload.sender || peerObj.nickname;
        
        // Add progress bubble
        addFileProgressMessage(fileId, payload.filename, payload.filetype, payload.filesize, senderName, false);
        
        fileReceivers[fileId] = {
          filename: payload.filename,
          filetype: payload.filetype,
          filesize: payload.filesize,
          sender: senderName,
          totalChunks: payload.totalChunks,
          chunks: new Array(payload.totalChunks),
          receivedChunksCount: 0,
          startTime: Date.now(),
          lastUpdateTime: Date.now(),
          lastBytesReceived: 0,
          bytesReceived: 0
        };
        logToConsole(`Receiving encrypted file "${payload.filename}" from ${senderName} in ${payload.totalChunks} chunks...`);
        
        // Host streaming relay: relay file-start to other guests
        if (state.isHost) {
          for (const otherPeer of state.peers) {
            if (otherPeer.id === peerObj.id) continue;
            try {
              otherPeer.peerManager.send(data);
            } catch (err) {
              logToConsole(`Failed to relay file metadata to [${otherPeer.nickname}]: ${err.message}`);
            }
          }
        }
      } else if (payload.type === 'members') {
        if (!state.isHost) {
          const membersList = payload.list.map(name => ({
            name: name,
            isHost: name === peerObj.nickname
          }));
          updatePeerList(membersList);
        }
      }
    } catch (err) {
      logToConsole(`[Tunnel:${peerObj.id}] Process error: ${err.message}`);
    }
  };
  
  pm.onDisconnected = () => {
    logToConsole(`[Tunnel:${peerObj.id}] Connection closed.`);
    addSystemInfo(`❌ Link closed with ${peerObj.nickname}`);
    
    state.peers = state.peers.filter(p => p.id !== peerObj.id);
    
    if (state.isHost) {
      broadcastMemberList();
    } else {
      updateStatus('offline');
      showToast("Host connection lost.", "error");
    }
    
    refreshMembersUI();
  };
}

/**
 * Host-only: relays a decrypted guest message to all other active guest tunnels.
 * @param {string} senderId Raw connection identifier
 * @param {string} senderName Text nickname of the sender
 * @param {string} text Message contents
 */
async function relayMessage(senderId, senderName, text) {
  logToConsole(`Relaying message from [${senderName}] to active nodes...`);
  
  for (const peer of state.peers) {
    if (peer.id === senderId) continue;
    
    try {
      const ciphertext = await crypto.encrypt(peer.sharedKey, text);
      const payload = {
        type: 'message',
        sender: senderName,
        ciphertext: ciphertext
      };
      peer.peerManager.send(JSON.stringify(payload));
    } catch (err) {
      logToConsole(`Failed to relay to [${peer.nickname}]: ${err.message}`);
    }
  }
}

/**
 * Encrypts and broadcasts a message to connected nodes.
 */
async function sendMessage() {
  const text = elements.inputMessage.value.trim();
  if (!text) return;
  
  if (state.peers.length === 0) {
    showToast("No active nodes connected to this peer.", "error");
    return;
  }
  
  try {
    if (state.isHost) {
      for (const peer of state.peers) {
        const ciphertext = await crypto.encrypt(peer.sharedKey, text);
        const payload = {
          type: 'message',
          sender: state.nickname,
          ciphertext: ciphertext
        };
        peer.peerManager.send(JSON.stringify(payload));
      }
      addMessage(text, state.nickname, true);
    } else {
      const hostPeer = state.peers[0];
      if (hostPeer) {
        const ciphertext = await crypto.encrypt(hostPeer.sharedKey, text);
        const payload = {
          type: 'message',
          ciphertext: ciphertext
        };
        hostPeer.peerManager.send(JSON.stringify(payload));
        addMessage(text, state.nickname, true);
      }
    }
    
    elements.inputMessage.value = '';
  } catch (err) {
    logToConsole(`Encryption fail: ${err.message}`);
    showToast("Failed to encrypt and send.", "error");
  }
}

/**
 * Reads a Blob slice as an ArrayBuffer.
 * @param {Blob} slice
 * @returns {Promise<ArrayBuffer>}
 */
function readSliceAsArrayBuffer(slice) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(slice);
  });
}

/**
 * Reads the selected local file and transmits it in encrypted binary chunks.
 */
async function handleFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  // Clear the input value so the user can re-upload the same file if desired
  e.target.value = '';
  
  await sendFile(file);
}

/**
 * Encrypts a file slice-by-slice and transmits it over the WebRTC data channel.
 * @param {File} file
 */
async function sendFile(file) {
  if (state.peers.length === 0) {
    showToast("No active peers connected.", "error");
    return;
  }
  
  const CHUNK_SIZE = 128 * 1024; // 128 KB chunks
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const fileId = Math.random().toString(36).substring(2, 9);
  
  logToConsole(`Preparing to send "${file.name}" (${file.size} bytes) in ${totalChunks} chunks...`);
  
  // Add progress bubble in sender's own UI
  addFileProgressMessage(fileId, file.name, file.type, file.size, state.nickname, true);
  
  // Send file-start metadata first
  const fileStartPayload = {
    type: 'file-start',
    fileId: fileId,
    filename: file.name,
    filetype: file.type,
    filesize: file.size,
    totalChunks: totalChunks,
    sender: state.nickname
  };
  
  const metadataStr = JSON.stringify(fileStartPayload);
  
  if (state.isHost) {
    for (const peer of state.peers) {
      try {
        peer.peerManager.send(metadataStr);
      } catch (err) {
        logToConsole(`Failed to send file metadata to [${peer.nickname}]: ${err.message}`);
      }
    }
  } else {
    const hostPeer = state.peers[0];
    if (hostPeer) {
      try {
        hostPeer.peerManager.send(metadataStr);
      } catch (err) {
        logToConsole(`Failed to send file metadata to Host: ${err.message}`);
        showToast("Failed to send file.", "error");
        return;
      }
    }
  }
  
  let bytesSent = 0;
  let lastUpdateTime = Date.now();
  let lastBytesSent = 0;
  
  for (let i = 0; i < totalChunks; i++) {
    const slice = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    let chunkBuffer;
    try {
      chunkBuffer = await readSliceAsArrayBuffer(slice);
    } catch (err) {
      logToConsole(`Error reading chunk ${i} of "${file.name}": ${err.message}`);
      showToast("Failed to read file.", "error");
      return;
    }
    
    if (state.isHost) {
      // Host encrypts and sends the chunk to all connected guests
      for (const peer of state.peers) {
        try {
          const encrypted = await crypto.encryptBinaryRaw(peer.sharedKey, chunkBuffer);
          const packet = crypto.createBinaryChunk(fileId, i, totalChunks, encrypted.iv, encrypted.ciphertext);
          
          const pm = peer.peerManager;
          const dc = pm.dc;
          if (dc && dc.readyState === 'open') {
            dc.bufferedAmountLowThreshold = 65536;
            if (dc.bufferedAmount > 65536) {
              await new Promise((resolve) => {
                const handleLow = () => {
                  dc.removeEventListener('bufferedamountlow', handleLow);
                  resolve();
                };
                dc.addEventListener('bufferedamountlow', handleLow);
                setTimeout(resolve, 150); // Fallback
              });
            }
            pm.send(packet);
          }
        } catch (err) {
          logToConsole(`Failed to send chunk ${i} to peer [${peer.nickname}]: ${err.message}`);
        }
      }
    } else {
      // Guest encrypts and sends the chunk to the Host (which will relay it)
      const hostPeer = state.peers[0];
      if (hostPeer) {
        try {
          const encrypted = await crypto.encryptBinaryRaw(hostPeer.sharedKey, chunkBuffer);
          const packet = crypto.createBinaryChunk(fileId, i, totalChunks, encrypted.iv, encrypted.ciphertext);
          
          const pm = hostPeer.peerManager;
          const dc = pm.dc;
          if (dc && dc.readyState === 'open') {
            dc.bufferedAmountLowThreshold = 65536;
            if (dc.bufferedAmount > 65536) {
              await new Promise((resolve) => {
                const handleLow = () => {
                  dc.removeEventListener('bufferedamountlow', handleLow);
                  resolve();
                };
                dc.addEventListener('bufferedamountlow', handleLow);
                setTimeout(resolve, 150); // Fallback
              });
            }
            pm.send(packet);
          }
        } catch (err) {
          logToConsole(`Failed to send chunk ${i} to Host: ${err.message}`);
          showToast("Failed to send file.", "error");
          return;
        }
      }
    }
    
    bytesSent += slice.size;
    
    // Update progress in UI
    const now = Date.now();
    if (now - lastUpdateTime >= 500 || i === totalChunks - 1) {
      const progressPercent = Math.round((bytesSent / file.size) * 100);
      const elapsedSec = (now - lastUpdateTime) / 1000;
      const bytesInInterval = bytesSent - lastBytesSent;
      const speedBps = elapsedSec > 0 ? bytesInInterval / elapsedSec : 0;
      
      let speedText = '';
      if (speedBps < 1024) speedText = `${speedBps.toFixed(0)} B/s`;
      else if (speedBps < 1024 * 1024) speedText = `${(speedBps / 1024).toFixed(1)} KB/s`;
      else speedText = `${(speedBps / (1024 * 1024)).toFixed(1)} MB/s`;
      
      updateFileProgress(fileId, progressPercent, speedText);
      
      lastUpdateTime = now;
      lastBytesSent = bytesSent;
    }
  }
  
  // Create object URL for local display/preview
  const localUrl = URL.createObjectURL(file);
  completeFileProgress(fileId, file.name, file.type, file.size, localUrl);
  logToConsole(`File "${file.name}" sent successfully.`);
}

/**
 * Processes a raw binary file chunk from WebRTC.
 * @param {object} peerObj
 * @param {ArrayBuffer} arrayBuffer
 */
async function handleBinaryFileChunk(peerObj, arrayBuffer) {
  if (!peerObj.sharedKey) {
    console.warn("Dropped raw file chunk: key exchange incomplete.");
    return;
  }
  
  let parsed;
  try {
    parsed = crypto.parseBinaryChunk(arrayBuffer);
  } catch (err) {
    logToConsole(`Failed to parse binary chunk: ${err.message}`);
    return;
  }
  
  const { fileId, chunkIndex, totalChunks, iv, ciphertext } = parsed;
  
  const receiver = fileReceivers[fileId];
  if (!receiver) {
    console.warn(`Warning: Received binary chunk ${chunkIndex} for unknown fileId: ${fileId}`);
    return;
  }
  
  // Decrypt this chunk immediately
  let decryptedChunkBuffer;
  try {
    decryptedChunkBuffer = await crypto.decryptBinaryRaw(peerObj.sharedKey, iv, ciphertext);
  } catch (decErr) {
    logToConsole(`Failed to decrypt chunk ${chunkIndex} of "${receiver.filename}": ${decErr.message}`);
    return;
  }
  
  // Wrap in Blob and save to save RAM
  if (!receiver.chunks[chunkIndex]) {
    receiver.chunks[chunkIndex] = new Blob([decryptedChunkBuffer]);
    receiver.receivedChunksCount++;
    receiver.bytesReceived += decryptedChunkBuffer.byteLength;
  }
  
  // Host streaming relay: immediately re-encrypt and relay this chunk to other active guest tunnels
  if (state.isHost) {
    for (const otherPeer of state.peers) {
      if (otherPeer.id === peerObj.id) continue; // skip the sender
      
      try {
        // Encrypt this chunk using otherPeer's sharedKey
        const encrypted = await crypto.encryptBinaryRaw(otherPeer.sharedKey, decryptedChunkBuffer);
        const relayPacket = crypto.createBinaryChunk(fileId, chunkIndex, totalChunks, encrypted.iv, encrypted.ciphertext);
        
        const pmOther = otherPeer.peerManager;
        const dcOther = pmOther.dc;
        if (dcOther && dcOther.readyState === 'open') {
          dcOther.bufferedAmountLowThreshold = 65536;
          if (dcOther.bufferedAmount > 65536) {
            await new Promise((resolve) => {
              const handleLow = () => {
                dcOther.removeEventListener('bufferedamountlow', handleLow);
                resolve();
              };
              dcOther.addEventListener('bufferedamountlow', handleLow);
              setTimeout(resolve, 150);
            });
          }
          pmOther.send(relayPacket);
        }
      } catch (err) {
        logToConsole(`Failed to relay chunk ${chunkIndex} to [${otherPeer.nickname}]: ${err.message}`);
      }
    }
  }
  
  // Update progress UI
  const now = Date.now();
  if (now - receiver.lastUpdateTime >= 500 || receiver.receivedChunksCount === totalChunks) {
    const progressPercent = Math.round((receiver.receivedChunksCount / totalChunks) * 100);
    const elapsedSec = (now - receiver.lastUpdateTime) / 1000;
    const bytesInInterval = receiver.bytesReceived - receiver.lastBytesReceived;
    const speedBps = elapsedSec > 0 ? bytesInInterval / elapsedSec : 0;
    
    let speedText = '';
    if (speedBps < 1024) speedText = `${speedBps.toFixed(0)} B/s`;
    else if (speedBps < 1024 * 1024) speedText = `${(speedBps / 1024).toFixed(1)} KB/s`;
    else speedText = `${(speedBps / (1024 * 1024)).toFixed(1)} MB/s`;
    
    updateFileProgress(fileId, progressPercent, speedText);
    
    receiver.lastUpdateTime = now;
    receiver.lastBytesReceived = receiver.bytesReceived;
  }
  
  // If all chunks received, reassemble the file
  if (receiver.receivedChunksCount === totalChunks) {
    logToConsole(`All chunks received for "${receiver.filename}". Generating local Blob...`);
    
    const fileBlob = new Blob(receiver.chunks, { type: receiver.filetype });
    const downloadUrl = URL.createObjectURL(fileBlob);
    
    completeFileProgress(fileId, receiver.filename, receiver.filetype, receiver.filesize, downloadUrl);
    
    delete fileReceivers[fileId];
    logToConsole(`File "${receiver.filename}" reassembled and ready for download.`);
  }
}

/**
 * Host-only: broadcasts the complete list of participant nicknames.
 */
function broadcastMemberList() {
  if (!state.isHost) return;
  
  const names = [state.nickname, ...state.peers.map(p => p.nickname)];
  const payload = {
    type: 'members',
    list: names
  };
  
  const dataStr = JSON.stringify(payload);
  state.peers.forEach(peer => {
    try {
      peer.peerManager.send(dataStr);
    } catch (err) {
      console.error(`Broadcast failed for ${peer.nickname}:`, err);
    }
  });
}

/**
 * Refreshes member lists and enables/disables inputs dynamically.
 */
function refreshMembersUI() {
  const isConnected = state.peers.length > 0 && state.peers.some(p => p.sharedKey);
  
  if (state.isHost) {
    const members = [
      { name: `${state.nickname} (You)`, isHost: true },
      ...state.peers.map(p => ({ name: p.nickname, isHost: false }))
    ];
    updatePeerList(members);
    
    elements.inputMessage.disabled = !isConnected;
    elements.btnSendMessage.disabled = !isConnected;
    elements.btnAttachFile.disabled = !isConnected;
    elements.btnEmojiTrigger.disabled = !isConnected;
    
    if (isConnected) {
      elements.inputMessage.placeholder = "Type a transmission...";
    } else {
      elements.inputMessage.placeholder = "Waiting for guest connection...";
    }
    
    elements.chatRoomName.innerText = `Host Room (${state.peers.length} active)`;
  } else {
    const hostPeer = state.peers[0];
    const guestConnected = !!(hostPeer && hostPeer.sharedKey);
    
    elements.inputMessage.disabled = !guestConnected;
    elements.btnSendMessage.disabled = !guestConnected;
    elements.btnAttachFile.disabled = !guestConnected;
    elements.btnEmojiTrigger.disabled = !guestConnected;
    
    if (guestConnected) {
      elements.chatRoomName.innerText = `Guest Room (Host: ${hostPeer.nickname})`;
      elements.inputMessage.placeholder = "Type a transmission...";
      
      const members = [
        { name: `${state.nickname} (You)`, isHost: false },
        { name: hostPeer.nickname, isHost: true }
      ];
      updatePeerList(members);
    } else {
      elements.chatRoomName.innerText = "Connecting to Host...";
      elements.inputMessage.placeholder = "Connecting to host...";
      updatePeerList([{ name: `${state.nickname} (You)`, isHost: false }]);
    }
  }
}

/**
 * Clipboard copy helper.
 * @param {string} text Text to write
 */
function copyToClipboard(text) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast("Copied code to clipboard!", "info");
  }).catch(() => {
    showToast("Failed to copy code.", "error");
  });
}

/**
 * Clean disconnect and return to landing page.
 */
function disconnectChat() {
  logToConsole("Disconnecting links...");
  closeMobileSidebar();
  
  if (state.signaler) {
    try {
      state.signaler.close();
    } catch (e) {}
    state.signaler = null;
  }
  if (state.signalingTimeoutId) {
    clearTimeout(state.signalingTimeoutId);
    state.signalingTimeoutId = null;
  }
  
  state.peers.forEach(peer => {
    try {
      peer.peerManager.close();
    } catch (e) {}
  });
  
  if (state.pendingHostPeer) {
    try {
      state.pendingHostPeer.peerManager.close();
    } catch (e) {}
  }
  
  resetToLanding();
  showToast("Disconnected.", "info");
}

/**
 * Resets state variables and returns UI to landing console overlay.
 */
function resetToLanding() {
  if (state.signaler) {
    try {
      state.signaler.close();
    } catch (e) {}
    state.signaler = null;
  }
  if (state.signalingTimeoutId) {
    clearTimeout(state.signalingTimeoutId);
    state.signalingTimeoutId = null;
  }
  
  state.peers = [];
  state.pendingHostPeer = null;
  state.localKeyPair = null;
  state.isHost = false;
  closeMobileSidebar();
  
  isConnectingHost = false;
  isProcessingJoiner = false;
  fileReceivers = {};
  
  // Clear search parameter so reloading starts fresh
  window.history.replaceState({}, document.title, window.location.pathname);
  
  elements.hostRemoteCode.disabled = false;
  elements.joinerRemoteCode.disabled = false;
  
  elements.hostLocalCode.innerText = '';
  elements.hostRemoteCode.value = '';
  elements.joinerRemoteCode.value = '';
  elements.joinerLocalCode.innerText = '';
  elements.hostSignalingStatus.style.display = "none";
  elements.joinerSignalingStatus.style.display = "none";
  elements.inputMessage.value = '';
  elements.inputMessage.disabled = true;
  elements.inputMessage.placeholder = "Session Offline - Connect a peer to chat...";
  elements.btnSendMessage.disabled = true;
  elements.btnAttachFile.disabled = true;
  elements.btnEmojiTrigger.disabled = true;
  
  elements.chatRoomName.innerText = "Session Offline";
  updateStatus('offline');
  updatePeerList([]);
  
  showLanding(true);
}
