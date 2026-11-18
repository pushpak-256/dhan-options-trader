// Stateless pass-through CORS proxy for DhanHQ v2 REST & OAuth Consent APIs
// Credentials (access-token, client-id, app_id, app_secret) remain strictly on the user's device and are never stored.

const DHAN_API_BASE = 'https://api.dhan.co/v2';
const DHAN_AUTH_BASE = 'https://auth.dhan.co';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, access-token, client-id, app_id, app_secret',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

function getHeader(headers, targetName) {
  if (!headers) return undefined;
  const lowerTarget = targetName.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerTarget) {
      return value;
    }
  }
  return undefined;
}

function buildQueryString(event) {
  if (typeof event.rawQuery === 'string' && event.rawQuery.length > 0) {
    return `?${event.rawQuery}`;
  }
  if (event.queryStringParameters && Object.keys(event.queryStringParameters).length > 0) {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(event.queryStringParameters)) {
      if (val !== undefined && val !== null) {
        params.append(key, String(val));
      }
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }
  return '';
}

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  try {
    const rawPath = event.path || '';
    const isAuthRoute =
      rawPath.startsWith('/api/dhan-auth') ||
      rawPath.startsWith('/.netlify/functions/dhan-proxy/auth');

    const subPath = isAuthRoute
      ? rawPath
          .replace(/^\/\.netlify\/functions\/dhan-proxy\/auth/, '')
          .replace(/^\/api\/dhan-auth/, '')
      : rawPath
          .replace(/^\/\.netlify\/functions\/dhan-proxy/, '')
          .replace(/^\/api\/dhan/, '');

    const normalizedSubPath = subPath.startsWith('/') ? subPath : `/${subPath}`;
    const baseUrl = isAuthRoute ? DHAN_AUTH_BASE : DHAN_API_BASE;
    const queryString = buildQueryString(event);
    const targetUrl = `${baseUrl}${normalizedSubPath}${queryString}`;

    const headers = {
      'Content-Type': 'application/json',
    };

    const accessToken = getHeader(event.headers, 'access-token');
    const clientId = getHeader(event.headers, 'client-id');
    const appId = getHeader(event.headers, 'app_id');
    const appSecret = getHeader(event.headers, 'app_secret');

    if (accessToken) headers['access-token'] = accessToken;
    if (clientId) headers['client-id'] = clientId;
    if (appId) headers['app_id'] = appId;
    if (appSecret) headers['app_secret'] = appSecret;

    const fetchOptions = {
      method: event.httpMethod,
      headers,
    };

    if (event.body && !['GET', 'HEAD'].includes(event.httpMethod)) {
      fetchOptions.body = event.body;
    }

    const response = await fetch(targetUrl, fetchOptions);
    const responseText = await response.text();
    const contentType = response.headers.get('content-type') || 'application/json';

    return {
      statusCode: response.status,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
      },
      body: responseText,
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: 'Proxy error', message: err.message }),
    };
  }
};
