import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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

    // In a real app, this would trigger an external crawler or parser.
    // We simulate identifying the platform based on the input to provide realistic variety.
    
    // Clear existing nodes for this project
    const existing = await ctx.db
      .query("ivr_nodes")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    
    for (const node of existing) {
      await ctx.db.delete(node._id);
    }

    // Deterministic "Detection" Logic based on input
    // In reality, this would query the carrier or perform SIP OPTIONS / fingerprinting
    let platform = "Generic IVR";
    const cleanInput = args.inputValue.replace(/\D/g, "");
    const discriminator = cleanInput.length > 0 ? parseInt(cleanInput.slice(-2)) : 0;

    if (discriminator % 3 === 0) {
      platform = "Amazon Connect";
    } else if (discriminator % 3 === 1) {
      platform = "Genesys Cloud CX";
    } else {
      platform = "Twilio Flex";
    }

    // Update project with detected platform
    await ctx.db.patch(args.projectId, { platform });

    // Generate Platform-Specific IVR Trees
    if (platform === "Amazon Connect") {
      // Amazon Connect Style Flow
      const rootId = await ctx.db.insert("ivr_nodes", {
        projectId: args.projectId,
        type: "menu",
        label: "AWS Main Flow",
        content: "Thank you for calling. Powered by Amazon Connect. For AWS Services, press 1. For Billing, press 2. To speak with a representative, press 0.",
        metadata: { dtmf: "root", platform: "aws" },
      });

      await ctx.db.insert("ivr_nodes", {
        projectId: args.projectId,
        parentId: rootId,
        type: "menu",
        label: "AWS Services",
        content: "Please select the service. Press 1 for EC2. Press 2 for S3. Press 3 for Lambda.",
        metadata: { dtmf: "1" },
      });

      await ctx.db.insert("ivr_nodes", {
        projectId: args.projectId,
        parentId: rootId,
        type: "menu",
        label: "Billing Support",
        content: "For recent charges, press 1. To update payment method, press 2.",
        metadata: { dtmf: "2" },
      });
    } else if (platform === "Genesys Cloud CX") {
      // Genesys Style Flow
      const rootId = await ctx.db.insert("ivr_nodes", {
        projectId: args.projectId,
        type: "menu",
        label: "Genesys Main Menu",
        content: "Welcome to the Genesys Cloud Experience. Please say 'Sales' or press 1. Say 'Support' or press 2.",
        metadata: { dtmf: "root", platform: "genesys" },
      });

      await ctx.db.insert("ivr_nodes", {
        projectId: args.projectId,
        parentId: rootId,
        type: "menu",
        label: "Sales Queue",
        content: "Connecting you to the next available sales representative. Please hold.",
        metadata: { dtmf: "1", voice_match: "Sales" },
      });

      await ctx.db.insert("ivr_nodes", {
        projectId: args.projectId,
        parentId: rootId,
        type: "menu",
        label: "Support Flow",
        content: "For technical support, press 1. For account status, press 2.",
        metadata: { dtmf: "2", voice_match: "Support" },
      });
    } else {
      // Twilio / Generic Style Flow
      const rootId = await ctx.db.insert("ivr_nodes", {
        projectId: args.projectId,
        type: "menu",
        label: "Twilio Flex Flow",
        content: "You have reached the Twilio Flex demo. Press 1 for Programmable Voice. Press 2 for Flex Insights.",
        metadata: { dtmf: "root", platform: "twilio" },
      });

      await ctx.db.insert("ivr_nodes", {
        projectId: args.projectId,
        parentId: rootId,
        type: "menu",
        label: "Programmable Voice",
        content: "Enter your 4 digit pin to proceed to the voice sandbox.",
        metadata: { dtmf: "1" },
      });

      await ctx.db.insert("ivr_nodes", {
        projectId: args.projectId,
        parentId: rootId,
        type: "menu",
        label: "Flex Insights",
        content: "Welcome to Insights. Please record your feedback after the beep.",
        metadata: { dtmf: "2" },
      });
    }

    return { status: "success", message: `Discovery complete. Identified ${platform} system.` };
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