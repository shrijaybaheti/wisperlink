/**
 * MQTT-over-WebSocket Signaling Client
 * Handles serverless WebRTC signaling using a public, zero-auth MQTT broker.
 */

export class MqttSignaler {
  /**
   * @param {string} brokerUrl
   * @param {string} infoHash Room identifier
   * @param {string} peerId Client peer identifier
   */
  constructor(brokerUrl, infoHash, peerId) {
    this.brokerUrl = brokerUrl || "wss://broker.hivemq.com:8884/mqtt";
    this.infoHash = infoHash;
    this.peerId = peerId;
    this.ws = null;
    
    // Callbacks to be hooked by application controller
    this.onOffer = (offer, remotePeerId) => {};
    this.onAnswer = (answer, remotePeerId) => {};
    this.onError = (err) => {};
    this.onLog = (msg) => {};
    this.onConnect = () => {};
    
    this.isConnected = false;
    this.topicOffers = `wisperlink/rooms/${this.infoHash}/offers`;
    this.topicAnswers = `wisperlink/rooms/${this.infoHash}/answers`;
  }

  /**
   * Establishes the WebSocket connection and negotiates the MQTT subprotocol.
   */
  connect() {
    this.onLog(`Connecting to MQTT broker: ${this.brokerUrl}`);
    
    try {
      // Connect using the standard 'mqtt' WebSocket subprotocol
      const ws = new WebSocket(this.brokerUrl, 'mqtt');
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      
      const connectionTimeout = setTimeout(() => {
        if (ws.readyState !== WebSocket.OPEN || !this.isConnected) {
          this.onLog("Broker connection timed out.");
          this.onError(new Error("Connection to signaling broker timed out."));
          ws.close();
        }
      }, 5000);
      
      ws.onopen = () => {
        this.onLog("WebSocket transport open. Sending MQTT CONNECT...");
        this.sendConnect();
      };
      
      ws.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          this.handleMessage(event.data);
        }
      };
      
      ws.onerror = (err) => {
        clearTimeout(connectionTimeout);
        this.onLog(`WebSocket error: ${err.message || "Disconnected"}`);
      };
      
      ws.onclose = () => {
        clearTimeout(connectionTimeout);
        this.onLog("WebSocket signaling connection closed.");
        this.isConnected = false;
      };
    } catch (err) {
      this.onLog(`WebSocket creation failed: ${err.message}`);
      this.onError(err);
    }
  }

  /**
   * Sends the binary CONNECT packet to the MQTT broker.
   */
  sendConnect() {
    const protocolName = [0, 4, 77, 81, 84, 84]; // "MQTT"
    const protocolLevel = 4; // v3.1.1
    const connectFlags = 2; // Clean Session
    const keepAlive = [0, 60]; // 60 seconds
    
    const clientIdBytes = new TextEncoder().encode(this.peerId);
    const clientIdLen = [clientIdBytes.length >> 8, clientIdBytes.length & 0xFF];
    
    const varHeader = [...protocolName, protocolLevel, connectFlags, ...keepAlive];
    const payload = [...clientIdLen, ...clientIdBytes];
    const remLen = varHeader.length + payload.length;
    
    const packet = new Uint8Array([0x10, remLen, ...varHeader, ...payload]);
    this.ws.send(packet.buffer);
  }

  /**
   * Subscribes to a specific MQTT topic.
   * @param {string} topic
   */
  subscribe(topic) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const topicBytes = new TextEncoder().encode(topic);
    const topicLen = [topicBytes.length >> 8, topicBytes.length & 0xFF];
    const packetId = [0, 1]; // Unique packet ID
    
    const varHeader = [...packetId];
    const payload = [...topicLen, ...topicBytes, 0]; // QoS = 0
    const remLen = varHeader.length + payload.length;
    
    const packet = new Uint8Array([0x82, remLen, ...varHeader, ...payload]);
    this.ws.send(packet.buffer);
    this.onLog(`MQTT Subscribe packet sent for: ${topic}`);
  }

  /**
   * Publishes a text payload to a topic.
   * @param {string} topic
   * @param {string} payloadStr
   */
  publish(topic, payloadStr) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    
    const topicBytes = new TextEncoder().encode(topic);
    const topicLen = [topicBytes.length >> 8, topicBytes.length & 0xFF];
    
    const msgObj = {
      sender: this.peerId,
      payload: payloadStr
    };
    const msgBytes = new TextEncoder().encode(JSON.stringify(msgObj));
    
    const varHeader = [...topicLen, ...topicBytes];
    const payload = [...msgBytes];
    const remLen = varHeader.length + payload.length;
    
    // Remaining length encoding (can be up to 4 bytes if payload is large)
    const headerBytes = [0x30]; // Control Type: PUBLISH, QoS: 0
    let temp = remLen;
    do {
      let encodedByte = temp % 128;
      temp = Math.floor(temp / 128);
      if (temp > 0) {
        encodedByte = encodedByte | 128;
      }
      headerBytes.push(encodedByte);
    } while (temp > 0);
    
    const packet = new Uint8Array([...headerBytes, ...varHeader, ...payload]);
    this.ws.send(packet.buffer);
    this.onLog(`MQTT Publish packet sent to: ${topic}`);
  }

  /**
   * Processes incoming binary messages from the MQTT broker.
   * @param {ArrayBuffer} arrayBuffer
   */
  handleMessage(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    if (bytes.length === 0) return;
    
    const type = bytes[0] >> 4;
    
    if (type === 2) {
      // CONNACK
      const returnCode = bytes[3];
      if (returnCode === 0) {
        this.isConnected = true;
        this.onLog("MQTT Connection accepted.");
        this.onConnect();
      } else {
        this.onError(new Error(`MQTT Connection refused: code ${returnCode}`));
      }
    } else if (type === 3) {
      // PUBLISH
      let offset = 1;
      let multiplier = 1;
      let remLen = 0;
      let encodedByte;
      
      // Parse remaining length
      do {
        encodedByte = bytes[offset++];
        remLen += (encodedByte & 127) * multiplier;
        multiplier *= 128;
      } while ((encodedByte & 128) !== 0);
      
      const varHeaderStart = offset;
      
      // Parse topic length
      const topicLen = (bytes[offset] << 8) | bytes[offset + 1];
      offset += 2;
      
      // Parse topic
      const topicBytes = bytes.subarray(offset, offset + topicLen);
      const topic = new TextDecoder().decode(topicBytes);
      offset += topicLen;
      
      // Parse message payload
      const payloadBytes = bytes.subarray(offset, varHeaderStart + remLen);
      const messageStr = new TextDecoder().decode(payloadBytes);
      
      try {
        const msgObj = JSON.parse(messageStr);
        if (msgObj.sender === this.peerId) {
          // Ignore own messages
          return;
        }
        
        if (topic === this.topicOffers) {
          this.onOffer(msgObj.payload, msgObj.sender);
        } else if (topic === this.topicAnswers) {
          this.onAnswer(msgObj.payload, msgObj.sender);
        }
      } catch (err) {
        this.onLog(`Failed to parse incoming MQTT payload: ${err.message}`);
      }
    }
  }

  /**
   * Closes the active WebSocket connection.
   */
  close() {
    if (this.ws) {
      this.onLog("Closing connection to signaling broker.");
      const socket = this.ws;
      this.ws = null;
      try {
        socket.close();
      } catch (e) {}
    }
  }
}
