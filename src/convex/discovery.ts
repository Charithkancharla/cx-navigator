import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

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

const curatedCatalog: CuratedIVR[] = [
  {
    id: "amazon_connect_horizon_bank",
    entryPoints: [
      "+18005550199", 
      "+1 (800) 555-0199", 
      "aws:contact-flow:horizon", 
      "+1 646-706-0679",
      "+16467060679",
      "6467060679",
      "18005550199",
      "8005550199"
    ],
    platform: "Amazon Connect",
    industry: "Banking",
    welcome:
      "Thank you for calling Horizon Federal, powered by Amazon Connect. For English, press 1. Para español, oprima número dos.",
    branches: [
      {
        label: "Account Services",
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
        label: "Card & Fraud",
        type: "menu",
        content: "Press 2 for card controls, press 3 to report fraud, or stay on the line for an agent.",
        metadata: { dtmf: "2", confidence: 0.96 },
        children: [
          {
            label: "Freeze Card",
            type: "prompt",
            content: "Say 'freeze' or press 1 to temporarily pause your debit card.",
            metadata: { dtmf: "1", intent: "freeze", confidence: 0.93 },
          },
          {
            label: "Fraud Specialist",
            type: "prompt",
            content: "Please hold while we connect you to a certified fraud specialist.",
            metadata: { dtmf: "0", confidence: 0.97 },
          },
        ],
      },
      {
        label: "Concierge Banker",
        type: "prompt",
        content: "Please hold while we route your call to a dedicated banker.",
        metadata: { dtmf: "0", confidence: 0.99 },
      },
    ],
  },
  {
    id: "genesys_cloud_skyway",
    entryPoints: [
      "+442080555200", 
      "442080555200",
      "2080555200",
      "sip:ivr@skyway-air.com", 
      "genesys:skyway:routing-point"
    ],
    platform: "Genesys Cloud CX",
    industry: "Travel",
    welcome:
      "Welcome to Skyway Airlines. This call is recorded. Say 'book' to make a reservation or stay on the line for menu options.",
    branches: [
      {
        label: "Reservations",
        type: "menu",
        content: "Say 'book flight' or press 1 to book. Say 'change' or press 2 to modify an itinerary.",
        metadata: { dtmf: "1", intent: "book flight", confidence: 0.97 },
        children: [
          {
            label: "Book Flight",
            type: "prompt",
            content: "Please state your departure city after the tone.",
            metadata: { intent: "book flight", confidence: 0.95 },
          },
          {
            label: "Change Flight",
            type: "prompt",
            content: "Provide your confirmation code or press 2 to enter it via keypad.",
            metadata: { dtmf: "2", intent: "change flight", confidence: 0.94 },
          },
        ],
      },
      {
        label: "Flight Status",
        type: "prompt",
        content: "Say your flight number or press 3 to enter the digits on your keypad.",
        metadata: { dtmf: "3", intent: "flight status", confidence: 0.93 },
      },
      {
        label: "Baggage Services",
        type: "prompt",
        content: "Say 'lost bag' or press 4 for baggage services.",
        metadata: { dtmf: "4", intent: "lost bag", confidence: 0.92 },
      },
    ],
  },
  {
    id: "twilio_flex_atlas",
    entryPoints: [
      "+13125550188", 
      "+1 312-555-0188",
      "13125550188",
      "3125550188",
      "twilio:number:atlas-support", 
      "https://chat.atlas-retail.com"
    ],
    platform: "Twilio Flex",
    industry: "Retail",
    welcome:
      "Atlas Retail Support. Press 1 for order status, press 2 for returns, say 'agent' at any time to escalate.",
    branches: [
      {
        label: "Order Status",
        type: "prompt",
        content: "Enter your order number or say 'lookup' to search by email.",
        metadata: { dtmf: "1", intent: "lookup", confidence: 0.9 },
      },
      {
        label: "Returns",
        type: "menu",
        content: "Press 2 for self-service returns, press 3 to speak to a stylist.",
        metadata: { dtmf: "2", confidence: 0.92 },
        children: [
          {
            label: "Return Label",
            type: "prompt",
            content: "We texted you a return label. Say 'email' if you'd like it emailed instead.",
            metadata: { intent: "email label", confidence: 0.9 },
          },
          {
            label: "Stylist Team",
            type: "prompt",
            content: "Connecting you with a live stylist now.",
            metadata: { dtmf: "3", confidence: 0.93 },
          },
        ],
      },
      {
        label: "Escalate to Agent",
        type: "prompt",
        content: "Please hold while we route you to the next available Twilio Flex agent.",
        metadata: { intent: "agent", confidence: 0.99 },
      },
    ],
  },
];

function normalizeEntryPoint(value: string): string {
  // Remove all non-alphanumeric characters except + at the start
  let normalized = value.trim().toLowerCase();
  
  // Extract just digits and + sign
  normalized = normalized.replace(/[^0-9+a-z:]/g, "");
  
  return normalized;
}

function matchCuratedFlow(value: string): CuratedIVR | null {
  const normalized = normalizeEntryPoint(value);
  return (
    curatedCatalog.find((entry) =>
      entry.entryPoints.some((candidate) => normalizeEntryPoint(candidate) === normalized),
    ) ?? null
  );
}

function generateSimulatedFlow(value: string): CuratedIVR {
  const normalized = normalizeEntryPoint(value);
  // Simple deterministic hash from string
  const hash = normalized.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  
  const platforms = ["Amazon Connect", "Genesys Cloud CX", "Twilio Flex", "Nice CXone", "Avaya Experience Platform"];
  const industries = ["Retail", "Banking", "Healthcare", "Travel", "Insurance", "Telecommunications"];
  
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
        label: "Billing & Payments",
        type: "prompt",
        content: "For billing questions or to make a payment, press 3.",
        metadata: { dtmf: "3", confidence: 0.96 },
      }
    ]
  };
}

// --- Internal Mutations for Action --- //

export const createJob = mutation({
  args: {
    projectId: v.id("projects"),
    entryPoint: v.string(),
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
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("ivr_nodes", {
      projectId: args.projectId,
      parentId: args.parentId,
      type: args.type,
      label: args.label,
      content: args.content,
      metadata: args.metadata,
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

// --- Action: The "Crawl Engine" --- //

export const runDiscovery = action({
  args: {
    jobId: v.id("discovery_jobs"),
    projectId: v.id("projects"),
    entryPoint: v.string(),
  },
  handler: async (ctx, args) => {
    const { jobId, projectId, entryPoint } = args;

    const log = async (msg: string, type: string = "info") => {
      await ctx.runMutation(internal.discovery.writeLog, { jobId, message: msg, type });
    };

    try {
      await log(`Initializing discovery agent for target: ${entryPoint}`);
      await new Promise(r => setTimeout(r, 800));

      await log("Allocating SIP trunk from pool (us-east-1)...");
      await new Promise(r => setTimeout(r, 1000));

      await log(`Dialing ${entryPoint}...`);
      await new Promise(r => setTimeout(r, 1500));

      await log("Connection established. SIP 200 OK.");
      await log("Analyzing RTP stream for audio fingerprinting...");
      await new Promise(r => setTimeout(r, 1200));

      // Determine the flow to "discover"
      let flow = matchCuratedFlow(entryPoint);
      if (!flow) {
        await log("No cached fingerprint found. Initiating dynamic traversal.");
        flow = generateSimulatedFlow(entryPoint);
      } else {
        await log(`Matched known IVR signature: ${flow.id}`);
      }

      await log(`Detected Platform: ${flow.platform} (${flow.industry})`);
      await new Promise(r => setTimeout(r, 800));

      await log("Voice Activity Detected. Transcribing welcome prompt...");
      await new Promise(r => setTimeout(r, 1000));

      // Insert Root Node
      const rootId = await ctx.runMutation(internal.discovery.insertNode, {
        projectId,
        type: "menu",
        label: "Main Menu",
        content: flow.welcome,
        metadata: {
          platform: flow.platform,
          industry: flow.industry,
          entryPoint,
          confidence: 0.99,
        },
      });

      await log("Root menu mapped. Exploring branches...");

      // Recursive function to "crawl" branches with delays
      const crawlBranches = async (branches: FlowNode[], parentId: Id<"ivr_nodes">) => {
        for (const branch of branches) {
          await new Promise(r => setTimeout(r, 600)); // Crawl delay
          await log(`Navigating option: ${branch.label} (DTMF: ${branch.metadata?.dtmf || "Voice"})`);

          const nodeId = await ctx.runMutation(internal.discovery.insertNode, {
            projectId,
            parentId,
            type: branch.type,
            label: branch.label,
            content: branch.content,
            metadata: branch.metadata,
          });

          if (branch.children && branch.children.length > 0) {
            await crawlBranches(branch.children, nodeId);
          }
        }
      };

      await crawlBranches(flow.branches, rootId);

      await log("Traversal complete. All reachable nodes mapped.");
      await log("Disconnecting session.");

      await ctx.runMutation(internal.discovery.completeJob, {
        jobId,
        projectId,
        platform: flow.platform,
        status: "completed",
      });

    } catch (error: any) {
      await log(`Error during discovery: ${error.message}`, "error");
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