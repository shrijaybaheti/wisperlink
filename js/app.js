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
  initEmojiAutocomplete
} from './ui.js';
import * as codec from './codec.js';
import * as crypto from './crypto.js';
import { PeerManager } from './peer.js';

// NAT Discovery STUN Servers
const iceConfig = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// Application State
let state = {
  nickname: 'Anonymous',
  isHost: false,
  localKeyPair: null,
  peers: [],            // List of active peer objects: { id, peerManager, sharedKey, nickname }
  pendingHostPeer: null // Host-only: peer object currently in the handshake process
};

// Concurrency locks to prevent double-execution during auto-paste or button double-clicks
let isConnectingHost = false;
let isProcessingJoiner = false;

// Keep track of incoming file transfers: { fileId: { filename, filetype, filesize, sender, totalChunks, chunks, receivedChunksCount } }
let fileReceivers = {};

// Check for URL invite parameters on load
const urlParams = new URLSearchParams(window.location.search);
const inviteParam = urlParams.get('invite');

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

  // Check URL boarding params on load
  if (inviteParam) {
    logToConsole("Invite code detected in URL query params.");
    elements.joinerRemoteCode.value = inviteParam;
    elements.btnJoinerProcess.disabled = false;
    
    // Highlight UI that they are entering an invited session
    elements.btnJoinStart.innerText = "Join Invited Chat";
    elements.btnJoinStart.classList.add('orange');
    elements.btnHostStart.classList.remove('orange');
    
    showToast("Invite link detected in URL!", "info");
  }
});

/**
 * Initializes keypair generation and routes to dashboard views.
 * @param {boolean} isHost
 */
async function startSetup(isHost) {
  state.isHost = isHost;
  
  // Reset inputs and fields
  elements.btnHostConnect.disabled = true;
  elements.btnJoinerProcess.disabled = true;
  elements.hostInviteSection.style.display = "none";
  elements.joinerAnswerSection.style.display = "none";
  elements.hostQrContainer.style.display = "none";
  elements.joinerQrContainer.style.display = "none";
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
    
    elements.hostLocalCode.innerText = shareableCode;
    elements.btnHostCopyInvite.disabled = false;
    
    // Generate Invite URL and draw QR Code
    const inviteUrl = window.location.origin + window.location.pathname + '?invite=' + encodeURIComponent(shareableCode);
    renderQrCode(elements.hostQrContainer, inviteUrl);
    
    logToConsole(`Invite code generated [${peerId}]. QR Code set to URL.`);
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
  
  try {
    logToConsole("Importing Host invite parameters...");
    const offerDesc = await codec.decode(codeText);
    
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
    
    elements.joinerLocalCode.innerText = answerCode;
    elements.joinerAnswerSection.style.display = "flex";
    elements.btnJoinerCopyAnswer.disabled = false;
    
    // Draw QR Code of Guest's Answer code
    renderQrCode(elements.joinerQrContainer, answerCode);
    
    // Save host peer temporarily so callbacks have access
    state.peers = [peerObj];
    
    logToConsole("Answer Code and QR generated. Send back to Host.");
    updateStatus('connecting');
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
    } catch (err) {
      logToConsole(`[Tunnel:${peerObj.id}] Failed to dispatch handshake: ${err.message}`);
    }
  };
  
  pm.onMessage = async (data) => {
    try {
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
      } else if (payload.type === 'file-chunk') {
        if (!peerObj.sharedKey) {
          console.warn("Dropped raw file chunk: key exchange incomplete.");
          return;
        }
        
        const fileId = payload.fileId;
        if (!fileReceivers[fileId]) {
          fileReceivers[fileId] = {
            filename: payload.filename,
            filetype: payload.filetype,
            filesize: payload.filesize,
            sender: payload.sender,
            totalChunks: payload.totalChunks,
            chunks: new Array(payload.totalChunks),
            receivedChunksCount: 0
          };
          logToConsole(`Receiving encrypted file "${payload.filename}" in ${payload.totalChunks} chunks...`);
        }
        
        const receiver = fileReceivers[fileId];
        if (!receiver.chunks[payload.chunkIndex]) {
          receiver.chunks[payload.chunkIndex] = payload.chunkData;
          receiver.receivedChunksCount++;
        }
        
        if (receiver.receivedChunksCount === receiver.totalChunks) {
          logToConsole(`All chunks received for "${receiver.filename}". Reassembling and decrypting...`);
          const fullCiphertext = receiver.chunks.join('');
          delete fileReceivers[fileId];
          
          try {
            const decryptedDataUrl = await crypto.decrypt(peerObj.sharedKey, fullCiphertext);
            
            if (state.isHost) {
              addFileMessage(receiver.filename, receiver.filetype, receiver.filesize, decryptedDataUrl, peerObj.nickname, false);
              await relayFile(peerObj.id, peerObj.nickname, receiver.filename, receiver.filetype, receiver.filesize, decryptedDataUrl);
            } else {
              const senderName = receiver.sender || peerObj.nickname;
              addFileMessage(receiver.filename, receiver.filetype, receiver.filesize, decryptedDataUrl, senderName, false);
            }
          } catch (decErr) {
            logToConsole(`Failed to decrypt reassembled file: ${decErr.message}`);
            showToast("Failed to decrypt received file.", "error");
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
 * Sends a large string payload in 16KB fragments with WebRTC flow-control.
 */
async function sendPayloadInChunks(peer, payloadTemplate, ciphertext) {
  const pm = peer.peerManager;
  const dc = pm.dc;
  
  if (!dc || dc.readyState !== 'open') {
    throw new Error("Data channel is closed");
  }
  
  // Set threshold to 64KB
  dc.bufferedAmountLowThreshold = 65536;
  
  const CHUNK_SIZE = 16384;
  const totalChunks = Math.ceil(ciphertext.length / CHUNK_SIZE);
  
  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunkData = ciphertext.substring(start, start + CHUNK_SIZE);
    
    const packet = {
      ...payloadTemplate,
      chunkIndex: i,
      totalChunks: totalChunks,
      chunkData: chunkData
    };
    
    // Flow control: wait if buffer exceeds threshold
    if (dc.bufferedAmount > 65536) {
      await new Promise((resolve) => {
        const handleLow = () => {
          dc.removeEventListener('bufferedamountlow', handleLow);
          resolve();
        };
        dc.addEventListener('bufferedamountlow', handleLow);
        // Fallback timeout in case event is missed
        setTimeout(handleLow, 150);
      });
    }
    
    pm.send(JSON.stringify(packet));
  }
}

/**
 * Host-only: relays a decrypted guest file attachment to other guest tunnels.
 * Encrypts the file separately for each recipient using their shared key.
 */
async function relayFile(senderId, senderName, filename, filetype, filesize, dataUrl) {
  logToConsole(`Relaying file "${filename}" from [${senderName}] to active nodes...`);
  
  for (const peer of state.peers) {
    if (peer.id === senderId) continue;
    
    try {
      const ciphertext = await crypto.encrypt(peer.sharedKey, dataUrl);
      const fileId = Math.random().toString(36).substring(2, 9);
      const payloadTemplate = {
        type: 'file-chunk',
        fileId: fileId,
        sender: senderName,
        filename,
        filetype,
        filesize
      };
      await sendPayloadInChunks(peer, payloadTemplate, ciphertext);
    } catch (err) {
      logToConsole(`Failed to relay file to [${peer.nickname}]: ${err.message}`);
    }
  }
}

/**
 * Reads the selected local file, encrypts it, and broadcasts it to peers.
 */
async function handleFileSelected(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  // Clear the input value so the user can re-upload the same file if desired
  e.target.value = '';
  
  const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
  if (file.size > MAX_FILE_SIZE) {
    showToast("File exceeds the 5MB size limit.", "error");
    return;
  }
  
  logToConsole(`Reading file: ${file.name} (${file.size} bytes)`);
  
  const reader = new FileReader();
  reader.onload = async (event) => {
    const dataUrl = event.target.result;
    await sendFile(file.name, file.type, file.size, dataUrl);
  };
  reader.onerror = (err) => {
    logToConsole(`Error reading file: ${err.message || err}`);
    showToast("Failed to read the local file.", "error");
  };
  reader.readAsDataURL(file);
}

/**
 * Encrypts a file (represented as a Data URL) and transmits it over the WebRTC data channel.
 */
async function sendFile(filename, filetype, filesize, dataUrl) {
  if (state.peers.length === 0) {
    showToast("No active peers connected.", "error");
    return;
  }
  
  try {
    const fileId = Math.random().toString(36).substring(2, 9);
    
    if (state.isHost) {
      // Host encrypts and sends the file to all connected guests
      for (const peer of state.peers) {
        const ciphertext = await crypto.encrypt(peer.sharedKey, dataUrl);
        const payloadTemplate = {
          type: 'file-chunk',
          fileId: fileId,
          sender: state.nickname,
          filename,
          filetype,
          filesize
        };
        await sendPayloadInChunks(peer, payloadTemplate, ciphertext);
      }
      addFileMessage(filename, filetype, filesize, dataUrl, state.nickname, true);
    } else {
      // Guest encrypts and sends the file to the Host (which will relay it)
      const hostPeer = state.peers[0];
      if (hostPeer) {
        const ciphertext = await crypto.encrypt(hostPeer.sharedKey, dataUrl);
        const payloadTemplate = {
          type: 'file-chunk',
          fileId: fileId,
          filename,
          filetype,
          filesize
        };
        await sendPayloadInChunks(hostPeer, payloadTemplate, ciphertext);
        addFileMessage(filename, filetype, filesize, dataUrl, state.nickname, true);
      }
    }
  } catch (err) {
    logToConsole(`Encryption or send failed for file: ${err.message}`);
    showToast("Failed to send encrypted file.", "error");
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
  state.peers = [];
  state.pendingHostPeer = null;
  state.localKeyPair = null;
  state.isHost = false;
  
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
