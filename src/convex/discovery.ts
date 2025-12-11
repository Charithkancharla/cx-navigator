import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

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

// --- Queries --- //

export const getConfigStatus = query({
  args: {},
  handler: async () => {
    const url = process.env.TELEPHONY_BACKEND_URL;
    const isInvalid = url && (url.includes("convex.site") || url.includes("vly.site"));
    return {
      isConfigured: !!url && url.length > 0 && !isInvalid,
      isInvalid: !!isInvalid,
      url: url ? `${url.substring(0, 8)}...` : undefined // Return partial URL for debug if needed, but keep secure
    };
  },
});

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