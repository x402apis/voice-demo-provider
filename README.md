<!-- @format -->

---

### 2. README for the `voice-demo-provider` Repo

This is the specific README for the provider node.

````markdown
# x402 Voice Agent Provider

[![x402 Protocol](https://img.shields.io/badge/Built%20with-%40x402apis%2Fnode-blue.svg)](https://github.com/x402-apis/x402-router-node)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

This repository contains the server-side **Provider Node** for the x402 Voice Agent Demo.

Its purpose is to act as a decentralized bridge between the Web3 and Web2 worlds. It gets paid in SOL via the x402 protocol and uses those funds to pay for a traditional Web2 service (Deepgram's AI Agent API) on behalf of the user.

This node is built using the [`@x402apis/node`](https://github.com/x402-apis/x402-router-node) library, which handles the core logic of wallet management, registry communication, and payment processing.

## Core Functionality

1.  **Registers API:** On startup, the server registers the `deepgram.agent.createSession` API with the central x402 Registry, making it discoverable by clients.
2.  **Accepts Payments:** It listens for incoming requests from the x402 network, automatically verifying on-chain payments from clients.
3.  **Bridges to Deepgram:** Upon successful payment, it uses its own private Deepgram API key to create a new AI agent session.
4.  **Proxies Real-time Audio:** It establishes a WebSocket connection between the end-user and Deepgram, securely proxying the real-time audio stream for the duration of the paid session.

## How It Works

This provider is the "missing link" that allows a Web3 user to access a Web2 service without an account or credit card.

![Provider Flow](./docs/provider-flow.png)
_(**Note:** You can create a simple diagram for this and add it to a `/docs` folder.)_

1.  **Request Received:** The `@x402apis/node` server receives an authenticated request from a client who has already paid.
2.  **Session Generation:** The `server.ts` logic calls the `deepgram.agent.createSession` handler. This handler generates a short-lived session token.
3.  **Return URLs:** The provider returns the `sessionToken` and its own public `websocketUrl` to the client.
4.  **WebSocket Proxy:** The client connects to the provider's WebSocket (`proxy.ts`). The provider validates the session token and then establishes a second, outbound WebSocket connection to Deepgram, streaming data between the two.

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/en/) (v18 or later)
- [npm](https://www.npmjs.com/) (included with Node.js)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools)
- A [Deepgram](https://deepgram.com/) account with an API key.

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/x402-apis/voice-demo-provider.git
cd voice-demo-provider

# Install dependencies
npm install
```
````
