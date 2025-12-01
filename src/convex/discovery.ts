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
    // Here we simulate discovering a simple IVR tree.
    
    // Clear existing nodes for this project (for this demo)
    const existing = await ctx.db
      .query("ivr_nodes")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    
    for (const node of existing) {
      await ctx.db.delete(node._id);
    }

    // Create Root Node
    const rootId = await ctx.db.insert("ivr_nodes", {
      projectId: args.projectId,
      type: "menu",
      label: "Main Menu",
      content: "Welcome to the service. Press 1 for Sales, 2 for Support.",
      metadata: { dtmf: "root" },
    });

    // Create Child Nodes
    await ctx.db.insert("ivr_nodes", {
      projectId: args.projectId,
      parentId: rootId,
      type: "menu",
      label: "Sales",
      content: "You have reached Sales. Press 1 for New Customer, 2 for Existing.",
      metadata: { dtmf: "1" },
    });

    await ctx.db.insert("ivr_nodes", {
      projectId: args.projectId,
      parentId: rootId,
      type: "menu",
      label: "Support",
      content: "Support line. Please hold while we connect you.",
      metadata: { dtmf: "2" },
    });

    return { status: "success", message: "Discovery complete. IVR map generated." };
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
