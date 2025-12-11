import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import Twilio from "twilio";
import { createClient } from "@deepgram/sdk";

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;

// Store active calls
const calls = new Map<string, any>();

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", env: { 
    twilio: !!process.env.TWILIO_ACCOUNT_SID, 
    deepgram: !!process.env.DEEPGRAM_API_KEY 
  }});
});

// 1. Dial Endpoint
app.post("/dial", async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      res.status(400).json({ error: "Missing endpoint" });
      return;
    }

    console.log(`[Dial] Initiating call to ${endpoint}...`);

    const client = Twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    const call = await client.calls.create({
      url: `${process.env.WEBHOOK_BASE_URL}/twiml/start`,
      to: endpoint,
      from: process.env.TWILIO_PHONE_NUMBER!,
      statusCallback: `${process.env.WEBHOOK_BASE_URL}/status-callback`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });

    calls.set(call.sid, { status: "initiated", transcript: [] });
    res.json({ callId: call.sid, status: "initiated" });
  } catch (error: any) {
    console.error("[Dial] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 2. TwiML Start
app.post("/twiml/start", (req, res) => {
  const twiml = new Twilio.twiml.VoiceResponse();
  const start = twiml.start();
  start.stream({
    url: `wss://${req.headers.host}/streams`,
    track: "inbound_track",
  });
  twiml.pause({ length: 60 }); // Keep call open for 60s listening
  
  res.type("text/xml");
  res.send(twiml.toString());
});

// 3. Send DTMF
app.post("/send-dtmf", async (req, res) => {
  const { callId, digit } = req.body;
  if (!callId || !digit) {
    res.status(400).json({ error: "Missing callId or digit" });
    return;
  }

  try {
    const client = Twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    // Play DTMF tones on the active call
    // Note: This plays to the callee.
    await client.calls(callId).update({
      twiml: `<Response><Play digits="${digit}"></Play><Pause length="10"/></Response>`
    });

    // Wait a bit for the system to respond (simulated delay)
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Return the latest transcript
    const callData = calls.get(callId);
    const transcript = callData?.transcript.join(" ") || "";
    
    res.json({ 
      success: true, 
      transcript,
      confidence: 0.95,
      durationMs: 2000
    });
  } catch (error: any) {
    console.error("[DTMF] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Hangup
app.post("/hangup", async (req, res) => {
  const { callId } = req.body;
  if (!callId) {
    res.status(400).json({ error: "Missing callId" });
    return;
  }

  try {
    const client = Twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );

    await client.calls(callId).update({ status: "completed" });
    calls.delete(callId);
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Hangup] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// WebSocket for Media Streams (Deepgram)
wss.on("connection", (ws) => {
  console.log("[WS] Client connected");
  
  let deepgramLive: any;
  let callSid: string | null = null;

  const setupDeepgram = () => {
    const deepgram = createClient(process.env.DEEPGRAM_API_KEY!);
    deepgramLive = deepgram.listen.live({
      model: "nova-2",
      language: "en-US",
      smart_format: true,
      encoding: "mulaw",
      sample_rate: 8000,
      channels: 1,
    });

    deepgramLive.on("Open", () => console.log("[Deepgram] Connection open"));
    
    deepgramLive.on("Results", (data: any) => {
      const transcript = data.channel?.alternatives?.[0]?.transcript;
      if (transcript && callSid) {
        console.log(`[Transcript] ${callSid}: ${transcript}`);
        const callData = calls.get(callSid);
        if (callData) {
          callData.transcript.push(transcript);
        }
      }
    });

    deepgramLive.on("Error", (e: any) => console.error("[Deepgram] Error:", e));
    deepgramLive.on("Close", () => console.log("[Deepgram] Connection closed"));
  };

  setupDeepgram();

  ws.on("message", (message: string) => {
    try {
      const data = JSON.parse(message);
      
      if (data.event === "start") {
        callSid = data.start.callSid;
        console.log(`[WS] Stream started for call ${callSid}`);
      } else if (data.event === "media") {
        if (deepgramLive && deepgramLive.getReadyState() === 1) {
          const payload = Buffer.from(data.media.payload, "base64");
          deepgramLive.send(payload);
        }
      } else if (data.event === "stop") {
        console.log(`[WS] Stream stopped for call ${callSid}`);
        if (deepgramLive) deepgramLive.finish();
      }
    } catch (e) {
      console.error("[WS] Error processing message:", e);
    }
  });

  ws.on("close", () => {
    console.log("[WS] Client disconnected");
    if (deepgramLive) deepgramLive.finish();
  });
});

server.listen(PORT, () => {
  console.log(`Telephony Backend running on port ${PORT}`);
});
