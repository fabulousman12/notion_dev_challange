import crypto from "crypto";
import { getAppConfig } from "../config/appConfig.js";
import {
  clearEncryptedAuthStates,
  readEncryptedAuthStates,
  writeEncryptedAuthStates
} from "./secureStore.js";

function createDefaultState() {
  return {
    clientInformation: null,
    tokens: null,
    codeVerifier: null,
    oauthState: null,
    discovery: null,
    updatedAt: null
  };
}

async function readUserAuthState(userId) {
  const allStates = await readEncryptedAuthStates();
  return allStates[userId] || createDefaultState();
}

async function writeUserAuthState(userId, nextState) {
  const allStates = await readEncryptedAuthStates();
  allStates[userId] = nextState;
  await writeEncryptedAuthStates(allStates);
}

export class PersistentNotionOAuthProvider {
  constructor(userId, { onRedirect } = {}) {
    this.userId = userId;
    this.config = getAppConfig();
    this.onRedirect = onRedirect;
  }

  get redirectUrl() {
    return `${this.config.appBaseUrl}/api/notion/callback`;
  }

  get clientMetadata() {
    return {
      client_name: `${this.config.appName} (${this.userId})`,
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    };
  }

  async state() {
    const oauthState = crypto.randomBytes(24).toString("hex");
    const current = await readUserAuthState(this.userId);
    current.oauthState = oauthState;
    current.updatedAt = new Date().toISOString();
    await writeUserAuthState(this.userId, current);
    return oauthState;
  }

  async clientInformation() {
    const state = await readUserAuthState(this.userId);
    return state.clientInformation || undefined;
  }

  async saveClientInformation(clientInformation) {
    const state = await readUserAuthState(this.userId);
    state.clientInformation = clientInformation;
    state.updatedAt = new Date().toISOString();
    await writeUserAuthState(this.userId, state);
  }

  async tokens() {
    const state = await readUserAuthState(this.userId);
    return state.tokens || undefined;
  }

  async saveTokens(tokens) {
    const state = await readUserAuthState(this.userId);
    state.tokens = tokens;
    state.updatedAt = new Date().toISOString();
    await writeUserAuthState(this.userId, state);
  }

  async redirectToAuthorization(authorizationUrl) {
    if (this.onRedirect) {
      await this.onRedirect(authorizationUrl);
    }
  }

  async saveCodeVerifier(codeVerifier) {
    const state = await readUserAuthState(this.userId);
    state.codeVerifier = codeVerifier;
    state.updatedAt = new Date().toISOString();
    await writeUserAuthState(this.userId, state);
  }

  async codeVerifier() {
    const state = await readUserAuthState(this.userId);

    if (!state.codeVerifier) {
      throw new Error("Missing PKCE code verifier for Notion OAuth flow");
    }

    return state.codeVerifier;
  }

  async saveDiscoveryState(discoveryState) {
    const state = await readUserAuthState(this.userId);
    state.discovery = discoveryState;
    state.updatedAt = new Date().toISOString();
    await writeUserAuthState(this.userId, state);
  }

  async discoveryState() {
    const state = await readUserAuthState(this.userId);
    return state.discovery || undefined;
  }

  async invalidateCredentials(scope = "all") {
    if (scope === "all") {
      const allStates = await readEncryptedAuthStates();
      delete allStates[this.userId];

      if (Object.keys(allStates).length === 0) {
        await clearEncryptedAuthStates();
      } else {
        await writeEncryptedAuthStates(allStates);
      }
      return;
    }

    const state = await readUserAuthState(this.userId);

    if (scope === "tokens") {
      state.tokens = null;
    }

    if (scope === "client") {
      state.clientInformation = null;
    }

    if (scope === "verifier") {
      state.codeVerifier = null;
      state.oauthState = null;
    }

    if (scope === "discovery") {
      state.discovery = null;
    }

    state.updatedAt = new Date().toISOString();
    await writeUserAuthState(this.userId, state);
  }
}

export async function getNotionAuthSnapshot(userId) {
  return readUserAuthState(userId);
}

export async function findUserIdByOAuthState(oauthState) {
  const allStates = await readEncryptedAuthStates();
  const match = Object.entries(allStates).find(([, state]) => state?.oauthState === oauthState);
  return match?.[0] || null;
}
