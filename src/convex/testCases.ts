import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const generateFromNodes = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const nodes = await ctx.db
      .query("ivr_nodes")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    if (nodes.length === 0) return { count: 0 };

    // Simple rule-based generation: Create a test case for each leaf node path
    // For this demo, we just create tests for each node found
    let count = 0;
    
    for (const node of nodes) {
      // Skip if test already exists for this node (simplified check)
      const existing = await ctx.db
        .query("test_cases")
        .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
        .filter((q) => q.eq(q.field("targetNodeId"), node._id))
        .first();
        
      if (!existing) {
        await ctx.db.insert("test_cases", {
          projectId: args.projectId,
          title: `Verify ${node.label}`,
          description: `Navigate to ${node.label} and verify prompt`,
          steps: [
            { action: "call", value: "+18005550199" },
            { action: "listen", value: node.content },
            { action: "dtmf", value: node.metadata?.dtmf || "0" }
          ],
          status: "draft",
          targetNodeId: node._id,
          tags: ["auto-generated", "smoke"],
        });
        count++;
      }
    }

    return { count };
  },
});

export const list = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("test_cases")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const updateStatus = mutation({
  args: { 
    id: v.id("test_cases"), 
    status: v.union(v.literal("draft"), v.literal("approved"), v.literal("disabled")) 
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { status: args.status });
  },
});
