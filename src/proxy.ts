import { RawData, WebSocket } from 'ws';
import { validateSessionToken } from './auth';

// --- SERVER-SIDE ENVIRONMENT VARIABLES ---
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const GRADIENTS_API_KEY = process.env.GRADIENTS_API_KEY; // Securely loaded on the server
const DEEPGRAM_AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse";

if (!DEEPGRAM_API_KEY) {
    throw new Error("DEEPGRAM_API_KEY is not defined.");
}
if (!GRADIENTS_API_KEY) {
    console.warn("WARNING: GRADIENTS_API_KEY is not defined. Parallax provider override will fail.");
}

export const handleProxyConnection = (clientWs: WebSocket, req: any) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');

    if (!token || !validateSessionToken(token)) {
        clientWs.close(1008, "Invalid session token");
        return;
    }

    console.log("✅ Client authenticated. Opening proxy to Deepgram...");
    console.log("🔑 Using Deepgram API key:", DEEPGRAM_API_KEY?.substring(0, 15) + "...");

    const sessionTimeout = setTimeout(() => {
        console.log("Session limit (3 minutes) reached. Closing connection.");
        clientWs.close(1000, "Session limit reached");
    }, 180 * 1000);

    const deepgramWs = new WebSocket(DEEPGRAM_AGENT_URL, ["token", DEEPGRAM_API_KEY]);

    let isConnectionOpen = false;
    let settingsSent = false;
    let settingsApplied = false;
    const settingsQueue: Array<any> = [];
    const audioQueue: Array<any> = [];

    let messagesSentToDeepgram = 0;

    const cleanup = () => {
        isConnectionOpen = false;
        settingsSent = false;
        settingsApplied = false;
        settingsQueue.length = 0;
        audioQueue.length = 0;
        clearTimeout(sessionTimeout);
        if (deepgramWs.readyState === WebSocket.OPEN) deepgramWs.close();
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close();
        console.log("Proxy connection closed and cleaned up.");
    };

    deepgramWs.on('open', () => {
        console.log("✅ Proxy connection to Deepgram is open.");
        isConnectionOpen = true;

        if (settingsQueue.length > 0 && !settingsSent) {
            const settingsMsg = settingsQueue.shift()!;
            deepgramWs.send(settingsMsg);
            settingsSent = true;
            messagesSentToDeepgram++;
        }
    });

    clientWs.on('message', (message: RawData) => {
        let isJson = false;
        let parsedMessage: any = null;

        if (Buffer.isBuffer(message)) {
            try {
                parsedMessage = JSON.parse(message.toString('utf8'));
                isJson = true;
            } catch { /* Not JSON */ }
        } else if (typeof message === 'string') {
            try {
                parsedMessage = JSON.parse(message);
                isJson = true;
            } catch { /* Not JSON */ }
        }

        if (isJson && (parsedMessage.type === "Settings" || parsedMessage.type === "SettingsConfiguration")) {
            console.log("🔧 [DETECTED] Settings message from client");

            let finalSettings = parsedMessage;

            if (finalSettings.agent?.think?.provider?.type === 'parallax') {
                console.log("🔧 [OVERRIDE] Detected 'parallax' provider. Reformatting for Deepgram.");
                if (!GRADIENTS_API_KEY) {
                    clientWs.close(1011, "Server configuration error for LLM provider.");
                    return;
                }

                let clientModel = finalSettings.agent.think.provider.model;
                if (!clientModel) {
                    clientWs.close(1008, "Invalid 'parallax' settings: model is required.");
                    return;
                }

                // --- THIS IS THE FINAL FIX ---
                // The Gradients API expects a specific format for the model name.
                // We correct it here on the server.
                let finalModelId = "qwen/qwen3-235b-instruct-fp8";

                // Rebuild the 'think' object with the corrected model ID
                finalSettings.agent.think = {
                    provider: {
                        type: "open_ai",
                        model: finalModelId // Use the corrected model ID
                    },
                    endpoint: {
                        url: "https://apis.gradient.network/api/v1/ai/chat/completions",
                        headers: { "Authorization": `Bearer ${GRADIENTS_API_KEY}` }
                    },
                    prompt: finalSettings.agent.think.prompt
                };
            }

            const finalSettingsString = JSON.stringify(finalSettings);
            console.log("   - Final Settings being sent to Deepgram:", finalSettingsString);

            if (isConnectionOpen && !settingsSent) {
                deepgramWs.send(finalSettingsString);
                settingsSent = true;
                messagesSentToDeepgram++;
            } else if (!isConnectionOpen && settingsQueue.length === 0) {
                settingsQueue.push(finalSettingsString);
            }
            return;
        }

        if (settingsApplied) {
            deepgramWs.send(message);
            messagesSentToDeepgram++;
        } else {
            audioQueue.push(message);
        }
    });

    deepgramWs.on('message', (message: RawData) => {
        if (Buffer.isBuffer(message)) {
            try {
                const parsedDeepgramMessage = JSON.parse(message.toString('utf8'));
                if (parsedDeepgramMessage.type === "SettingsApplied") {
                    console.log("✅ [SERVER] Settings were successfully applied!");
                    settingsApplied = true;

                    while (audioQueue.length > 0) {
                        deepgramWs.send(audioQueue.shift()!);
                        messagesSentToDeepgram++;
                    }
                } else if (parsedDeepgramMessage.type === "Error") {
                    console.error("❌ [SERVER] DEEPGRAM RETURNED AN ERROR:", JSON.stringify(parsedDeepgramMessage, null, 2));
                    clientWs.close(1011, "Deepgram configuration error.");
                }
            } catch (e) { /* Not JSON */ }
        }

        if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(message);
        }
    });

    clientWs.on('close', () => {
        console.log("🔌 Client WebSocket closed.");
        cleanup();
    });

    deepgramWs.on('close', (code, reason) => {
        console.log("🔌 Deepgram WebSocket closed:", reason.toString());
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