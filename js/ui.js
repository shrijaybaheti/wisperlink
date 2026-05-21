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
  hostSignalingStatus: document.getElementById('host-signaling-status'),
  
  panelGuestControls: document.getElementById('panel-guest-controls'),
  joinerRemoteCode: document.getElementById('joiner-remote-code'),
  btnJoinerProcess: document.getElementById('btn-joiner-process'),
  joinerAnswerSection: document.getElementById('joiner-answer-section'),
  joinerLocalCode: document.getElementById('joiner-local-code'),
  btnJoinerCopyAnswer: document.getElementById('btn-joiner-copy-answer'),
  btnJoinerShowQr: document.getElementById('btn-joiner-show-qr'),
  joinerQrContainer: document.getElementById('joiner-qr-container'),
  joinerSignalingStatus: document.getElementById('joiner-signaling-status'),
  
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
  btnAttachFile: document.getElementById('btn-attach-file'),
  fileInput: document.getElementById('file-input'),
  btnEmojiTrigger: document.getElementById('btn-emoji-trigger'),
  emojiPicker: document.getElementById('emoji-picker'),
  emojiPickerGrid: document.getElementById('emoji-picker-grid'),
  emojiAutocomplete: document.getElementById('emoji-autocomplete'),
  
  toastOverlay: document.getElementById('toast-overlay'),
  btnMobileMenu: document.getElementById('btn-mobile-menu'),
  mobileSidebarBackdrop: document.getElementById('mobile-sidebar-backdrop'),
  panelSidebar: document.querySelector('.panel-sidebar')
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
 * Appends a file download / preview message to the chat view.
 * @param {string} filename
 * @param {string} filetype
 * @param {number} filesize
 * @param {string} dataUrl
 * @param {string} sender
 * @param {boolean} isMe
 */
export function addFileMessage(filename, filetype, filesize, dataUrl, sender, isMe) {
  const block = document.createElement('div');
  block.className = `msg-block ${isMe ? 'me' : 'peer'}`;
  
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.innerText = `${sender} [${timeStr}]`;
  
  const textDiv = document.createElement('div');
  textDiv.className = 'msg-text file-msg';
  
  // Format file size
  let sizeStr = '';
  if (filesize < 1024) sizeStr = `${filesize} B`;
  else if (filesize < 1024 * 1024) sizeStr = `${(filesize / 1024).toFixed(1)} KB`;
  else sizeStr = `${(filesize / (1024 * 1024)).toFixed(1)} MB`;
  
  // If it's an image, render a nice preview
  if (filetype.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = dataUrl;
    img.className = 'chat-image-preview';
    img.alt = filename;
    textDiv.appendChild(img);
  }
  
  const fileInfo = document.createElement('div');
  fileInfo.className = 'file-info-row';
  
  const icon = document.createElement('span');
  icon.className = 'file-icon';
  icon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5a3 3 0 0 0 6 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z"/></svg>`;
  
  const details = document.createElement('div');
  details.className = 'file-details';
  details.innerHTML = `<span class="file-name">${escapeHTML(filename)}</span><span class="file-size">${sizeStr}</span>`;
  
  const dlBtn = document.createElement('a');
  dlBtn.href = dataUrl;
  dlBtn.download = filename;
  dlBtn.className = 'btn-download';
  dlBtn.innerText = 'Download';
  
  fileInfo.appendChild(icon);
  fileInfo.appendChild(details);
  fileInfo.appendChild(dlBtn);
  textDiv.appendChild(fileInfo);
  
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
 * @param {'info'|'warning'|'error'} type
 */
export function showToast(text, type = 'info') {
  const toast = document.createElement('div');
  let typeClass = '';
  if (type === 'error') typeClass = 'error';
  else if (type === 'warning') typeClass = 'warning';
  
  toast.className = `toast-console ${typeClass}`;
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

/**
 * Initializes the emoji picker popover and hooks its item clicks.
 */
export function initEmojiPicker() {
  const pickerGrid = elements.emojiPickerGrid;
  const trigger = elements.btnEmojiTrigger;
  const popover = elements.emojiPicker;
  const input = elements.inputMessage;

  const popularEmojis = [
    '😄', '😃', '😀', '😊', '😉', '😍', '😘', '😜', '😝', '🧐', '😎', '🤔',
    '😐', '😑', '😒', '🙄', '😬', '😔', '😢', '😭', '😱', '😡', '💀', '💩',
    '👍', '👎', '👊', '✊', '✌️', '👌', '✋', '👐', '👏', '🙌', '🙏', '🤝',
    '❤️', '💔', '💕', '💖', '🔥', '🚀', '🎉', '💯', '⚠️', '✅', '❌', '👀'
  ];

  pickerGrid.innerHTML = '';
  popularEmojis.forEach(emoji => {
    const item = document.createElement('span');
    item.className = 'emoji-item';
    item.innerText = emoji;
    item.addEventListener('click', () => {
      const start = input.selectionStart || 0;
      const end = input.selectionEnd || 0;
      const val = input.value;
      input.value = val.substring(0, start) + emoji + val.substring(end);
      
      input.focus();
      const newPos = start + emoji.length;
      input.setSelectionRange(newPos, newPos);
      
      popover.style.display = 'none';
    });
    pickerGrid.appendChild(item);
  });

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const show = popover.style.display === 'none';
    popover.style.display = show ? 'flex' : 'none';
  });

  document.addEventListener('click', (e) => {
    if (!popover.contains(e.target) && e.target !== trigger) {
      popover.style.display = 'none';
    }
  });
}

/**
 * Initializes the Discord-style emoji autocomplete dropdown list.
 */
export function initEmojiAutocomplete() {
  const popover = elements.emojiAutocomplete;
  const input = elements.inputMessage;

  const emojiSuggestions = [
    { name: 'smile', emoji: '😄' },
    { name: 'grin', emoji: '😁' },
    { name: 'joy', emoji: '😂' },
    { name: 'laughing', emoji: '😆' },
    { name: 'sweat_smile', emoji: '😅' },
    { name: 'wink', emoji: '😉' },
    { name: 'heart', emoji: '❤️' },
    { name: 'thumbsup', emoji: '👍' },
    { name: 'thumbsdown', emoji: '👎' },
    { name: 'fire', emoji: '🔥' },
    { name: 'rocket', emoji: '🚀' },
    { name: 'cry', emoji: '😢' },
    { name: 'sob', emoji: '😭' },
    { name: 'tada', emoji: '🎉' },
    { name: 'eyes', emoji: '👀' },
    { name: 'thinking', emoji: '🤔' },
    { name: 'ok_hand', emoji: '👌' },
    { name: 'clap', emoji: '👏' },
    { name: '100', emoji: '💯' },
    { name: 'skull', emoji: '💀' },
    { name: 'rage', emoji: '😡' },
    { name: 'scream', emoji: '😱' },
    { name: 'poop', emoji: '💩' },
    { name: 'check', emoji: '✅' },
    { name: 'cross', emoji: '❌' },
    { name: 'warning', emoji: '⚠️' },
    { name: 'party', emoji: '🥳' },
    { name: 'wave', emoji: '👋' }
  ];

  let activeIndex = 0;
  let currentFiltered = [];

  function checkAutocomplete() {
    const val = input.value;
    const cursor = input.selectionStart || 0;
    const textBefore = val.substring(0, cursor);
    const match = textBefore.match(/(?:^|\s)(:([a-zA-Z0-9_]*))$/);

    if (match) {
      const matchFull = match[1]; // e.g. ":sm" or ":"
      const queryText = match[2].toLowerCase();

      currentFiltered = emojiSuggestions.filter(item =>
        item.name.toLowerCase().includes(queryText)
      ).slice(0, 10);

      if (currentFiltered.length > 0) {
        if (activeIndex >= currentFiltered.length) {
          activeIndex = 0;
        }
        renderPopover();
        popover.style.display = 'block';
        return;
      }
    }

    popover.style.display = 'none';
    currentFiltered = [];
    activeIndex = 0;
  }

  function renderPopover() {
    popover.innerHTML = '';
    currentFiltered.forEach((item, index) => {
      const div = document.createElement('div');
      div.className = 'emoji-autocomplete-item';
      if (index === activeIndex) {
        div.classList.add('active');
      }

      const emojiSpan = document.createElement('span');
      emojiSpan.className = 'autocomplete-emoji';
      emojiSpan.innerText = item.emoji;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'autocomplete-name';
      nameSpan.innerText = `:${item.name}:`;

      div.appendChild(emojiSpan);
      div.appendChild(nameSpan);

      div.addEventListener('click', (e) => {
        e.stopPropagation();
        selectEmoji(item.emoji);
      });

      popover.appendChild(div);
    });
  }

  function selectEmoji(emoji) {
    const val = input.value;
    const cursor = input.selectionStart || 0;
    const textBefore = val.substring(0, cursor);
    const match = textBefore.match(/(?:^|\s)(:([a-zA-Z0-9_]*))$/);

    if (match) {
      const matchFull = match[1];
      const startIdx = cursor - matchFull.length;

      const newVal = val.substring(0, startIdx) + emoji + val.substring(cursor);
      input.value = newVal;

      const newCursorPos = startIdx + emoji.length;
      input.focus();
      input.setSelectionRange(newCursorPos, newCursorPos);
    }

    popover.style.display = 'none';
    currentFiltered = [];
    activeIndex = 0;
  }

  input.addEventListener('input', checkAutocomplete);
  input.addEventListener('keyup', (e) => {
    if (['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(e.key)) {
      return;
    }
    checkAutocomplete();
  });

  input.addEventListener('keydown', (e) => {
    if (popover.style.display === 'block' && currentFiltered.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeIndex = (activeIndex + 1) % currentFiltered.length;
        renderPopover();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeIndex = (activeIndex - 1 + currentFiltered.length) % currentFiltered.length;
        renderPopover();
      } else if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectEmoji(currentFiltered[activeIndex].emoji);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        popover.style.display = 'none';
        currentFiltered = [];
        activeIndex = 0;
      }
    }
  });

  document.addEventListener('click', (e) => {
    if (!popover.contains(e.target) && e.target !== input) {
      popover.style.display = 'none';
      currentFiltered = [];
      activeIndex = 0;
    }
  });
}

/**
 * Appends a file progress bubble to the chat timeline.
 * @param {string} fileId
 * @param {string} filename
 * @param {string} filetype
 * @param {number} filesize
 * @param {string} sender
 * @param {boolean} isMe
 */
export function addFileProgressMessage(fileId, filename, filetype, filesize, sender, isMe) {
  const block = document.createElement('div');
  block.className = `msg-block ${isMe ? 'me' : 'peer'}`;
  
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  
  const meta = document.createElement('div');
  meta.className = 'msg-meta';
  meta.innerText = `${sender} [${timeStr}]`;
  
  const textDiv = document.createElement('div');
  textDiv.className = 'msg-text file-msg';
  textDiv.id = `file-msg-text-${fileId}`;
  
  let sizeStr = '';
  if (filesize < 1024) sizeStr = `${filesize} B`;
  else if (filesize < 1024 * 1024) sizeStr = `${(filesize / 1024).toFixed(1)} KB`;
  else sizeStr = `${(filesize / (1024 * 1024)).toFixed(1)} MB`;
  
  textDiv.innerHTML = `
    <div class="file-info-row progress-row" id="file-progress-${fileId}">
      <span class="file-icon"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5a3 3 0 0 0 6 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z"/></svg></span>
      <div class="file-details" style="flex: 1; overflow: hidden;">
        <span class="file-name" style="display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(filename)}</span>
        <span class="file-size progress-text" style="font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-secondary); margin-top: 0.1rem; display: block;">0% of ${sizeStr}</span>
        <div class="file-progress-bar-container">
          <div class="file-progress-bar" style="width: 0%;"></div>
        </div>
      </div>
    </div>
  `;
  
  block.appendChild(meta);
  block.appendChild(textDiv);
  elements.chatMessages.appendChild(block);
  
  scrollToBottom();
}

/**
 * Updates an active file transfer progress bar.
 * @param {string} fileId
 * @param {number} progressPercent
 * @param {string} speedText
 */
export function updateFileProgress(fileId, progressPercent, speedText) {
  const container = document.getElementById(`file-progress-${fileId}`);
  if (!container) return;
  const bar = container.querySelector('.file-progress-bar');
  const text = container.querySelector('.progress-text');
  if (bar) {
    bar.style.width = `${progressPercent}%`;
  }
  if (text) {
    text.innerText = `${progressPercent}%${speedText ? ` (${speedText})` : ''}`;
  }
}

/**
 * Replaces progress UI with final download button and optional image preview.
 * @param {string} fileId
 * @param {string} filename
 * @param {string} filetype
 * @param {number} filesize
 * @param {string} dataUrl
 */
export function completeFileProgress(fileId, filename, filetype, filesize, dataUrl) {
  const textDiv = document.getElementById(`file-msg-text-${fileId}`);
  if (!textDiv) return;
  
  textDiv.innerHTML = '';
  
  let sizeStr = '';
  if (filesize < 1024) sizeStr = `${filesize} B`;
  else if (filesize < 1024 * 1024) sizeStr = `${(filesize / 1024).toFixed(1)} KB`;
  else sizeStr = `${(filesize / (1024 * 1024)).toFixed(1)} MB`;
  
  if (filetype.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = dataUrl;
    img.className = 'chat-image-preview';
    img.alt = filename;
    textDiv.appendChild(img);
  }
  
  const fileInfo = document.createElement('div');
  fileInfo.className = 'file-info-row';
  
  const icon = document.createElement('span');
  icon.className = 'file-icon';
  icon.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5a2.5 2.5 0 0 1 5 0v10.5c0 .83-.67 1.5-1.5 1.5s-1.5-.67-1.5-1.5V6H9v9.5a3 3 0 0 0 6 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z"/></svg>`;
  
  const details = document.createElement('div');
  details.className = 'file-details';
  details.innerHTML = `<span class="file-name">${escapeHTML(filename)}</span><span class="file-size">${sizeStr}</span>`;
  
  const dlBtn = document.createElement('a');
  dlBtn.href = dataUrl;
  dlBtn.download = filename;
  dlBtn.className = 'btn-download';
  dlBtn.innerText = 'Download';
  
  fileInfo.appendChild(icon);
  fileInfo.appendChild(details);
  fileInfo.appendChild(dlBtn);
  textDiv.appendChild(fileInfo);
  
  scrollToBottom();
}
