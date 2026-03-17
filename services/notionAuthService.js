import {
  discoverOAuthServerInfo,
  exchangeAuthorization,
  refreshAuthorization,
  registerClient,
  startAuthorization
} from "@modelcontextprotocol/sdk/client/auth.js";
import { getAppConfig } from "../config/appConfig.js";
import { findUserById } from "./userService.js";
import {
  findUserIdByOAuthState,
  getNotionAuthSnapshot,
  PersistentNotionOAuthProvider
} from "./notionOAuthProvider.js";

function getResourceUrl() {
  const config = getAppConfig();
  return new URL(config.notion.mcpServerUrl);
}

function normalizeExpiry(tokens) {
  if (!tokens) {
    return null;
  }

  if (tokens.expires_at) {
    return new Date(tokens.expires_at).toISOString();
  }

  if (tokens.expires_in) {
    return new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  }

  return null;
}

function hasNotionTargetConfig(user) {
  return Boolean(user?.notion?.targetId);
}

export async function beginNotionOAuthFlow(userId) {
  const provider = new PersistentNotionOAuthProvider(userId);
  const resourceUrl = getResourceUrl();
  const discovery = await discoverOAuthServerInfo(resourceUrl);

  if (provider.saveDiscoveryState) {
    await provider.saveDiscoveryState(discovery);
  }

  let clientInformation = await provider.clientInformation();

  if (!clientInformation) {
    clientInformation = await registerClient(discovery.authorizationServerUrl, {
      metadata: discovery.authorizationServerMetadata,
      clientMetadata: provider.clientMetadata
    });

    await provider.saveClientInformation(clientInformation);
  }

  const state = await provider.state();
  const { authorizationUrl, codeVerifier } = await startAuthorization(
    discovery.authorizationServerUrl,
    {
      metadata: discovery.authorizationServerMetadata,
      clientInformation,
      redirectUrl: provider.redirectUrl,
      state,
      resource: resourceUrl
    }
  );

  await provider.saveCodeVerifier(codeVerifier);

  return {
    authorizationUrl: authorizationUrl.toString(),
    state
  };
}

export async function completeNotionOAuthFlow({ code, state }) {
  const userId = await findUserIdByOAuthState(state);

  if (!userId) {
    throw new Error("Invalid OAuth state for Notion MCP callback");
  }

  const provider = new PersistentNotionOAuthProvider(userId);
  const snapshot = await getNotionAuthSnapshot(userId);

  if (!snapshot.discovery?.authorizationServerUrl) {
    throw new Error("Missing OAuth discovery state for Notion MCP callback");
  }

  const clientInformation = await provider.clientInformation();

  if (!clientInformation) {
    throw new Error("Missing registered OAuth client information");
  }

  const tokens = await exchangeAuthorization(snapshot.discovery.authorizationServerUrl, {
    metadata: snapshot.discovery.authorizationServerMetadata,
    clientInformation,
    authorizationCode: code,
    codeVerifier: await provider.codeVerifier(),
    redirectUri: provider.redirectUrl,
    resource: getResourceUrl()
  });

  await provider.saveTokens(tokens);
  await provider.invalidateCredentials("verifier");

  return {
    connected: true,
    expiresAt: normalizeExpiry(tokens),
    userId
  };
}

export async function ensureFreshNotionTokens(userId) {
  const provider = new PersistentNotionOAuthProvider(userId);
  const snapshot = await getNotionAuthSnapshot(userId);
  const tokens = snapshot.tokens;
  const clientInformation = await provider.clientInformation();

  if (!tokens || !clientInformation) {
    return null;
  }

  if (!tokens.refresh_token) {
    return tokens;
  }

  const expiresAt = normalizeExpiry(tokens);

  if (!expiresAt || Date.now() < new Date(expiresAt).getTime() - 60_000) {
    return tokens;
  }

  if (!snapshot.discovery?.authorizationServerUrl) {
    return tokens;
  }

  try {
    const refreshed = await refreshAuthorization(snapshot.discovery.authorizationServerUrl, {
      metadata: snapshot.discovery.authorizationServerMetadata,
      clientInformation,
      refreshToken: tokens.refresh_token,
      resource: getResourceUrl()
    });

    await provider.saveTokens(refreshed);
    return refreshed;
  } catch (error) {
    await provider.invalidateCredentials("tokens");
    throw error;
  }
}

export async function getNotionConnectionStatus(userId) {
  const config = getAppConfig();
  const snapshot = await getNotionAuthSnapshot(userId);
  const tokens = snapshot.tokens;
  const clientInformation = snapshot.clientInformation;
  const user = await findUserById(userId);
  const expiresAt = normalizeExpiry(tokens);

  return {
    connected: Boolean(tokens?.access_token),
    configured: Boolean(config.security.hasEncryptionKey && hasNotionTargetConfig(user)),
    mcpServerUrl: config.notion.mcpServerUrl,
    hasClientRegistration: Boolean(clientInformation?.client_id),
    notionTarget: user?.notion || null,
    expiresAt,
    updatedAt: snapshot.updatedAt
  };
}

export async function disconnectNotion(userId) {
  const provider = new PersistentNotionOAuthProvider(userId);
  await provider.invalidateCredentials("all");
}
