import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    projects: defineTable({
      name: v.string(),
      description: v.optional(v.string()),
      type: v.string(), // voice, chat, etc
      status: v.string(),
      createdBy: v.string(),
      platform: v.optional(v.string()), // Detected platform (e.g. Amazon Connect, Genesys)
    }).index("by_creator", ["createdBy"]),

    ivr_nodes: defineTable({
      projectId: v.id("projects"),
      parentId: v.optional(v.id("ivr_nodes")),
      type: v.string(), // menu, prompt, input
      label: v.string(),
      content: v.string(), // text or transcript
      metadata: v.optional(v.any()),
    })
      .index("by_project", ["projectId"])
      .index("by_project_and_target_node", ["projectId", "targetNodeId"]),

    test_cases: defineTable({
      projectId: v.id("projects"),
      targetNodeId: v.optional(v.id("ivr_nodes")),
      title: v.string(),
      description: v.optional(v.string()),
      steps: v.array(v.object({
        action: v.string(),
        value: v.string(),
        expected: v.optional(v.string())
      })),
      status: v.string(), // draft, approved, disabled
      tags: v.array(v.string()),
    }).index("by_project", ["projectId"]),

    test_runs: defineTable({
      projectId: v.id("projects"),
      campaignId: v.optional(v.string()),
      status: v.string(), // running, completed
      startTime: v.number(),
      endTime: v.optional(v.number()),
      summary: v.optional(v.string()),
    }).index("by_project", ["projectId"]),

    test_results: defineTable({
      runId: v.id("test_runs"),
      testCaseId: v.id("test_cases"),
      status: v.string(), // pass, fail
      logs: v.array(v.string()),
      duration: v.number(),
      recordingUrl: v.optional(v.string()),
      stepResults: v.optional(v.array(v.object({
        stepIndex: v.number(),
        action: v.string(),
        expected: v.optional(v.string()),
        actual: v.optional(v.string()),
        status: v.string(), // pass, fail
        timestamp: v.number()
      })))
    }).index("by_run", ["runId"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;