import { RawData, WebSocket } from 'ws';
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
    console.log("🔑 Using API key:", DEEPGRAM_API_KEY?.substring(0, 15) + "...");

    const sessionTimeout = setTimeout(() => {
        console.log("Session limit (3 minutes) reached. Closing connection.");
        clientWs.close(1000, "Session limit reached");
    }, 180 * 1000);

    const deepgramWs = new WebSocket(DEEPGRAM_AGENT_URL, ["token", DEEPGRAM_API_KEY]);

    let isConnectionOpen = false;
    let settingsSent = false;
    let settingsApplied = false;
    // Use an array to strictly separate settings and audio to ensure settings are sent first
    const settingsQueue: Array<any> = [];
    const audioQueue: Array<any> = [];

    let messagesSentToDeepgram = 0;
    let messagesReceivedFromDeepgram = 0;
    let deepgramOutputEncoding: string | undefined;
    let deepgramOutputSampleRate: number | undefined;


    const cleanup = () => {
        isConnectionOpen = false;
        settingsSent = false;
        settingsApplied = false;
        settingsQueue.length = 0;
        audioQueue.length = 0;
        clearTimeout(sessionTimeout);
        if (deepgramWs.readyState === WebSocket.OPEN) deepgramWs.close();
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        console.log("📊 Final stats:");
        console.log(`   Messages sent to Deepgram: ${messagesSentToDeepgram}`);
        console.log(`   Messages received from Deepgram: ${messagesReceivedFromDeepgram}`);
        console.log("Proxy connection closed and cleaned up.");
    };

    deepgramWs.on('open', () => {
        console.log("✅ Proxy connection to Deepgram is open.");
        isConnectionOpen = true;

        // --- ENHANCEMENT: Prioritize sending settings if queued ---
        if (settingsQueue.length > 0 && !settingsSent) {
            const settingsMsg = settingsQueue.shift()!; // Get the first (and only) settings message
            console.log("📤 [SEND #1] Queued Settings message to Deepgram");

            const settingsStr = Buffer.isBuffer(settingsMsg)
                ? settingsMsg.toString('utf8')
                : settingsMsg.toString();

            console.log("   Sending as text string, length:", settingsStr.length);
            deepgramWs.send(settingsStr);
            settingsSent = true;
            messagesSentToDeepgram++;
        }
        console.log(`📦 ${audioQueue.length} audio messages remain queued, waiting for SettingsApplied.`);
    });



    clientWs.on('message', (message) => {
        let messageData: Buffer | ArrayBuffer | string | RawData = message;
        let isBinary = false;
        let isJson = false;
        let parsedMessage: any = null;

        if (Buffer.isBuffer(message)) {
            try {
                const msgStr = message.toString('utf8');
                parsedMessage = JSON.parse(msgStr);
                isJson = true;
                console.log(`📨 [RECV from client] TEXT message (as Buffer), length: ${message.length}`);
            } catch {
                isBinary = true;
                console.log(`📨 [RECV from client] BINARY message (Buffer), length: ${message.length}, audio queue: ${audioQueue.length}`);
            }
        } else if (message instanceof ArrayBuffer) {
            isBinary = true;
            console.log(`📨 [RECV from client] BINARY message (ArrayBuffer), length: ${message.byteLength}, audio queue: ${audioQueue.length}`);
        } else { // Assumed string
            try {
                parsedMessage = JSON.parse(message as any);
                isJson = true;
                console.log(`📨 [RECV from client] TEXT message (string), length: ${message.length}`);
            } catch {
                // Not JSON, just a plain string (unlikely for Deepgram agent, but possible)
                console.log(`📨 [RECV from client] UNPARSABLE TEXT message (string), length: ${message.length}`);
            }
        }

        // --- ENHANCEMENT: Handle Settings message with clear logic ---
        if (isJson && (parsedMessage.type === "Settings" || parsedMessage.type === "SettingsConfiguration")) {
            console.log("🔧 [DETECTED] Settings message from client");
            console.log("   Current state:");
            console.log("   - isConnectionOpen:", isConnectionOpen);
            console.log("   - settingsSent:", settingsSent);
            console.log("   - Audio queue size:", audioQueue.length);
            console.log("   - Received Settings:", JSON.stringify(parsedMessage, null, 2));


            if (isConnectionOpen && !settingsSent) {
                console.log("📤 [SEND IMMEDIATELY] Settings to Deepgram (connection open, not yet sent)");
                deepgramWs.send(messageData); // Send original message data
                settingsSent = true;
                messagesSentToDeepgram++;
            } else if (!isConnectionOpen && settingsQueue.length === 0) { // Only queue if not already queued
                console.log("⏸️ [QUEUE] Settings (connection not open, queuing)");
                settingsQueue.push(messageData);
            } else if (settingsSent) {
                console.log("⚠️ Settings already sent to Deepgram, ignoring duplicate or late settings message from client.");
            } else {
                console.log("⚠️ Settings message received but unexpected state (e.g., already queued, or logic error).");
            }
            return; // Important: do not process as audio
        }

        // Handle audio/other messages
        if (settingsApplied) {
            console.log(`📤 [SEND to Deepgram] Audio chunk. Deepgram output: ${deepgramOutputEncoding}@${deepgramOutputSampleRate}Hz`);
            deepgramWs.send(messageData);
            messagesSentToDeepgram++;
        } else {
            console.log(`⏸️ [QUEUE] Audio (waiting for SettingsApplied, total queued: ${audioQueue.length + 1})`);
            audioQueue.push(messageData);
        }
    });

    deepgramWs.on('message', (message) => {
        messagesReceivedFromDeepgram++;
        console.log(`\n📥 ===== MESSAGE #${messagesReceivedFromDeepgram} FROM DEEPGRAM =====`);

        let parsedAsText = false;
        let parsedDeepgramMessage: any = null;

        if (Buffer.isBuffer(message)) {
            try {
                const msgStr = message.toString('utf8');
                parsedDeepgramMessage = JSON.parse(msgStr);
                parsedAsText = true;
                console.log(`   Type: TEXT (detected as JSON)`);
                console.log(`   Parsed type: ${parsedDeepgramMessage.type}`);
                console.log(`   Full parsed object:`);
                console.log(JSON.stringify(parsedDeepgramMessage, null, 2));

                if (parsedDeepgramMessage.type === "Welcome") {
                    console.log("👋 Welcome message received from Deepgram");
                }

                if (parsedDeepgramMessage.type === "SettingsApplied") {
                    console.log("✅ Settings confirmed by Deepgram!");
                    settingsApplied = true;
                    // --- ENHANCEMENT: Store and log the confirmed output settings ---
                    deepgramOutputEncoding = parsedDeepgramMessage.response?.encoding;
                    deepgramOutputSampleRate = parsedDeepgramMessage.response?.sample_rate;
                    console.log(`   Confirmed output encoding: ${deepgramOutputEncoding}, sample rate: ${deepgramOutputSampleRate}Hz`);


                    // Flush queue
                    console.log(`📤 [FLUSH] Sending ${audioQueue.length} queued audio messages`);
                    let flushed = 0;
                    while (audioQueue.length > 0) {
                        const msg = audioQueue.shift()!;
                        deepgramWs.send(msg); // msg is already Buffer/ArrayBuffer
                        flushed++;
                        messagesSentToDeepgram++;
                    }
                    console.log(`✅ Flushed ${flushed} messages, audio flow active.`);
                    if (flushed > 0) {
                        console.log(`   First few flushed messages were audio for Deepgram output: ${deepgramOutputEncoding}@${deepgramOutputSampleRate}Hz`);
                    } else {
                        console.log("   No audio messages were queued to flush.");
                    }
                }

                if (parsedDeepgramMessage.type === "Error") {
                    console.error("❌ Deepgram Error:");
                    console.error(JSON.stringify(parsedDeepgramMessage, null, 2));
                    // Consider closing connection or notifying client of error
                }
            } catch (e) {
                // Not JSON text, it's actual binary
                parsedAsText = false;
            }
        }

        if (!parsedAsText) {
            // It's actually binary audio data
            const length = Buffer.isBuffer(message) ? message.length : (message instanceof ArrayBuffer ? message.byteLength : 0);
            console.log(`   Type: BINARY (audio)`);
            console.log(`   Length: ${length} bytes`);
            console.log(`   Assumed encoding: ${deepgramOutputEncoding || 'UNKNOWN'}, sample rate: ${deepgramOutputSampleRate || 'UNKNOWN'}Hz`);


            // Try to decode first few bytes to see what it is
            if (Buffer.isBuffer(message) && message.length > 0) {
                console.log(`   First 20 bytes (hex): ${message.slice(0, 20).toString('hex')}`);
                // Attempt to interpret as string only for debugging, not actual data
                console.log(`   First 20 bytes (utf8-ish, non-printable chars replaced): ${message.slice(0, 20).toString('utf8').replace(/[^\x20-\x7E]/g, '.')}`);
            }
        }

        console.log(`📥 ===== END MESSAGE #${messagesReceivedFromDeepgram} =====\n`);

        // Forward to client
        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(message);
        }
    });

    clientWs.on('close', () => {
        console.log("🔌 Client WebSocket closed.");
        cleanup();
    });

    deepgramWs.on('close', (code, reason) => {
        console.log("🔌 Deepgram WebSocket closed:");
        console.log("   Code:", code);
        console.log("   Reason:", reason.toString() || "(empty)");
        console.log("   Settings sent:", settingsSent);
        console.log("   Settings applied:", settingsApplied);
        console.log(`   Deepgram output encoding/sample rate: ${deepgramOutputEncoding || 'N/A'}@${deepgramOutputSampleRate || 'N/A'}Hz`);
        cleanup();
    });

    clientWs.on('error', (err) => {
        console.error("❌ Client WebSocket error:", err.message);
        cleanup();
    });

    deepgramWs.on('error', (err) => {
        console.error("❌ Deepgram WebSocket error:", err);
        cleanup();
    });
};