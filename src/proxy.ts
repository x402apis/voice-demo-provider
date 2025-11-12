import { WebSocket } from 'ws';
import { validateSessionToken } from './auth';

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const DEEPGRAM_AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";

if (!DEEPGRAM_API_KEY) {
    throw new Error("DEEPGRAM_API_KEY is not defined.");
}

export const handleProxyConnection = (clientWs: WebSocket, req: any) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token || !validateSessionToken(token)) {
        clientWs.close(1008, "Invalid session token");
        return;
    }

    console.log("✅ Client authenticated. Opening proxy to Deepgram...");

    const sessionTimeout = setTimeout(() => {
        console.log("Session limit (3 minutes) reached. Closing connection.");
        clientWs.close(1000, "Session limit reached");
    }, 180 * 1000);

    const deepgramWs = new WebSocket(DEEPGRAM_AGENT_URL, ["token", DEEPGRAM_API_KEY]);

    let isConnectionOpen = false;
    let settingsSent = false;
    let settingsApplied = false;
    const messageQueue: Array<{ type: 'settings' | 'audio', data: any }> = [];

    const cleanup = () => {
        isConnectionOpen = false;
        settingsSent = false;
        settingsApplied = false;
        messageQueue.length = 0;
        clearTimeout(sessionTimeout);
        if (deepgramWs.readyState === WebSocket.OPEN) deepgramWs.close();
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        console.log("Proxy connection closed and cleaned up.");
    };

    deepgramWs.on('open', () => {
        console.log("✅ Proxy connection to Deepgram is open.");
        isConnectionOpen = true;

        // Process queue in strict order
        console.log(`📦 Processing ${messageQueue.length} queued messages`);

        // First, send Settings if queued
        const settingsIndex = messageQueue.findIndex(m => m.type === 'settings');
        if (settingsIndex !== -1) {
            const settingsMsg = messageQueue.splice(settingsIndex, 1)[0];
            console.log("📤 [SEND] Settings message to Deepgram");
            deepgramWs.send(settingsMsg.data);
            settingsSent = true;
        }

        // Keep everything else queued until SettingsApplied
        console.log(`⏸️ ${messageQueue.length} audio messages remain queued`);
    });

    clientWs.on('message', (message) => {
        // Handle different message types from ws library
        let messageData: Buffer | ArrayBuffer | string;
        let isBinary = false;

        if (Buffer.isBuffer(message)) {
            // It's a Buffer from ws library - check if it's JSON text
            try {
                const str = message.toString('utf8');
                const parsed = JSON.parse(str);
                // It's JSON text sent as Buffer
                messageData = message;
                isBinary = false;
                console.log(`📨 [RECV from client] TEXT message (as Buffer)`);
            } catch {
                // It's actual binary audio data
                messageData = message;
                isBinary = true;
                console.log(`📨 [RECV from client] BINARY message`);
            }
        } else if (message instanceof ArrayBuffer) {
            messageData = message;
            isBinary = true;
            console.log(`📨 [RECV from client] BINARY message (ArrayBuffer)`);
        } else {
            messageData = message as any;
            isBinary = false;
            console.log(`📨 [RECV from client] TEXT message (string)`);
        }

        // Try to detect Settings message
        if (!isBinary) {
            try {
                const msgStr = Buffer.isBuffer(messageData)
                    ? messageData.toString('utf8')
                    : messageData.toString();
                const parsedMessage = JSON.parse(msgStr);

                if (parsedMessage.type === "Settings" || parsedMessage.type === "SettingsConfiguration") {
                    console.log("🔧 [DETECTED] Settings message from client");
                    console.log(JSON.stringify(parsedMessage, null, 2));

                    if (isConnectionOpen && !settingsSent) {
                        console.log("📤 [SEND] Settings to Deepgram immediately");
                        deepgramWs.send(messageData);
                        settingsSent = true;
                    } else if (!isConnectionOpen) {
                        console.log("⏸️ [QUEUE] Settings (connection not open)");
                        messageQueue.push({ type: 'settings', data: messageData });
                    }
                    return;
                }
            } catch (e) {
                // Not Settings JSON, continue
            }
        }

        // Handle audio/other messages
        if (settingsApplied) {
            console.log(`📤 [SEND] ${isBinary ? 'Audio' : 'Message'} to Deepgram (settings applied)`);
            deepgramWs.send(messageData);
        } else {
            if (messageQueue.length === 0 || messageQueue.length % 20 === 0) {
                console.log(`⏸️ [QUEUE] ${isBinary ? 'Audio' : 'Message'} (waiting for SettingsApplied, queue size: ${messageQueue.length + 1})`);
            }
            messageQueue.push({ type: 'audio', data: messageData });
        }
    });

    deepgramWs.on('message', (message) => {
        const isBinary = message instanceof ArrayBuffer || Buffer.isBuffer(message);

        if (!isBinary) {
            try {
                const parsed = JSON.parse(message.toString());
                console.log(`📥 [RECV from Deepgram] ${parsed.type}`);

                if (parsed.type === "SettingsApplied") {
                    console.log("✅ Settings confirmed by Deepgram!");
                    settingsApplied = true;

                    // Flush queue
                    console.log(`📤 [FLUSH] Sending ${messageQueue.length} queued messages`);
                    while (messageQueue.length > 0) {
                        const msg = messageQueue.shift()!;
                        deepgramWs.send(msg.data);
                    }
                    console.log("✅ Queue flushed, audio flow active");
                }

                if (parsed.type === "Error") {
                    console.error("❌ Deepgram Error:", JSON.stringify(parsed, null, 2));
                }
            } catch (e) {
                // Not JSON
            }
        }

        // Forward to client
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(message);
        }
    });

    clientWs.on('close', () => {
        console.log("Client WebSocket closed.");
        cleanup();
    });

    deepgramWs.on('close', (code, reason) => {
        console.log(`Deepgram WebSocket closed: Code ${code}, Reason: ${reason.toString()}`);
        cleanup();
    });

    clientWs.on('error', (err) => {
        console.error("Client WebSocket error:", err.message);
        cleanup();
    });

    deepgramWs.on('error', (err) => {
        console.error("Deepgram WebSocket error:", err.message);
        cleanup();
    });
};