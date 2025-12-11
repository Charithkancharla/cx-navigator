import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import Twilio from "twilio";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// State management (in-memory for demo)
// Map<CallSid, { resolve: Function, transcript: string, isWaiting: boolean }>
const calls = new Map();

// Twilio & Deepgram Setup
// Note: These will be loaded from .env
const twilioClient = Twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

let deepgram: any;
if (process.env.DEEPGRAM_API_KEY) {
  deepgram = createClient(process.env.DEEPGRAM_API_KEY);
}

// Helper to get public URL
const getBaseUrl = () => process.env.WEBHOOK_BASE_URL;

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true, provider: "twilio", status: "running" });
});

app.post("/dial", async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
        res.status(400).json({ error: "Missing endpoint" });
        return;
    }

    const baseUrl = getBaseUrl();
    if (!baseUrl) {
        res.status(500).json({ error: "WEBHOOK_BASE_URL not set in .env" });
        return;
    }

    console.log(`Dialing ${endpoint}...`);

    // Create a promise that will be resolved when we get the first transcript
    let resolvePromise: any;
    const transcriptPromise = new Promise((resolve) => {
      resolvePromise = resolve;
    });

    const call = await twilioClient.calls.create({
      url: `${baseUrl}/twiml/start`,
      to: endpoint,
      from: process.env.TWILIO_PHONE_NUMBER,
    });

    console.log(`Call initiated: ${call.sid}`);

    // Store call state
    calls.set(call.sid, {
      resolve: resolvePromise,
      transcript: "",
      isWaiting: true,
      lastActivity: Date.now(),
    });

    // Wait for the welcome message (timeout after 30s)
    const timeout = setTimeout(() => {
      if (calls.has(call.sid)) {
        const state = calls.get(call.sid);
        if (state.isWaiting) {
           console.log(`Timeout waiting for audio on ${call.sid}`);
           state.resolve({ transcript: "(No audio detected)", confidence: 0 });
           state.isWaiting = false;
        }
      }
    }, 30000);

    const result: any = await transcriptPromise;
    clearTimeout(timeout);

    res.json({
      callId: call.sid,
      transcript: result.transcript,
      confidence: result.confidence || 0.8,
      audioUrl: "", 
      durationMs: 0,
    });

  } catch (error: any) {
    console.error("Dial error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/send-dtmf", async (req, res) => {
  const { callId, digit } = req.body;
  if (!calls.has(callId)) {
      res.status(404).json({ error: "Call not found" });
      return;
  }

  const state = calls.get(callId);
  
  // Reset state for new transcript
  let resolvePromise: any;
  const transcriptPromise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  
  state.resolve = resolvePromise;
  state.transcript = "";
  state.isWaiting = true;

  try {
    console.log(`Sending DTMF ${digit} to ${callId}`);
    const baseUrl = getBaseUrl();
    // We need to reconnect the stream after playing DTMF
    // Note: We use a different stream URL path just to be explicit, but logic is same
    await twilioClient.calls(callId).update({
      twiml: `<Response><Play digits="${digit}"></Play><Connect><Stream url="wss://${baseUrl?.replace("https://", "")}/streams/dtmf" /></Connect></Response>`
    });

    // Wait for response
    const result: any = await transcriptPromise;
    
    res.json({
      callId,
      transcript: result.transcript,
      confidence: result.confidence || 0.8,
    });
  } catch (error: any) {
    console.error("DTMF error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/hangup", async (req, res) => {
  const { callId } = req.body;
  if (callId) {
    try {
      console.log(`Hanging up ${callId}`);
      await twilioClient.calls(callId).update({ status: "completed" });
      calls.delete(callId);
    } catch (e) {
      console.error("Hangup error", e);
    }
  }
  res.json({ ok: true });
});

app.post("/twiml/start", (req, res) => {
  const baseUrl = getBaseUrl()?.replace("https://", "");
  const twiml = `
    <Response>
      <Connect>
        <Stream url="wss://${baseUrl}/streams/initial" />
      </Connect>
    </Response>
  `;
  res.type("text/xml").send(twiml);
});

// WebSocket for Audio Stream
wss.on("connection", (ws, req) => {
  console.log("WS Connected");
  let deepgramLive: any;
  let callSid: string | null = null;

  ws.on("message", (message) => {
    const msg = JSON.parse(message.toString());
    
    if (msg.event === "start") {
      callSid = msg.start.callSid;
      console.log(`Stream started for ${callSid}`);
      
      if (!deepgram) {
          console.error("Deepgram not initialized");
          return;
      }

      // Initialize Deepgram
      deepgramLive = deepgram.listen.live({
        model: "nova-2",
        smart_format: true,
        encoding: "mulaw",
        sample_rate: 8000,
        channels: 1,
      });

      deepgramLive.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        const transcript = data.channel?.alternatives?.[0]?.transcript;
        if (transcript && transcript.trim().length > 0 && callSid && calls.has(callSid)) {
          const state = calls.get(callSid);
          if (state.isWaiting) {
             console.log(`Transcript for ${callSid}: ${transcript}`);
             // Simple logic: resolve on first meaningful transcript
             // In production, you'd wait for silence or end of utterance
             state.resolve({ transcript, confidence: data.channel.alternatives[0].confidence });
             state.isWaiting = false;
          }
        }
      });
      
      deepgramLive.on(LiveTranscriptionEvents.Error, (err: any) => {
          console.error("Deepgram error:", err);
      });

    } else if (msg.event === "media" && deepgramLive && deepgramLive.getReadyState() === 1) {
      const audio = Buffer.from(msg.media.payload, "base64");
      deepgramLive.send(audio);
    }
  });

  ws.on("close", () => {
    if (deepgramLive) deepgramLive.finish();
  });
});

server.listen(PORT, () => {
  console.log(`Telephony backend listening on port ${PORT}`);
});
