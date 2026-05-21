/**
 * UI Controller Module
 * Handles all DOM queries, element caching, rendering chat bubbles,
 * appending logs, showing toast overlays, rendering QR codes, and log drawer transitions.
 */

// Cache DOM elements
export const elements = {
  viewLanding: document.getElementById('view-landing'),
  
  inputNickname: document.getElementById('input-nickname'),
  btnHostStart: document.getElementById('btn-host-start'),
  btnJoinStart: document.getElementById('btn-join-start'),
  
  statusDot: document.getElementById('status-dot'),
  statusText: document.getElementById('status-text'),
  
  panelHostControls: document.getElementById('panel-host-controls'),
  btnHostGenInvite: document.getElementById('btn-host-gen-invite'),
  hostInviteSection: document.getElementById('host-invite-section'),
  hostLocalCode: document.getElementById('host-local-code'),
  btnHostCopyInvite: document.getElementById('btn-host-copy-invite'),
  btnHostShowQr: document.getElementById('btn-host-show-qr'),
  hostQrContainer: document.getElementById('host-qr-container'),
  hostRemoteCode: document.getElementById('host-remote-code'),
  btnHostConnect: document.getElementById('btn-host-connect'),
  
  panelGuestControls: document.getElementById('panel-guest-controls'),
  joinerRemoteCode: document.getElementById('joiner-remote-code'),
  btnJoinerProcess: document.getElementById('btn-joiner-process'),
  joinerAnswerSection: document.getElementById('joiner-answer-section'),
  joinerLocalCode: document.getElementById('joiner-local-code'),
  btnJoinerCopyAnswer: document.getElementById('btn-joiner-copy-answer'),
  btnJoinerShowQr: document.getElementById('btn-joiner-show-qr'),
  joinerQrContainer: document.getElementById('joiner-qr-container'),
  
  peerList: document.getElementById('peer-list'),
  
  eventLogContainer: document.getElementById('event-log-container'),
  eventLogHeader: document.getElementById('event-log-header'),
  eventLog: document.getElementById('event-log'),
  
  chatRoomName: document.getElementById('chat-room-name'),
  chatRoomSecurity: document.getElementById('chat-room-security'),
  btnDisconnect: document.getElementById('btn-disconnect'),
  
  chatMessages: document.getElementById('chat-messages'),
  inputMessage: document.getElementById('input-message'),
  btnSendMessage: document.getElementById('btn-send-message'),
  
  toastOverlay: document.getElementById('toast-overlay')
};

/**
 * Initializes the collapsible console drawer click listener.
 */
export function initConsoleDrawer() {
  elements.eventLogHeader.addEventListener('click', () => {
    const container = elements.eventLogContainer;
    const arrow = container.querySelector('.event-log-arrow');
    
    if (container.classList.contains('collapsed')) {
      container.classList.remove('collapsed');
      container.classList.add('expanded');
      arrow.innerText = '▼';
    } else {
      container.classList.remove('expanded');
      container.classList.add('collapsed');
      arrow.innerText = '▲';
    }
  });
}

/**
 * Toggles landing screen visibility.
 * @param {boolean} show
 */
export function showLanding(show) {
  if (show) {
    elements.viewLanding.style.display = 'flex';
    elements.viewLanding.classList.add('active');
  } else {
    elements.viewLanding.style.display = 'none';
    elements.viewLanding.classList.remove('active');
  }
}

/**
 * Updates the network status dot and text.
 * @param {'offline' | 'gathering' | 'connecting' | 'secure'} status
 */
export function updateStatus(status) {
  const dot = elements.statusDot;
  const txt = elements.statusText;
  
  dot.className = 'status-dot';
  
  switch (status) {
    case 'secure':
      dot.classList.add('active');
      txt.innerText = 'SECURE LINK';
      break;
    case 'gathering':
      dot.classList.add('pending');
      txt.innerText = 'ICE GATHER';
      break;
    case 'connecting':
      dot.classList.add('pending');
      txt.innerText = 'CONNECTING';
      break;
    case 'offline':
    default:
      txt.innerText = 'OFFLINE';
      break;
  }
}

/**
 * Logs message to the Monospace Event Log drawer.
 * @param {string} text
 */
export function logToConsole(text) {
  const line = document.createElement('div');
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  line.innerText = `[${timeStr}] ${text}`;
  
  elements.eventLog.appendChild(line);
  elements.eventLog.scrollTop = elements.eventLog.scrollHeight;
}

/**
 * Updates peer list inside sidebar.
 * @param {Array<{name: string, isHost: boolean}>} members
 */
export function updatePeerList(members) {
  elements.peerList.innerHTML = '';
  
  members.forEach(member => {
    const item = document.createElement('div');
    item.className = 'peer-item';
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'peer-name';
    nameSpan.innerText = member.name;
    
    const roleSpan = document.createElement('span');
    roleSpan.className = 'peer-role';
    roleSpan.innerText = member.isHost ? 'host' : 'peer';
    
    item.appendChild(nameSpan);
    item.appendChild(roleSpan);
    elements.peerList.appendChild(item);
  });
}

/**
 * Appends standard message to the chat view.
 * @param {string} text
 * @param {string} sender
 * @param {boolean} isMe
 */
export function addMessage(text, sender, isMe) {
  const block = document.createElement('div');
  block.className = `msg-block ${isMe ? 'me' : 'peer'}`;
  
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.innerText = `${sender} [${timeStr}]`;
  
  const textDiv = document.createElement('div');
  textDiv.className = 'msg-text';
  textDiv.innerHTML = parseDiscordMarkdown(text);
  
  block.appendChild(meta);
  block.appendChild(textDiv);
  elements.chatMessages.appendChild(block);
  
  scrollToBottom();
}

/**
 * Escapes HTML characters to prevent XSS injection.
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Parses Discord-style markdown and emoji shorthands into safe HTML.
 * @param {string} text
 * @returns {string}
 */
function parseDiscordMarkdown(text) {
  let escaped = escapeHTML(text);
  const placeholders = [];

  // Extract multiline code blocks (```code```)
  escaped = escaped.replace(/```([\s\S]*?)```/g, (match, code) => {
    const id = `{{CODE_BLOCK_${placeholders.length}}}`;
    const cleanCode = code.replace(/^\n/, '').replace(/\n$/, '');
    placeholders.push(`<pre><code>${cleanCode}</code></pre>`);
    return id;
  });

  // Extract inline code (`code`)
  escaped = escaped.replace(/`([^`]+)`/g, (match, code) => {
    const id = `{{CODE_BLOCK_${placeholders.length}}}`;
    placeholders.push(`<code>${code}</code>`);
    return id;
  });

  // Blockquotes (starts with > )
  let lines = escaped.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('&gt; ')) {
      lines[i] = `<blockquote>${lines[i].substring(5)}</blockquote>`;
    }
  }
  escaped = lines.join('\n');

  // Formatting (bold, italic, underline, strikethrough, spoiler)
  escaped = escaped
    .replace(/\*\*\*([^\*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^\*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/__([^_]+)__/g, '<u>$1</u>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\|\|([^|]+)\|\|/g, '<span class="spoiler" onclick="this.classList.toggle(\'revealed\')">$1</span>');

  // Emoji and text smiley map
  const emojiMap = {
    ':smile:': '😄',
    ':heart:': '❤️',
    ':thumbsup:': '👍',
    ':thumbsdown:': '👎',
    ':fire:': '🔥',
    ':rocket:': '🚀',
    ':cry:': '😢',
    ':wink:': '😉',
    ':tada:': '🎉',
    ':eyes:': '👀',
    ':thinking:': '🤔',
    ':ok_hand:': '👌',
    ':clap:': '👏',
    ':100:': '💯',
    ':skull:': '💀',
    ':grin:': '😁',
    ':joy:': '😂',
    ':sob:': '😭',
    ':rage:': '😡',
    ':scream:': '😱',
    ':poop:': '💩',
    ':check:': '✅',
    ':cross:': '❌',
    ':warning:': '⚠️',
    ':party:': '🥳',
    ':sweat_smile:': '😅',
    ':laughing:': '😆',
    ':wave:': '👋',
    ':D': '😃',
    ':)': '🙂',
    ':(': '🙁',
    ';)': '😉',
    '<3': '❤️'
  };

  // Convert emoji codes
  for (const [short, emoji] of Object.entries(emojiMap)) {
    const escShort = short.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(escShort, 'g');
    escaped = escaped.replace(regex, emoji);
  }

  // Restore code block placeholders
  for (let i = 0; i < placeholders.length; i++) {
    escaped = escaped.replace(`{{CODE_BLOCK_${i}}}`, placeholders[i]);
  }

  return escaped;
}


/**
 * Appends system notifications inside chat timeline.
 * @param {string} text
 */
export function addSystemInfo(text) {
  const line = document.createElement('div');
  line.className = 'system-msg';
  line.innerText = text;
  
  elements.chatMessages.appendChild(line);
  scrollToBottom();
}

/**
 * Renders SVG QR code into the specified container.
 * @param {HTMLElement} container
 * @param {string} text
 */
export function renderQrCode(container, text) {
  container.innerHTML = '';
  try {
    if (typeof window.qrcode === 'undefined') {
      container.innerText = "QR Engine not loaded.";
      return;
    }
    // Auto-select type (0), Low error correction ('L')
    const qr = window.qrcode(0, 'L');
    qr.addData(text);
    qr.make();
    // Render SVG tag with cell size=3, margin=8
    const svgTagHtml = qr.createSvgTag(3, 8);
    container.innerHTML = svgTagHtml;
  } catch (err) {
    console.error("QR Code error:", err);
    container.innerText = "Failed to render QR Code";
  }
}

/**
 * Toggles display style of QR code containers.
 * @param {HTMLElement} container
 * @param {boolean} [forceState]
 */
export function toggleQrContainer(container, forceState) {
  const show = forceState !== undefined ? forceState : container.style.display === 'none';
  container.style.display = show ? 'flex' : 'none';
}

/**
 * Triggers toast message.
 * @param {string} text
 * @param {'info'|'error'} type
 */
export function showToast(text, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast-console ${type === 'error' ? 'error' : ''}`;
  toast.innerText = text;
  
  elements.toastOverlay.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.5s ease-out';
    setTimeout(() => {
      toast.remove();
    }, 500);
  }, 3500);
}

/**
 * Scrolls chat container to the bottom.
 */
export function scrollToBottom() {
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}
