import { Platform } from 'react-native';
import axios from 'axios';
import { DhanAppConfig } from '../types/dhan';
import { StorageService } from './storage';

export interface GenerateConsentResult {
  consentAppId: string;
  loginUrl: string;
}

export interface ConsumeConsentResult {
  dhanClientId: string;
  dhanClientName: string;
  accessToken: string;
  expiryTime?: string;
}

function getDhanAuthBaseUrl(): string {
  // On deployed Netlify PWA, route via /api/dhan-auth proxy to avoid browser CORS blocks.
  // On localhost, GitHub Pages, or native iOS/Android APK, connect directly to auth.dhan.co.
  if (
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    window.location?.hostname &&
    !window.location.hostname.includes('localhost') &&
    !window.location.hostname.includes('127.0.0.1') &&
    !window.location.hostname.includes('github.io')
  ) {
    return '/api/dhan-auth';
  }
  return 'https://auth.dhan.co';
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, '%20'));
  } catch {
    return value;
  }
}

function extractTokenFromParamString(paramStr: string): string | null {
  if (!paramStr) return null;
  const cleaned = paramStr.replace(/^[?#]+/, '');
  if (!cleaned) return null;

  const pairs = cleaned.split('&');
  for (const pair of pairs) {
    if (!pair) continue;
    const eqIdx = pair.indexOf('=');
    if (eqIdx <= 0) continue;
    const rawKey = safeDecode(pair.slice(0, eqIdx)).trim().toLowerCase();
    if (rawKey === 'tokenid' || rawKey === 'token_id') {
      const rawVal = pair.slice(eqIdx + 1);
      const decoded = safeDecode(rawVal).trim();
      if (decoded.length > 0) {
        return decoded;
      }
    }
  }
  return null;
}

export class DhanAuthService {
  /**
   * Builds the official DhanHQ OAuth consent login URL for browser/WebView redirect.
   */
  static getLoginUrl(consentAppId: string): string {
    return `https://auth.dhan.co/login/consentApp-login?consentAppId=${encodeURIComponent(
      (consentAppId || '').trim()
    )}`;
  }

  /**
   * Robustly extracts `tokenId` (case-insensitive `tokenId` / `token_id`) from query string
   * or hash fragment of any http/https/custom-scheme redirect URL without throwing on malformed URLs.
   */
  static extractTokenIdFromUrl(url: string): string | null {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (!trimmed) return null;

    // 1. Try standard URL parsing first (works for http, https, custom schemes like dhantrader://)
    try {
      const parsed = new URL(trimmed);
      if (parsed.search) {
        const fromSearch = extractTokenFromParamString(parsed.search);
        if (fromSearch) return fromSearch;
      }
      if (parsed.hash) {
        const hashBody = parsed.hash.replace(/^#/, '');
        const hashQueryIdx = hashBody.indexOf('?');
        const fromHashQuery =
          hashQueryIdx >= 0 ? extractTokenFromParamString(hashBody.slice(hashQueryIdx + 1)) : null;
        if (fromHashQuery) return fromHashQuery;

        const fromHashParams = extractTokenFromParamString(hashBody);
        if (fromHashParams) return fromHashParams;
      }
    } catch {
      // Malformed or relative URL — fall through to manual segment extraction
    }

    // 2. Manual fallback for malformed / relative URLs (e.g. "?tokenId=abc" or "#/auth?tokenId=abc")
    try {
      const hashIdx = trimmed.indexOf('#');
      const beforeHash = hashIdx >= 0 ? trimmed.slice(0, hashIdx) : trimmed;
      const hashPart = hashIdx >= 0 ? trimmed.slice(hashIdx + 1) : '';

      const qIdx = beforeHash.indexOf('?');
      if (qIdx >= 0) {
        const fromQuery = extractTokenFromParamString(beforeHash.slice(qIdx + 1));
        if (fromQuery) return fromQuery;
      }

      if (hashPart) {
        const hqIdx = hashPart.indexOf('?');
        if (hqIdx >= 0) {
          const fromHashQ = extractTokenFromParamString(hashPart.slice(hqIdx + 1));
          if (fromHashQ) return fromHashQ;
        }
        const fromHash = extractTokenFromParamString(hashPart);
        if (fromHash) return fromHash;
      }
    } catch {
      return null;
    }

    return null;
  }

  /**
   * Step 1 of DhanHQ OAuth Consent flow:
   * Requests a short-lived `consentAppId` and returns the browser/WebView `loginUrl`.
   */
  static async generateConsent(overrideConfig?: DhanAppConfig): Promise<GenerateConsentResult> {
    const cfg = overrideConfig || (await StorageService.getAppConfig());
    const clientId = (cfg?.clientId || '').trim();
    const appId = (cfg?.appId || '').trim();
    const appSecret = (cfg?.appSecret || '').trim();

    if (!clientId || !appId || !appSecret) {
      throw new Error(
        'Missing Dhan App Config. Enter your Client ID, API Key (App ID), and API Secret first.'
      );
    }

    const baseUrl = getDhanAuthBaseUrl();
    try {
      const res = await axios.post(
        `${baseUrl}/app/generate-consent?client_id=${encodeURIComponent(clientId)}`,
        {},
        {
          headers: {
            app_id: appId,
            app_secret: appSecret,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      const payload = res.data?.data ?? res.data ?? {};
      const consentAppId = String(payload.consentAppId || '').trim();

      if (!consentAppId) {
        throw new Error(
          payload.errorMessage ||
            payload.message ||
            'Dhan did not return a valid consentAppId. Verify your Client ID, API Key, and API Secret.'
        );
      }

      return {
        consentAppId,
        loginUrl: this.getLoginUrl(consentAppId),
      };
    } catch (err: any) {
      const brokerMsg =
        err?.response?.data?.errorMessage ||
        err?.response?.data?.internalErrorMessage ||
        err?.response?.data?.message ||
        err?.message;
      throw new Error(
        brokerMsg || 'Failed to initiate Dhan 1-Tap Login. Check network and API App credentials.'
      );
    }
  }

  /**
   * Step 2 of DhanHQ OAuth Consent flow:
   * Exchanges the captured `tokenId` for a live 24-hour `accessToken` and persists credentials.
   */
  static async consumeConsent(
    tokenId: string,
    overrideConfig?: DhanAppConfig
  ): Promise<ConsumeConsentResult> {
    const cleanTokenId = (tokenId || '').trim();
    if (!cleanTokenId) {
      throw new Error('Missing tokenId from Dhan login redirect.');
    }

    const cfg = overrideConfig || (await StorageService.getAppConfig());
    const appId = (cfg?.appId || '').trim();
    const appSecret = (cfg?.appSecret || '').trim();

    if (!appId || !appSecret) {
      throw new Error(
        'Dhan API Key (App ID) and API Secret are not saved yet. Configure them in Account settings first.'
      );
    }

    const baseUrl = getDhanAuthBaseUrl();
    try {
      const res = await axios.post(
        `${baseUrl}/app/consumeApp-consent?tokenId=${encodeURIComponent(cleanTokenId)}`,
        {},
        {
          headers: {
            app_id: appId,
            app_secret: appSecret,
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      const payload = res.data?.data ?? res.data ?? {};
      const accessToken = String(payload.accessToken || payload.access_token || '').trim();
      const dhanClientId = String(
        payload.dhanClientId || payload.clientId || cfg?.clientId || ''
      ).trim();
      const dhanClientName = String(
        payload.dhanClientName || payload.clientName || ''
      ).trim();
      const expiryTime: string | undefined =
        payload.expiryTime || payload.tokenValidity || undefined;

      if (!accessToken) {
        throw new Error(
          payload.errorMessage ||
            payload.message ||
            'Dhan login exchange did not return an accessToken. The tokenId may have expired — please retry login.'
        );
      }

      await StorageService.saveCredentials({
        clientId: dhanClientId || (cfg?.clientId || '').trim(),
        accessToken,
        expiryTime,
        clientName: dhanClientName || undefined,
        isDemoMode: false,
      });

      return {
        dhanClientId,
        dhanClientName,
        accessToken,
        expiryTime,
      };
    } catch (err: any) {
      const brokerMsg =
        err?.response?.data?.errorMessage ||
        err?.response?.data?.internalErrorMessage ||
        err?.response?.data?.message ||
        err?.message;
      throw new Error(
        brokerMsg || 'Failed to complete Dhan login exchange. Please try logging in again.'
      );
    }
  }

  /**
   * Safely checks whether a saved session's `expiryTime` is still in the future.
   */
  static isSessionValid(expiryTime?: string): boolean {
    if (!expiryTime || typeof expiryTime !== 'string') return false;
    const trimmed = expiryTime.trim();
    if (!trimmed) return false;

    let parsedMs = Date.parse(trimmed);

    // Handle DhanHQ formats like "2026-11-19 08:00:00" or "19-11-2026 08:00"
    if (!Number.isFinite(parsedMs)) {
      const ymdSpace = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)$/);
      if (ymdSpace) {
        parsedMs = Date.parse(`${ymdSpace[1]}-${ymdSpace[2]}-${ymdSpace[3]}T${ymdSpace[4]}`);
      } else {
        const dmySpace = trimmed.match(/^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}:\d{2}(?::\d{2})?)$/);
        if (dmySpace) {
          parsedMs = Date.parse(`${dmySpace[3]}-${dmySpace[2]}-${dmySpace[1]}T${dmySpace[4]}`);
        }
      }
    }

    return Number.isFinite(parsedMs) && parsedMs > Date.now();
  }
}
