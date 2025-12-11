"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
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
        if (res.status === 404) {
          throw new Error(
            `Telephony backend returned 404 (Not Found). You might be pointing TELEPHONY_BACKEND_URL to the frontend instead of the backend server, or the /dial endpoint is missing. Check TELEPHONY_SETUP.md.`
          );
        }
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

    await ctx.runAction(api.discoveryActions.runDiscovery, {
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
      const backendUrl = process.env.TELEPHONY_BACKEND_URL;

      await log(
        `Starting Graph-Based Discovery for ${entryPoint} (inputType=${inputType ?? "none"})...`
      );

      // Check for common misconfiguration
      if (inputType !== "simulated" && inputType !== "text") {
        if (!backendUrl) {
           throw new Error("TELEPHONY_BACKEND_URL is missing. Please set it in the Convex Dashboard.");
        }
        
        // STRICT CHECK: Prevent using the Convex URL as the Telephony Backend
        if (backendUrl.includes("convex.site") || backendUrl.includes("vly.site")) {
           const errorMsg = `INVALID CONFIGURATION: TELEPHONY_BACKEND_URL is set to '${backendUrl}'.\n` +
             `This is your Convex Frontend/Backend URL, which CANNOT handle phone calls.\n` +
             `\n` +
             `TO FIX THIS:\n` +
             `1. If you want to TEST without a server: Check 'Simulate Interaction' in the UI.\n` +
             `2. If you want REAL CALLS: You must run the 'server.ts' file locally and use ngrok.\n` +
             `   - Run: npm run start:server\n` +
             `   - Run: ngrok http 3000\n` +
             `   - Set TELEPHONY_BACKEND_URL to your ngrok URL (e.g. https://xyz.ngrok-free.app)`;
           
           await log(errorMsg, "error");
           throw new Error(errorMsg);
        }
      }

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

        await log(`DEBUG: TELEPHONY_BACKEND_URL='${String(backendUrl)}'`, "debug");
        const session = createTelephonySession(entryPoint, inputType, backendUrl);
        await log(
          `Created session: ${
            session instanceof RealTelephonySession ? "RealTelephonySession" : "SimulatedTelephonySession"
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
          platform: backendUrl ? "Live/Discovered" : "Simulated",
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
        platform: backendUrl ? "Live/Discovered" : "Simulated",
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
