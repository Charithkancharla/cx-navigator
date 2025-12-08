import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// --- Types & Interfaces --- //

type FlowNode = {
  label: string;
  type: "menu" | "prompt" | "input";
  content: string;
  metadata?: Record<string, unknown>;
  children?: FlowNode[];
};

type CuratedIVR = {
  id: string;
  entryPoints: string[];
  platform: string;
  industry: string;
  welcome: string;
  branches: FlowNode[];
};

type AudioProcessingResult = {
  transcript: string;
  confidence: number;
  audioUrl: string;
  durationMs: number;
  detectedDtmf?: string;
};

// --- Simulation Data (The "Oracle") --- //

const curatedCatalog: CuratedIVR[] = [
  {
    id: "amazon_connect_horizon_bank",
    entryPoints: ["+18005550199", "horizon"],
    platform: "Amazon Connect",
    industry: "Banking",
    welcome:
      "Thank you for calling Horizon Federal, powered by Amazon Connect. For English, press 1. Para español, oprima número dos.",
    branches: [
      {
        label: "English",
        type: "menu",
        content:
          "Press 1 for balances, press 2 for recent activity, or press 0 to reach a banker.",
        metadata: { dtmf: "1", confidence: 0.98 },
        children: [
          {
            label: "Balance Inquiry",
            type: "prompt",
            content:
              "Please enter your 16 digit account number followed by the pound key.",
            metadata: { dtmf: "1", confidence: 0.95 },
          },
          {
            label: "Recent Transactions",
            type: "prompt",
            content:
              "Say 'transactions' or press 2 to hear your last five transactions.",
            metadata: { dtmf: "2", intent: "transactions", confidence: 0.94 },
          },
        ],
      },
      {
        label: "Spanish",
        type: "prompt",
        content: "Gracias. Por favor espere un momento.",
        metadata: { dtmf: "2", confidence: 0.99 },
      },
    ],
  },
];

// --- Helper Functions --- //

function normalizeEntryPoint(value: string): string {
  let normalized = value.trim().toLowerCase();
  normalized = normalized.replace(/[^0-9+a-z:]/g, "");
  return normalized;
}

function generateSimulatedFlow(value: string): CuratedIVR {
  const normalized = normalizeEntryPoint(value);
  const hash = normalized
    .split("")
    .reduce((acc, char) => acc + char.charCodeAt(0), 0);

  const platforms = ["Amazon Connect", "Genesys Cloud CX", "Twilio Flex", "Nice CXone"];
  const industries = ["Retail", "Banking", "Healthcare", "Travel"];

  const platform = platforms[hash % platforms.length];
  const industry = industries[hash % industries.length];

  return {
    id: `ivr_${normalized}`,
    entryPoints: [value],
    platform,
    industry,
    welcome: `Thank you for calling the ${industry} Support Center. This call is powered by ${platform}. Please listen closely as our menu options have changed.`,
    branches: [
      {
        label: "Customer Service",
        type: "menu",
        content: "For customer service and general inquiries, press 1.",
        metadata: { dtmf: "1", confidence: 0.98 },
        children: [
          {
            label: "Order Status",
            type: "prompt",
            content: "Please enter your order number followed by the pound key.",
            metadata: { dtmf: "1", confidence: 0.95 },
          },
          {
            label: "Speak to Agent",
            type: "prompt",
            content:
              "Please hold while we connect you to the next available agent.",
            metadata: { dtmf: "0", confidence: 0.99 },
          },
        ],
      },
      {
        label: "Technical Support",
        type: "menu",
        content: "For technical support or to report an outage, press 2.",
        metadata: { dtmf: "2", confidence: 0.97 },
        children: [
          {
            label: "Troubleshooting",
            type: "prompt",
            content: "Please describe the issue you are experiencing.",
            metadata: { dtmf: "1", intent: "troubleshoot", confidence: 0.92 },
          },
        ],
      },
      {
        label: "Billing",
        type: "prompt",
        content: "For billing questions, press 3.",
        metadata: { dtmf: "3", confidence: 0.96 },
      },
    ],
  };
}

function parseTranscriptFlow(text: string): CuratedIVR {
  const branches: FlowNode[] = [];
  const pressMatches = text.matchAll(/Press (\d) for ([^.,;]+)/gi);
  for (const match of pressMatches) {
    branches.push({
      label: match[2].trim(),
      type: "prompt",
      content: `(Simulated) You selected ${match[2].trim()}.`,
      metadata: { dtmf: match[1], confidence: 1.0 },
    });
  }
  return {
    id: "transcript_flow",
    entryPoints: [],
    platform: "Text Transcript",
    industry: "Unknown",
    welcome: text,
    branches: branches,
  };
}

// --- Strict Matching & Fingerprinting --- //

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

function fingerprintPrompt(text: string): string {
  // Enhanced fingerprinting with versioning
  let hash = 0;
  const normalized = normalizeText(text);
  if (normalized.length === 0) return "empty";
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return `v1:${Math.abs(hash).toString(16)}`;
}

function extractMenuOptions(
  text: string
): { dtmf: string; label: string }[] {
  const options: { dtmf: string; label: string }[] = [];
  // Regex to find "Press X for Y" or "For Y, press X"
  const patterns = [
    /Press (\d) for ([^.,;]+)/gi,
    /For ([^.,;]+),? press (\d)/gi,
  ];

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      // Determine which group is digit and which is label
      const g1 = match[1];
      const g2 = match[2];
      if (/\d/.test(g1)) {
        options.push({ dtmf: g1, label: g2.trim() });
      } else {
        options.push({ dtmf: g2, label: g1.trim() });
      }
    }
  }
  return options;
}

// --- Telephony Abstraction (Interface + Factory + Implementations) --- //

interface TelephonySession {
  dial(): Promise<AudioProcessingResult>;
  sendDtmf(digit: string): Promise<AudioProcessingResult>;
  hangup(): Promise<void>;
}

// Backend service that actually talks to Twilio / Connect / SIP / etc.
const TELEPHONY_BACKEND_URL = process.env.TELEPHONY_BACKEND_URL ?? "";

/**
 * Real telephony session: talks to a separate backend that:
 *  - places the call
 *  - listens to prompts
 *  - runs ASR
 *  - returns AudioProcessingResult JSON
 */
class RealTelephonySession implements TelephonySession {
  private callId: string | null = null;
  private endpoint: string;

  constructor(endpoint: string) {
    if (!TELEPHONY_BACKEND_URL) {
      throw new Error(
        "TELEPHONY_BACKEND_URL is not configured for RealTelephonySession"
      );
    }
    this.endpoint = endpoint;
  }

  async dial(): Promise<AudioProcessingResult> {
    const res = await fetch(`${TELEPHONY_BACKEND_URL}/dial`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: this.endpoint }),
    });

    if (!res.ok) {
      throw new Error(`Dial failed with status ${res.status}`);
    }

    const data = await res.json();
    this.callId = data.callId;

    return {
      transcript: data.transcript,
      confidence: data.confidence,
      audioUrl: data.audioUrl,
      durationMs: data.durationMs,
      detectedDtmf: data.detectedDtmf,
    };
  }

  async sendDtmf(digit: string): Promise<AudioProcessingResult> {
    if (!this.callId) {
      throw new Error("Call not connected");
    }

    const res = await fetch(`${TELEPHONY_BACKEND_URL}/send-dtmf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId: this.callId, digit }),
    });

    if (!res.ok) {
      throw new Error(`sendDtmf failed with status ${res.status}`);
    }

    const data = await res.json();

    return {
      transcript: data.transcript,
      confidence: data.confidence,
      audioUrl: data.audioUrl,
      durationMs: data.durationMs,
      detectedDtmf: data.detectedDtmf,
    };
  }

  async hangup(): Promise<void> {
    if (!this.callId) return;

    try {
      await fetch(`${TELEPHONY_BACKEND_URL}/hangup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId: this.callId }),
      });
    } catch {
      // best-effort; ignore errors on hangup
    } finally {
      this.callId = null;
    }
  }
}

/**
 * Existing simulator, now implementing TelephonySession.
 * Used for:
 *  - text inputType (full transcript)
 *  - non-phone/non-SIP endpoints
 *  - dev/demo fallback
 */
class SimulatedTelephonySession implements TelephonySession {
  private flow: CuratedIVR;
  private currentNode: FlowNode | null = null;
  private isConnected: boolean = false;

  constructor(entryPoint: string, inputType?: string) {
    if (inputType === "text") {
      this.flow = parseTranscriptFlow(entryPoint);
    } else {
      const normalized = normalizeEntryPoint(entryPoint);
      this.flow =
        curatedCatalog.find((c) =>
          c.entryPoints.some((e) => normalizeEntryPoint(e) === normalized)
        ) ?? generateSimulatedFlow(entryPoint);
    }
  }

  async dial(): Promise<AudioProcessingResult> {
    this.isConnected = true;
    // Start at root
    return this.processAudio(this.flow.welcome);
  }

  async sendDtmf(digit: string): Promise<AudioProcessingResult> {
    if (!this.isConnected) throw new Error("Call not connected");

    // Traverse logic
    let children = this.currentNode ? this.currentNode.children : this.flow.branches;

    if (!children) return this.processAudio("Invalid option.");

    const match = children.find((c) => c.metadata?.dtmf === digit);
    if (match) {
      this.currentNode = match;
      return this.processAudio(match.content);
    }

    return this.processAudio("Invalid selection. Please try again.");
  }

  async hangup() {
    this.isConnected = false;
    this.currentNode = null;
  }

  // Simulate Real Audio Processing (ASR/TTS)
  private processAudio(text: string): AudioProcessingResult {
    // In a real implementation, this would:
    // 1. Fetch audio stream
    // 2. Send to ASR service (Google/AWS/Deepgram)
    // 3. Return transcript + confidence + audio URL

    const confidence = 0.85 + Math.random() * 0.14; // Random confidence 0.85 - 0.99
    const duration = text.length * 50; // Approx 50ms per character

    return {
      transcript: text,
      confidence,
      audioUrl: `https://s3.amazonaws.com/simulated-audio/${Math.random()
        .toString(36)
        .substring(7)}.mp3`,
      durationMs: duration,
    };
  }
}

/**
 * Factory: choose which TelephonySession to use based on entryPoint + inputType.
 *  - inputType === "text"       → transcript-based simulation
 *  - phone number or sip: URI   → real telephony
 *  - everything else            → simulated IVR (catalog / generated)
 */
function createTelephonySession(
  entryPoint: string,
  inputType?: string
): TelephonySession {
  if (inputType === "text") {
    return new SimulatedTelephonySession(entryPoint, "text");
  }

  const ep = entryPoint.trim().toLowerCase();
  const looksLikePhone =
    /^(\+?\d{6,})$/.test(ep) || ep.startsWith("tel:");
  const looksLikeSip = ep.startsWith("sip:");

  if (looksLikePhone || looksLikeSip) {
    return new RealTelephonySession(entryPoint);
  }

  // Fallback to simulated IVR for unknown endpoints
  return new SimulatedTelephonySession(entryPoint, inputType);
}

// --- Internal Mutations --- //

export const createJob = mutation({
  args: {
    projectId: v.id("projects"),
    entryPoint: v.string(),
    inputType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Clear existing nodes for a fresh discovery
    const existingNodes = await ctx.db
      .query("ivr_nodes")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const node of existingNodes) {
      await ctx.db.delete(node._id);
    }

    return await ctx.db.insert("discovery_jobs", {
      projectId: args.projectId,
      entryPoint: args.entryPoint,
      inputType: args.inputType,
      status: "queued",
      startTime: Date.now(),
    });
  },
});

export const writeLog = internalMutation({
  args: {
    jobId: v.id("discovery_jobs"),
    message: v.string(),
    type: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("discovery_logs", {
      jobId: args.jobId,
      message: args.message,
      type: args.type,
      timestamp: Date.now(),
    });
  },
});

export const insertNode = internalMutation({
  args: {
    projectId: v.id("projects"),
    parentId: v.optional(v.id("ivr_nodes")),
    type: v.string(),
    label: v.string(),
    content: v.string(),
    metadata: v.optional(v.any()),
    fingerprint: v.optional(v.string()),
    isLoop: v.optional(v.boolean()),
    linkedNodeId: v.optional(v.id("ivr_nodes")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("ivr_nodes", {
      projectId: args.projectId,
      parentId: args.parentId,
      type: args.type,
      label: args.label,
      content: args.content,
      metadata: args.metadata,
      fingerprint: args.fingerprint,
      isLoop: args.isLoop,
      linkedNodeId: args.linkedNodeId,
    });
  },
});

export const completeJob = internalMutation({
  args: {
    jobId: v.id("discovery_jobs"),
    projectId: v.id("projects"),
    platform: v.string(),
    status: v.string(),
    artifacts: v.optional(
      v.object({
        graph: v.string(),
        report: v.string(),
        testCases: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: args.status,
      endTime: Date.now(),
      platform: args.platform,
      artifacts: args.artifacts,
    });
    await ctx.db.patch(args.projectId, {
      platform: args.platform,
    });
  },
});

export const setWaiting = internalMutation({
  args: {
    jobId: v.id("discovery_jobs"),
    waitingFor: v.string(),
    resumeState: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "waiting_for_input",
      waitingFor: args.waitingFor,
      resumeState: args.resumeState,
    });
  },
});

export const resumeJob = mutation({
  args: {
    jobId: v.id("discovery_jobs"),
    input: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "running",
      waitingFor: undefined,
    });
  },
});

// --- Action: The "Crawl Engine" (DFS Graph Traversal) --- //

export const continueDiscovery = action({
  args: {
    jobId: v.id("discovery_jobs"),
    projectId: v.id("projects"),
    input: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.runQuery(api.discovery.getJob, { jobId: args.jobId });
    if (!job || !job.resumeState) {
      throw new Error("Cannot resume job: No state found");
    }

    const stack = JSON.parse(job.resumeState);
    if (stack.length > 0) {
      const lastState = stack[stack.length - 1];
      // Apply the manual input to the last path
      stack[stack.length - 1] = {
        ...lastState,
        path: [...lastState.path, args.input],
      };
    }

    await ctx.runAction(api.discovery.runDiscovery, {
      jobId: args.jobId,
      projectId: args.projectId,
      entryPoint: job.entryPoint,
      inputType: job.inputType,
      resumeInput: args.input,
      resumeStack: JSON.stringify(stack),
    });
  },
});

export const runDiscovery = action({
  args: {
    jobId: v.id("discovery_jobs"),
    projectId: v.id("projects"),
    entryPoint: v.string(),
    inputType: v.optional(v.string()),
    resumeInput: v.optional(v.string()),
    resumeStack: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { jobId, projectId, entryPoint, inputType, resumeInput, resumeStack } =
      args;

    const log = async (msg: string, type: string = "info") => {
      await ctx.runMutation(internal.discovery.writeLog, {
        jobId,
        message: msg,
        type,
      });
    };

    try {
      await log(`Starting Graph-Based Discovery for ${entryPoint}...`);

      // 1. Initialize State
      const visitedFingerprints = new Map<string, Id<"ivr_nodes">>(); // Map fingerprint -> nodeId
      const maxDepth = 5;

      // Stack for Iterative DFS
      let stack: { path: string[]; parentId?: Id<"ivr_nodes">; depth: number }[] =
        [];

      if (resumeStack) {
        stack = JSON.parse(resumeStack);
        await log("Resuming from saved state...", "info");
        if (resumeInput && stack.length > 0) {
          const current = stack.pop()!;
          stack.push({ ...current, path: [...current.path, resumeInput] });
          await log(`Applied manual input: ${resumeInput}`);
        }
      } else {
        stack.push({ path: [], parentId: undefined, depth: 0 });
      }

      // Metrics for Report
      const metrics = {
        startTime: Date.now(),
        nodesDiscovered: 0,
        loopsDetected: 0,
        maxDepthReached: 0,
        errors: 0,
      };

      // 2. Iterative DFS Loop
      while (stack.length > 0) {
        const { path, parentId, depth } = stack.pop()!;

        if (depth > maxDepth) {
          await log(`Max depth (${maxDepth}) reached. Pruning branch.`, "debug");
          continue;
        }

        metrics.maxDepthReached = Math.max(metrics.maxDepthReached, depth);

        // A. Dial and Navigate (Replay Path) using dynamic session
        const session = createTelephonySession(entryPoint, inputType);
        let result = await session.dial();

        // Replay DTMFs to reach current state
        for (const digit of path) {
          result = await session.sendDtmf(digit);
        }

        // B. Fingerprint & Loop Detection
        const fingerprint = fingerprintPrompt(result.transcript);
        const isLoop = visitedFingerprints.has(fingerprint);

        await log(
          `[Depth ${depth}] Reached node. Confidence: ${(result.confidence * 100).toFixed(
            1
          )}%`
        );

        // C. Save Node
        const nodeId = await ctx.runMutation(internal.discovery.insertNode, {
          projectId,
          parentId,
          type: depth === 0 ? "menu" : "prompt",
          label: depth === 0 ? "Main Menu" : `Option ${path[path.length - 1]}`,
          content: result.transcript,
          metadata: {
            path: path.join(">"),
            confidence: result.confidence,
            audioUrl: result.audioUrl,
            durationMs: result.durationMs,
            dtmf: path.length > 0 ? path[path.length - 1] : undefined,
          },
          fingerprint,
          isLoop,
          linkedNodeId: isLoop ? visitedFingerprints.get(fingerprint) : undefined,
        });

        metrics.nodesDiscovered++;

        if (isLoop) {
          metrics.loopsDetected++;
          await log(`Loop detected back to node. Stopping branch.`);
          await session.hangup();
          continue;
        }

        // Mark visited
        visitedFingerprints.set(fingerprint, nodeId);

        // D. Extract Options & Recurse
        const options = extractMenuOptions(result.transcript);

        if (options.length > 0) {
          await log(
            `Found ${options.length} options: ${options
              .map((o) => o.dtmf)
              .join(", ")}`
          );

          // Simulate delay for realism
          await new Promise((r) => setTimeout(r, 500));

          // Push options to stack (reverse order to process 1 first if using pop)
          for (let i = options.length - 1; i >= 0; i--) {
            stack.push({
              path: [...path, options[i].dtmf],
              parentId: nodeId,
              depth: depth + 1,
            });
          }

          await session.hangup();
        } else {
          // Check if we need manual input (Simulated logic: if text contains "enter" or "pin" and no options found)
          if (
            result.transcript.toLowerCase().includes("enter") &&
            options.length === 0
          ) {
            await log("Node requires input. Pausing for human intervention.", "warning");

            // Save state and pause
            stack.push({ path, parentId, depth });

            await session.hangup();

            await ctx.runMutation(internal.discovery.setWaiting, {
              jobId,
              waitingFor: "PIN/ID",
              resumeState: JSON.stringify(stack),
            });
            return; // Exit action, wait for resume
          }

          await log("No further options found. Leaf node.");
          await session.hangup();
        }
      }

      // 3. Generate Artifacts
      await log("Generating artifacts...");

      // Graph JSON
      const nodes = await ctx.runQuery(api.discovery.getNodes, { projectId });
      const graphJson = JSON.stringify({ nodes, edges: [] }, null, 2); // Simplified graph

      // Report JSON
      const reportJson = JSON.stringify(
        {
          jobId,
          entryPoint,
          platform: "Simulated/Discovered",
          metrics: {
            ...metrics,
            duration: Date.now() - metrics.startTime,
            totalNodes: nodes.length,
          },
          timestamp: new Date().toISOString(),
        },
        null,
        2
      );

      // Test Cases JSON (Generate them)
      const testGenResult = await ctx.runMutation(
        internal.testCases.generateInternal,
        { projectId }
      );
      const testCasesJson = JSON.stringify(
        testGenResult.generatedTests || [],
        null,
        2
      );

      await log("Graph traversal complete.");
      await ctx.runMutation(internal.discovery.completeJob, {
        jobId,
        projectId,
        platform: "Simulated/Discovered",
        status: "completed",
        artifacts: {
          graph: graphJson,
          report: reportJson,
          testCases: testCasesJson,
        },
      });
    } catch (error: any) {
      await log(`Critical Failure: ${error.message}`, "error");
      await ctx.runMutation(internal.discovery.completeJob, {
        jobId,
        projectId,
        platform: "Unknown",
        status: "failed",
      });
    }
  },
});

// --- Queries --- //

export const getJob = query({
  args: { jobId: v.id("discovery_jobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

export const getLogs = query({
  args: { jobId: v.id("discovery_jobs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("discovery_logs")
      .withIndex("by_job", (q) => q.eq("jobId", args.jobId))
      .order("asc")
      .collect();
  },
});

export const getNodes = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ivr_nodes")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});
