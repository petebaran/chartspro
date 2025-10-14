// Capital.com API Proxy for CC Charts Pro Figma Plugin
// Handles session management and proxies requests to Capital.com API

// Using DEMO API - switch to live API when ready
const CAPITAL_API_BASE = 'https://demo-api-capital.backend-capital.com';
const API_KEY = 'sP6oTAnyrvt6lHjl';
const IDENTIFIER = 'petebaran@proton.me'; // Your Capital.com login email - UPDATE THIS!
const PASSWORD = 'wtp7fhz2epd@RWY.qzm';

// Session cache with timestamp
let sessionCache = {
  token: null,
  cst: null,
  securityToken: null,
  expiresAt: 0
};

async function createSession() {
  try {
    // Create session with simple password authentication
    const sessionResponse = await fetch(`${CAPITAL_API_BASE}/api/v1/session`, {
      method: 'POST',
      headers: {
        'X-CAP-API-KEY': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        identifier: IDENTIFIER,
        password: PASSWORD,
        encryptedPassword: false
      })
    });

    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text();
      throw new Error(`Session creation failed: ${sessionResponse.status} - ${errorText}`);
    }

    // Extract security headers
    const cst = sessionResponse.headers.get('CST');
    const securityToken = sessionResponse.headers.get('X-SECURITY-TOKEN');

    if (!cst || !securityToken) {
      throw new Error('Missing security tokens in session response');
    }

    // Cache session (valid for 10 minutes, we'll refresh after 9)
    sessionCache = {
      cst,
      securityToken,
      expiresAt: Date.now() + (9 * 60 * 1000) // 9 minutes
    };

    return sessionCache;
  } catch (error) {
    console.error('Session creation error:', error);
    throw error;
  }
}

async function getValidSession() {
  // Check if we have a valid cached session
  if (sessionCache.cst && sessionCache.expiresAt > Date.now()) {
    return sessionCache;
  }

  // Create new session
  return await createSession();
}

async function fetchMarketData(epic, resolution, from, to) {
  const session = await getValidSession();

  const url = new URL(`${CAPITAL_API_BASE}/api/v1/prices/${epic}`);
  url.searchParams.append('resolution', resolution);

  // Convert ISO dates to Capital.com format (YYYY-MM-DDTHH:mm:ss without milliseconds)
  if (from) {
    const cleanFrom = from.replace(/\.\d{3}Z$/, '');
    url.searchParams.append('from', cleanFrom);
  }
  if (to) {
    const cleanTo = to.replace(/\.\d{3}Z$/, '');
    url.searchParams.append('to', cleanTo);
  }

  url.searchParams.append('max', '1000');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-CAP-API-KEY': API_KEY,
      'CST': session.cst,
      'X-SECURITY-TOKEN': session.securityToken,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Market data request failed: ${response.status} - ${errorText}`);
  }

  return await response.json();
}

async function searchMarkets(searchTerm) {
  const session = await getValidSession();

  const url = new URL(`${CAPITAL_API_BASE}/api/v1/markets`);
  if (searchTerm) {
    url.searchParams.append('searchTerm', searchTerm);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'X-CAP-API-KEY': API_KEY,
      'CST': session.cst,
      'X-SECURITY-TOKEN': session.securityToken,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    throw new Error(`Markets search failed: ${response.status}`);
  }

  return await response.json();
}

// Convert Capital.com data format to Yahoo Finance-compatible format
function convertToYahooFormat(capitalData, epic) {
  const timestamps = [];
  const opens = [];
  const highs = [];
  const lows = [];
  const closes = [];
  const volumes = [];

  if (capitalData.prices) {
    capitalData.prices.forEach(price => {
      // Capital.com timestamp format: "2024-10-14T10:00:00"
      const timestamp = Math.floor(new Date(price.snapshotTime || price.snapshotTimeUTC).getTime() / 1000);
      timestamps.push(timestamp);
      opens.push(price.openPrice?.bid || price.openPrice?.ask || 0);
      highs.push(price.highPrice?.bid || price.highPrice?.ask || 0);
      lows.push(price.lowPrice?.bid || price.lowPrice?.ask || 0);
      closes.push(price.closePrice?.bid || price.closePrice?.ask || 0);
      volumes.push(price.lastTradedVolume || 0);
    });
  }

  return {
    chart: {
      result: [{
        meta: {
          symbol: epic,
          currency: 'USD',
          exchangeName: 'Capital.com'
        },
        timestamp: timestamps,
        indicators: {
          quote: [{
            open: opens,
            high: highs,
            low: lows,
            close: closes,
            volume: volumes
          }]
        }
      }]
    }
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Main endpoint: /chart?epic=SYMBOL&resolution=DAY&from=timestamp&to=timestamp
      if (url.pathname === '/' || url.pathname === '/chart') {
        const epic = url.searchParams.get('epic') || url.searchParams.get('symbol');
        const resolution = url.searchParams.get('resolution') || 'DAY';
        const from = url.searchParams.get('from');
        const to = url.searchParams.get('to');

        if (!epic) {
          return new Response(JSON.stringify({ error: 'Missing epic/symbol parameter' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        }

        const capitalData = await fetchMarketData(epic, resolution, from, to);
        const yahooFormat = convertToYahooFormat(capitalData, epic);

        return new Response(JSON.stringify(yahooFormat), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Search endpoint: /search?term=AAPL
      if (url.pathname === '/search') {
        const term = url.searchParams.get('term');
        const markets = await searchMarkets(term);

        return new Response(JSON.stringify(markets), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response('Not Found', { status: 404, headers: corsHeaders });
    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({
        error: error.message,
        details: error.stack
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};
