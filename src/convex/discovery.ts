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

// --- Helper Functions --- //

function normalizeEntryPoint(value: string): string {
  let normalized = value.trim().toLowerCase();
  normalized = normalized.replace(/[^0-9+a-z:]/g, "");
  return normalized;
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
    branches,
  };
}

// --- Strict Matching & Fingerprinting --- //

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

function fingerprintPrompt(text: string): string {
  let hash = 0;
  const normalized = normalizeText(text);
  if (normalized.length === 0) return "empty";
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return `v1:${Math.abs(hash).toString(16)}`;
}

function extractMenuOptions(text: string): { dtmf: string; label: string }[] {
  const options: { dtmf: string; label: string }[] = [];

  // Try to catch common IVR phrases:
  // - "Press 1 for Billing"
  // - "For Billing, press 1"
  // - "To check your balance, press 1"
  // - "Press or say 1 for Billing"
  const patterns = [
    /Press\s+(\d)\s+(?:for|to)\s+([^.,;]+)/gi,
    /For\s+([^.,;]+?),?\s+press\s+(\d)/gi,
    /To\s+([^.,;]+?),?\s+press\s+(\d)/gi,
    /Press\s+or\s+say\s+(\d)\s+for\s+([^.,;]+)/gi,
  ];

  for (const pattern of patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
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
  private backendUrl: string;

  constructor(endpoint: string, backendUrl: string) {
    this.endpoint = endpoint;
    this.backendUrl = backendUrl;
  }

  async dial(): Promise<AudioProcessingResult> {
    try {
      const res = await fetch(`${this.backendUrl}/dial`, {
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
        transcript: data.transcript ?? "",
        confidence: data.confidence ?? 0,
        audioUrl: data.audioUrl ?? "",
        durationMs: data.durationMs ?? 0,
        detectedDtmf: data.detectedDtmf,
      };
    } catch (err: any) {
      throw new Error(`RealTelephonySession.dial error: ${err.message}`);
    }
  }

  async sendDtmf(digit: string): Promise<AudioProcessingResult> {
    if (!this.callId) {
      throw new Error("Call not connected");
    }

    try {
      const res = await fetch(`${this.backendUrl}/send-dtmf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId: this.callId, digit }),
      });

      if (!res.ok) {
        throw new Error(`sendDtmf failed with status ${res.status}`);
      }

      const data = await res.json();

      return {
        transcript: data.transcript ?? "",
        confidence: data.confidence ?? 0,
        audioUrl: data.audioUrl ?? "",
        durationMs: data.durationMs ?? 0,
        detectedDtmf: data.detectedDtmf,
      };
    } catch (err: any) {
      throw new Error(`RealTelephonySession.sendDtmf error: ${err.message}`);
    }
  }

  async hangup(): Promise<void> {
    if (!this.callId) return;

    try {
      await fetch(`${this.backendUrl}/hangup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callId: this.callId }),
      });
    } catch (err: any) {
      console.error(`RealTelephonySession.hangup error: ${err.message}`);
    } finally {
      this.callId = null;
    }
  }
}

/**
 * Simple simulator used ONLY when:
 *  - inputType === "text" (user pasted transcript)
 *  - inputType === "simulated" (explicit dev mode)
 */
class SimulatedTelephonySession implements TelephonySession {
  private flow: CuratedIVR;
  private currentNode: FlowNode | null = null;
  private isConnected = false;

  constructor(entryPoint: string, inputType?: string) {
    if (inputType === "text") {
      this.flow = parseTranscriptFlow(entryPoint);
    } else {
      // minimal generic wrapper for simulated mode
      this.flow = {
        id: "simulated_text",
        entryPoints: [entryPoint],
        platform: "Simulated",
        industry: "Unknown",
        welcome: entryPoint,
        branches: [],
      };
    }
  }

  async dial(): Promise<AudioProcessingResult> {
    this.isConnected = true;
    return this.processAudio(this.flow.welcome);
  }

  async sendDtmf(digit: string): Promise<AudioProcessingResult> {
    if (!this.isConnected) throw new Error("Call not connected");

    let children = this.currentNode ? this.currentNode.children : this.flow.branches;

    if (!children || children.length === 0) {
      return this.processAudio("Invalid option.");
    }

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

  private processAudio(text: string): AudioProcessingResult {
    const confidence = 0.9;
    const duration = text.length * 50;

    return {
      transcript: text,
      confidence,
      audioUrl: `https://example.com/simulated/${Math.random()
        .toString(36)
        .substring(7)}.mp3`,
      durationMs: duration,
    };
  }
}

/**
 * Factory: choose which TelephonySession to use based on entryPoint + inputType.
 *
 *  - inputType === "text"       → transcript-based simulation
 *  - inputType === "simulated"  → simulated dev mode
 *  - phone number or sip: URI   → real telephony (ALWAYS)
 */
function createTelephonySession(
  entryPoint: string,
  inputType: string | undefined,
  backendUrl?: string
): TelephonySession {
  if (inputType === "text" || inputType === "simulated") {
    return new SimulatedTelephonySession(entryPoint, inputType);
  }

  const ep = normalizeEntryPoint(entryPoint);
  const looksLikePhone = /^(\+?\d{6,})$/.test(ep) || ep.startsWith("tel");
  const looksLikeSip = ep.startsWith("sip");

  if (looksLikePhone || looksLikeSip) {
    if (!backendUrl) {
      throw new Error("TELEPHONY_BACKEND_URL is not configured for RealTelephonySession");
    }
    return new RealTelephonySession(entryPoint, backendUrl);
  }

  // Default: treat unknown formats as real to avoid silently simulating
  if (!backendUrl) {
    throw new Error("TELEPHONY_BACKEND_URL is not configured for RealTelephonySession");
  }
  return new RealTelephonySession(entryPoint, backendUrl);
}

// --- Internal Mutations --- //

export const createJob = mutation({
  args: {
    projectId: v.id("projects"),
    entryPoint: v.string(),
    inputType: v.optional(v.string()), // "text" | "simulated" | undefined
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
      await log(
        `Starting Graph-Based Discovery for ${entryPoint} (inputType=${inputType ?? "none"})...`
      );

      const visitedFingerprints = new Map<string, Id<"ivr_nodes">>();
      const maxDepth = 5;

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

      const metrics = {
        startTime: Date.now(),
        nodesDiscovered: 0,
        loopsDetected: 0,
        maxDepthReached: 0,
        errors: 0,
      };

      // --- DFS Loop --- //
      while (stack.length > 0) {
        const { path, parentId, depth } = stack.pop()!;

        if (depth > maxDepth) {
          await log(`Max depth (${maxDepth}) reached. Pruning branch.`, "debug");
          continue;
        }

        metrics.maxDepthReached = Math.max(metrics.maxDepthReached, depth);

        const backendUrl = process.env.TELEPHONY_BACKEND_URL;
        await log(`TELEPHONY_BACKEND_URL=${String(backendUrl)}`, "debug");
        const session = createTelephonySession(entryPoint, inputType, backendUrl);
        await log(
          `Created session: ${session instanceof RealTelephonySession ? "RealTelephonySession" : "SimulatedTelephonySession"
          } for path [${path.join(",")}]`,
          "debug"
        );

        let result = await session.dial();

        for (const digit of path) {
          result = await session.sendDtmf(digit);
        }

        const fingerprint = fingerprintPrompt(result.transcript);
        const isLoop = visitedFingerprints.has(fingerprint);

        await log(
          `[Depth ${depth}] Reached node. Fingerprint=${fingerprint}, Confidence=${(
            result.confidence * 100
          ).toFixed(1)}%`
        );

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
          await log(`Loop detected. Stopping branch at fingerprint=${fingerprint}.`);
          await session.hangup();
          continue;
        }

        visitedFingerprints.set(fingerprint, nodeId);

        const options = extractMenuOptions(result.transcript);

        if (options.length > 0) {
          await log(
            `Found ${options.length} options: ${options
              .map((o) => `${o.dtmf}:${o.label}`)
              .join(" | ")}`
          );

          for (let i = options.length - 1; i >= 0; i--) {
            stack.push({
              path: [...path, options[i].dtmf],
              parentId: nodeId,
              depth: depth + 1,
            });
          }

          await session.hangup();
        } else {
          const lower = result.transcript.toLowerCase();
          if (
            (lower.includes("enter") || lower.includes("pin")) &&
            options.length === 0
          ) {
            await log(
              "Node requires input (PIN/ID). Pausing for human intervention.",
              "warning"
            );

            stack.push({ path, parentId, depth });

            await session.hangup();

            await ctx.runMutation(internal.discovery.setWaiting, {
              jobId,
              waitingFor: "PIN/ID",
              resumeState: JSON.stringify(stack),
            });
            return;
          }

          await log("No further options found. Leaf node.");
          await session.hangup();
        }
      }

      await log("Generating artifacts...");

      const nodes = await ctx.runQuery(api.discovery.getNodes, { projectId });
      const graphJson = JSON.stringify({ nodes, edges: [] }, null, 2);

      const reportJson = JSON.stringify(
        {
          jobId,
          entryPoint,
          platform: process.env.TELEPHONY_BACKEND_URL ? "Live/Discovered" : "Simulated",
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
        platform: process.env.TELEPHONY_BACKEND_URL ? "Live/Discovered" : "Simulated",
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