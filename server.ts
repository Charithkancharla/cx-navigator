import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import cors from "cors";
import dotenv from "dotenv";
import twilio from "twilio";
import { createClient, LiveTranscriptionEvents } from "@deepgram/sdk";
import bodyParser from "body-parser";

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY;
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL;

// Validate config
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_FROM_NUMBER || !DEEPGRAM_API_KEY || !WEBHOOK_BASE_URL) {
  console.warn("⚠️ Missing environment variables in .env. Telephony features will not work until configured.");
}

const twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
const deepgram = createClient(DEEPGRAM_API_KEY);

// --- State Management ---
interface CallSession {
  callId: string;
  res: express.Response | null; // The pending HTTP response for /dial or /send-dtmf
  transcriptParts: string[];
  silenceTimer: NodeJS.Timeout | null;
  maxWaitTimer: NodeJS.Timeout | null;
  isGathering: boolean;
  deepgramLive: any;
}

const sessions = new Map<string, CallSession>();

// --- Helper Functions ---

const resolveRequest = (callSid: string) => {
  const session = sessions.get(callSid);
  if (!session || !session.res) return;

  const fullTranscript = session.transcriptParts.join(" ").trim();
  console.log(`[${callSid}] Resolving request. Transcript: "${fullTranscript}"`);

  // Return the result to the crawler
  session.res.json({
    callId: callSid,
    transcript: fullTranscript,
    confidence: 0.9, // Placeholder
    audioUrl: "", // Recording not implemented in this basic version
    durationMs: 0, 
  });

  // Cleanup state for this turn
  session.res = null;
  session.transcriptParts = [];
  session.isGathering = false;
  if (session.silenceTimer) clearTimeout(session.silenceTimer);
  if (session.maxWaitTimer) clearTimeout(session.maxWaitTimer);
};

const startGathering = (callSid: string, res: express.Response) => {
  const session = sessions.get(callSid);
  if (!session) {
    res.status(404).json({ error: "Call session not found" });
    return;
  }

  // If there was a pending request (race condition), resolve it now
  if (session.res) {
    resolveRequest(callSid);
  }

  session.res = res;
  session.isGathering = true;
  session.transcriptParts = [];

  console.log(`[${callSid}] Listening for speech...`);

  // 1. Max Wait Timer: If no speech detected at all within 10s, return empty
  session.maxWaitTimer = setTimeout(() => {
    console.log(`[${callSid}] Max wait timeout (10s) reached.`);
    resolveRequest(callSid);
  }, 10000);
  
  // Note: silenceTimer is set ONLY after we hear the first speech
};

// --- HTTP Endpoints ---

app.get("/", (req, res) => {
  res.send("Telephony Backend is running.");
});

// 1. Dial: Initiates a call and waits for the initial greeting
app.post("/dial", async (req, res) => {
  const { endpoint } = req.body;
  console.log(`Dialing ${endpoint}...`);

  try {
    // Construct the WebSocket URL for the media stream
    // Replace http/https with ws/wss
    const wsUrl = WEBHOOK_BASE_URL!.replace(/^http/, "ws") + "/streams";
    
    // TwiML to start the stream immediately
    const twiml = `
<Response>
  <Connect>
    <Stream url="${wsUrl}" />
  </Connect>
  <Pause length="3600" />
</Response>
    `;

    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: endpoint,
      from: TWILIO_FROM_NUMBER!,
    });

    console.log(`Call initiated: ${call.sid}`);

    // Initialize session
    sessions.set(call.sid, {
      callId: call.sid,
      res: null,
      transcriptParts: [],
      silenceTimer: null,
      maxWaitTimer: null,
      isGathering: false,
      deepgramLive: null
    });

    // Start waiting for the greeting immediately
    startGathering(call.sid, res);

  } catch (error: any) {
    console.error("Error dialing:", error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Send DTMF: Sends digits and waits for the subsequent prompt
app.post("/send-dtmf", async (req, res) => {
  const { callId, digit } = req.body;
  console.log(`[${callId}] Sending DTMF: ${digit}`);

  try {
    const session = sessions.get(callId);
    if (!session) {
      res.status(404).json({ error: "Call not found" });
      return;
    }

    // Send digits via Twilio
    await twilioClient.calls(callId).update({
      sendDigits: digit
    });

    // Start waiting for the response prompt
    startGathering(callId, res);

  } catch (error: any) {
    console.error("Error sending DTMF:", error);
    res.status(500).json({ error: error.message });
  }
});

// 3. Hangup: Ends the call
app.post("/hangup", async (req, res) => {
  const { callId } = req.body;
  console.log(`[${callId}] Hanging up`);

  try {
    await twilioClient.calls(callId).update({ status: "completed" });
    
    const session = sessions.get(callId);
    if (session) {
        if (session.deepgramLive) {
            session.deepgramLive.finish();
        }
        sessions.delete(callId);
    }
    
    res.json({ status: "hungup" });
  } catch (error: any) {
    console.error("Error hanging up:", error);
    // If call is already done, just ignore
    res.json({ status: "hungup", note: error.message });
  }
});

// TwiML endpoint (optional, if we used url instead of inline twiml)
app.post("/twiml", (req, res) => {
  const wsUrl = WEBHOOK_BASE_URL!.replace(/^http/, "ws") + "/streams";
  res.type("text/xml");
  res.send(`
<Response>
  <Connect>
    <Stream url="${wsUrl}" />
  </Connect>
  <Pause length="3600" />
</Response>
  `);
});

// --- WebSocket Handler (Twilio Media Streams) ---

wss.on("connection", (ws) => {
  console.log("New WebSocket connection");
  let callSid = "";
  let deepgramLive: any = null;

  ws.on("message", async (message) => {
    try {
      const msg = JSON.parse(message.toString());

      if (msg.event === "start") {
        callSid = msg.start.callSid;
        console.log(`[${callSid}] Stream started`);
        
        // Setup Deepgram Live Client
        deepgramLive = deepgram.listen.live({
          model: "nova-2",
          language: "en-US",
          smart_format: true,
          encoding: "mulaw",
          sample_rate: 8000,
          channels: 1,
        });

        // Attach Deepgram to session
        const session = sessions.get(callSid);
        if (session) {
          session.deepgramLive = deepgramLive;
        }

        deepgramLive.on(LiveTranscriptionEvents.Open, () => {
          console.log(`[${callSid}] Deepgram connected`);
        });

        deepgramLive.on(LiveTranscriptionEvents.Transcript, (data: any) => {
          const transcript = data.channel?.alternatives?.[0]?.transcript;
          
          if (transcript && transcript.trim().length > 0) {
            console.log(`[${callSid}] Transcript: ${transcript}`);
            
            const sess = sessions.get(callSid);
            if (sess && sess.isGathering) {
              // We detected speech!
              sess.transcriptParts.push(transcript);
              
              // Clear the "max wait" timer since we found speech
              if (sess.maxWaitTimer) {
                clearTimeout(sess.maxWaitTimer);
                sess.maxWaitTimer = null;
              }

              // Reset silence timer (debounce)
              // Wait for 1.5s of silence to consider the prompt finished
              if (sess.silenceTimer) clearTimeout(sess.silenceTimer);
              sess.silenceTimer = setTimeout(() => {
                  console.log(`[${callSid}] Silence detected (end of turn).`);
                  resolveRequest(callSid);
              }, 1500); 
            }
          }
        });
        
        deepgramLive.on(LiveTranscriptionEvents.Error, (err: any) => {
          console.error(`[${callSid}] Deepgram error:`, err);
        });

      } else if (msg.event === "media") {
        // Forward audio to Deepgram
        if (deepgramLive && deepgramLive.getReadyState() === 1) {
          const payload = Buffer.from(msg.media.payload, "base64");
          deepgramLive.send(payload);
        }
      } else if (msg.event === "stop") {
        console.log(`[${callSid}] Stream stopped`);
        if (deepgramLive) {
          deepgramLive.finish();
          deepgramLive = null;
        }
      }
    } catch (e) {
      console.error("Error processing WebSocket message:", e);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Telephony server running on port ${PORT}`);
  console.log(`Webhook Base URL: ${WEBHOOK_BASE_URL}`);
});
