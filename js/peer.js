/**
 * WebRTC Peer Connection Manager
 * Coordinates RTCPeerConnection creation, ICE gathering completion,
 * and RTCDataChannel lifecycle management.
 */

export class PeerManager {
  /**
   * @param {RTCConfiguration} iceConfig
   */
  constructor(iceConfig) {
    this.pc = new RTCPeerConnection(iceConfig);
    this.dc = null;
    
    // Callbacks to be hooked by application controller
    this.onConnected = () => {};
    this.onMessage = (data) => {};
    this.onDisconnected = () => {};
    this.onStateChange = (state) => {};
    this.onIceGatheringChange = (state) => {};
    this.onLog = (msg) => {}; // Added for tactical console output
    
    // Bind connection state changes
    this.pc.onconnectionstatechange = () => {
      const state = this.pc.connectionState;
      this.onLog(`Connection state: ${state}`);
      this.onStateChange(state);
      
      if (state === 'disconnected' || state === 'failed' || state === 'closed') {
        this.onDisconnected();
      }
    };
    
    this.onLog('Peer connection created');
  }

  /**
   * Configures event listeners on the RTCDataChannel.
   * @param {RTCDataChannel} channel
   */
  setupDataChannel(channel) {
    this.dc = channel;
    this.dc.binaryType = 'arraybuffer'; // Optional but good practice for raw binaries (we'll send strings/buffers)
    
    this.dc.onopen = () => {
      this.onLog("Data channel established");
      this.onConnected();
    };
    
    this.dc.onclose = () => {
      this.onLog("Data channel closed");
      this.onDisconnected();
    };
    
    this.dc.onmessage = (event) => {
      this.onMessage(event.data);
    };
    
    this.dc.onerror = (err) => {
      this.onLog(`Data channel error: ${err.message || err}`);
    };
  }

  /**
   * Binds data channel listener for the responder side.
   */
  listenForDataChannel() {
    this.pc.ondatachannel = (event) => {
      this.onLog("Remote data channel received");
      this.setupDataChannel(event.channel);
    };
  }

  /**
   * Generates a WebRTC Offer. Initiator flow.
   * @returns {Promise<RTCSessionDescription>} Offer description with candidates gathered
   */
  async createOffer() {
    this.onLog("Creating data channel...");
    // Create reliable, ordered data channel
    const channel = this.pc.createDataChannel("whisperlink-chat", {
      ordered: true
    });
    this.setupDataChannel(channel);

    this.onLog("Creating local offer...");
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // Wait for all ICE candidates to be gathered so they are embedded in the offer code
    await this.waitForIceGathering();
    return this.pc.localDescription;
  }

  /**
   * Accepts a remote WebRTC Offer and generates a response Answer. Responder flow.
   * @param {RTCSessionDescription} offerSdp
   * @returns {Promise<RTCSessionDescription>} Answer description with candidates gathered
   */
  async acceptOffer(offerSdp) {
    this.onLog("Setting remote offer description...");
    this.listenForDataChannel();
    await this.pc.setRemoteDescription(offerSdp);
    
    this.onLog("Creating local answer description...");
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    
    // Wait for ICE candidates to gather for the answer code
    await this.waitForIceGathering();
    return this.pc.localDescription;
  }

  /**
   * Accepts the remote WebRTC Answer. Initiator flow.
   * @param {RTCSessionDescription} answerSdp
   */
  async acceptAnswer(answerSdp) {
    if (this.pc.signalingState === 'stable') {
      this.onLog("Connection is already stable. Skipping duplicate answer.");
      return;
    }
    this.onLog("Setting remote answer description...");
    await this.pc.setRemoteDescription(answerSdp);
  }

  /**
   * Promise that resolves when ICE gathering state transitions to 'complete', or times out.
   * @param {number} timeoutMs
   * @returns {Promise<void>}
   */
  waitForIceGathering(timeoutMs = 10000) {
    return new Promise((resolve) => {
      this.onLog(`Gathering ICE candidates (current: ${this.pc.iceGatheringState})...`);
      if (this.pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const timer = setTimeout(() => {
        this.onLog("ICE gathering timed out. Connecting with what we have.");
        resolve();
      }, timeoutMs);

      const onStateChange = () => {
        const state = this.pc.iceGatheringState;
        this.onLog(`ICE state: ${state}`);
        this.onIceGatheringChange(state);
        
        if (state === 'complete') {
          clearTimeout(timer);
          this.pc.removeEventListener('icegatheringstatechange', onStateChange);
          resolve();
        }
      };

      this.pc.addEventListener('icegatheringstatechange', onStateChange);
    });
  }

  /**
   * Sends raw string or ArrayBuffer down the data channel.
   * @param {string|ArrayBuffer} data
   */
  send(data) {
    if (this.dc && this.dc.readyState === 'open') {
      this.dc.send(data);
    } else {
      throw new Error("Unable to send: connection is not open");
    }
  }

  /**
   * Closes data channel and connection.
   */
  close() {
    if (this.dc) {
      try {
        this.dc.close();
      } catch (e) {}
    }
    try {
      this.pc.close();
    } catch (e) {}
  }
}
