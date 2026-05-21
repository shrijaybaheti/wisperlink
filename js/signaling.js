/**
 * WebTorrent WebSocket Tracker Signaling Client
 * Handles serverless WebRTC signaling using public WebTorrent tracker servers.
 */

export class TrackerSignaler {
  /**
   * @param {string[]} trackerUrls
   * @param {string} infoHash 40-character hex room identifier
   * @param {string} peerId 40-character hex peer identifier
   */
  constructor(trackerUrls, infoHash, peerId) {
    this.trackerUrls = trackerUrls;
    this.infoHash = infoHash;
    this.peerId = peerId;
    this.ws = null;
    this.offerId = null;
    
    // Callbacks to be hooked by application controller
    this.onOffer = (offer, offerId, remotePeerId) => {};
    this.onAnswer = (answer, offerId, remotePeerId) => {};
    this.onError = (err) => {};
    this.onLog = (msg) => {};
    this.onConnect = () => {};
  }

  /**
   * Connects to the tracker URLs. Iterates through the list until a successful connection is made.
   */
  connect() {
    let index = 0;
    
    const connectToNext = () => {
      if (index >= this.trackerUrls.length) {
        this.onError(new Error("Unable to connect to any public WebSocket trackers."));
        return;
      }
      
      const url = this.trackerUrls[index];
      this.onLog(`Connecting to tracker: ${url}`);
      
      try {
        const ws = new WebSocket(url);
        this.ws = ws;
        
        // Timeout tracker connections quickly (3 seconds) to proceed to next/fallback
        const connectionTimeout = setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            this.onLog(`Connection to ${url} timed out.`);
            ws.close();
          }
        }, 3000);
        
        ws.onopen = () => {
          clearTimeout(connectionTimeout);
          this.onLog(`Connected to tracker: ${url}`);
          // Send initial announce to register on the swarm
          this.announce();
          this.onConnect();
        };
        
        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (err) {
            this.onLog(`Failed to parse tracker JSON: ${err.message}`);
          }
        };
        
        ws.onerror = (err) => {
          clearTimeout(connectionTimeout);
          this.onLog(`WebSocket error on tracker ${url}: ${err.message || "Disconnected"}`);
        };
        
        ws.onclose = () => {
          clearTimeout(connectionTimeout);
          if (this.ws === ws) {
            this.ws = null;
            index++;
            connectToNext();
          }
        };
      } catch (err) {
        this.onLog(`WebSocket creation failed for ${url}: ${err.message}`);
        index++;
        connectToNext();
      }
    };
    
    connectToNext();
  }

  /**
   * Send announce packet to the tracker.
   * @param {object} [extraParams]
   */
  announce(extraParams = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const payload = {
      action: 'announce',
      info_hash: this.infoHash,
      peer_id: this.peerId,
      ...extraParams
    };
    
    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Host (Alice) announces her WebRTC offer to the tracker swarm.
   * @param {object} sdpOffer
   */
  sendOffer(sdpOffer) {
    this.offerId = this.offerId || this.generateId();
    this.onLog(`Announcing WebRTC offer (Offer ID: ${this.offerId.substring(0, 8)})...`);
    this.announce({
      numwant: 1,
      offers: [
        {
          offer_id: this.offerId,
          offer: sdpOffer
        }
      ]
    });
  }

  /**
   * Guest (Bob) sends answer to a specific host offer.
   * @param {object} sdpAnswer
   * @param {string} toPeerId Target host peer ID
   * @param {string} offerId Target offer ID
   */
  sendAnswer(sdpAnswer, toPeerId, offerId) {
    this.onLog(`Sending WebRTC answer to Host ${toPeerId.substring(0, 8)}...`);
    this.announce({
      to_peer_id: toPeerId,
      offer_id: offerId,
      answer: sdpAnswer
    });
  }

  /**
   * Parses messages from the tracker and invokes appropriate callbacks.
   * @param {object} data
   */
  handleMessage(data) {
    if (data.action === 'announce') {
      // Bob receives Host's offer
      if (data.offer && data.offer_id && data.peer_id) {
        this.onLog(`Received remote offer (Offer ID: ${data.offer_id.substring(0, 8)}) from Host ${data.peer_id.substring(0, 8)}`);
        this.onOffer(data.offer, data.offer_id, data.peer_id);
      } 
      // Alice receives Guest's answer
      else if (data.answer && data.offer_id && data.peer_id) {
        this.onLog(`Received remote answer (Offer ID: ${data.offer_id.substring(0, 8)}) from Guest ${data.peer_id.substring(0, 8)}`);
        this.onAnswer(data.answer, data.offer_id, data.peer_id);
      }
    } else if (data.failure_reason) {
      this.onLog(`Tracker failure message: ${data.failure_reason}`);
      this.onError(new Error(data.failure_reason));
    }
  }

  /**
   * Generates a random 20-byte hex ID.
   * @returns {string}
   */
  generateId() {
    const arr = new Uint8Array(20);
    window.crypto.getRandomValues(arr);
    return Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Closes the active WebSocket tracker connection.
   */
  close() {
    if (this.ws) {
      this.onLog("Closing connection to signaling tracker.");
      const socket = this.ws;
      this.ws = null; // prevent reconnection attempts
      try {
        socket.close();
      } catch (e) {}
    }
  }
}
