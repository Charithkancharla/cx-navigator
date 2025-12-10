import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import Twilio from "twilio";
import dotenv from "dotenv";
import { createClient } from "@deepgram/sdk";
import cors from "cors";
import bodyParser from "body-parser";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !WEBHOOK_BASE_URL) {
  console.error("Missing required environment variables. Check .env");
  // We don't exit here to allow the server to start and show logs, but functionality will be broken
}

const twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const deepgram = createClient(DEEPGRAM_API_KEY || "");

// Store active calls
const activeCalls = new Map<string, any>();

// Health Check
app.get("/health", (req, res) => {
  res.json({ ok: true, provider: "twilio" });
});

// 1. Dial Endpoint
app.post("/dial", async (req, res) => {
  const { endpoint } = req.body;
  console.log(`[Dial] Request to call ${endpoint}`);

  if (!endpoint) {
    res.status(400).json({ error: "Missing endpoint" });
    return;
  }

  try {
    const call = await twilioClient.calls.create({
      url: `${WEBHOOK_BASE_URL}/twiml/start`,
      to: endpoint,
      from: TWILIO_FROM_NUMBER,
      statusCallback: `${WEBHOOK_BASE_URL}/status-callback`,
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    });

    console.log(`[Dial] Call initiated: ${call.sid}`);
    activeCalls.set(call.sid, { transcript: "", confidence: 0, audioUrl: "", durationMs: 0 });
    
    res.json({ 
      callId: call.sid,
      status: "initiated"
    });
  } catch (error: any) {
    console.error("[Dial] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 2. TwiML Endpoint (Start)
app.post("/twiml/start", (req, res) => {
  const twiml = new Twilio.twiml.VoiceResponse();
  
  // Start stream for Deepgram
  const start = twiml.start();
  start.stream({
    url: `wss://${WEBHOOK_BASE_URL?.replace("https://", "")}/twilio-ws`,
    track: "inbound_track"
  });

  // Pause to listen (simulating a human listening)
  twiml.pause({ length: 30 }); 

  res.type("text/xml");
  res.send(twiml.toString());
});

// 3. Send DTMF Endpoint
app.post("/send-dtmf", async (req, res) => {
  const { callId, digit } = req.body;
  console.log(`[DTMF] Sending ${digit} to ${callId}`);

  if (!callId || !digit) {
    res.status(400).json({ error: "Missing callId or digit" });
    return;
  }

  try {
    // Strategy: Redirect call to a TwiML that plays digits then connects back to stream/listen
    const twiml = new Twilio.twiml.VoiceResponse();
    twiml.play({ digits: `w${digit}` });
    // Resume stream/listen
    const start = twiml.start();
    start.stream({
      url: `wss://${WEBHOOK_BASE_URL?.replace("https://", "")}/twilio-ws`,
      track: "inbound_track"
    });
    twiml.pause({ length: 30 });

    await twilioClient.calls(callId).update({
      twiml: twiml.toString()
    });

    // Wait a bit for the DTMF to be processed and new audio to come in
    await new Promise(resolve => setTimeout(resolve, 2000));

    const callData = activeCalls.get(callId) || {};
    res.json({
      transcript: callData.transcript || "",
      confidence: callData.confidence || 0,
      audioUrl: callData.audioUrl || "",
      durationMs: callData.durationMs || 0
    });

  } catch (error: any) {
    console.error("[DTMF] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 4. Hangup Endpoint
app.post("/hangup", async (req, res) => {
  const { callId } = req.body;
  console.log(`[Hangup] Request for ${callId}`);

  if (!callId) {
    res.status(400).json({ error: "Missing callId" });
    return;
  }

  try {
    await twilioClient.calls(callId).update({ status: "completed" });
    activeCalls.delete(callId);
    res.json({ status: "hungup" });
  } catch (error: any) {
    console.error("[Hangup] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// WebSocket for Deepgram
wss.on("connection", (ws) => {
  console.log("[WS] Twilio connected");
  
  let deepgramLive: any = null;
  let callSid = "";

  ws.on("message", (message: any) => {
    const msg = JSON.parse(message);
    
    if (msg.event === "start") {
      callSid = msg.start.callSid;
      console.log(`[WS] Stream started for ${callSid}`);
      
      if (DEEPGRAM_API_KEY) {
        deepgramLive = deepgram.listen.live({
          model: "nova-2",
          language: "en-US",
          smart_format: true,
          encoding: "mulaw",
          sample_rate: 8000,
          channels: 1
        });

        deepgramLive.on(createClient.LiveTranscriptionEvents.Open, () => {
          console.log("[Deepgram] Connection open");
        });

        deepgramLive.on(createClient.LiveTranscriptionEvents.Transcript, (data: any) => {
          const transcript = data.channel.alternatives[0].transcript;
          if (transcript && activeCalls.has(callSid)) {
            console.log(`[Transcript] ${callSid}: ${transcript}`);
            const callData = activeCalls.get(callSid);
            if (data.is_final) {
               callData.transcript = transcript;
               callData.confidence = data.channel.alternatives[0].confidence;
               activeCalls.set(callSid, callData);
            }
          }
        });

        deepgramLive.on(createClient.LiveTranscriptionEvents.Error, (err: any) => {
          console.error("[Deepgram] Error:", err);
        });
      }
    } else if (msg.event === "media") {
      if (deepgramLive && deepgramLive.getReadyState() === 1) {
        const payload = Buffer.from(msg.media.payload, "base64");
        deepgramLive.send(payload);
      }
    } else if (msg.event === "stop") {
      console.log(`[WS] Stream stopped for ${callSid}`);
      if (deepgramLive) {
        deepgramLive.finish();
        deepgramLive = null;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Telephony backend listening on port ${PORT}`);
});
