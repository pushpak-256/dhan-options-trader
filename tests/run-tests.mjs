#!/usr/bin/env node
/**
 * Automated Test Suite for Dhan Options Trader
 * Covers:
 *   (a) DhanHQ v2 Binary WebSocket Decoder & Live/Demo Subscription Protocol
 *   (b) DhanHQ v2 Option Chain & Positions Parser
 *   (c) Compliance Engine (all risk & behavioral rules)
 *   (d) AutoSquareOffEngine Kill Switch (breach, square-off, lock, single-fire, concurrency)
 *   (e) Technical Indicators (calculateVWAP, calculateEMA)
 *   (f) InteractiveChart HTML / Embedded JS Integrity, XSS Escaping, KLineChart v9 CDN & Handlers
 *   (g) Live Local App Verification (http://localhost:8081 HTTP + Metro bundle + Headless Chrome CDP)
 *
 * Run: node tests/run-tests.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// ============================================================================
// 1. Lightweight TypeScript Loader + Deterministic In-Memory Mocks
// ============================================================================
const Module = require('node:module');
const ts = require(path.join(ROOT_DIR, 'node_modules', 'typescript'));

const asyncStorageMap = new Map();
const mockAsyncStorage = {
  async getItem(key) {
    return asyncStorageMap.has(key) ? asyncStorageMap.get(key) : null;
  },
  async setItem(key, value) {
    asyncStorageMap.set(key, String(value));
  },
  async removeItem(key) {
    asyncStorageMap.delete(key);
  },
  async clear() {
    asyncStorageMap.clear();
  },
  _reset() {
    asyncStorageMap.clear();
  },
};

const mockPlatform = { OS: 'android' };

// Controllable mock Axios adapter for live-mode DhanApiService unit tests
const axiosMockState = {
  getHandler: async (url) => {
    throw new Error(`Unhandled mock GET ${url}`);
  },
  postHandler: async (url, body) => {
    throw new Error(`Unhandled mock POST ${url}`);
  },
  putHandler: async (url, body) => {
    throw new Error(`Unhandled mock PUT ${url}`);
  },
  deleteHandler: async (url) => {
    throw new Error(`Unhandled mock DELETE ${url}`);
  },
  lastCreateConfig: null,
  calls: [],
  reset() {
    this.calls = [];
    this.lastCreateConfig = null;
    this.getHandler = async (url) => {
      throw new Error(`Unhandled mock GET ${url}`);
    };
    this.postHandler = async (url, body) => {
      throw new Error(`Unhandled mock POST ${url}`);
    };
    this.putHandler = async (url, body) => {
      throw new Error(`Unhandled mock PUT ${url}`);
    };
    this.deleteHandler = async (url) => {
      throw new Error(`Unhandled mock DELETE ${url}`);
    };
  },
};

const mockAxios = {
  async get(url, cfg) {
    axiosMockState.calls.push({ method: 'GET', url, cfg });
    return axiosMockState.getHandler(url, cfg);
  },
  async post(url, body, cfg) {
    axiosMockState.calls.push({ method: 'POST', url, body, cfg });
    return axiosMockState.postHandler(url, body, cfg);
  },
  async put(url, body, cfg) {
    axiosMockState.calls.push({ method: 'PUT', url, body, cfg });
    return axiosMockState.putHandler(url, body, cfg);
  },
  async delete(url, cfg) {
    axiosMockState.calls.push({ method: 'DELETE', url, cfg });
    return axiosMockState.deleteHandler(url, cfg);
  },
  create(config) {
    axiosMockState.lastCreateConfig = config;
    return {
      async get(url, cfg) {
        axiosMockState.calls.push({ method: 'GET', url, cfg });
        return axiosMockState.getHandler(url, cfg);
      },
      async post(url, body, cfg) {
        axiosMockState.calls.push({ method: 'POST', url, body, cfg });
        return axiosMockState.postHandler(url, body, cfg);
      },
      async put(url, body, cfg) {
        axiosMockState.calls.push({ method: 'PUT', url, body, cfg });
        return axiosMockState.putHandler(url, body, cfg);
      },
      async delete(url, cfg) {
        axiosMockState.calls.push({ method: 'DELETE', url, cfg });
        return axiosMockState.deleteHandler(url, cfg);
      },
    };
  },
};

// Hook Module._resolveFilename and Module._load for src/**/*.ts
const origResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (
    request === 'react-native' ||
    request === '@react-native-async-storage/async-storage' ||
    request === 'axios'
  ) {
    return request;
  }

  // Resolve extensionless relative imports to .ts / .tsx
  if (parent && parent.filename && (request.startsWith('./') || request.startsWith('../'))) {
    const base = path.resolve(path.dirname(parent.filename), request);
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, 'index.ts'),
      path.join(base, 'index.tsx'),
    ]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    }
  }

  return origResolveFilename.call(this, request, parent, isMain, options);
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'react-native') {
    return { Platform: mockPlatform };
  }
  if (request === '@react-native-async-storage/async-storage') {
    return { __esModule: true, default: mockAsyncStorage };
  }
  if (request === 'axios') {
    return { __esModule: true, default: mockAxios, ...mockAxios };
  }
  return origLoad.call(this, request, parent, isMain);
};

require.extensions['.ts'] = function (mod, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      strict: false,
    },
  });
  mod._compile(outputText, filename);
};

// Load real source modules
const { DhanWebSocketService } = require(path.join(ROOT_DIR, 'src/services/dhanWebSocket.ts'));
const { DhanApiService, aggregateCandles } = require(path.join(ROOT_DIR, 'src/services/dhanApi.ts'));
const { DhanAuthService } = require(path.join(ROOT_DIR, 'src/services/dhanAuthService.ts'));
const { generateMockCandles, TIMEFRAME_SECONDS } = require(path.join(ROOT_DIR, 'src/services/mockData.ts'));
const { StorageService, DEFAULT_COMPLIANCE_CONFIG, DEFAULT_COMPLIANCE_STATE } = require(
  path.join(ROOT_DIR, 'src/services/storage.ts')
);
const { ComplianceEngine } = require(path.join(ROOT_DIR, 'src/services/complianceEngine.ts'));
const { AutoSquareOffEngine } = require(path.join(ROOT_DIR, 'src/services/autoSquareOffEngine.ts'));
const { calculateVWAP, calculateEMA } = require(path.join(ROOT_DIR, 'src/utils/indicators.ts'));

// ============================================================================
// 2. Minimal Test Runner
// ============================================================================
const results = [];
let currentSuite = '';

function suite(name) {
  currentSuite = name;
  console.log(`\n=== ${name} ===`);
}

async function test(name, fn) {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    results.push({ suite: currentSuite, name, passed: true, ms });
    console.log(`  [PASS] ${name} (${ms}ms)`);
  } catch (err) {
    const ms = Date.now() - start;
    results.push({ suite: currentSuite, name, passed: false, ms, error: err });
    console.error(`  [FAIL] ${name} (${ms}ms)`);
    console.error(`         ${err?.stack || err}`);
  }
}

// ============================================================================
// 3. Binary Packet Builder Helpers (DhanHQ v2 Little-Endian Spec)
// ============================================================================
function buildTickerPacket({ exchangeByte, securityId, ltp, ltt, declaredLen = 16 }) {
  const buf = new ArrayBuffer(16);
  const view = new DataView(buf);
  view.setUint8(0, 2); // responseCode = 2 (Ticker)
  view.setUint16(1, declaredLen, true);
  view.setUint8(3, exchangeByte);
  view.setInt32(4, securityId, true);
  view.setFloat32(8, ltp, true);
  view.setInt32(12, ltt, true);
  return buf;
}

function buildQuotePacket({
  exchangeByte,
  securityId,
  ltp,
  ltt,
  volume,
  open,
  close,
  high,
  low,
  declaredLen = 50,
}) {
  const buf = new ArrayBuffer(50);
  const view = new DataView(buf);
  view.setUint8(0, 4); // responseCode = 4 (Quote)
  view.setUint16(1, declaredLen, true);
  view.setUint8(3, exchangeByte);
  view.setInt32(4, securityId, true);
  view.setFloat32(8, ltp, true);
  view.setInt16(12, 50, true); // ltq
  view.setInt32(14, ltt, true);
  view.setFloat32(18, ltp, true); // atp
  view.setInt32(22, volume, true);
  view.setInt32(26, 1000, true); // total sell qty
  view.setInt32(30, 1200, true); // total buy qty
  view.setFloat32(34, open, true);
  view.setFloat32(38, close, true);
  view.setFloat32(42, high, true);
  view.setFloat32(46, low, true);
  return buf;
}

function buildFullPacket({
  exchangeByte,
  securityId,
  ltp,
  ltt,
  volume,
  oi,
  open,
  close,
  high,
  low,
  declaredLen = 162,
}) {
  const buf = new ArrayBuffer(162);
  const view = new DataView(buf);
  view.setUint8(0, 8); // responseCode = 8 (Full)
  view.setUint16(1, declaredLen, true);
  view.setUint8(3, exchangeByte);
  view.setInt32(4, securityId, true);
  view.setFloat32(8, ltp, true);
  view.setInt16(12, 25, true); // ltq
  view.setInt32(14, ltt, true);
  view.setFloat32(18, ltp, true); // atp
  view.setInt32(22, volume, true);
  view.setInt32(26, 5000, true);
  view.setInt32(30, 6000, true);
  view.setInt32(34, oi, true);
  view.setInt32(38, oi + 1000, true); // day high oi
  view.setInt32(42, oi - 1000, true); // day low oi
  view.setFloat32(46, open, true);
  view.setFloat32(50, close, true);
  view.setFloat32(54, high, true);
  view.setFloat32(58, low, true);
  return buf;
}

function buildDisconnectPacket({ exchangeByte = 2, securityId = 0, disconnectCode = 805 }) {
  const buf = new ArrayBuffer(10);
  const view = new DataView(buf);
  view.setUint8(0, 50); // responseCode = 50 (Disconnect)
  view.setUint16(1, 10, true);
  view.setUint8(3, exchangeByte);
  view.setInt32(4, securityId, true);
  view.setInt16(8, disconnectCode, true);
  return buf;
}

function concatBuffers(...buffers) {
  const totalLen = buffers.reduce((s, b) => s + b.byteLength, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const b of buffers) {
    out.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }
  return out.buffer;
}

// ============================================================================
// SUITE A: DhanHQ v2 Binary WebSocket Decoder & Protocol
// ============================================================================
suite('A. DhanHQ v2 Binary WebSocket Decoder & Protocol');

await test('Decodes responseCode=2 (Ticker 16B) for NSE_FNO accurately', () => {
  const lttSec = 1731840000;
  const buf = buildTickerPacket({
    exchangeByte: 2, // NSE_FNO
    securityId: 51234,
    ltp: 148.75,
    ltt: lttSec,
  });
  const decoded = DhanWebSocketService.decodeBinaryFrame(buf);
  assert.equal(decoded.disconnectCode, undefined);
  assert.equal(decoded.ticks.length, 1);
  const t = decoded.ticks[0];
  assert.equal(t.securityId, '51234');
  assert.equal(t.exchangeSegment, 'NSE_FNO');
  assert.equal(t.ltp, 148.75);
  assert.equal(t.timestamp, lttSec * 1000);
});

await test('Decodes responseCode=2 (Ticker 16B) for BSE_FNO accurately', () => {
  const buf = buildTickerPacket({
    exchangeByte: 8, // BSE_FNO
    securityId: 834567,
    ltp: 312.5,
    ltt: 1731840050,
  });
  const decoded = DhanWebSocketService.decodeBinaryFrame(buf);
  assert.equal(decoded.ticks.length, 1);
  assert.equal(decoded.ticks[0].securityId, '834567');
  assert.equal(decoded.ticks[0].exchangeSegment, 'BSE_FNO');
  assert.equal(decoded.ticks[0].ltp, 312.5);
});

await test('Decodes responseCode=4 (Quote 50B) with ltp, volume, OHLC', () => {
  const lttSec = 1731840100;
  const buf = buildQuotePacket({
    exchangeByte: 2, // NSE_FNO
    securityId: 49012,
    ltp: 245.5,
    ltt: lttSec,
    volume: 184250,
    open: 210.25,
    close: 205.75,
    high: 260.0,
    low: 198.5,
  });
  const decoded = DhanWebSocketService.decodeBinaryFrame(buf);
  assert.equal(decoded.ticks.length, 1);
  const t = decoded.ticks[0];
  assert.equal(t.securityId, '49012');
  assert.equal(t.exchangeSegment, 'NSE_FNO');
  assert.equal(t.ltp, 245.5);
  assert.equal(t.volume, 184250);
  assert.equal(t.open, 210.25);
  assert.equal(t.close, 205.75);
  assert.equal(t.high, 260.0);
  assert.equal(t.low, 198.5);
  assert.equal(t.timestamp, lttSec * 1000);
});

await test('Decodes responseCode=8 (Full 162B) with ltp, volume, OI, OHLC for BSE_FNO', () => {
  const lttSec = 1731840200;
  const buf = buildFullPacket({
    exchangeByte: 8, // BSE_FNO
    securityId: 812345,
    ltp: 312.25,
    ltt: lttSec,
    volume: 92500,
    oi: 1450000,
    open: 290.0,
    close: 285.5,
    high: 325.75,
    low: 275.25,
  });
  const decoded = DhanWebSocketService.decodeBinaryFrame(buf);
  assert.equal(decoded.ticks.length, 1);
  const t = decoded.ticks[0];
  assert.equal(t.securityId, '812345');
  assert.equal(t.exchangeSegment, 'BSE_FNO');
  assert.equal(t.ltp, 312.25);
  assert.equal(t.volume, 92500);
  assert.equal(t.oi, 1450000);
  assert.equal(t.open, 290.0);
  assert.equal(t.close, 285.5);
  assert.equal(t.high, 325.75);
  assert.equal(t.low, 275.25);
  assert.equal(t.timestamp, lttSec * 1000);
});

await test('Decodes multi-packet concatenated frame (Ticker + Quote + Full)', () => {
  const multi = concatBuffers(
    buildTickerPacket({ exchangeByte: 2, securityId: 10001, ltp: 99.5, ltt: 1731840001 }),
    buildQuotePacket({
      exchangeByte: 8,
      securityId: 20002,
      ltp: 215.0,
      ltt: 1731840002,
      volume: 42000,
      open: 200,
      close: 195,
      high: 220,
      low: 190,
    }),
    buildFullPacket({
      exchangeByte: 2,
      securityId: 30003,
      ltp: 450.25,
      ltt: 1731840003,
      volume: 120000,
      oi: 850000,
      open: 430,
      close: 425,
      high: 460,
      low: 415,
    })
  );
  const decoded = DhanWebSocketService.decodeBinaryFrame(multi);
  assert.equal(decoded.ticks.length, 3);
  assert.equal(decoded.ticks[0].securityId, '10001');
  assert.equal(decoded.ticks[0].ltp, 99.5);
  assert.equal(decoded.ticks[1].securityId, '20002');
  assert.equal(decoded.ticks[1].exchangeSegment, 'BSE_FNO');
  assert.equal(decoded.ticks[1].volume, 42000);
  assert.equal(decoded.ticks[2].securityId, '30003');
  assert.equal(decoded.ticks[2].oi, 850000);
});

await test('Decodes responseCode=50 (Disconnect 10B) cleanly', () => {
  const buf = buildDisconnectPacket({ disconnectCode: 805 });
  const decoded = DhanWebSocketService.decodeBinaryFrame(buf);
  assert.equal(decoded.ticks.length, 0);
  assert.equal(decoded.disconnectCode, 805);
});

await test('Handles truncated, empty, zero-length, and malformed buffers with zero crashes', () => {
  // 0-byte
  assert.deepEqual(DhanWebSocketService.decodeBinaryFrame(new ArrayBuffer(0)), {
    ticks: [],
    disconnectCode: undefined,
  });

  // 5-byte (< 8B header)
  assert.equal(DhanWebSocketService.decodeBinaryFrame(new ArrayBuffer(5)).ticks.length, 0);

  // Truncated Ticker (12B instead of 16B)
  const truncTicker = buildTickerPacket({
    exchangeByte: 2,
    securityId: 111,
    ltp: 100,
    ltt: 1731840000,
  }).slice(0, 12);
  assert.equal(DhanWebSocketService.decodeBinaryFrame(truncTicker).ticks.length, 0);

  // Truncated Quote (30B instead of 50B)
  const truncQuote = buildQuotePacket({
    exchangeByte: 2,
    securityId: 222,
    ltp: 100,
    ltt: 1731840000,
    volume: 100,
    open: 90,
    close: 95,
    high: 105,
    low: 85,
  }).slice(0, 30);
  assert.equal(DhanWebSocketService.decodeBinaryFrame(truncQuote).ticks.length, 0);

  // Truncated Full (70B instead of 162B)
  const truncFull = buildFullPacket({
    exchangeByte: 8,
    securityId: 333,
    ltp: 100,
    ltt: 1731840000,
    volume: 100,
    oi: 5000,
    open: 90,
    close: 95,
    high: 105,
    low: 85,
  }).slice(0, 70);
  assert.equal(DhanWebSocketService.decodeBinaryFrame(truncFull).ticks.length, 0);

  // Malformed unknown responseCode=255 with declaredLen=0 (must not infinite loop)
  const unknownBuf = new ArrayBuffer(20);
  const uv = new DataView(unknownBuf);
  uv.setUint8(0, 255);
  uv.setUint16(1, 0, true);
  assert.equal(DhanWebSocketService.decodeBinaryFrame(unknownBuf).ticks.length, 0);

  // NaN / negative LTP in Ticker must be safely skipped
  const nanBuf = buildTickerPacket({
    exchangeByte: 2,
    securityId: 444,
    ltp: Number.NaN,
    ltt: 1731840000,
  });
  assert.equal(DhanWebSocketService.decodeBinaryFrame(nanBuf).ticks.length, 0);

  const negBuf = buildTickerPacket({
    exchangeByte: 2,
    securityId: 445,
    ltp: -10.5,
    ltt: 1731840000,
  });
  assert.equal(DhanWebSocketService.decodeBinaryFrame(negBuf).ticks.length, 0);
});

await test('Live WebSocket sets binaryType=arraybuffer, subscribes with true NSE_FNO/BSE_FNO segments, and dispatches binary ticks', async () => {
  mockAsyncStorage._reset();
  DhanWebSocketService.disconnect();

  await StorageService.saveCredentials({
    clientId: '1100998877',
    accessToken: 'test-token-abc',
    isDemoMode: false,
  });

  const sentPayloads = [];
  let createdWs = null;

  class MockWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = url;
      this.readyState = MockWebSocket.CONNECTING;
      this.binaryType = 'blob';
      createdWs = this;
    }
    send(data) {
      sentPayloads.push(JSON.parse(data));
    }
    close() {
      this.readyState = MockWebSocket.CLOSED;
    }
  }

  const prevWS = globalThis.WebSocket;
  globalThis.WebSocket = MockWebSocket;

  try {
    const received = [];
    const unsub1 = DhanWebSocketService.subscribe(
      '55001',
      (t) => received.push(t),
      { exchangeSegment: 'NSE_FNO', seedPrice: 185, requestCode: 17 }
    );
    const unsub2 = DhanWebSocketService.subscribe(
      '88002',
      (t) => received.push(t),
      { exchangeSegment: 'BSE_FNO', seedPrice: 340, requestCode: 15 }
    );

    await DhanWebSocketService.connect();
    assert.ok(createdWs, 'WebSocket should be instantiated');
    assert.equal(createdWs.binaryType, 'arraybuffer');
    assert.ok(createdWs.url.includes('wss://api-feed.dhan.co?version=2'));
    assert.ok(createdWs.url.includes('authType=2'));

    // Trigger socket open
    createdWs.readyState = MockWebSocket.OPEN;
    createdWs.onopen();

    // Verify subscription payloads preserve exact segments & request codes
    const flatInstruments = sentPayloads.flatMap((p) =>
      p.InstrumentList.map((i) => ({ ...i, RequestCode: p.RequestCode }))
    );
    const nseSub = flatInstruments.find((i) => i.SecurityId === '55001');
    const bseSub = flatInstruments.find((i) => i.SecurityId === '88002');
    assert.deepEqual(nseSub, {
      ExchangeSegment: 'NSE_FNO',
      SecurityId: '55001',
      RequestCode: 17,
    });
    assert.deepEqual(bseSub, {
      ExchangeSegment: 'BSE_FNO',
      SecurityId: '88002',
      RequestCode: 15,
    });

    // Deliver binary Quote packet over onmessage
    const binFrame = buildQuotePacket({
      exchangeByte: 8,
      securityId: 88002,
      ltp: 355.25,
      ltt: 1731840300,
      volume: 12345,
      open: 340,
      close: 335,
      high: 360,
      low: 330,
    });
    createdWs.onmessage({ data: binFrame });

    assert.equal(received.length, 1);
    assert.equal(received[0].securityId, '88002');
    assert.equal(received[0].exchangeSegment, 'BSE_FNO');
    assert.equal(received[0].ltp, 355.25);
    assert.equal(received[0].volume, 12345);

    unsub1();
    unsub2();
  } finally {
    DhanWebSocketService.disconnect();
    globalThis.WebSocket = prevWS;
  }
});

await test('Batch subscribeMany/unsubscribeMany groups RequestCode 15/16 by ExchangeSegment and preserves overlapping Chart listener', async () => {
  mockAsyncStorage._reset();
  DhanWebSocketService.disconnect();

  await StorageService.saveCredentials({
    clientId: '1100998877',
    accessToken: 'test-token-batch',
    isDemoMode: false,
  });

  const sentPayloads = [];
  let createdWs = null;

  class MockBatchWS {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    constructor(url) {
      this.url = url;
      this.readyState = MockBatchWS.CONNECTING;
      this.binaryType = 'blob';
      createdWs = this;
    }
    send(data) {
      sentPayloads.push(JSON.parse(data));
    }
    close() {
      this.readyState = MockBatchWS.CLOSED;
    }
  }

  const prevWS = globalThis.WebSocket;
  globalThis.WebSocket = MockBatchWS;

  try {
    await DhanWebSocketService.connect();
    createdWs.readyState = MockBatchWS.OPEN;
    createdWs.onopen();

    const chartTicks = [];
    const chainTicks = [];

    // Active chart subscribes to 51001 with Quote (17)
    const unsubChart = DhanWebSocketService.subscribe(
      '51001',
      (t) => chartTicks.push(t),
      { exchangeSegment: 'NSE_FNO', seedPrice: 180, requestCode: 17 }
    );

    // Option chain batch-subscribes 51001 (overlap!), 51002 (NSE_FNO), 81001 (BSE_FNO)
    sentPayloads.length = 0;
    const unsubChain = DhanWebSocketService.subscribeMany(
      [
        { securityId: '51001', exchangeSegment: 'NSE_FNO', seedPrice: 180, requestCode: 15 },
        { securityId: '51002', exchangeSegment: 'NSE_FNO', seedPrice: 160, requestCode: 15 },
        { securityId: '81001', exchangeSegment: 'BSE_FNO', seedPrice: 310, requestCode: 15 },
      ],
      (t) => chainTicks.push(t)
    );

    assert.equal(DhanWebSocketService.getSubscribedCount(), 3);
    // Verify NSE_FNO and BSE_FNO subscribe frames sent
    const subFlat = sentPayloads.flatMap((p) =>
      p.InstrumentList.map((i) => ({ ...i, RequestCode: p.RequestCode }))
    );
    assert.ok(subFlat.some((i) => i.SecurityId === '51002' && i.ExchangeSegment === 'NSE_FNO' && i.RequestCode === 15));
    assert.ok(subFlat.some((i) => i.SecurityId === '81001' && i.ExchangeSegment === 'BSE_FNO' && i.RequestCode === 15));
    // Overlapping 51001 retains higher-detail RequestCode 17 from active chart
    assert.ok(subFlat.some((i) => i.SecurityId === '51001' && i.RequestCode === 17));

    // Unsubscribe Option Chain => must unsubscribe 51002 & 81001 (RequestCode 16), but PRESERVE 51001 for active chart!
    sentPayloads.length = 0;
    unsubChain();

    assert.equal(DhanWebSocketService.getSubscribedCount(), 1, 'Overlapping active chart subscription must survive chain unsubscribe');
    const unsubFlat = sentPayloads.flatMap((p) =>
      p.InstrumentList.map((i) => ({ ...i, RequestCode: p.RequestCode }))
    );
    assert.ok(unsubFlat.some((i) => i.SecurityId === '51002' && i.RequestCode === 16));
    assert.ok(unsubFlat.some((i) => i.SecurityId === '81001' && i.RequestCode === 16));
    assert.equal(unsubFlat.some((i) => i.SecurityId === '51001'), false, '51001 must NOT be unsubscribed while chart still listens');

    // Deliver binary tick for 51001 -> chart still receives it, chain does not
    createdWs.onmessage({
      data: buildTickerPacket({ exchangeByte: 2, securityId: 51001, ltp: 184.5, ltt: 1731840500 }),
    });
    assert.equal(chartTicks.length, 1);
    assert.equal(chartTicks[0].ltp, 184.5);
    assert.equal(chainTicks.length, 0);

    unsubChart();
    assert.equal(DhanWebSocketService.getSubscribedCount(), 0);
  } finally {
    DhanWebSocketService.disconnect();
    globalThis.WebSocket = prevWS;
  }
});

await test('Demo mode simulated ticks anchor to instrument seedPrice (not hardcoded 150)', async () => {
  mockAsyncStorage._reset();
  DhanWebSocketService.disconnect();

  const ticks = [];
  const unsub = DhanWebSocketService.subscribe(
    'MOCK_SENSEX_80000_CE',
    (t) => ticks.push(t),
    { exchangeSegment: 'BSE_FNO', seedPrice: 450.0 }
  );

  try {
    await DhanWebSocketService.connect();
    await new Promise((r) => setTimeout(r, 850));
    assert.ok(ticks.length >= 1, 'Expected at least 1 simulated tick within 850ms');
    const last = ticks[ticks.length - 1];
    assert.equal(last.exchangeSegment, 'BSE_FNO');
    assert.ok(
      last.ltp >= 400 && last.ltp <= 500,
      `Expected tick anchored near seedPrice 450, got ${last.ltp}`
    );
  } finally {
    unsub();
    DhanWebSocketService.disconnect();
  }
});

// ============================================================================
// SUITE B: DhanHQ v2 Option Chain & Positions Parser
// ============================================================================
suite('B. DhanHQ v2 Option Chain & Positions Parser');

await test('Parses 51-strike DhanHQ v2 data.oc response with ATM ±12 windowing, Greeks & expiry retention', async () => {
  mockAsyncStorage._reset();
  axiosMockState.reset();

  await StorageService.saveCredentials({
    clientId: '1100998877',
    accessToken: 'live-token',
    isDemoMode: false,
  });

  const expiries = ['2026-11-19', '2026-11-26', '2026-12-03', '2026-12-31'];
  const oc = {};
  // Build 51 strikes from 23000 to 25500 (step 50)
  for (let strike = 23000; strike <= 25500; strike += 50) {
    const key = `${strike}.000000`;
    const isAtm = strike === 24200;
    oc[key] = {
      ce: {
        security_id: 500000 + strike,
        last_price: isAtm ? 182.5 : Math.max(5, 24212.5 - strike + 120),
        previous_close_price: isAtm ? 160.0 : 100.0,
        oi: 1250000 + strike,
        previous_oi: 1200000 + strike,
        volume: 450000,
        implied_volatility: 14.25,
        greeks: { delta: 0.52, theta: -18.4, gamma: 0.0012, vega: 11.5 },
        top_bid_price: 182.25,
        top_ask_price: 182.75,
      },
      pe: {
        security_id: 600000 + strike,
        last_price: isAtm ? 168.0 : Math.max(5, strike - 24212.5 + 110),
        previous_close_price: isAtm ? 175.0 : 100.0,
        oi: 1380000 + strike,
        previous_oi: 1350000 + strike,
        volume: 510000,
        implied_volatility: 15.1,
        greeks: { delta: -0.48, theta: -16.2, gamma: 0.0011, vega: 11.2 },
        top_bid_price: 167.75,
        top_ask_price: 168.25,
      },
    };
  }

  axiosMockState.postHandler = async (url, body) => {
    if (url === '/optionchain/expirylist') {
      assert.equal(body.UnderlyingScrip, 13);
      assert.equal(body.UnderlyingSeg, 'IDX_I');
      return { data: { data: expiries } };
    }
    if (url === '/optionchain') {
      assert.equal(body.Expiry, '2026-11-19');
      return {
        data: {
          data: {
            last_price: 24212.5,
            oc,
          },
        },
      };
    }
    throw new Error(`Unexpected POST ${url}`);
  };

  const chain = await DhanApiService.getOptionChain('NIFTY');

  assert.equal(chain.underlying, 'NIFTY');
  assert.equal(chain.underlyingLtp, 24212.5);
  assert.deepEqual(chain.expiryDates, expiries, 'All expiry chips must be retained');
  assert.equal(chain.selectedExpiry, '2026-11-19');

  // ATM ±12 windowing => 25 strikes (23600..24800)
  assert.equal(chain.strikes.length, 25, `Expected 25 windowed strikes, got ${chain.strikes.length}`);
  assert.equal(chain.strikes[0].strikePrice, 23600);
  assert.equal(chain.strikes[24].strikePrice, 24800);

  // Strictly sorted ascending
  for (let i = 1; i < chain.strikes.length; i++) {
    assert.ok(chain.strikes[i].strikePrice > chain.strikes[i - 1].strikePrice);
  }

  // Exactly 1 ATM strike at index 12 (strike 24200)
  const atmRows = chain.strikes.filter((s) => s.isATM);
  assert.equal(atmRows.length, 1);
  assert.equal(atmRows[0].strikePrice, 24200);
  assert.equal(chain.strikes[12].strikePrice, 24200);
  assert.equal(chain.strikes[12].isATM, true);

  // Verify Call & Put fields + Greeks
  const atm = chain.strikes[12];
  assert.equal(atm.call.securityId, String(500000 + 24200));
  assert.equal(atm.call.exchangeSegment, 'NSE_FNO');
  assert.equal(atm.call.lotSize, 25);
  assert.equal(atm.call.ltp, 182.5);
  assert.equal(atm.call.change, 22.5);
  assert.equal(atm.call.oiChange, 50000);
  assert.equal(atm.call.iv, 14.25);
  assert.equal(atm.call.delta, 0.52);
  assert.equal(atm.call.theta, -18.4);
  assert.equal(atm.call.bidPrice, 182.25);
  assert.equal(atm.call.askPrice, 182.75);

  assert.equal(atm.put.securityId, String(600000 + 24200));
  assert.equal(atm.put.ltp, 168.0);
  assert.equal(atm.put.change, -7.0);
  assert.equal(atm.put.oiChange, 30000);
  assert.equal(atm.put.delta, -0.48);
  assert.equal(atm.put.theta, -16.2);
});

await test('Retains all expiry chips when user switches to a non-default expiry on SENSEX (BSE_FNO)', async () => {
  mockAsyncStorage._reset();
  axiosMockState.reset();
  await StorageService.saveCredentials({
    clientId: '1100998877',
    accessToken: 'live-token',
    isDemoMode: false,
  });

  const expiries = ['2026-11-20', '2026-11-27', '2026-12-04'];
  axiosMockState.postHandler = async (url, body) => {
    if (url === '/optionchain/expirylist') {
      assert.equal(body.UnderlyingScrip, 51);
      return { data: { data: expiries } };
    }
    if (url === '/optionchain') {
      assert.equal(body.Expiry, '2026-11-27');
      return {
        data: {
          data: {
            last_price: 80120,
            oc: {
              '80000.000000': {
                ce: { security_id: 801001, last_price: 420, previous_close_price: 400, oi: 50000, previous_oi: 45000, volume: 12000 },
                pe: { security_id: 801002, last_price: 310, previous_close_price: 330, oi: 60000, previous_oi: 58000, volume: 14000 },
              },
              '80100.000000': {
                ce: { security_id: 801003, last_price: 350, previous_close_price: 340, oi: 70000, previous_oi: 65000, volume: 18000 },
                pe: { security_id: 801004, last_price: 360, previous_close_price: 350, oi: 75000, previous_oi: 72000, volume: 19000 },
              },
            },
          },
        },
      };
    }
    throw new Error(`Unexpected POST ${url}`);
  };

  const chain = await DhanApiService.getOptionChain('SENSEX', '2026-11-27');
  assert.deepEqual(chain.expiryDates, expiries);
  assert.equal(chain.selectedExpiry, '2026-11-27');
  assert.equal(chain.strikes[0].call.exchangeSegment, 'BSE_FNO');
  assert.equal(chain.strikes[0].call.lotSize, 10);
  assert.equal(chain.strikes[1].isATM, true);
});

await test('Computes correct signed LTP & dayPnl for Long, Short, Profit, Loss & Closed /v2/positions', async () => {
  mockAsyncStorage._reset();
  axiosMockState.reset();
  await StorageService.saveCredentials({
    clientId: '1100998877',
    accessToken: 'live-token',
    isDemoMode: false,
  });

  axiosMockState.getHandler = async (url) => {
    assert.equal(url, '/positions');
    return {
      data: [
        // 1. Long in profit (ltp & dayPnl omitted by Dhan)
        {
          securityId: '51001',
          tradingSymbol: 'NIFTY 24200 CE',
          exchangeSegment: 'NSE_FNO',
          productType: 'INTRADAY',
          buyQty: 50,
          buyAvg: 120,
          sellQty: 0,
          sellAvg: 0,
          netQty: 50,
          realizedProfit: 200,
          unrealizedProfit: 750, // +15 pts => ltp = 135
          costPrice: 120,
        },
        // 2. Short in profit (ltp & dayPnl omitted by Dhan)
        {
          securityId: '51002',
          tradingSymbol: 'NIFTY 24300 PE',
          exchangeSegment: 'NSE_FNO',
          productType: 'INTRADAY',
          buyQty: 0,
          buyAvg: 0,
          sellQty: 50,
          sellAvg: 150,
          netQty: -50,
          realizedProfit: -100,
          unrealizedProfit: 1000, // short profit => price FELL by 20 => ltp = 130
          costPrice: 150,
        },
        // 3. Short in loss (ltp omitted)
        {
          securityId: '51003',
          tradingSymbol: 'BANKNIFTY 52000 CE',
          exchangeSegment: 'NSE_FNO',
          productType: 'INTRADAY',
          buyQty: 0,
          buyAvg: 0,
          sellQty: 25,
          sellAvg: 200,
          netQty: -25,
          realizedProfit: 0,
          unrealizedProfit: -500, // short loss => price ROSE by 20 => ltp = 220
          costPrice: 200,
        },
        // 4. Closed position (netQty=0 must not divide by zero)
        {
          securityId: '51004',
          tradingSymbol: 'NIFTY 24100 CE',
          exchangeSegment: 'NSE_FNO',
          productType: 'INTRADAY',
          buyQty: 25,
          buyAvg: 100,
          sellQty: 25,
          sellAvg: 110,
          netQty: 0,
          realizedProfit: 250,
          unrealizedProfit: 0,
          costPrice: 100,
        },
        // 5. Raw ltp explicitly provided => preserved
        {
          securityId: '51005',
          tradingSymbol: 'SENSEX 80000 CE',
          exchangeSegment: 'BSE_FNO',
          productType: 'INTRADAY',
          buyQty: 10,
          buyAvg: 300,
          sellQty: 0,
          sellAvg: 0,
          netQty: 10,
          realizedProfit: 0,
          unrealizedProfit: 500,
          costPrice: 300,
          ltp: 351.25,
          dayPnl: 512.5,
        },
      ],
    };
  };

  const positions = await DhanApiService.getPositions();
  assert.equal(positions.length, 5);

  // Long in profit
  assert.equal(positions[0].ltp, 135);
  assert.equal(positions[0].dayPnl, 950);

  // Short in profit: 150 + 1000 / (-50) = 130
  assert.equal(positions[1].ltp, 130);
  assert.equal(positions[1].dayPnl, 900);

  // Short in loss: 200 + (-500) / (-25) = 220
  assert.equal(positions[2].ltp, 220);
  assert.equal(positions[2].dayPnl, -500);

  // Closed position: no NaN/Infinity
  assert.equal(positions[3].ltp, 0);
  assert.equal(Number.isFinite(positions[3].ltp), true);
  assert.equal(positions[3].dayPnl, 250);

  // Explicit ltp & dayPnl preserved
  assert.equal(positions[4].ltp, 351.25);
  assert.equal(positions[4].dayPnl, 512.5);
});

await test('Demo mode getOptionChain returns unique expiryDates (no duplicate React keys)', async () => {
  mockAsyncStorage._reset();
  const chain = await DhanApiService.getOptionChain('NIFTY');
  const uniqueExpiries = new Set(chain.expiryDates);
  assert.equal(
    uniqueExpiries.size,
    chain.expiryDates.length,
    `Duplicate expiryDates found in Demo Option Chain: ${JSON.stringify(chain.expiryDates)}`
  );
});

await test('Multi-timeframe generateMockCandles supports all 9 timeframes (1m..1W) with accurate interval spacing', () => {
  const tfs = ['1m', '3m', '5m', '15m', '30m', '1H', '4H', '1D', '1W'];
  for (const tf of tfs) {
    const candles = generateMockCandles(150, 20, tf);
    assert.equal(candles.length, 21, `Expected 21 candles for ${tf}`);
    const expectedStep = TIMEFRAME_SECONDS[tf];
    assert.ok(expectedStep > 0, `Missing TIMEFRAME_SECONDS for ${tf}`);
    assert.equal(
      candles[1].time - candles[0].time,
      expectedStep,
      `Expected ${expectedStep}s interval for ${tf}, got ${candles[1].time - candles[0].time}`
    );
    for (const c of candles) {
      assert.ok(c.high >= Math.max(c.open, c.close), `Invalid high in ${tf}`);
      assert.ok(c.low <= Math.min(c.open, c.close), `Invalid low in ${tf}`);
    }
  }
});

await test('aggregateCandles accurately resamples OHLCV bars (1m->3m and daily->1W)', () => {
  const baseTs = 1731900060; // strictly divisible by 180 (1731900060 % 180 === 0)
  const oneMin = [
    { time: baseTs, open: 100, high: 105, low: 98, close: 103, volume: 100 },
    { time: baseTs + 60, open: 103, high: 112, low: 101, close: 110, volume: 250 },
    { time: baseTs + 120, open: 110, high: 111, low: 95, close: 104, volume: 150 },
    { time: baseTs + 180, open: 104, high: 108, low: 102, close: 107, volume: 300 },
  ];
  const threeMin = aggregateCandles(oneMin, 180);
  assert.equal(threeMin.length, 2);
  assert.equal(threeMin[0].open, 100);
  assert.equal(threeMin[0].high, 112);
  assert.equal(threeMin[0].low, 95);
  assert.equal(threeMin[0].close, 104);
  assert.equal(threeMin[0].volume, 500);
  assert.equal(threeMin[1].open, 104);
  assert.equal(threeMin[1].close, 107);
  assert.equal(threeMin[1].volume, 300);
});

await test('DhanApiService.getChartCandles routes intraday (3m/30m/4H) to /charts/intraday and 1D/1W to /charts/historical', async () => {
  mockAsyncStorage._reset();
  axiosMockState.reset();
  await StorageService.saveCredentials({
    clientId: '1100998877',
    accessToken: 'live-token',
    isDemoMode: false,
  });

  const baseTs = 1731900060; // strictly divisible by 180
  axiosMockState.postHandler = async (url, body) => {
    if (url === '/charts/intraday') {
      return {
        data: {
          timestamp: [baseTs, baseTs + 60, baseTs + 120, baseTs + 180, baseTs + 240, baseTs + 300],
          open: [100, 102, 104, 106, 108, 110],
          high: [105, 106, 107, 109, 111, 115],
          low: [99, 100, 101, 105, 106, 108],
          close: [102, 104, 106, 108, 110, 112],
          volume: [10, 20, 30, 40, 50, 60],
        },
      };
    }
    if (url === '/charts/historical') {
      // 10 consecutive days across 2 weeks
      const startDay = 1731283200; // Mon 2024-11-11 00:00 UTC
      const ts = Array.from({ length: 10 }, (_, i) => startDay + i * 86400);
      return {
        data: {
          timestamp: ts,
          open: ts.map((_, i) => 100 + i),
          high: ts.map((_, i) => 110 + i),
          low: ts.map((_, i) => 95 + i),
          close: ts.map((_, i) => 105 + i),
          volume: ts.map(() => 1000),
        },
      };
    }
    throw new Error(`Unexpected POST ${url}`);
  };

  // 3m -> /charts/intraday interval='1', resampled from 6x1m -> 2x3m
  const c3m = await DhanApiService.getChartCandles('51001', 'NSE_FNO', 'OPTIDX', '3m');
  assert.equal(axiosMockState.calls[0].url, '/charts/intraday');
  assert.equal(axiosMockState.calls[0].body.interval, '1');
  assert.equal(c3m.length, 2);
  assert.equal(c3m[0].volume, 60); // 10+20+30

  // 1D -> /charts/historical (10 daily bars)
  const c1d = await DhanApiService.getChartCandles('51001', 'NSE_FNO', 'OPTIDX', '1D');
  assert.equal(axiosMockState.calls[1].url, '/charts/historical');
  assert.equal(c1d.length, 10);

  // 1W -> /charts/historical aggregated into 2 weekly bars
  const c1w = await DhanApiService.getChartCandles('51001', 'NSE_FNO', 'OPTIDX', '1W');
  assert.equal(axiosMockState.calls[2].url, '/charts/historical');
  assert.equal(c1w.length, 2);
  assert.equal(c1w[0].volume, 7000); // Mon..Sun = 7 days
  assert.equal(c1w[1].volume, 3000); // next Mon..Wed = 3 days
});

// ============================================================================
// SUITE C: Compliance Engine (All Rules)
// ============================================================================
suite('C. Compliance Engine');

async function seedCompliance(configOverrides = {}, stateOverrides = {}) {
  mockAsyncStorage._reset();
  await StorageService.saveComplianceConfig({
    ...DEFAULT_COMPLIANCE_CONFIG,
    // Disable wall-clock IST time filters by default so unit tests are deterministic
    blockOpeningVolatility: false,
    blockMarketClose: false,
    ...configOverrides,
  });
  await StorageService.saveComplianceState({
    ...DEFAULT_COMPLIANCE_STATE,
    ...stateOverrides,
  });
}

function makeOrder(overrides = {}) {
  return {
    transactionType: 'BUY',
    exchangeSegment: 'NSE_FNO',
    productType: 'INTRADAY',
    orderType: 'LIMIT',
    validity: 'DAY',
    securityId: '51001',
    quantity: 50, // 2 lots of NIFTY (lotSize 25)
    price: 150,
    ...overrides,
  };
}

await test('Allows valid BUY order (SL < Entry, within all limits, R:R >= 1.5)', async () => {
  await seedCompliance();
  const res = await ComplianceEngine.validateOrder({
    order: makeOrder({ transactionType: 'BUY', quantity: 50 }),
    lotSize: 25,
    entryPrice: 150,
    stopLossPrice: 130, // risk = 20 * 50 = ₹1000 <= ₹1500
    targetPrice: 190, // reward = 40 => R:R = 1:2.0 >= 1.5
  });
  assert.equal(res.allowed, true);
  assert.equal(res.reasons.length, 0);
  assert.equal(res.warnings.length, 0);
});

await test('Blocks BUY order when SL >= Entry (both equal and above)', async () => {
  await seedCompliance();
  const eqRes = await ComplianceEngine.validateOrder({
    order: makeOrder({ transactionType: 'BUY', quantity: 25 }),
    lotSize: 25,
    entryPrice: 150,
    stopLossPrice: 150,
    targetPrice: 190,
  });
  assert.equal(eqRes.allowed, false);
  assert.ok(eqRes.checks.some((c) => c.ruleId === 'MANDATORY_SL' && !c.passed));

  const aboveRes = await ComplianceEngine.validateOrder({
    order: makeOrder({ transactionType: 'BUY', quantity: 25 }),
    lotSize: 25,
    entryPrice: 150,
    stopLossPrice: 165,
    targetPrice: 190,
  });
  assert.equal(aboveRes.allowed, false);
  assert.ok(aboveRes.checks.some((c) => c.ruleId === 'MANDATORY_SL' && !c.passed));
});

await test('Blocks SELL order when SL <= Entry and allows SELL order when SL > Entry', async () => {
  await seedCompliance();
  const badSell = await ComplianceEngine.validateOrder({
    order: makeOrder({ transactionType: 'SELL', quantity: 25 }),
    lotSize: 25,
    entryPrice: 150,
    stopLossPrice: 140,
    targetPrice: 110,
  });
  assert.equal(badSell.allowed, false);
  assert.ok(badSell.checks.some((c) => c.ruleId === 'MANDATORY_SL' && !c.passed));

  const eqSell = await ComplianceEngine.validateOrder({
    order: makeOrder({ transactionType: 'SELL', quantity: 25 }),
    lotSize: 25,
    entryPrice: 150,
    stopLossPrice: 150,
    targetPrice: 110,
  });
  assert.equal(eqSell.allowed, false);

  const goodSell = await ComplianceEngine.validateOrder({
    order: makeOrder({ transactionType: 'SELL', quantity: 25 }),
    lotSize: 25,
    entryPrice: 150,
    stopLossPrice: 170, // risk = 20 * 25 = ₹500
    targetPrice: 110, // reward = 40 => R:R = 1:2.0
  });
  assert.equal(goodSell.allowed, true);
});

await test('Blocks order exceeding Max Lots Per Trade', async () => {
  await seedCompliance({ maxLotsPerTrade: 2 });
  const res = await ComplianceEngine.validateOrder({
    order: makeOrder({ quantity: 75 }), // 3 lots
    lotSize: 25,
    entryPrice: 150,
    stopLossPrice: 140,
    targetPrice: 170,
  });
  assert.equal(res.allowed, false);
  assert.ok(res.checks.some((c) => c.ruleId === 'MAX_LOTS' && !c.passed));
});

await test('Blocks order exceeding Max Risk Per Trade', async () => {
  await seedCompliance({ maxRiskPerTradeAmount: 1500 });
  const res = await ComplianceEngine.validateOrder({
    order: makeOrder({ quantity: 50 }), // 2 lots
    lotSize: 25,
    entryPrice: 150,
    stopLossPrice: 110, // 40 * 50 = ₹2000 > ₹1500
    targetPrice: 230,
  });
  assert.equal(res.allowed, false);
  assert.ok(res.checks.some((c) => c.ruleId === 'MAX_TRADE_RISK' && !c.passed));
});

await test('Blocks order when Max Trades Per Day is reached', async () => {
  await seedCompliance({ maxTradesPerDay: 5 }, { todayTradeCount: 5 });
  const res = await ComplianceEngine.validateOrder({
    order: makeOrder({ quantity: 25 }),
    lotSize: 25,
    entryPrice: 150,
    stopLossPrice: 140,
    targetPrice: 170,
  });
  assert.equal(res.allowed, false);
  assert.ok(res.checks.some((c) => c.ruleId === 'MAX_TRADES' && !c.passed));
});

await test('Blocks order & persists lock on Max Daily Loss lockout', async () => {
  await seedCompliance(
    { maxDailyLossAmount: 5000 },
    { todayRealizedPnl: -3000, todayUnrealizedPnl: -2200, isDailyLossLocked: false }
  );
  const res = await ComplianceEngine.validateOrder({
    order: makeOrder({ quantity: 25 }),
    lotSize: 25,
    entryPrice: 150,
    stopLossPrice: 140,
    targetPrice: 170,
  });
  assert.equal(res.allowed, false);
  assert.ok(res.checks.some((c) => c.ruleId === 'DAILY_LOSS_LIMIT' && !c.passed));

  const savedState = await StorageService.getComplianceState();
  assert.equal(savedState.isDailyLossLocked, true);
});

await test('Enforces Revenge Cooldown when active and clears when expired', async () => {
  // Active cooldown (5 mins remaining)
  await seedCompliance(
    { revengeCooldownEnabled: true },
    { cooldownUntil: Date.now() + 5 * 60 * 1000 }
  );
  const blocked = await ComplianceEngine.validateOrder({
    order: makeOrder({ quantity: 25 }),
    lotSize: 25,
    entryPrice: 150,
    stopLossPrice: 140,
    targetPrice: 170,
  });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.checks.some((c) => c.ruleId === 'REVENGE_COOLDOWN' && !c.passed));

  // Expired cooldown
  await seedCompliance(
    { revengeCooldownEnabled: true },
    { cooldownUntil: Date.now() - 1000 }
  );
  const allowed = await ComplianceEngine.validateOrder({
    order: makeOrder({ quantity: 25 }),
    lotSize: 25,
    entryPrice: 150,
    stopLossPrice: 140,
    targetPrice: 170,
  });
  assert.equal(allowed.allowed, true);
});

await test('Emits Min R:R WARNING (without blocking) when R:R < target', async () => {
  await seedCompliance({ minRiskRewardEnabled: true, minRiskRewardRatio: 1.5 });
  const res = await ComplianceEngine.validateOrder({
    order: makeOrder({ quantity: 25 }),
    lotSize: 25,
    entryPrice: 150,
    stopLossPrice: 130, // risk = 20
    targetPrice: 170, // reward = 20 => 1:1.0 < 1:1.5
  });
  assert.equal(res.allowed, true, 'Min R:R should be a WARNING, not a hard BLOCK');
  assert.equal(res.warnings.length, 1);
  const rrCheck = res.checks.find((c) => c.ruleId === 'MIN_RR');
  assert.ok(rrCheck);
  assert.equal(rrCheck.severity, 'WARNING');
  assert.equal(rrCheck.passed, false);
});

await test('recordTradeResult updates trade count, triggers cooldown on loss, and resets streak on win', async () => {
  await seedCompliance({ revengeCooldownEnabled: true, triggerConsecutiveLosses: 1, revengeCooldownMinutes: 15 });
  await ComplianceEngine.recordTradeResult(-800);
  let state = await StorageService.getComplianceState();
  assert.equal(state.todayTradeCount, 1);
  assert.equal(state.todayRealizedPnl, -800);
  assert.equal(state.consecutiveLossCount, 1);
  assert.ok(state.cooldownUntil && state.cooldownUntil > Date.now());

  await ComplianceEngine.recordTradeResult(1200);
  state = await StorageService.getComplianceState();
  assert.equal(state.todayTradeCount, 2);
  assert.equal(state.todayRealizedPnl, 400);
  assert.equal(state.consecutiveLossCount, 0);
});

// ============================================================================
// SUITE D: AutoSquareOffEngine Kill Switch
// ============================================================================
suite('D. AutoSquareOffEngine Kill Switch');

await test('Breach squares off all open positions via DhanApiService, locks account, fires ONCE, and subsequent polls do NOT double-fire', async () => {
  await seedCompliance({ maxDailyLossEnabled: true, maxDailyLossAmount: 5000 });
  AutoSquareOffEngine.stopMonitoring();

  // Stub DhanApiService.getPositions & squareOffAllPositions deterministically
  const origGetPositions = DhanApiService.getPositions;
  const origSquareOff = DhanApiService.squareOffAllPositions;

  let currentPositions = [
    {
      securityId: '51001',
      tradingSymbol: 'NIFTY 24200 CE',
      exchangeSegment: 'NSE_FNO',
      productType: 'INTRADAY',
      buyQty: 50,
      buyAvg: 150,
      sellQty: 0,
      sellAvg: 0,
      netQty: 50,
      realizedProfit: -1000,
      unrealizedProfit: -2500,
      costPrice: 150,
      ltp: 100,
      dayPnl: -3500,
    },
    {
      securityId: '51002',
      tradingSymbol: 'BANKNIFTY 52000 PE',
      exchangeSegment: 'NSE_FNO',
      productType: 'INTRADAY',
      buyQty: 30,
      buyAvg: 250,
      sellQty: 0,
      sellAvg: 0,
      netQty: 30,
      realizedProfit: 0,
      unrealizedProfit: -2000,
      costPrice: 250,
      ltp: 183.33,
      dayPnl: -2000,
    },
  ];
  // Total P&L = -1000 + (-2500) + (-2000) = -5500 (breaches 5000 limit!)

  let squareOffCallCount = 0;
  const killEvents = [];
  const pnlUpdates = [];

  const unsubKill = AutoSquareOffEngine.onKillSwitchTriggered((evt) => killEvents.push(evt));
  const unsubPnl = AutoSquareOffEngine.onPnlUpdate((total, r, u) => pnlUpdates.push({ total, r, u }));

  DhanApiService.getPositions = async () => currentPositions.map((p) => ({ ...p }));
  DhanApiService.squareOffAllPositions = async () => {
    squareOffCallCount += 1;
    const open = currentPositions.filter((p) => p.netQty !== 0);
    // Simulate broker flattening all open positions
    currentPositions = currentPositions.map((p) => ({
      ...p,
      realizedProfit: p.realizedProfit + p.unrealizedProfit,
      unrealizedProfit: 0,
      netQty: 0,
    }));
    return {
      exitedCount: open.length,
      cancelledOrdersCount: 1,
      orderIds: ['EXIT_1', 'EXIT_2'],
      exitedSymbols: open.map((p) => p.tradingSymbol),
      totalPnlAtExit: -5500,
    };
  };

  try {
    // First check with healthy P&L resets internal retry timer
    const saved = currentPositions;
    currentPositions = [{ ...saved[0], realizedProfit: 0, unrealizedProfit: -500 }];
    const noBreach = await AutoSquareOffEngine.checkAndEnforce();
    assert.equal(noBreach, null);
    assert.equal(squareOffCallCount, 0);
    assert.equal(killEvents.length, 0);

    // Now simulate Max Daily Loss breach (-₹5500 vs ₹5000)
    currentPositions = saved;
    const evt = await AutoSquareOffEngine.checkAndEnforce();

    assert.ok(evt, 'KillSwitchEvent must be returned on breach');
    assert.equal(evt.maxLossLimit, 5000);
    assert.equal(evt.actualLoss, 5500);
    assert.equal(evt.summary.exitedCount, 2);
    assert.equal(squareOffCallCount, 1, 'squareOffAllPositions must be called ONCE');
    assert.equal(killEvents.length, 1, 'KillSwitch listener must fire ONCE');

    const lockedState = await StorageService.getComplianceState();
    assert.equal(lockedState.isDailyLossLocked, true, 'Account must be locked in StorageService');
    assert.equal(AutoSquareOffEngine.getLastStatus().isDailyLossLocked, true);
    assert.equal(AutoSquareOffEngine.getLastStatus().openPositionsCount, 0);

    // Subsequent polls (even 3 consecutive times) MUST NOT double-fire
    const poll2 = await AutoSquareOffEngine.checkAndEnforce();
    const poll3 = await AutoSquareOffEngine.checkAndEnforce();
    const poll4 = await AutoSquareOffEngine.checkAndEnforce();
    assert.equal(poll2, null);
    assert.equal(poll3, null);
    assert.equal(poll4, null);
    assert.equal(squareOffCallCount, 1, 'Must NOT double-fire squareOffAllPositions');
    assert.equal(killEvents.length, 1, 'Must NOT double-fire killSwitchListeners');
    assert.ok(pnlUpdates.length >= 2, 'PnL listeners should receive updates');
  } finally {
    unsubKill();
    unsubPnl();
    DhanApiService.getPositions = origGetPositions;
    DhanApiService.squareOffAllPositions = origSquareOff;
  }
});

// ============================================================================
// SUITE E: Technical Indicators (indicators.ts)
// ============================================================================
suite('E. Technical Indicators (calculateVWAP & calculateEMA)');

await test('calculateVWAP handles empty array, 1 candle, zero volume, and typical series', () => {
  // Empty
  assert.deepEqual(calculateVWAP([]), []);

  // 1 candle
  const single = [{ time: 1000, open: 100, high: 110, low: 90, close: 100, volume: 500 }];
  const vSingle = calculateVWAP(single);
  assert.equal(vSingle.length, 1);
  assert.equal(vSingle[0].time, 1000);
  assert.equal(vSingle[0].value, 100); // (110+90+100)/3 = 100

  // Zero / undefined volume (no NaN or Infinity)
  const zeroVol = [
    { time: 1000, open: 100, high: 120, low: 90, close: 105, volume: 0 },
    { time: 1300, open: 105, high: 130, low: 100, close: 115 },
  ];
  const vZero = calculateVWAP(zeroVol);
  assert.equal(vZero.length, 2);
  assert.ok(Number.isFinite(vZero[0].value));
  assert.ok(Number.isFinite(vZero[1].value));
  assert.equal(vZero[0].value, 105); // (120+90+105)/3 = 105

  // Typical weighted series
  const series = [
    { time: 1000, open: 100, high: 110, low: 90, close: 100, volume: 100 }, // TP=100, TV=10000
    { time: 1300, open: 100, high: 140, low: 110, close: 140, volume: 300 }, // TP=130, TV=39000 => (10000+39000)/400 = 122.5
  ];
  const vSeries = calculateVWAP(series);
  assert.equal(vSeries.length, 2);
  assert.equal(vSeries[0].value, 100);
  assert.equal(vSeries[1].value, 122.5);
});

await test('calculateEMA handles empty array, 1 candle, and typical multi-candle series', () => {
  // Empty
  assert.deepEqual(calculateEMA([], 9), []);

  // 1 candle
  const single = [{ time: 1000, open: 120, high: 125, low: 115, close: 123.45, volume: 100 }];
  const eSingle = calculateEMA(single, 9);
  assert.equal(eSingle.length, 1);
  assert.equal(eSingle[0].value, 123.45);

  // Typical rising series
  const candles = Array.from({ length: 20 }, (_, i) => ({
    time: 1000 + i * 300,
    open: 100 + i * 2,
    high: 102 + i * 2,
    low: 99 + i * 2,
    close: 100 + (i + 1) * 2,
    volume: 1000,
  }));
  const ema9 = calculateEMA(candles, 9);
  assert.equal(ema9.length, 20);
  for (const pt of ema9) {
    assert.ok(Number.isFinite(pt.value), 'EMA values must be finite');
  }
  // In a strictly rising series, EMA should rise monotonically after warmup and lag slightly behind close
  assert.ok(ema9[19].value > ema9[10].value);
  assert.ok(ema9[19].value < candles[19].close);
});

// ============================================================================
// SUITE F: Chart HTML / Embedded JS Integrity (InteractiveChart.tsx)
// ============================================================================
suite('F. InteractiveChart HTML / Embedded JS Integrity & KLineChart v9 CDN');

const chartFilePath = path.join(ROOT_DIR, 'src/components/InteractiveChart.tsx');
const chartSource = fs.readFileSync(chartFilePath, 'utf8');

await test('InteractiveChart references KLineChart v9 CDN URL and CDN returns HTTP 200', async () => {
  const cdnMatch = chartSource.match(/https:\/\/cdn\.jsdelivr\.net\/npm\/klinecharts@9[^\s"'`<>]+/);
  assert.ok(
    cdnMatch,
    'InteractiveChart.tsx must reference KLineChart v9 CDN URL (https://cdn.jsdelivr.net/npm/klinecharts@9...)'
  );
  const cdnUrl = cdnMatch[0];
  const res = await fetch(cdnUrl, { method: 'HEAD' });
  assert.equal(res.status, 200, `Expected HTTP 200 from KLineChart CDN (${cdnUrl}), got ${res.status}`);
});

await test('InteractiveChart embedded <script> parses with zero JS syntax errors', () => {
  // Locate the HTML template literal (from <!DOCTYPE html> to </html>)
  const htmlStart = chartSource.indexOf('<!DOCTYPE html>');
  const htmlEnd = chartSource.indexOf('</html>', htmlStart);
  assert.ok(htmlStart !== -1 && htmlEnd !== -1, 'Could not locate embedded HTML document in InteractiveChart.tsx');

  const rawHtmlTemplate = chartSource.slice(htmlStart, htmlEnd + '</html>'.length);

  // Extract inline <script> blocks (excluding external <script src="...">)
  const scriptRegex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  const scripts = [];
  let match;
  while ((match = scriptRegex.exec(rawHtmlTemplate)) !== null) {
    scripts.push(match[1]);
  }
  assert.ok(scripts.length >= 1, 'Expected at least one inline <script> block inside chart HTML');

  for (let idx = 0; idx < scripts.length; idx++) {
    // Evaluate template literal interpolations safely for syntax validation:
    // Replace ${...} expressions with syntactically valid JS literals/JSON based on context
    let jsCode = scripts[idx];
    // Handle nested braces in ${...} safely using a small scanner
    let out = '';
    let i = 0;
    while (i < jsCode.length) {
      if (jsCode[i] === '$' && jsCode[i + 1] === '{') {
        let depth = 1;
        let j = i + 2;
        while (j < jsCode.length && depth > 0) {
          if (jsCode[j] === '{') depth++;
          else if (jsCode[j] === '}') depth--;
          j++;
        }
        const expr = jsCode.slice(i + 2, j - 1).trim();
        // Substitute safe placeholder values so syntax check mirrors real runtime output
        if (/JSON\.stringify/i.test(expr)) {
          out += '[]';
        } else if (/^['"`]/.test(expr)) {
          out += expr;
        } else {
          out += '0';
        }
        i = j;
      } else {
        // Unescape template-literal escaped sequences like \` or \$ or \\
        if (jsCode[i] === '\\' && (jsCode[i + 1] === '`' || jsCode[i + 1] === '$')) {
          out += jsCode[i + 1];
          i += 2;
        } else {
          out += jsCode[i];
          i++;
        }
      }
    }

    // Must parse cleanly with zero syntax errors
    assert.doesNotThrow(
      () => new Function(out),
      `Embedded <script> #${idx + 1} in InteractiveChart.tsx failed JS syntax check`
    );
  }
});

await test('InteractiveChart properly escapes symbol against HTML/XSS injection', () => {
  // Check for HTML escaping helper or JSON.stringify safe textContent assignment (not raw unescaped ${symbol} inside HTML)
  const htmlStart = chartSource.indexOf('<!DOCTYPE html>');
  const htmlEnd = chartSource.indexOf('</html>', htmlStart);
  const rawHtml = chartSource.slice(htmlStart, htmlEnd + '</html>'.length);

  // Raw unescaped ${symbol} directly in HTML is an XSS vector
  assert.equal(
    /\$\{\s*symbol\s*\}/.test(rawHtml),
    false,
    'Found unescaped ${symbol} directly inside embedded HTML! Must escape HTML entities or use JSON.stringify + textContent.'
  );

  // Confirm escaping utility or safeSymbol exists and escapes HTML special chars
  const hasEscaper =
    /escapeHtml|safeSymbol/.test(chartSource) &&
    chartSource.includes('&amp;') &&
    chartSource.includes('&lt;') &&
    chartSource.includes('&gt;');
  assert.ok(hasEscaper, 'InteractiveChart.tsx should sanitize/escape dynamic strings (&, <, >) before HTML interpolation');
});

await test('InteractiveChart supports all required message handlers, RESET_CHART, opacity & all 9 timeframes', () => {
  const requiredTokens = [
    'SYNC_STATE',
    'LIVE_TICK',
    'RESET_CHART',
    'overlayOpacity',
    'CLEAR_DRAWINGS',
    'UNDO_DRAWING',
    'btnResetChart',
    'latestTick',
  ];
  for (const token of requiredTokens) {
    assert.ok(
      chartSource.includes(token),
      `InteractiveChart.tsx is missing required message/feature token: ${token}`
    );
  }
  const requiredTimeframes = ['1m', '3m', '5m', '15m', '30m', '1H', '4H', '1D', '1W'];
  for (const tf of requiredTimeframes) {
    assert.ok(
      chartSource.includes(`'${tf}'`),
      `InteractiveChart.tsx is missing timeframe '${tf}'`
    );
  }
});

await test('ChartOrderPanel & ChartTradingScreen wire editable Entry/SL/TP inputs and 1-Click/Confirm mode', () => {
  const orderPanelSrc = fs.readFileSync(
    path.join(ROOT_DIR, 'src/components/ChartOrderPanel.tsx'),
    'utf8'
  );
  const chartScreenSrc = fs.readFileSync(
    path.join(ROOT_DIR, 'src/screens/ChartTradingScreen.tsx'),
    'utf8'
  );
  assert.ok(orderPanelSrc.includes('TextInput'), 'ChartOrderPanel.tsx must render editable TextInput controls');
  assert.ok(orderPanelSrc.includes('oneClickMode'), 'ChartOrderPanel.tsx must support oneClickMode prop');
  assert.ok(orderPanelSrc.includes('onToggleOneClickMode'), 'ChartOrderPanel.tsx must support onToggleOneClickMode prop');
  assert.ok(chartScreenSrc.includes('trading_one_click_mode_v1'), 'ChartTradingScreen.tsx must persist oneClickMode in AsyncStorage');
  assert.ok(chartScreenSrc.includes('handleConfirmLevelChange'), 'ChartTradingScreen.tsx must support Confirm level prompt');
  assert.ok(chartScreenSrc.includes('handleRevertLevelChange'), 'ChartTradingScreen.tsx must support Revert level prompt');
  assert.ok(chartScreenSrc.includes('Confirm & Place'), 'ChartTradingScreen.tsx must render Confirm Order modal');
});

// ============================================================================
// SUITE G: DhanHQ 1-Tap OAuth Consent Service (v1.0.3)
// ============================================================================
suite('G. DhanHQ 1-Tap OAuth Consent Service (DhanAuthService)');

await test('DhanAuthService.extractTokenIdFromUrl handles query, multi-param, encoded, hash, custom scheme, missing & malformed URLs', () => {
  // Standard query param
  assert.equal(
    DhanAuthService.extractTokenIdFromUrl(
      'https://pushpak-256.github.io/dhan-options-trader/?tokenId=tok_abc123'
    ),
    'tok_abc123'
  );
  // Multi-param URL + case-insensitive key
  assert.equal(
    DhanAuthService.extractTokenIdFromUrl(
      'https://example.com/callback?foo=1&token_id=multi_tok_99&bar=2'
    ),
    'multi_tok_99'
  );
  assert.equal(
    DhanAuthService.extractTokenIdFromUrl('https://example.com/cb?TOKENID=UPPER_77'),
    'UPPER_77'
  );
  // Encoded characters
  assert.equal(
    DhanAuthService.extractTokenIdFromUrl('https://example.com/cb?tokenId=abc%2B123%3D%3D'),
    'abc+123=='
  );
  // Hash fragments
  assert.equal(
    DhanAuthService.extractTokenIdFromUrl('https://example.com/#/auth?tokenId=hash_q_42'),
    'hash_q_42'
  );
  assert.equal(
    DhanAuthService.extractTokenIdFromUrl('https://example.com/#tokenId=hash_direct_88'),
    'hash_direct_88'
  );
  // Custom mobile deep-link scheme
  assert.equal(
    DhanAuthService.extractTokenIdFromUrl('dhantrader://auth?tokenId=abc'),
    'abc'
  );
  // Missing param -> null
  assert.equal(
    DhanAuthService.extractTokenIdFromUrl('https://pushpak-256.github.io/dhan-options-trader/?foo=bar'),
    null
  );
  // Malformed / empty URLs -> null with zero throws
  assert.equal(DhanAuthService.extractTokenIdFromUrl('not a valid ::: url ///'), null);
  assert.equal(DhanAuthService.extractTokenIdFromUrl(''), null);
  assert.equal(DhanAuthService.extractTokenIdFromUrl(null), null);
  assert.equal(DhanAuthService.extractTokenIdFromUrl(undefined), null);
});

await test('DhanAuthService.generateConsent & consumeConsent use exact URLs/headers and persist live credentials', async () => {
  mockAsyncStorage._reset();
  axiosMockState.reset();

  await StorageService.saveAppConfig({
    clientId: '1100998877',
    appId: 'dhan-app-id-123',
    appSecret: 'dhan-secret-xyz',
  });
  const savedCfg = await StorageService.getAppConfig();
  assert.deepEqual(savedCfg, {
    clientId: '1100998877',
    appId: 'dhan-app-id-123',
    appSecret: 'dhan-secret-xyz',
  });

  const futureExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  axiosMockState.postHandler = async (url, _body, cfg) => {
    if (url.includes('/app/generate-consent')) {
      assert.equal(
        url,
        'https://auth.dhan.co/app/generate-consent?client_id=1100998877'
      );
      assert.equal(cfg?.headers?.app_id, 'dhan-app-id-123');
      assert.equal(cfg?.headers?.app_secret, 'dhan-secret-xyz');
      return {
        data: {
          consentAppId: 'consent_xyz_789',
          consentAppStatus: 'GENERATED',
        },
      };
    }
    if (url.includes('/app/consumeApp-consent')) {
      assert.equal(
        url,
        'https://auth.dhan.co/app/consumeApp-consent?tokenId=tok_live_456'
      );
      assert.equal(cfg?.headers?.app_id, 'dhan-app-id-123');
      assert.equal(cfg?.headers?.app_secret, 'dhan-secret-xyz');
      return {
        data: {
          dhanClientId: '1100998877',
          dhanClientName: 'Pushpak Trader',
          accessToken: 'jwt_live_token_999',
          expiryTime: futureExpiry,
        },
      };
    }
    throw new Error(`Unexpected auth POST ${url}`);
  };

  // Step 1: generateConsent
  const gen = await DhanAuthService.generateConsent();
  assert.equal(gen.consentAppId, 'consent_xyz_789');
  assert.equal(
    gen.loginUrl,
    'https://auth.dhan.co/login/consentApp-login?consentAppId=consent_xyz_789'
  );

  // Step 2: consumeConsent -> persists accessToken + expiryTime with isDemoMode: false
  const consumed = await DhanAuthService.consumeConsent('tok_live_456');
  assert.equal(consumed.dhanClientId, '1100998877');
  assert.equal(consumed.dhanClientName, 'Pushpak Trader');
  assert.equal(consumed.accessToken, 'jwt_live_token_999');
  assert.equal(consumed.expiryTime, futureExpiry);

  const persisted = await StorageService.getCredentials();
  assert.ok(persisted, 'consumeConsent must persist credentials to StorageService');
  assert.equal(persisted.clientId, '1100998877');
  assert.equal(persisted.accessToken, 'jwt_live_token_999');
  assert.equal(persisted.expiryTime, futureExpiry);
  assert.equal(persisted.clientName, 'Pushpak Trader');
  assert.equal(persisted.isDemoMode, false);
});

await test('DhanAuthService.isSessionValid validates future, past, Dhan space-format, and missing dates', () => {
  const futureIso = new Date(Date.now() + 3600 * 1000).toISOString();
  const pastIso = new Date(Date.now() - 3600 * 1000).toISOString();
  assert.equal(DhanAuthService.isSessionValid(futureIso), true);
  assert.equal(DhanAuthService.isSessionValid('2099-12-31 15:30:00'), true);
  assert.equal(DhanAuthService.isSessionValid(pastIso), false);
  assert.equal(DhanAuthService.isSessionValid('2020-01-01 09:15:00'), false);
  assert.equal(DhanAuthService.isSessionValid(undefined), false);
  assert.equal(DhanAuthService.isSessionValid(''), false);
  assert.equal(DhanAuthService.isSessionValid('not-a-date'), false);
});

await test('App.tsx OAuth redirect handler & Netlify auth CORS proxy are wired cleanly', () => {
  const appSrc = fs.readFileSync(path.join(ROOT_DIR, 'App.tsx'), 'utf8');
  assert.ok(appSrc.includes('extractTokenIdFromUrl'), 'App.tsx must extract tokenId on web mount');
  assert.ok(appSrc.includes('replaceState'), 'App.tsx must strip tokenId from URL via history.replaceState');
  assert.ok(appSrc.includes('consumeConsent'), 'App.tsx must call DhanAuthService.consumeConsent');

  const netlifyToml = fs.readFileSync(path.join(ROOT_DIR, 'netlify.toml'), 'utf8');
  assert.ok(netlifyToml.includes('/api/dhan-auth/*'), 'netlify.toml must map /api/dhan-auth/* redirect');

  const proxySrc = fs.readFileSync(path.join(ROOT_DIR, 'netlify/functions/dhan-proxy.js'), 'utf8');
  assert.ok(proxySrc.includes('https://auth.dhan.co'), 'dhan-proxy.js must forward auth requests to https://auth.dhan.co');
  assert.ok(proxySrc.includes('app_id') && proxySrc.includes('app_secret'), 'dhan-proxy.js must allow & forward app_id and app_secret headers');
  assert.doesNotThrow(() => new Function(proxySrc), 'netlify/functions/dhan-proxy.js must have zero JS syntax errors');
});

// ============================================================================
// SUITE H: Live Local App Verification (http://localhost:8081 or Static Export)
// ============================================================================
suite('H. Live Local App Verification (Web Bundle + Headless Chromium E2E)');

let APP_URL = process.env.TEST_APP_URL || 'http://localhost:8081';
let staticServer = null;

function startStaticServer(rootDir) {
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || '/').split('?')[0];
      let filePath = path.join(rootDir, urlPath === '/' ? 'index.html' : urlPath);
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(rootDir, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
    server.on('error', reject);
  });
}

if (process.env.TEST_STATIC_DIR && fs.existsSync(process.env.TEST_STATIC_DIR)) {
  const started = await startStaticServer(process.env.TEST_STATIC_DIR);
  staticServer = started.server;
  APP_URL = started.url;
  console.log(`  [INFO] Serving production web export at ${APP_URL}`);
}

await test('Web app serves HTTP 200 HTML and clean Expo JS bundle with zero bundler errors', async () => {
  const htmlRes = await fetch(APP_URL, { signal: AbortSignal.timeout(15000) });
  assert.equal(htmlRes.status, 200, `Expected 200 from ${APP_URL}, got ${htmlRes.status}`);
  const html = await htmlRes.text();
  assert.ok(html.includes('<div id="root">'), 'Expo web HTML should contain <div id="root">');

  const scriptMatch = html.match(/<script[^>]+src="([^"]+)"[^>]*>/i);
  assert.ok(scriptMatch, 'Expected Expo bundle <script src="..."> in HTML');

  const bundleUrl = new URL(scriptMatch[1], APP_URL).href;
  const bundleRes = await fetch(bundleUrl, { signal: AbortSignal.timeout(30000) });
  assert.equal(bundleRes.status, 200, `Expo JS bundle (${bundleUrl}) returned HTTP ${bundleRes.status}`);
  const contentType = bundleRes.headers.get('content-type') || '';
  assert.ok(
    contentType.includes('javascript') || contentType.includes('ecmascript'),
    `Expected JS bundle content-type, got "${contentType}" (possible Metro bundler JSON error)`
  );
  const bundleText = await bundleRes.text();
  assert.ok(bundleText.length > 50_000, `Expected real JS bundle, got only ${bundleText.length} bytes`);
  assert.equal(
    bundleText.trimStart().startsWith('{"type":') || bundleText.includes('__metro_error__'),
    false,
    'Metro/Expo bundle returned a bundler error payload!'
  );
});

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

function findBrowserExecutable() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

await test('Headless Chromium renders http://localhost:8081 with real DOM content and zero console/runtime errors', async () => {
  const browserPath = findBrowserExecutable();
  assert.ok(browserPath, 'Chrome or Edge executable must exist for headless verification');

  const port = await getFreePort();
  const userDataDir = path.join(os.tmpdir(), `dhan-tests-chrome-${Date.now()}`);
  fs.mkdirSync(userDataDir, { recursive: true });

  const chrome = spawn(
    browserPath,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let ws = null;
  try {
    // Wait for CDP endpoint to come up
    let targets = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        if (res.ok) {
          const list = await res.json();
          const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
          if (page) {
            targets = page;
            break;
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(targets, 'Headless Chromium CDP endpoint did not start in time');

    ws = new WebSocket(targets.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });

    let msgId = 1;
    const pending = new Map();
    const consoleErrors = [];
    const pageExceptions = [];

    ws.addEventListener('message', (evt) => {
      const msg = JSON.parse(evt.data.toString());
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
      if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
        const text = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
        consoleErrors.push(text);
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        const details = msg.params?.exceptionDetails;
        pageExceptions.push(
          details?.exception?.description || details?.text || 'Unknown Runtime Exception'
        );
      }
    });

    const cdp = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = msgId++;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });

    await cdp('Runtime.enable');
    await cdp('Page.enable');
    await cdp('Page.navigate', { url: APP_URL });

    // Poll DOM until React mounts meaningful UI (up to 15 seconds)
    let bodyText = '';
    for (let i = 0; i < 30; i++) {
      const evalRes = await cdp('Runtime.evaluate', {
        expression: 'document.body ? document.body.innerText : ""',
        returnByValue: true,
      });
      bodyText = String(evalRes?.result?.value || '');
      if (bodyText.trim().length > 80) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    assert.ok(
      bodyText.trim().length > 80,
      `App did not render meaningful DOM content within 15s. Got: ${JSON.stringify(bodyText.slice(0, 200))}`
    );
    assert.ok(
      /NIFTY|Option Chain|Positions|Rules|Demo/i.test(bodyText),
      `Rendered DOM missing expected app headings/tabs. Text preview: ${bodyText.slice(0, 200)}`
    );

    // Wait for InteractiveChart iframe + KLineChart v9 canvas to mount inside the Chart tab
    let chartCheck = null;
    for (let i = 0; i < 20; i++) {
      const iframeEval = await cdp('Runtime.evaluate', {
        expression: `(() => {
          const iframe = document.querySelector('iframe');
          if (!iframe || !iframe.contentWindow || !iframe.contentDocument) return { ready: false, reason: 'no iframe' };
          const w = iframe.contentWindow;
          const d = iframe.contentDocument;
          const hasKlineLib = typeof w.klinecharts !== 'undefined';
          const canvases = d.querySelectorAll('#klineContainer canvas').length;
          const hasDrawRail = !!d.getElementById('drawRail');
          const hasHandler = typeof w.handleHostMessage === 'function';
          return {
            ready: hasKlineLib && canvases > 0 && hasDrawRail && hasHandler,
            hasKlineLib,
            canvases,
            hasDrawRail,
            hasHandler,
          };
        })()`,
        returnByValue: true,
      });
      chartCheck = iframeEval?.result?.value;
      if (chartCheck && chartCheck.ready) break;
      await new Promise((r) => setTimeout(r, 400));
    }

    assert.ok(
      chartCheck && chartCheck.ready,
      `KLineChart v9 did not initialize cleanly inside chart iframe: ${JSON.stringify(chartCheck)}`
    );

    // Exercise live message handlers inside the rendered iframe (overlayOpacity + LIVE_TICK + RESET_CHART)
    const msgCheck = await cdp('Runtime.evaluate', {
      expression: `(() => {
        const iframe = document.querySelector('iframe');
        const w = iframe.contentWindow;
        const d = iframe.contentDocument;
        w.handleHostMessage(JSON.stringify({ type: 'SYNC_STATE', overlayOpacity: 0.35 }));
        w.handleHostMessage(JSON.stringify({ type: 'LIVE_TICK', price: 151.25, volume: 75, timestamp: Date.now() }));
        w.handleHostMessage(JSON.stringify({ type: 'RESET_CHART' }));
        return {
          ltpText: d.getElementById('ltpHeader')?.textContent || '',
          hasResetBtn: !!d.getElementById('btnResetChart'),
        };
      })()`,
      returnByValue: true,
    });
    assert.ok(
      String(msgCheck?.result?.value?.ltpText || '').includes('151.25'),
      `LIVE_TICK did not update chart LTP badge; got ${JSON.stringify(msgCheck?.result?.value)}`
    );
    assert.equal(
      msgCheck?.result?.value?.hasResetBtn,
      true,
      'Floating #btnResetChart button missing inside chart iframe'
    );

    // Verify editable Entry/SL/TP inputs, 9-timeframe strip, and 1-Click/Confirm toggle in Chart tab
    const uiCheck = await cdp('Runtime.evaluate', {
      expression: `(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const text = document.body.innerText || '';
        const hasTfs = ['1m', '5m', '15m', '1H', '4H', '1D', '1W'].every((tf) => text.includes(tf));
        const hasAuto = text.includes('Auto');
        const hasConfirmOrOneClick = text.includes('Confirm') || text.includes('1-Click');
        return { inputCount: inputs.length, hasTfs, hasAuto, hasConfirmOrOneClick };
      })()`,
      returnByValue: true,
    });
    assert.ok(
      uiCheck?.result?.value?.inputCount >= 3,
      `Expected >=3 editable price TextInputs (Entry/SL/TP), got ${JSON.stringify(uiCheck?.result?.value)}`
    );
    assert.equal(uiCheck?.result?.value?.hasTfs, true, 'Missing 1m..1W timeframe pills in chart toolbar');
    assert.equal(uiCheck?.result?.value?.hasAuto, true, 'Missing ⟲ Auto reset button in chart toolbar');
    assert.equal(uiCheck?.result?.value?.hasConfirmOrOneClick, true, 'Missing 1-Click / Confirm mode toggle');

    // Toggle ✓ Confirm -> ⚡ 1-Click -> ✓ Confirm cleanly (match exact pill text, not toast banner!)
    const toggleCheck = await cdp('Runtime.evaluate', {
      expression: `(() => {
        const el = Array.from(document.querySelectorAll('div, span, button')).find(
          (n) => n.childElementCount === 0 && n.textContent && n.textContent.trim() === '✓ Confirm'
        );
        if (el) { el.click(); return true; }
        return false;
      })()`,
      returnByValue: true,
    });
    assert.equal(toggleCheck?.result?.value, true, 'Could not click ✓ Confirm mode toggle');
    await new Promise((r) => setTimeout(r, 350));
    const afterToggle = await cdp('Runtime.evaluate', {
      expression: `Array.from(document.querySelectorAll('div, span, button')).some(
        (n) => n.childElementCount === 0 && n.textContent && n.textContent.trim() === '⚡ 1-Click'
      )`,
      returnByValue: true,
    });
    assert.equal(afterToggle?.result?.value, true, 'Clicking ✓ Confirm should toggle to ⚡ 1-Click');

    // Toggle back to ✓ Confirm (exact pill text!) and trigger on-chart Quick BUY to verify Confirm Order modal opens cleanly
    const toggleBack = await cdp('Runtime.evaluate', {
      expression: `(() => {
        const el = Array.from(document.querySelectorAll('div, span, button')).find(
          (n) => n.childElementCount === 0 && n.textContent && n.textContent.trim() === '⚡ 1-Click'
        );
        if (el) { el.click(); return true; }
        return false;
      })()`,
      returnByValue: true,
    });
    assert.equal(toggleBack?.result?.value, true, 'Could not click ⚡ 1-Click mode toggle');
    await new Promise((r) => setTimeout(r, 350));
    const backToConfirm = await cdp('Runtime.evaluate', {
      expression: `Array.from(document.querySelectorAll('div, span, button')).some(
        (n) => n.childElementCount === 0 && n.textContent && n.textContent.trim() === '✓ Confirm'
      )`,
      returnByValue: true,
    });
    assert.equal(backToConfirm?.result?.value, true, 'Clicking ⚡ 1-Click should toggle back to ✓ Confirm');
    await cdp('Runtime.evaluate', {
      expression: `(() => {
        const iframe = document.querySelector('iframe');
        const buyBtn = iframe?.contentDocument?.getElementById('btnQuickBuy');
        if (buyBtn) buyBtn.click();
      })()`,
      returnByValue: true,
    });
    let modalShown = false;
    for (let i = 0; i < 12; i++) {
      const m = await cdp('Runtime.evaluate', {
        expression: `(document.body.innerText || '').includes('Confirm & Place')`,
        returnByValue: true,
      });
      if (m?.result?.value) {
        modalShown = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(modalShown, true, 'Clicking on-chart Quick BUY in Confirm mode did not open Confirm & Place overlay');

    // Dismiss Confirm Order modal cleanly
    await cdp('Runtime.evaluate', {
      expression: `(() => {
        const el = Array.from(document.querySelectorAll('div, span, button')).find(
          (n) => n.childElementCount === 0 && n.textContent && n.textContent.trim().includes('Cancel')
        );
        if (el) el.click();
      })()`,
      returnByValue: true,
    });
    await new Promise((r) => setTimeout(r, 250));

    // Switch to MKT mode and verify Entry becomes read-only (only 2 numeric inputs for SL/TP)
    await cdp('Runtime.evaluate', {
      expression: `(() => {
        const el = Array.from(document.querySelectorAll('div, span, button')).find(
          (n) => n.childElementCount === 0 && n.textContent && n.textContent.trim() === 'MKT'
        );
        if (el) el.click();
      })()`,
      returnByValue: true,
    });
    await new Promise((r) => setTimeout(r, 350));
    const mktCheck = await cdp('Runtime.evaluate', {
      expression: `({ inputCount: document.querySelectorAll('input').length })`,
      returnByValue: true,
    });
    assert.equal(
      mktCheck?.result?.value?.inputCount,
      2,
      `Expected 2 editable inputs (SL & TP only, Entry read-only) in MKT mode, got ${JSON.stringify(mktCheck?.result?.value)}`
    );

    // Switch timeframe to 1H and verify zero runtime errors
    await cdp('Runtime.evaluate', {
      expression: `(() => {
        const el = Array.from(document.querySelectorAll('div, span, button')).find(
          (n) => n.childElementCount === 0 && n.textContent && n.textContent.trim() === '1H'
        );
        if (el) el.click();
      })()`,
      returnByValue: true,
    });
    await new Promise((r) => setTimeout(r, 500));

    // Navigate to Option Chain tab and verify ⚡ LIVE WS renders cleanly
    await cdp('Runtime.evaluate', {
      expression: `(() => {
        const nodes = Array.from(document.querySelectorAll('div, span, button'));
        const chainBtn = nodes.find((el) => el.childElementCount === 0 && el.textContent && el.textContent.trim() === 'Chain');
        if (chainBtn) chainBtn.click();
      })()`,
      returnByValue: true,
    });
    let chainText = '';
    for (let i = 0; i < 15; i++) {
      const res = await cdp('Runtime.evaluate', {
        expression: 'document.body ? document.body.innerText : ""',
        returnByValue: true,
      });
      chainText = String(res?.result?.value || '');
      if (chainText.includes('LIVE WS') || chainText.includes('STRIKE')) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(
      chainText.includes('LIVE WS') && chainText.includes('STRIKE'),
      `Option Chain tab did not render LIVE WS / STRIKE table cleanly. Preview: ${chainText.slice(0, 250)}`
    );

    // Navigate to Account tab and verify both ⚡ 1-Tap Dhan Login (default) & 🔑 Manual JWT Token tabs render cleanly
    await cdp('Runtime.evaluate', {
      expression: `(() => {
        const nodes = Array.from(document.querySelectorAll('div, span, button'));
        const accountBtn = nodes.find((el) => el.childElementCount === 0 && el.textContent && el.textContent.trim() === 'Account');
        if (accountBtn) accountBtn.click();
      })()`,
      returnByValue: true,
    });
    let accountText = '';
    for (let i = 0; i < 15; i++) {
      const res = await cdp('Runtime.evaluate', {
        expression: 'document.body ? document.body.innerText : ""',
        returnByValue: true,
      });
      accountText = String(res?.result?.value || '');
      if (accountText.includes('1-Tap Dhan Login') && accountText.includes('Login with Dhan')) break;
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.ok(
      accountText.includes('1-Tap Dhan Login') &&
        accountText.includes('Manual JWT Token') &&
        accountText.includes('Client ID') &&
        accountText.includes('API Key') &&
        accountText.includes('API Secret') &&
        accountText.includes('Login with Dhan'),
      `Account tab default 1-Tap Dhan Login UI incomplete. Preview: ${accountText.slice(0, 350)}`
    );

    // Switch to 🔑 Manual JWT Token tab and verify it renders cleanly
    await cdp('Runtime.evaluate', {
      expression: `(() => {
        const nodes = Array.from(document.querySelectorAll('div, span, button'));
        const jwtTab = nodes.find((el) => el.childElementCount === 0 && el.textContent && el.textContent.trim().includes('Manual JWT Token'));
        if (jwtTab) jwtTab.click();
      })()`,
      returnByValue: true,
    });
    await new Promise((r) => setTimeout(r, 350));
    const jwtTextRes = await cdp('Runtime.evaluate', {
      expression: 'document.body ? document.body.innerText : ""',
      returnByValue: true,
    });
    const jwtText = String(jwtTextRes?.result?.value || '');
    assert.ok(
      jwtText.includes('Access Token') && jwtText.includes('Client ID'),
      `Manual JWT Token tab did not render expected form fields. Preview: ${jwtText.slice(0, 300)}`
    );

    assert.deepEqual(
      pageExceptions,
      [],
      `Uncaught runtime JS exceptions on ${APP_URL}: ${JSON.stringify(pageExceptions)}`
    );
    assert.deepEqual(
      consoleErrors,
      [],
      `Console errors on ${APP_URL}: ${JSON.stringify(consoleErrors)}`
    );
  } finally {
    try {
      ws?.close();
    } catch {}
    try {
      chrome.kill('SIGKILL');
    } catch {}
    // Wait briefly before cleaning up temp profile dir
    await new Promise((r) => setTimeout(r, 400));
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true });
    } catch {}
  }
});

if (staticServer) {
  staticServer.close();
}

// ============================================================================
// 4. Final Summary
// ============================================================================
const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
console.log(`\n========================================`);
console.log(`AUTOMATION TEST SUMMARY: ${passed}/${results.length} PASSED, ${failed} FAILED`);
console.log(`========================================`);

if (failed > 0) {
  process.exitCode = 1;
}
