// Stateless pass-through CORS proxy for DhanHQ v2 REST APIs
// Credentials (access-token & client-id) remain strictly on the user's device and are never stored.

const DHAN_API_BASE = 'https://api.dhan.co/v2';

exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, access-token, client-id',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      },
      body: '',
    };
  }

  try {
    // Extract target Dhan API path after /api/dhan/ or /.netlify/functions/dhan-proxy/
    const rawPath = event.path || '';
    const subPath = rawPath
      .replace(/^\/\.netlify\/functions\/dhan-proxy/, '')
      .replace(/^\/api\/dhan/, '');

    const targetUrl = `${DHAN_API_BASE}${subPath.startsWith('/') ? subPath : '/' + subPath}`;

    const headers = {
      'Content-Type': 'application/json',
    };

    const accessToken = event.headers['access-token'] || event.headers['Access-Token'];
    const clientId = event.headers['client-id'] || event.headers['Client-Id'];

    if (accessToken) headers['access-token'] = accessToken;
    if (clientId) headers['client-id'] = clientId;

    const fetchOptions = {
      method: event.httpMethod,
      headers,
    };

    if (event.body && !['GET', 'HEAD'].includes(event.httpMethod)) {
      fetchOptions.body = event.body;
    }

    const response = await fetch(targetUrl, fetchOptions);
    const responseText = await response.text();

    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
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
