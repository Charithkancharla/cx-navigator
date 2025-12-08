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
      summary: `Execution of ${testCase.title}`,
    });

    // Simulate execution logic
    const stepResults = [];
    let overallStatus = "pass";
    const logs = ["Initializing test agent...", `Dialing ${testCase.steps.find(s => s.action === 'call')?.value || 'target'}...`];
    
    // Artificial delay for realism
    const startTime = Date.now();

    for (const [index, step] of testCase.steps.entries()) {
      const stepResult: any = {
        stepIndex: index,
        action: step.action,
        timestamp: Date.now() + (index * 1000),
        status: "pass"
      };

      if (step.action === "listen") {
        stepResult.expected = step.value;
        
        // 80% chance to match exactly, 20% chance to have a mismatch or noise
        const isSuccess = Math.random() > 0.2;
        
        if (isSuccess) {
          stepResult.actual = step.value;
          logs.push(`Step ${index + 1}: Verified prompt matches expected.`);
        } else {
          // Simulate a slight mismatch
          stepResult.actual = step.value + " [unexpected noise]";
          stepResult.status = "fail";
          overallStatus = "fail";
          logs.push(`Step ${index + 1}: Mismatch! Expected "${step.value}" but heard "${stepResult.actual}"`);
        }
      } else if (step.action === "dtmf") {
        stepResult.expected = step.value;
        stepResult.actual = step.value; // DTMF usually succeeds in simulation
        logs.push(`Step ${index + 1}: Sent DTMF ${step.value}`);
      } else {
        logs.push(`Step ${index + 1}: Performed ${step.action}`);
      }

      stepResults.push(stepResult);
    }

    logs.push(`Test finished with status: ${overallStatus.toUpperCase()}`);

    await ctx.db.insert("test_results", {
      runId,
      testCaseId: args.testCaseId,
      status: overallStatus,
      logs: logs,
      duration: Date.now() - startTime + 1500, // Add some base latency
      stepResults: stepResults,
      recordingUrl: "https://www2.cs.uic.edu/~i101/SoundFiles/BabyElephantWalk60.wav", // Simulated recording
    });

    await ctx.db.patch(runId, {
      status: "completed",
      endTime: Date.now(),
      summary: overallStatus === "pass" ? "All steps passed" : "Steps failed during execution"
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