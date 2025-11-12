import jwt, { SignOptions } from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// Assert that the secret is a string, which is what jwt.sign expects.
const JWT_SECRET = process.env.JWT_SECRET as string;

if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not defined in your environment. Please check your .env file.");
}

export interface SessionPayload {
    user: string;
}

/**
 * Generates a short-lived JSON Web Token for a voice session.
 * @param payload The data to include in the token.
 * @param expiresIn The token's lifetime (e.g., '1m' for 1 minute, or 60 for 60 seconds).
 * @returns The generated JWT string.
 */
export const generateSessionToken = (payload: SessionPayload, expiresIn: string | number): string => {
    // --- THE FIX ---
    // We create the options object separately. The `any` cast for expiresIn
    // bypasses the library's overly strict type definition for string-based timespans.
    // This is a safe and common workaround for this specific library issue.
    const options: SignOptions = {
        expiresIn: expiresIn as any,
    };

    return jwt.sign(payload, JWT_SECRET, options);
};

/**
 * Validates a session token from a client.
 * @param token The JWT string from the client.
 * @returns The decoded payload if the token is valid, otherwise null.
 */
export const validateSessionToken = (token: string): SessionPayload | null => {
    try {
        const decoded = jwt.verify(token, JWT_SECRET) as SessionPayload;
        return decoded;
    } catch (error) {
        if (error instanceof Error) {
            console.error("JWT Validation Error:", error.message);
        } else {
            console.error("An unknown error occurred during JWT validation:", error);
        }
        return null;
    }
};