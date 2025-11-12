import { createProviderServer } from '@x402apis/node';
import { WebSocketServer } from 'ws';
import { handleProxyConnection } from './proxy';
import { generateSessionToken, SessionPayload } from './auth';
import dotenv from 'dotenv';
import cors from 'cors';
import { writeFileSync } from 'fs';

const walletJson = process.env.WALLET_JSON;

if (walletJson) {
    writeFileSync('wallet.json', walletJson);
} else {
    console.error('WALLET_JSON environment variable not set.');
    process.exit(1);
}

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 9001;
// --- CHANGE 1: Store your public URL in a constant for easy access ---
const PUBLIC_URL = "https://voice-demo-provider-production.up.railway.app";

// 1. Create the x402 Provider Server instance
const x402Provider = createProviderServer({
    wallet: './wallet.json',
    publicUrl: PUBLIC_URL, // Use the constant here
    port: Number(PORT),
    registry: 'https://x402apis.io/api'
});

const app = x402Provider.getExpressApp();

app.use(cors({
    origin: '*' // Allow requests ONLY from your client UI
}));
// 2. Define the API endpoint
x402Provider.addAPI(
    'deepgram.agent.createSession',
    async (params: { userIdentifier?: string }) => {
        console.log(`Payment received for a new voice session from user: ${params.userIdentifier || 'unknown'}.`);

        const payload: SessionPayload = { user: params.userIdentifier || 'anonymous' };
        const sessionToken = generateSessionToken(payload, '1m');

        // --- CHANGE 2: Dynamically create the production-ready WebSocket URL ---
        // This ensures the URL is correct for any environment.
        const publicUrlObject = new URL(PUBLIC_URL);
        // If the public URL is https, use wss (WebSocket Secure). Otherwise, use ws.
        const wsProtocol = publicUrlObject.protocol === 'https:' ? 'wss:' : 'ws:';
        // Construct the final URL with the correct protocol and public hostname.
        const productionWebsocketUrl = `${wsProtocol}//${publicUrlObject.host}/proxy`;
        // --------------------------------------------------------------------

        return {
            sessionToken: sessionToken,
            // --- CHANGE 3: Return the correct public URL to the client ---
            websocketUrl: productionWebsocketUrl,
            durationSeconds: 180,
        };
    },
    {
        price: 0.0001,
    }
);

// 3. Start the server and attach the WebSocket server
const startServer = async () => {
    try {
        // Call start() which registers AND starts the HTTP server.
        // It returns the running server instance.
        const httpServer = await x402Provider.start();

        // Now, create the WebSocketServer and attach it to the SAME server instance.
        const wss = new WebSocketServer({ server: httpServer, path: '/proxy' });

        // Handle new WebSocket connections
        wss.on('connection', handleProxyConnection);

        // This log message is for your server's console, so using localhost here is
        // perfectly fine and helpful for seeing the local port.
        console.log(`🔊 WebSocket Proxy is attached and listening on ws://localhost:${PORT}/proxy`);

    } catch (error) {
        console.error("Failed to start provider server:", error);
    }
};

startServer();