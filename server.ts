// server.ts
// TypeScript single-file Telephony backend (Twilio Media Streams -> Deepgram streaming)
// Exposes: POST /dial, POST /send-dtmf, POST /hangup
// Also exposes: GET /twiml/:callId  (returns TwiML that starts Media Streams toward our WS)
// WebSocket endpoint: /twilio-ws  (Twilio connects here; we forward audio to Deepgram)
// NOTE: This is a robust starting point. Audio codec conversion or advanced audio framing
// may be required depending on your Twilio Media Streams audio format and Deepgram config.
// See comment blocks for `TODO` and recommended production improvements.

import express from "express";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import { v4 as uuidv4 } from "uuid";
import Twilio from "twilio";
import { WebSocketServer, WebSocket } from "ws";
import axios from "axios";
import http from "http";

dotenv.config();

// ---------------------------
// Environment & validation
// ---------------------------
const PORT = Number(process.env.PORT || 3000);
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || "";
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || "";
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || "";
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || ""; // e.g. https://abc.ngrok.io
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || "";

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER) {
  console.error("Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM_NUMBER in .env");
  process.exit(1);
}
if (!WEBHOOK_BASE_URL) {
  console.error("Set WEBHOOK_BASE_URL (public) in .env so Twilio can reach your TwiML endpoints.");
  process.exit(1);
}
if (!DEEPGRAM_API_KEY) {
  console.warn("DEEPGRAM_API_KEY not set — transcripts will be empty unless you provide a key.");
}

// ---------------------------
// Types
// ---------------------------
type AudioProcessingResult = {
  callId: string;
  transcript: string;
  confidence: number;
  audioUrl?: string;
  durationMs?: number;
  detectedDtmf?: string;
};

// internal per-call state tracked on server
type CallState = {
  callId: string;
  twilioCallSid?: string;
  ws?: WebSocket; // twilio->our ws connection
  deepgramWs?: WebSocket; // our->deepgram ws
  transcriptBuffer: string[]; // incremental transcripts
  lastTranscript: string;
  lastConfidence: number;
  createdAt: number;
  pendingPromises: { resolve: (r: AudioProcessingResult) => void; timeout: NodeJS.Timeout }[];
};

// in-memory call store (for demo). For production, persist mapping to DB if needed.
const calls = new Map<string, CallState>();

// ---------------------------
// Twilio client
// ---------------------------
const twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// ---------------------------
// Express app
// ---------------------------
const app = express();
app.use(bodyParser.json({ limit: "20mb" }));

// ---------------------------
// Utility: create CallState
// ---------------------------
function makeCallState(callId?: string): CallState {
  const id = callId ?? uuidv4();
  return {
    callId: id,
    ws: undefined,
    deepgramWs: undefined,
    twilioCallSid: undefined,
    transcriptBuffer: [],
    lastTranscript: "",
    lastConfidence: 0,
    createdAt: Date.now(),
    pendingPromises: [],
  };
}

// ---------------------------
// Deepgram streaming helper
// ---------------------------
// We open a single Deepgram websocket per call and forward binary audio frames.
// Deepgram WS URL: wss://api.deepgram.com/v1/listen?model=general&language=en-US
function openDeepgramWebSocket(callState: CallState) {
  if (!DEEPGRAM_API_KEY) return;
  const dgUrl = `wss://api.deepgram.com/v1/listen?language=en-US&encoding=mulaw&sample_rate=8000`; 
  // NOTE: encoding/sample_rate must match Twilio Media Stream format (mulaw 8k typical).
  // If your Twilio stream is linear16 8000 or 16000, set accordingly.
  
  const headers = {
    Authorization: `Token ${DEEPGRAM_API_KEY}`,
  };
  const dgWs = new WebSocket(dgUrl, { headers });

  dgWs.on("open", () => {
    console.log(`[deepgram] connected for call ${callState.callId}`);
  });

  dgWs.on("message", (msg) => {
    // Deepgram sends JSON transcripts; parse and capture
    try {
      const parsed = typeof msg === "string" ? JSON.parse(msg) : JSON.parse(msg.toString());
      // Deepgram real-time format: { channel: { alternatives: [ { transcript, confidence } ] } } (varies)
      const alt = parsed?.channel?.alternatives?.[0];
      if (alt) {
        const t = alt.transcript || "";
        const conf = alt.confidence ?? callState.lastConfidence;
        if (t && t.trim().length > 0) {
          callState.transcriptBuffer.push(t);
          callState.lastTranscript = t;
          callState.lastConfidence = conf;
          
          // resolve any pending waiter for "next prompt"
          if (callState.pendingPromises.length > 0) {
            const { resolve, timeout } = callState.pendingPromises.shift()!;
            clearTimeout(timeout);
            resolve({
              callId: callState.callId,
              transcript: callState.lastTranscript,
              confidence: callState.lastConfidence,
              audioUrl: undefined,
              durationMs: undefined,
            });
          }
        }
      }
    } catch (e) {
      // not JSON (could be binary); ignore
    }
  });

  dgWs.on("close", () => {
    console.log(`[deepgram] closed for call ${callState.callId}`);
  });

  dgWs.on("error", (err) => {
    console.error("[deepgram] ws error:", err);
  });

  callState.deepgramWs = dgWs;
}

// ---------------------------
// WebSocket server for Twilio Media Streams
// Twilio will open a WS connection to ws://<public>/twilio-ws with a query param StreamSid or callSid.
// The messages are JSON frames containing media (base64) and events.
// ---------------------------
const wss = new WebSocketServer({ noServer: true });

// The Twilio WS protocol sends JSON messages. The 'media' events contain `payload` base64 mulaw frames.
// We'll listen for 'start', 'media', 'stop', 'dtmf' events.
wss.on("connection", (ws: WebSocket, req) => {
  // Identify callId from query
  const url = req.url || "";
  const params = new URL(`http://dummy${url}`).searchParams;
  const callId = params.get("callId") || params.get("CallSid") || params.get("session") || undefined;

  console.log(`[ws] twilio connected (callId=${callId})`);

  if (!callId || !calls.has(callId)) {
    console.warn(`[ws] unknown callId ${callId} connecting. Creating ephemeral state.`);
    calls.set(callId || uuidv4(), makeCallState(callId));
  }

  const state = calls.get(callId!)!;
  state.ws = ws;

  // ensure deepgram websocket open
  if (!state.deepgramWs) openDeepgramWebSocket(state);

  ws.on("message", (data) => {
    // Twilio Media Streams send JSON frames as text.
    let parsed: any;
    try {
      parsed = JSON.parse(data.toString());
    } catch (err) {
      return;
    }

    // Event types:
    // { event: 'start', ... }
    // { event: 'media', media: { payload: '<base64audio>' } }
    // { event: 'stop', ... }
    // { event: 'dtmf', ... } (sometimes)
    const evt = parsed.event;

    if (evt === "start") {
      console.log(`[ws] media start for call ${state.callId}`);
      // Optionally record that stream started
    } else if (evt === "media") {
      // base64 payload
      const payload = parsed.media?.payload;
      if (!payload) return;

      // Twilio media payload is base64-encoded single-channel mulaw (usually).
      // For Deepgram, we can forward raw mulaw frames as binary frames if Deepgram was
      // configured with encoding=mulaw&sample_rate=8000.
      // Convert base64 -> Buffer and send binary frame to Deepgram WS
      try {
        const audioBuffer = Buffer.from(payload, "base64");
        if (state.deepgramWs && state.deepgramWs.readyState === WebSocket.OPEN) {
          state.deepgramWs.send(audioBuffer);
        }
      } catch (err) {
        console.error("audio forward error", err);
      }
    } else if (evt === "dtmf") {
      // Twilio may notify of DTMF if detected; record if present
      const dtmf = parsed?.dtmf?.digit;
      if (dtmf) {
        state.transcriptBuffer.push(`[DTMF:${dtmf}]`);
        state.lastTranscript = state.transcriptBuffer.join(" ");
        state.lastConfidence = state.lastConfidence || 1.0;
      }
    } else if (evt === "stop") {
      console.log(`[ws] media stop for call ${state.callId}`);
      // close deepgram ws gracefully
      if (state.deepgramWs && state.deepgramWs.readyState === WebSocket.OPEN) {
        try {
          state.deepgramWs.close();
        } catch {}
      }
    } else {
      // other events
    }
  });

  ws.on("close", () => {
    console.log(`[ws] twilio ws closed for call ${state.callId}`);
    state.ws = undefined;
    // We don't close deepgramWs here automatically — allow it to finish
  });

  ws.on("error", (err) => {
    console.error("[ws] twilio ws error:", err);
  });
});

// We must hook the WS server into the HTTP server later when starting express

// ---------------------------
// TwiML endpoint used by Twilio when call is answered.
// This TwiML instructs Twilio to start Media Streams to our WS URL
// ---------------------------
app.post("/twiml/:callId", (req, res) => {
  const callId = req.params.callId;
  // Twilio Media Streams TwiML:
  // <Response>
  //   <Start>
  //     <Stream url="wss://<public>/twilio-ws?callId=CALLID" />
  //   </Start>
  //   <Pause length="1" />
  //   <Say>Connecting...</Say>
  // </Response>
  const streamUrl = `${WEBHOOK_BASE_URL.replace(/\/$/, "")}/twilio-ws?callId=${encodeURIComponent(callId)}`;
  const twiml = `<Response>
    <Start>
      <Stream url="${streamUrl}" />
    </Start>
    <Pause length="1" />
    <Say voice="alice">Please wait while we capture the prompt for crawling.</Say>
  </Response>`;
  res.type("text/xml").send(twiml);
});

// ---------------------------
// POST /dial
// body: { endpoint: string, callerId?: string }
// returns: { callId, transcript, confidence }
// ---------------------------
app.post("/dial", async (req, res) => {
  const { endpoint, callerId } = req.body;
  if (!endpoint) return res.status(400).json({ error: "Missing endpoint" });

  try {
    const callId = uuidv4();
    const state = makeCallState(callId);
    calls.set(callId, state);

    // Create TwiML URL that Twilio will request when the call is answered
    const twimlUrl = `${WEBHOOK_BASE_URL.replace(/\/$/, "")}/twiml/${encodeURIComponent(callId)}`;

    // Place the call via Twilio REST
    const call = await twilioClient.calls.create({
      url: twimlUrl, // Twilio will request this when call answered -> TwiML to start media stream
      to: endpoint,
      from: callerId || TWILIO_FROM_NUMBER,
      // statusCallback etc. can be added for more visibility
    });

    state.twilioCallSid = call.sid;

    // We expect Twilio to open a WebSocket connection to /twilio-ws (our wss), where we will receive audio.
    // Wait for that to connect for a short time, but don't block for long.
    // Instead, return callId now. The crawler will call /send-dtmf or await transcripts via runDiscovery flow.
    res.json({
      callId,
      transcript: state.lastTranscript || "",
      confidence: state.lastConfidence || 0,
      audioUrl: undefined,
      durationMs: undefined,
    });
  } catch (err: any) {
    console.error("dial error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------
// Helper: wait for next transcript event (prompts) with timeout
// The crawler expects immediate transcript after DTMF; we resolve with Deepgram live transcript when available.
// ---------------------------
function waitForTranscript(state: CallState, timeoutMs = 5000): Promise<AudioProcessingResult> {
  return new Promise((resolve) => {
    // If there's already a recent transcript, return it immediately
    if (state.lastTranscript && state.lastTranscript.trim().length > 0) {
      resolve({
        callId: state.callId,
        transcript: state.lastTranscript,
        confidence: state.lastConfidence || 0,
      });
      return;
    }

    // Otherwise register a pending promise to be resolved by Deepgram message handler
    const timeout = setTimeout(() => {
      // On timeout, resolve with whatever we have (maybe empty)
      resolve({
        callId: state.callId,
        transcript: state.lastTranscript || "",
        confidence: state.lastConfidence || 0,
      });
    }, timeoutMs);

    state.pendingPromises.push({ resolve, timeout });
  });
}

// ---------------------------
// POST /send-dtmf
// body: { callId: string, digit: string, gatherAfterMs?: number }
// returns: { callId, transcript, confidence }
// ---------------------------
app.post("/send-dtmf", async (req, res) => {
  const { callId, digit, gatherAfterMs } = req.body;
  if (!callId || typeof digit === "undefined") return res.status(400).json({ error: "Missing callId or digit" });

  const state = calls.get(callId);
  if (!state) return res.status(404).json({ error: "Unknown callId" });

  try {
    if (!state.twilioCallSid) return res.status(400).json({ error: "Twilio call not initialized yet" });

    // Inject DTMF into the live call using Twilio REST by updating call TwiML to Play digits
    // We use the 'update' with twiml to send in-band DTMF tones.
    const twiml = `<Response><Play digits="${String(digit)}"/></Response>`;
    await twilioClient.calls(state.twilioCallSid).update({ twiml });

    // Wait for the stream to produce the next transcript in real-time (Deepgram handler resolves)
    const result = await waitForTranscript(state, gatherAfterMs ?? 4000);
    res.json(result);
  } catch (err: any) {
    console.error("send-dtmf error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------
// POST /hangup
// body: { callId: string }
// ---------------------------
app.post("/hangup", async (req, res) => {
  const { callId } = req.body;
  if (!callId) return res.status(400).json({ error: "Missing callId" });

  const state = calls.get(callId);
  if (!state) return res.status(404).json({ error: "Unknown callId" });

  try {
    if (state.twilioCallSid) {
      await twilioClient.calls(state.twilioCallSid).update({ status: "completed" });
    }
    // close websockets
    try { state.ws?.close(); } catch {}
    try { state.deepgramWs?.close(); } catch {}
    calls.delete(callId);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("hangup error:", err);
    res.status(500).json({ error: String(err) });
  }
});

// ---------------------------
// Start HTTP and upgrade to WS for Twilio Media Streams
// ---------------------------
const server = http.createServer(app);

// integrate WebSocket server with same HTTP server
server.on("upgrade", (request, socket, head) => {
  // Accept upgrades only for /twilio-ws
  const url = request.url || "";
  if ((url || "").startsWith("/twilio-ws")) {
    wss.handleUpgrade(request, socket as any, head as any, (ws) => {
      wss.emit("connection", ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`Telephony backend listening on port ${PORT}`);
  console.log(`TwiML callback base: ${WEBHOOK_BASE_URL}`);
  console.log(`Endpoints: POST /dial, POST /send-dtmf, POST /hangup`);
});
