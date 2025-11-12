import { createProviderServer } from '@x402apis/node';
import { WebSocketServer } from 'ws';
import { handleProxyConnection } from './proxy';
import { generateSessionToken, SessionPayload } from './auth'; // Assuming SessionPayload is exported
import dotenv from 'dotenv';
import cors from 'cors'; // --- NEW: Import the cors middleware ---
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

// 1. Create the x402 Provider Server instance
const x402Provider = createProviderServer({
    wallet: './wallet.json',
    publicUrl: "https://voice-demo-provider-production.up.railway.app",
    port: Number(PORT),
    registry: 'https://x402apis.io/api'
});

// --- NEW: Configure and use the CORS middleware ---
const app = x402Provider.getExpressApp();
app.use(cors({
    origin: 'http://localhost:3001' // Allow requests ONLY from your client UI
}));
// -------------------------------------------------

// 2. Define the API endpoint
x402Provider.addAPI(
    'deepgram.agent.createSession',
    async (params: { userIdentifier?: string }) => {
        console.log(`Payment received for a new voice session from user: ${params.userIdentifier || 'unknown'}.`);

        const payload: SessionPayload = { user: params.userIdentifier || 'anonymous' };
        const sessionToken = generateSessionToken(payload, '1m');

        return {
            sessionToken: sessionToken,
            websocketUrl: `ws://localhost:${PORT}/proxy`,
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
        // --- THE CLEAN SOLUTION ---
        // Call start() which registers AND starts the HTTP server.
        // It returns the running server instance.
        const httpServer = await x402Provider.start();

        // Now, create the WebSocketServer and attach it to the SAME server instance.
        const wss = new WebSocketServer({ server: httpServer, path: '/proxy' });

        // Handle new WebSocket connections
        wss.on('connection', handleProxyConnection);

        console.log(`🔊 WebSocket Proxy is attached and listening on ws://localhost:${PORT}/proxy`);

    } catch (error) {
        console.error("Failed to start provider server:", error);
    }
};

startServer();