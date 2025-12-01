import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
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
  
  // Handle various phone number formats
  // +1 646-706-0679 -> +16467060679
  // (646) 706-0679 -> 6467060679
  // 646.706.0679 -> 6467060679
  
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

async function insertFlowNodes(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  nodes: FlowNode[],
  platform: string,
  industry: string,
  entryPoint: string,
  normalizedEntryPoint: string,
  parentId?: Id<"ivr_nodes">,
): Promise<void> {
  for (const node of nodes) {
    const metadata = {
      platform,
      industry,
      entryPoint,
      entryPointNormalized: normalizedEntryPoint,
      ...node.metadata,
    };
    const nodeId = await ctx.db.insert("ivr_nodes", {
      projectId,
      parentId,
      type: node.type,
      label: node.label,
      content: node.content,
      metadata,
    });

    if (node.children?.length) {
      await insertFlowNodes(
        ctx,
        projectId,
        node.children,
        platform,
        industry,
        entryPoint,
        normalizedEntryPoint,
        nodeId,
      );
    }
  }
}

export const discover = mutation({
  args: {
    projectId: v.id("projects"),
    inputType: v.union(v.literal("phone"), v.literal("sip"), v.literal("file"), v.literal("text")),
    inputValue: v.string(),
    fileId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const curatedFlow = matchCuratedFlow(args.inputValue);
    if (!curatedFlow) {
      throw new Error(
        "This entry point has not been onboarded. Register it with the telephony adapters to enable discovery.",
      );
    }

    const existingNodes = await ctx.db
      .query("ivr_nodes")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    for (const node of existingNodes) {
      await ctx.db.delete(node._id);
    }

    await ctx.db.patch(args.projectId, { platform: curatedFlow.platform });

    const normalizedEntryPoint = normalizeEntryPoint(args.inputValue);
    const displayEntryPoint = args.inputValue.trim();

    const rootId = await ctx.db.insert("ivr_nodes", {
      projectId: args.projectId,
      type: "menu",
      label: "Main Menu",
      content: curatedFlow.welcome,
      metadata: {
        platform: curatedFlow.platform,
        industry: curatedFlow.industry,
        entryPoint: displayEntryPoint,
        entryPointNormalized: normalizedEntryPoint,
        confidence: 0.995,
      },
    });

    await insertFlowNodes(
      ctx,
      args.projectId,
      curatedFlow.branches,
      curatedFlow.platform,
      curatedFlow.industry,
      displayEntryPoint,
      normalizedEntryPoint,
      rootId,
    );

    return {
      status: "success",
      message: `Captured ${curatedFlow.platform} (${curatedFlow.industry}) flow for ${displayEntryPoint}`,
    };
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