import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
import cors from "cors";
import bodyParser from "body-parser";
import Twilio from "twilio";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Configuration
const PORT = process.env.PORT || 3000;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL; // Your ngrok URL

// Validation
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER || !DEEPGRAM_API_KEY || !WEBHOOK_BASE_URL) {
  console.error("ERROR: Missing required environment variables. Check .env file.");
  process.exit(1);
}

const twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const deepgram = createClient(DEEPGRAM_API_KEY);

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));

// Store active calls
const activeCalls = new Map<string, {
  ws?: WebSocket;
  deepgram?: any;
  transcript: string[];
  latestTranscript: string;
  confidence: number;
  dtmf?: string;
}>();

// --- HTTP Endpoints ---

// 1. Dial a number
app.post("/dial", async (req, res) => {
  const { endpoint } = req.body;
  
  if (!endpoint) {
    res.status(400).json({ error: "Missing endpoint" });
    return;
  }

  try {
    console.log(`[Dial] Initiating call to ${endpoint}...`);
    
    const call = await twilioClient.calls.create({
      url: `${WEBHOOK_BASE_URL}/twiml`,
      to: endpoint,
      from: TWILIO_PHONE_NUMBER,
      statusCallback: `${WEBHOOK_BASE_URL}/status-callback`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    });

    // Initialize call state
    activeCalls.set(call.sid, {
      transcript: [],
      latestTranscript: "",
      confidence: 0,
    });

    // Wait a bit for the call to establish and audio to start flowing
    // In a real production app, we'd use webhooks/events to push updates.
    // For this synchronous-like discovery loop, we'll poll/wait briefly.
    await new Promise(resolve => setTimeout(resolve, 5000));

    const state = activeCalls.get(call.sid);
    
    res.json({
      callId: call.sid,
      transcript: state?.latestTranscript || "(Listening...)",
      confidence: state?.confidence || 0,
      audioUrl: "", // Could record if needed
      durationMs: 0,
    });
  } catch (error: any) {
    console.error("[Dial] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Send DTMF
app.post("/send-dtmf", async (req, res) => {
  const { callId, digit } = req.body;

  if (!callId || !digit) {
    res.status(400).json({ error: "Missing callId or digit" });
    return;
  }

  try {
    console.log(`[DTMF] Sending ${digit} to ${callId}`);
    
    // Play DTMF on the live call
    // Note: Twilio's play/send_digits might interrupt the stream briefly
    await twilioClient.calls(callId).update({
      twiml: `<Response><Play digits="${digit}"></Play><Connect><Stream url="wss://${WEBHOOK_BASE_URL.replace("https://", "")}/streams" /></Connect></Response>`
    });

    // Wait for response to the DTMF (new menu prompt)
    await new Promise(resolve => setTimeout(resolve, 4000));

    const state = activeCalls.get(callId);

    res.json({
      transcript: state?.latestTranscript || "",
      confidence: state?.confidence || 0,
      detectedDtmf: digit
    });
  } catch (error: any) {
    console.error("[DTMF] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Hangup
app.post("/hangup", async (req, res) => {
  const { callId } = req.body;
  if (!callId) {
    res.status(400).json({ error: "Missing callId" });
    return;
  }

  try {
    await twilioClient.calls(callId).update({ status: "completed" });
    activeCalls.delete(callId);
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Hangup] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// --- Twilio Webhooks ---

// TwiML for new calls
app.post("/twiml", (req, res) => {
  res.type("text/xml");
  res.send(`
    <Response>
      <Start>
        <Stream url="wss://${req.headers.host}/streams" />
      </Start>
      <Say>Connecting to CX Navigator.</Say>
      <Pause length="40" />
    </Response>
  `);
});

app.post("/status-callback", (req, res) => {
  const { CallSid, CallStatus } = req.body;
  console.log(`[Twilio] Call ${CallSid} is ${CallStatus}`);
  if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy') {
    activeCalls.delete(CallSid);
  }
  res.sendStatus(200);
});

// --- WebSocket for Audio Streaming ---

wss.on("connection", (ws) => {
  console.log("[WS] New connection");
  
  let deepgramLive: any = null;
  let callSid: string | null = null;

  ws.on("message", async (message) => {
    const msg = JSON.parse(message.toString());

    if (msg.event === "start") {
      callSid = msg.start.callSid;
      console.log(`[WS] Stream started for CallSid: ${callSid}`);
      
      // Setup Deepgram
      deepgramLive = deepgram.listen.live({
        model: "nova-2",
        language: "en-US",
        smart_format: true,
        encoding: "mulaw",
        sample_rate: 8000,
        channels: 1,
      });

      deepgramLive.on(LiveTranscriptionEvents.Open, () => {
        console.log("[Deepgram] Connection open");
      });

      deepgramLive.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        const transcript = data.channel.alternatives[0].transcript;
        if (transcript && callSid) {
          const state = activeCalls.get(callSid);
          if (state) {
            state.latestTranscript = transcript;
            state.transcript.push(transcript);
            state.confidence = data.channel.alternatives[0].confidence;
            console.log(`[Transcript] ${callSid}: ${transcript}`);
          }
        }
      });

      if (callSid) {
        const state = activeCalls.get(callSid);
        if (state) {
          state.ws = ws;
          state.deepgram = deepgramLive;
        }
      }
    } else if (msg.event === "media" && deepgramLive) {
      const audio = Buffer.from(msg.media.payload, "base64");
      deepgramLive.send(audio);
    } else if (msg.event === "stop") {
      console.log(`[WS] Stream stopped for ${callSid}`);
      if (deepgramLive) {
        deepgramLive.finish();
        deepgramLive = null;
      }
    }
  });

  ws.on("close", () => {
    if (deepgramLive) {
      deepgramLive.finish();
      deepgramLive = null;
    }
  });
});

server.listen(PORT, () => {
  console.log(`Telephony Server running on port ${PORT}`);
});
