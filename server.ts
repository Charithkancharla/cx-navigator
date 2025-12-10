import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import WebSocket from "ws";
import cors from "cors";
import bodyParser from "body-parser";
import Twilio from "twilio";
import { createClient } from "@deepgram/sdk";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// Configuration
const PORT = process.env.PORT || 3000;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL; // Your ngrok URL

if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER || !DEEPGRAM_API_KEY || !WEBHOOK_BASE_URL) {
  console.error("❌ Missing required environment variables. Check .env file.");
  process.exit(1);
}

const twilioClient = Twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const deepgram = createClient(DEEPGRAM_API_KEY);

// Active calls state
const calls = new Map<string, {
  ws?: WebSocket;
  transcript: string[];
  latestTranscript: string;
  confidence: number;
  streamSid?: string;
}>();

// --- API Endpoints ---

// 1. Dial a number
app.post("/dial", async (req, res) => {
  const { endpoint } = req.body;
  
  if (!endpoint) {
    res.status(400).json({ error: "Missing endpoint" });
    return;
  }

  console.log(`📞 Dialing ${endpoint}...`);

  try {
    const call = await twilioClient.calls.create({
      url: `${WEBHOOK_BASE_URL}/twiml/start`,
      to: endpoint,
      from: TWILIO_PHONE_NUMBER,
      statusCallback: `${WEBHOOK_BASE_URL}/status-callback`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
    });

    // Initialize call state
    calls.set(call.sid, {
      transcript: [],
      latestTranscript: "",
      confidence: 0
    });

    // Wait for some audio/transcript (simple polling for demo)
    // In a real app, you'd use webhooks or events
    await new Promise(resolve => setTimeout(resolve, 5000));

    const state = calls.get(call.sid);
    
    res.json({
      callId: call.sid,
      transcript: state?.latestTranscript || "Connected. Listening...",
      confidence: state?.confidence || 0.8,
      audioUrl: "", // Placeholder
      durationMs: 5000,
    });
  } catch (error: any) {
    console.error("Dial error:", error);
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

  console.log(`Tb Sending DTMF ${digit} to ${callId}`);

  try {
    // Play DTMF
    await twilioClient.calls(callId).update({
      twiml: `<Response><Play digits="${digit}"></Play><Pause length="1"/><Connect><Stream url="wss://${WEBHOOK_BASE_URL.replace("https://", "")}/streams" /></Connect></Response>`
    });

    // Wait for response prompt
    await new Promise(resolve => setTimeout(resolve, 4000));

    const state = calls.get(callId);

    res.json({
      callId,
      transcript: state?.latestTranscript || `(Menu Option ${digit})`,
      confidence: state?.confidence || 0.9,
      audioUrl: "",
      durationMs: 4000,
    });
  } catch (error: any) {
    console.error("DTMF error:", error);
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
    calls.delete(callId);
    res.json({ success: true });
  } catch (error: any) {
    console.error("Hangup error:", error);
    res.status(500).json({ error: error.message });
  }
});

// --- Twilio Webhooks ---

app.post("/twiml/start", (req, res) => {
  const twiml = `
    <Response>
      <Start>
        <Stream url="wss://${req.headers.host}/streams" />
      </Start>
      <Pause length="40" />
    </Response>
  `;
  res.type("text/xml");
  res.send(twiml);
});

app.post("/status-callback", (req, res) => {
  console.log(`Call Status: ${req.body.CallStatus}`);
  res.sendStatus(200);
});

// --- WebSocket for Media Stream ---

wss.on("connection", (ws) => {
  console.log("Media Stream Connected");
  let streamSid = "";
  let callSid = "";

  ws.on("message", async (message) => {
    const msg = JSON.parse(message.toString());

    if (msg.event === "start") {
      streamSid = msg.start.streamSid;
      callSid = msg.start.callSid;
      console.log(`Stream started for call ${callSid}`);
    } else if (msg.event === "media") {
      // Send audio to Deepgram (simplified)
      // In production, you'd stream raw audio to Deepgram Live Client
    } else if (msg.event === "stop") {
      console.log("Stream stopped");
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Telephony Backend running on port ${PORT}`);
  console.log(`🔗 Webhook Base URL: ${WEBHOOK_BASE_URL}`);
});
