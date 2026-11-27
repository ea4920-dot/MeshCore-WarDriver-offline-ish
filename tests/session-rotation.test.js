"use strict";

const {readFileSync} = require("node:fs");
const {runInNewContext} = require("node:vm");
const {test} = require("node:test");
const assert = require("node:assert/strict");

const html = readFileSync(new URL("../index.html", `file://${__filename}`), "utf8");

function extract(startText, endText) {
  const start = html.indexOf(startText);
  const end = html.indexOf(endText, start);
  assert.notEqual(start, -1, `Missing source: ${startText}`);
  assert.notEqual(end, -1, `Missing source boundary: ${endText}`);
  return html.slice(start, end);
}

const sessionHelpers = extract(
  "function receiverSessionPrefix(",
  "\nfunction cancelRecordingStart("
);
const saveTrackPointFunction = extract(
  "async function saveTrackPoint(",
  "\nasync function savePacket("
);
const recordingStart = extract(
  "function startRecord()",
  "\nasync function beginRecordingWithGPS("
);
const rotationFunctions = extract(
  "function trackWrite(",
  "\nasync function stopAndSync("
);
const activeSessionFunction = extract(
  "function activeSession(id)",
  "\nfunction usableServerBase("
);
const pendingSync = extract(
  "async function syncPending()",
  "\n/* One-button connection and recording controls */"
);
const postSession = extract(
  "async function postSession(",
  "\nasync function finishPostWithVerification("
);

function makeRotationHarness(options = {}) {
  const writes = [];
  const completed = [];
  const pending = [];
  const labels = new Map();
  const dates = options.dates||[
    "2026-11-27T10:00:00.000Z",
    "2026-11-27T10:01:00.000Z",
    "2026-11-27T10:02:00.000Z"
  ];
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [dates.shift() || "2026-11-27T10:03:00.000Z"]));
    }
  }
  const context = {
    Date: FixedDate,
    TextEncoder,
    MAX_SESSION_PACKETS: 500,
    MAX_SESSION_UPLOAD_BYTES: 5 * 1024 * 1024,
    SESSION_UPLOAD_SAFETY_BYTES: options.byteLimit ??
      Math.floor(5 * 1024 * 1024 * 0.9),
    writeJobs: new Set(),
    recording: true,
    recordingStartPending: false,
    recordingStartBusy: false,
    recordingStopBusy: false,
    gpsStopPromise: null,
    managerUploadingId: null,
    managerUploadAutomatic: false,
    syncBusy: false,
    syncQueued: false,
    sessionRotationPending: false,
    sessionRotationPromise: null,
    rotationObservationBuffer: [],
    recordingWriteFailures: new Map(),
    lastRecordingSessionTimestamp: 0,
    completedSession: false,
    sessionId: "Receiver-RX_2026-11-27T09:00:00.000Z",
    recordingReceiverName: "Receiver RX",
    sessionPacketEstimateCount: 0,
    sessionUploadEstimatedBytes: 100,
    packetCount: 0,
    trackCount: 0,
    noGps: 0,
    rxCount: 0,
    currentSessionPackets: [],
    packetLayer: null,
    trackLine: null,
    device: null,
    db: {},
    uploadPayload: (id, packets, track) => ({session_id: id, packets, track}),
    savePacket: async point => {
      if (options.savePacket) await options.savePacket(point);
      writes.push({kind: "packet", ...point});
    },
    dbPut: async (store, value) => {
      if(store==="track") {
        if(options.saveTrackPoint) await options.saveTrackPoint(value);
        writes.push({kind:"track",...value});
        return writes.length;
      }
      if(store==="meta"&&value.key==="current"&&options.saveCurrentSession) {
        await options.saveCurrentSession(value.value);
      }
      if (store === "meta" && value.key.startsWith("pending:")) {
        pending.push(value.value);
      }
      if (store === "meta" && value.key === "current") {
        labels.set(value.value, context.recordingReceiverName);
      }
    },
    refreshPending: async () => [],
    refreshSessionManager: async () => {},
    updateCounts: () => {},
    drawTrack: () => {},
    updateButtons: () => {},
    rebuildObservationCounts: () => {},
    drawTrack: () => {},
    $: id => ({textContent: ""}),
    log: message => { context.lastLog = message; },
    stopRecord: () => { context.recording=false; },
    startGPS: () => true,
    updateRecordingGPSStatus: () => {},
    syncPending: () => { context.syncCalls = (context.syncCalls || 0) + 1; },
    serverListLoaded: true,
    syncUrl: "https://map.example",
    uploadToken: "token",
    pendingIds: async () => [],
    serverBase: () => "https://map.example",
    fetchServerSessions: async () => [],
    activeSession: () => false,
    syncState: () => {},
    dbCountFor: async () => 1,
    dbGet: async () => null,
    serverEntryFor: () => null,
    recordVerification: async () => {},
    markSessionVerified: async () => {},
    setSessionVerificationUnavailable: async () => {},
    attemptSessionUpload: async () => ({status: "Verified"})
  };
  const api = runInNewContext(
    `${sessionHelpers}\n${saveTrackPointFunction}\n${recordingStart}\n${rotationFunctions}\n` +
    `${activeSessionFunction}\n` +
    `({enqueueRecordingObservation,startRecord,scheduleSessionRotation,activeSession,saveTrackPoint,createRecordingSession,` +
    `estimatedUploadRowBytes,uploadTrackRecord,` +
    `get:()=>({sessionId,recording,sessionRotationPending,sessionRotationPromise,` +
    `sessionPacketEstimateCount,sessionUploadEstimatedBytes,rotationObservationBuffer,trackCount,` +
    `managerUploadAutomatic,recordingStartPending,pendingWrites:writeJobs.size}),` +
    `set:(values)=>Object.assign(globalThis,values)})`,
    context
  );
  return {api, context, writes, completed, pending, labels};
}

async function waitForRotation(api) {
  const rotation = api.get().sessionRotationPromise;
  if (rotation) await rotation;
}

test("the 500th packet completes its session and continues with receiver identity", async () => {
  const {api, writes, pending, labels} = makeRotationHarness();
  api.set({
    sessionPacketEstimateCount: 499,
    sessionUploadEstimatedBytes: 100,
    recordingReceiverName: "Receiver RX"
  });
  await api.enqueueRecordingObservation("packet", {timestamp: "one"});
  await waitForRotation(api);

  assert.equal(writes.length, 1);
  assert.equal(writes[0].session, "Receiver-RX_2026-11-27T09:00:00.000Z");
  assert.deepEqual(pending, ["Receiver-RX_2026-11-27T09:00:00.000Z"]);
  assert.match(api.get().sessionId, /^Receiver-RX_2026-11-27T10:00:00\.000Z$/);
  assert.equal(labels.get(api.get().sessionId), "Receiver RX");
  assert.equal(api.get().recording, true);
});

test("the 5 MB safety threshold rotates GPS-only sessions below the hard limit", async () => {
  const {api, writes, pending} = makeRotationHarness();
  const safeThreshold=Math.floor(5*1024*1024*0.9);
  const point = {timestamp: "gps-only", lat: 1, lon: 2};
  const rowBytes = api.estimatedUploadRowBytes(api.uploadTrackRecord(point));
  api.set({
    sessionPacketEstimateCount: 0,
    sessionUploadEstimatedBytes: safeThreshold-rowBytes
  });

  await api.enqueueRecordingObservation("track", point);
  await waitForRotation(api);

  assert.equal(writes[0].kind, "track");
  assert.equal(writes[0].session, "Receiver-RX_2026-11-27T09:00:00.000Z");
  assert.deepEqual(pending, ["Receiver-RX_2026-11-27T09:00:00.000Z"]);
  assert.equal(api.get().sessionPacketEstimateCount, 0);
  assert.ok(api.get().sessionUploadEstimatedBytes < 5*1024*1024);
});

test("GPS track observations use the real IndexedDB writer and count only successful writes", async () => {
  const {api,writes,context}=makeRotationHarness();
  const point={timestamp:"gps-track",lat:43.1,lon:-79.2};
  await api.enqueueRecordingObservation("track",point);

  assert.equal(writes.length,1);
  assert.equal(writes[0].kind,"track");
  assert.equal(writes[0].session,"Receiver-RX_2026-11-27T09:00:00.000Z");
  assert.equal(context.trackCount,1);

  const failed=makeRotationHarness({
    byteLimit:1,
    saveTrackPoint:async()=>{throw new Error("IndexedDB write failed");}
  });
  await failed.api.enqueueRecordingObservation("track",point);
  await waitForRotation(failed.api);
  assert.equal(failed.context.trackCount,0);
  assert.deepEqual(failed.pending,[],"failed GPS writes do not complete or queue the session");
});

test("observations arriving during session creation drain into the new session before stop completes", async () => {
  let releaseSessionCreation;
  let createdSession;
  let api;
  const {writes,pending,context,...rest}=makeRotationHarness({
    saveCurrentSession:async id=>{
      if(id==="Receiver-RX_2026-11-27T10:00:00.000Z") {
        createdSession=id;
        await new Promise(resolve=>{releaseSessionCreation=resolve;});
      }
    }
  });
  api=rest.api;
  api.set({sessionPacketEstimateCount:499});
  await api.enqueueRecordingObservation("packet",{timestamp:"threshold"});
  for(let i=0;i<20&&!releaseSessionCreation;i++) {
    await new Promise(resolve=>setImmediate(resolve));
  }
  assert.equal(typeof releaseSessionCreation,"function");
  api.enqueueRecordingObservation("track",{timestamp:"queued-gps"});
  api.enqueueRecordingObservation("packet",{timestamp:"queued-ble"});
  api.set({recording:false});
  releaseSessionCreation();
  await waitForRotation(api);

  assert.equal(createdSession,"Receiver-RX_2026-11-27T10:00:00.000Z");
  assert.deepEqual(writes.map(row=>[row.kind,row.timestamp,row.session]),[
    ["packet","threshold","Receiver-RX_2026-11-27T09:00:00.000Z"],
    ["track","queued-gps",createdSession],
    ["packet","queued-ble",createdSession]
  ]);
  assert.deepEqual(pending,[
    "Receiver-RX_2026-11-27T09:00:00.000Z",
    createdSession
  ]);
  assert.equal(context.rotationObservationBuffer.length,0);
});

test("session IDs remain unique when consecutive rotations use the same millisecond", async () => {
  const {api}=makeRotationHarness({dates:[
    "2026-11-27T10:00:00.000Z",
    "2026-11-27T10:00:00.000Z"
  ]});
  const first=await api.createRecordingSession("Receiver RX");
  const second=await api.createRecordingSession("Receiver RX");
  assert.notEqual(first,second);
  assert.equal(Date.parse(second.slice(second.indexOf("_")+1))-
    Date.parse(first.slice(first.indexOf("_")+1)),1);
});

test("rotation waits for outstanding writes and stop finalizes buffered observations", async () => {
  const releases=[];
  let writeNumber=0;
  const {api, writes, pending} = makeRotationHarness({
    savePacket: async () => {
      if(writeNumber<2) await new Promise(resolve=>releases[writeNumber++]=resolve);
    }
  });
  api.set({sessionPacketEstimateCount: 498});
  const firstPromise = api.enqueueRecordingObservation("packet", {timestamp: "old-1"});
  const secondPromise = api.enqueueRecordingObservation("packet", {timestamp: "old-2"});
  await Promise.resolve();
  assert.equal(api.get().sessionRotationPending, true);
  api.enqueueRecordingObservation("packet", {timestamp: "buffered"});
  api.set({recording: false});
  assert.deepEqual(writes, [], "completion waits while the old IndexedDB write is outstanding");
  assert.equal(api.get().pendingWrites,2,"both old-session writes are still pending");

  releases[0]();
  await firstPromise;
  assert.deepEqual(pending,[],"rotation waits for every outstanding write");
  releases[1]();
  await secondPromise;
  await waitForRotation(api);

  assert.deepEqual(writes.map(item => item.session), [
    "Receiver-RX_2026-11-27T09:00:00.000Z",
    "Receiver-RX_2026-11-27T09:00:00.000Z",
    "Receiver-RX_2026-11-27T10:00:00.000Z"
  ]);
  assert.deepEqual(pending, [
    "Receiver-RX_2026-11-27T09:00:00.000Z",
    "Receiver-RX_2026-11-27T10:00:00.000Z"
  ]);
  assert.equal(api.get().recording, false);
});

test("manual stop and rotation keep an incomplete current session unavailable for upload", () => {
  const {api} = makeRotationHarness();
  api.set({
    recording: false,
    completedSession: false,
    packetCount: 10,
    recordingStopBusy: true,
    sessionRotationPending: false
  });
  assert.equal(api.activeSession(api.get().sessionId), true);

  api.set({recordingStopBusy: false, sessionRotationPending: true});
  assert.equal(api.activeSession(api.get().sessionId), true);
});

test("recording can start and accept packets while automatic sync is uploading", async () => {
  const {api, writes, context} = makeRotationHarness();
  let releaseUpload;
  const upload = new Promise(resolve => { releaseUpload = resolve; });
  context.pendingIds = async () => ["previous-session"];
  context.refreshPending = async () => ["previous-session"];
  context.fetchServerSessions = async () => [];
  context.dbGet = async () => null;
  context.attemptSessionUpload = async () => {
    context.managerUploadAutomatic = true;
    await upload;
    return {status: "Verified"};
  };
  context.recording = false;
  context.syncUrl = "https://map.example";

  const syncing = runInNewContext(`(${pendingSync})`, context)();
  for (let i=0; i<10&&!context.managerUploadAutomatic; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(context.managerUploadAutomatic, true);
  api.startRecord();
  assert.equal(api.get().recordingStartPending, true);

  context.recording = true;
  await api.enqueueRecordingObservation("packet", {timestamp: "during-upload"});
  assert.equal(writes.length, 1);
  assert.equal(context.syncBusy, true);

  releaseUpload();
  await syncing;
});

test("failed automatic uploads retain pending IDs and can be retried", async () => {
  const {api, context} = makeRotationHarness();
  const id = "Receiver-RX_2026-11-27T09:00:00.000Z";
  context.recording = false;
  context.completedSession = true;
  let attempts = 0;
  const syncMessages = [];
  context.syncState = message => syncMessages.push(message);
  context.log = message => syncMessages.push(message);
  context.pendingIds = async () => [id];
  context.refreshPending = async () => [id];
  context.fetchServerSessions = async () => [];
  context.dbGet = async () => null;
  context.attemptSessionUpload = async sessionId => {
    assert.equal(sessionId, id);
    attempts++;
    if (attempts === 1) throw new Error("offline");
    return {status: "Verified"};
  };

  const retryPending = runInNewContext(`(${pendingSync})`, context);
  await retryPending();
  assert.equal(attempts, 1, syncMessages.join("; "));
  await retryPending();
  assert.equal(attempts, 2);
});

test("the final serialized upload is rejected above 5 MB", async () => {
  let requests=0;
  const context={
    MAX_SESSION_UPLOAD_BYTES:5*1024*1024,
    uploadToken:"token",
    uploadPayload:()=>({observation:"x".repeat(5*1024*1024)}),
    utf8ByteLength:value=>new TextEncoder().encode(value).length,
    fetch:async()=>{requests++;return {ok:true,json:async()=>({status:"saved"})};}
  };
  const send=runInNewContext(`(${postSession})`,context);
  await assert.rejects(
    send("Receiver-RX_2026-11-27T10:00:00.000Z",[],[],"https://map.example"),
    /exceeds the 5 MB server limit/
  );
  assert.equal(requests,0);
});
