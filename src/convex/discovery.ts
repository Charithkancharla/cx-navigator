import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Helper for deterministic randomness based on string seed
// This ensures that the same phone number always yields the same "discovered" IVR structure
function createSeededRandom(seed: string) {
  let h = 0xdeadbeef;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 2654435761);
  }
  return function() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h >>> 0) / 4294967296;
  };
}

// Simulation of IVR discovery
export const discover = mutation({
  args: {
    projectId: v.id("projects"),
    inputType: v.union(
      v.literal("phone"),
      v.literal("sip"),
      v.literal("file"),
      v.literal("text")
    ),
    inputValue: v.string(), // Phone number, SIP URI, or text description
    fileId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    // Clear existing nodes for this project
    const existing = await ctx.db
      .query("ivr_nodes")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    
    for (const node of existing) {
      await ctx.db.delete(node._id);
    }

    // Initialize deterministic random generator
    const rng = createSeededRandom(args.inputValue);

    // Determine Platform and Industry based on the "number"
    const platforms = ["Amazon Connect", "Genesys Cloud CX", "Twilio Flex", "Nice CXone", "Avaya Experience"];
    const industries = ["Banking", "Healthcare", "Retail", "Travel", "Utilities"];
    
    const platformIndex = Math.floor(rng() * platforms.length);
    const industryIndex = Math.floor(rng() * industries.length);
    
    const platform = platforms[platformIndex];
    const industry = industries[industryIndex];

    // Update project with detected platform
    await ctx.db.patch(args.projectId, { platform });

    // Generate a realistic IVR tree based on the industry
    const rootId = await ctx.db.insert("ivr_nodes", {
      projectId: args.projectId,
      type: "menu",
      label: "Main Menu",
      content: getWelcomeMessage(industry, platform),
      metadata: { dtmf: "root", platform, confidence: 0.99 },
    });

    // Generate 3-5 main menu options
    const numOptions = Math.floor(rng() * 3) + 3; // 3 to 5 options
    
    for (let i = 1; i <= numOptions; i++) {
      const optionLabel = getOptionLabel(industry, i);
      const optionId = await ctx.db.insert("ivr_nodes", {
        projectId: args.projectId,
        parentId: rootId,
        type: "menu",
        label: optionLabel,
        content: getOptionContent(industry, optionLabel),
        metadata: { dtmf: i.toString(), confidence: 0.95 + (rng() * 0.04) },
      });

      // 50% chance to have a submenu
      if (rng() > 0.5) {
        const numSubOptions = Math.floor(rng() * 2) + 2; // 2 to 3 sub options
        for (let j = 1; j <= numSubOptions; j++) {
          await ctx.db.insert("ivr_nodes", {
            projectId: args.projectId,
            parentId: optionId,
            type: "prompt",
            label: `${optionLabel} - Option ${j}`,
            content: getSubOptionContent(industry, optionLabel, j),
            metadata: { dtmf: j.toString(), confidence: 0.92 },
          });
        }
      }
    }

    return { 
      status: "success", 
      message: `Successfully crawled ${args.inputValue}. Identified ${platform} (${industry}) system with ${numOptions} main branches.` 
    };
  },
});

// Helper functions for content generation
function getWelcomeMessage(industry: string, platform: string): string {
  const greetings = [
    "Thank you for calling",
    "Welcome to",
    "You have reached",
    "Hello, and welcome to"
  ];
  const suffix = platform.includes("Amazon") ? "(Powered by AWS)" : "";
  
  switch (industry) {
    case "Banking": return `${greetings[0]} First National Bank. ${suffix} For English, press 1. Para español, oprima número dos.`;
    case "Healthcare": return `${greetings[1]} City General Health. ${suffix} If this is a medical emergency, please hang up and dial 911.`;
    case "Retail": return `${greetings[2]} SuperMart Customer Care. ${suffix} Your one stop shop for everything.`;
    case "Travel": return `${greetings[3]} SkyHigh Airlines. ${suffix} We are currently experiencing higher than normal call volumes.`;
    case "Utilities": return `${greetings[0]} Metro Power and Light. ${suffix} To report an outage, please stay on the line.`;
    default: return "Welcome to the main menu.";
  }
}

function getOptionLabel(industry: string, index: number): string {
  const options = {
    "Banking": ["Account Balance", "Lost Card", "Fraud Department", "Loan Services", "Speak to Agent"],
    "Healthcare": ["Appointments", "Pharmacy", "Billing", "Nurse Line", "Operator"],
    "Retail": ["Order Status", "Returns", "Product Info", "Store Hours", "Representative"],
    "Travel": ["Reservations", "Flight Status", "Baggage Claims", "Miles Program", "Agent"],
    "Utilities": ["Pay Bill", "Report Outage", "Start/Stop Service", "Customer Service", "More Options"]
  };
  const list = options[industry as keyof typeof options] || options["Retail"];
  return list[index - 1] || `Option ${index}`;
}

function getOptionContent(industry: string, label: string): string {
  return `You have selected ${label}. Please hold while we retrieve your details.`;
}

function getSubOptionContent(industry: string, parentLabel: string, index: number): string {
  return `For inquiries related to ${parentLabel} specific category ${index}, press ${index}.`;
}

export const getNodes = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ivr_nodes")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});