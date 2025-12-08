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
        content: "Press 1 for balances, press 2 for recent activity, or press 0 to reach a banker.",
        metadata: { dtmf: "1", confidence: 0.98 },
        children: [
          {
            label: "Balance Inquiry",
            type: "prompt",
            content: "Please enter your 16 digit account number followed by the pound key.",
            metadata: { dtmf: "1", confidence: 0.95 },
          },
          {
            label: "Recent Transactions",
            type: "prompt",
            content: "Say 'transactions' or press 2 to hear your last five transactions.",
            metadata: { dtmf: "2", intent: "transactions", confidence: 0.94 },
          },
        ],
      },
      {
        label: "Spanish",
        type: "prompt",
        content: "Gracias. Por favor espere un momento.",
        metadata: { dtmf: "2", confidence: 0.99 },
      }
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
  const hash = normalized.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  
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
            content: "Please hold while we connect you to the next available agent.",
            metadata: { dtmf: "0", confidence: 0.99 },
          }
        ]
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
          }
        ]
      },
      {
        label: "Billing",
        type: "prompt",
        content: "For billing questions, press 3.",
        metadata: { dtmf: "3", confidence: 0.96 },
      }
    ]
  };
}

function parseTranscriptFlow(text: string): CuratedIVR {
  const branches: FlowNode[] = [];
  const pressMatches = text.matchAll(/Press (\\d) for ([^.,;]+)/gi);
  for (const match of pressMatches) {
    branches.push({
      label: match[2].trim(),
      type: "prompt",
      content: `(Simulated) You selected ${match[2].trim()}.`,
      metadata: { dtmf: match[1], confidence: 1.0 }
    });
  }
  return {
    id: "transcript_flow",
    entryPoints: [],
    platform: "Text Transcript",
    industry: "Unknown",
    welcome: text,
    branches: branches
  };
}

// --- Strict Matching & Fingerprinting --- //

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

function fingerprintPrompt(text: string): string {
  // Simple hash for simulation. In production, use a robust hash of the audio or normalized text.
  let hash = 0;
  const normalized = normalizeText(text);
  if (normalized.length === 0) return "empty";
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

function extractMenuOptions(text: string): { dtmf: string; label: string }[] {
  const options: { dtmf: string; label: string }[] = [];
  // Regex to find "Press X for Y" or "For Y, press X"
  const patterns = [
    /Press (\d) for ([^.,;]+)/gi,
    /For ([^.,;]+),? press (\d)/gi
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

// --- Simulated Telephony Adapter --- //

class SimulatedTelephonySession {
  private flow: CuratedIVR;
  private currentNode: FlowNode | null = null;
  private isConnected: boolean = false;

  constructor(entryPoint: string, inputType?: string) {
    if (inputType === "text") {
      this.flow = parseTranscriptFlow(entryPoint);
    } else {
      const normalized = normalizeEntryPoint(entryPoint);
      this.flow = curatedCatalog.find(c => c.entryPoints.some(e => normalizeEntryPoint(e) === normalized)) 
        ?? generateSimulatedFlow(entryPoint);
    }
  }

  async dial(): Promise<string> {
    this.isConnected = true;
    // Start at root (conceptually before the first prompt, but for sim we return welcome)
    return this.flow.welcome;
  }

  async sendDtmf(digit: string): Promise<string> {
    if (!this.isConnected) throw new Error("Call not connected");
    
    // Traverse logic
    let children = this.currentNode ? this.currentNode.children : this.flow.branches;
    
    if (!children) return "Invalid option.";

    const match = children.find(c => c.metadata?.dtmf === digit);
    if (match) {
      this.currentNode = match;
      return match.content;
    }
    
    return "Invalid selection. Please try again.";
  }

  async hangup() {
    this.isConnected = false;
    this.currentNode = null;
  }
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
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: args.status,
      endTime: Date.now(),
      platform: args.platform,
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
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.jobId, {
      status: "waiting_for_input",
      waitingFor: args.waitingFor,
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
    // For now, just log and complete as this is a complex state resume
    // In a real implementation, we would need to persist the DFS stack
    await ctx.runMutation(internal.discovery.writeLog, { 
      jobId: args.jobId, 
      message: `Resumed with input: ${args.input}. (Complex resume not fully implemented in sim)`, 
      type: "info" 
    });
    await ctx.runMutation(internal.discovery.completeJob, {
      jobId: args.jobId,
      projectId: args.projectId,
      platform: "Resumed Session",
      status: "completed",
    });
  }
});

export const runDiscovery = action({
  args: {
    jobId: v.id("discovery_jobs"),
    projectId: v.id("projects"),
    entryPoint: v.string(),
    inputType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { jobId, projectId, entryPoint, inputType } = args;

    const log = async (msg: string, type: string = "info") => {
      await ctx.runMutation(internal.discovery.writeLog, { jobId, message: msg, type });
    };

    try {
      await log(`Starting Graph-Based Discovery for ${entryPoint}...`);
      
      // 1. Initialize State
      const visitedFingerprints = new Map<string, Id<"ivr_nodes">>(); // Map fingerprint -> nodeId
      const maxDepth = 5;
      
      // 2. Define DFS Traversal Function
      const explore = async (path: string[], parentId?: Id<"ivr_nodes">, depth: number = 0) => {
        if (depth > maxDepth) {
          await log(`Max depth (${maxDepth}) reached. Pruning branch.`, "debug");
          return;
        }

        // A. Dial and Navigate (Replay Path)
        // In a real system, we might try to "backtrack", but for robustness, we often redial or reset.
        // Here we simulate a fresh call and navigation to the current point.
        const session = new SimulatedTelephonySession(entryPoint, inputType);
        let currentText = await session.dial();
        
        // Replay DTMFs to reach current state
        for (const digit of path) {
          currentText = await session.sendDtmf(digit);
        }

        // B. Fingerprint & Loop Detection
        const fingerprint = fingerprintPrompt(currentText);
        const isLoop = visitedFingerprints.has(fingerprint);
        
        await log(`[Depth ${depth}] Reached node. Fingerprint: ${fingerprint.substring(0, 6)}... ${isLoop ? "(LOOP DETECTED)" : ""}`);

        // C. Save Node
        const nodeId = await ctx.runMutation(internal.discovery.insertNode, {
          projectId,
          parentId,
          type: depth === 0 ? "menu" : "prompt", // Simplified type inference
          label: depth === 0 ? "Main Menu" : `Option ${path[path.length - 1]}`,
          content: currentText,
          metadata: { 
            path: path.join(">"), 
            confidence: 1.0,
            dtmf: path.length > 0 ? path[path.length - 1] : undefined
          },
          fingerprint,
          isLoop,
          linkedNodeId: isLoop ? visitedFingerprints.get(fingerprint) : undefined,
        });

        if (isLoop) {
          await log(`Loop detected back to node ${visitedFingerprints.get(fingerprint)}. Stopping branch.`);
          return;
        }

        // Mark visited
        visitedFingerprints.set(fingerprint, nodeId);

        // D. Extract Options & Recurse
        const options = extractMenuOptions(currentText);
        
        if (options.length > 0) {
          await log(`Found ${options.length} options: ${options.map(o => o.dtmf).join(", ")}`);
          
          // Simulate delay for realism
          await new Promise(r => setTimeout(r, 800));

          for (const option of options) {
            await explore([...path, option.dtmf], nodeId, depth + 1);
          }
        } else {
          await log("No further options found. Leaf node.");
        }
        
        await session.hangup();
      };

      // 3. Start Crawl
      await explore([]);

      await log("Graph traversal complete.");
      await ctx.runMutation(internal.discovery.completeJob, {
        jobId,
        projectId,
        platform: "Simulated/Discovered",
        status: "completed",
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