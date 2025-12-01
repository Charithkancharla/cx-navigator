import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const runTest = mutation({
  args: { testCaseId: v.id("test_cases") },
  handler: async (ctx, args) => {
    const testCase = await ctx.db.get(args.testCaseId);
    if (!testCase) throw new Error("Test case not found");

    // Create a run record
    const runId = await ctx.db.insert("test_runs", {
      projectId: testCase.projectId,
      status: "running",
      startTime: Date.now(),
      summary: "Single test execution",
    });

    // Simulate execution (in a real app, this would be a scheduled job or external call)
    // We'll just immediately mark it as done for the demo, but normally this is async
    const passed = Math.random() > 0.2; // 80% pass rate simulation

    await ctx.db.insert("test_results", {
      runId,
      testCaseId: args.testCaseId,
      status: passed ? "pass" : "fail",
      logs: ["Dialing...", "Connected", "Listening for prompt...", passed ? "Match found" : "Mismatch detected"],
      duration: 1500 + Math.random() * 2000,
    });

    await ctx.db.patch(runId, {
      status: "completed",
      endTime: Date.now(),
    });

    return runId;
  },
});

export const getRuns = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("test_runs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(20);
  },
});

export const getResults = query({
  args: { runId: v.id("test_runs") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("test_results")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});
