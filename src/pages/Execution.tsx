import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { CheckCircle2, Clock, XCircle, ChevronRight, ChevronDown, AlertCircle, Volume2 } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export default function Execution() {
  const { projectId } = useParams();
  const runs = useQuery(api.execution.getRuns, 
    projectId && projectId !== ":projectId" 
      ? { projectId: projectId as Id<"projects"> } 
      : "skip"
  );
  const [selectedRunId, setSelectedRunId] = useState<Id<"test_runs"> | null>(null);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-[calc(100vh-12rem)]">
      <Card className="lg:col-span-1 flex flex-col h-full">
        <CardHeader>
          <CardTitle>Execution History</CardTitle>
          <CardDescription>Recent test runs</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 p-0">
          <ScrollArea className="h-full">
            <div className="flex flex-col divide-y">
              {runs?.map((run) => (
                <button
                  key={run._id}
                  onClick={() => setSelectedRunId(run._id)}
                  className={`flex items-start gap-3 p-4 text-left hover:bg-muted/50 transition-colors ${selectedRunId === run._id ? 'bg-muted' : ''}`}
                >
                  <div className="mt-1">
                    {run.status === 'completed' ? (
                      run.summary?.includes("failed") ? (
                         <XCircle className="h-4 w-4 text-red-500" />
                      ) : (
                         <CheckCircle2 className="h-4 w-4 text-green-500" />
                      )
                    ) : (
                      <Clock className="h-4 w-4 text-blue-500 animate-pulse" />
                    )}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="font-medium text-sm">Run #{run._id.slice(-4)}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(run.startTime).toLocaleString()}
                    </div>
                    <div className="text-xs text-muted-foreground line-clamp-1">{run.summary}</div>
                  </div>
                </button>
              ))}
              {runs?.length === 0 && (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No executions recorded yet.
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2 flex flex-col h-full">
        <CardHeader>
          <CardTitle>Run Details</CardTitle>
          <CardDescription>Select a run to view detailed logs and results</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-hidden">
          {selectedRunId ? (
            <RunDetails runId={selectedRunId} />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              Select a run from the history to view details
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RunDetails({ runId }: { runId: Id<"test_runs"> }) {
  const results = useQuery(api.execution.getResults, { runId });

  if (!results) return <div className="p-4">Loading results...</div>;

  return (
    <ScrollArea className="h-full pr-4">
      <div className="space-y-4">
        {results.map((result) => (
          <div key={result._id} className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {result.status === 'pass' ? (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                ) : (
                  <XCircle className="h-5 w-5 text-red-500" />
                )}
                <span className="font-medium">Test Case {result.testCaseId.slice(-4)}</span>
              </div>
              <Badge variant={result.status === 'pass' ? 'outline' : 'destructive'}>
                {result.status.toUpperCase()}
              </Badge>
            </div>

            {/* Recording Player */}
            {result.recordingUrl && (
              <div className="bg-muted/30 p-3 rounded-md border border-muted/50">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <Volume2 className="h-3.5 w-3.5" />
                    Call Recording
                  </div>
                  <a 
                    href={result.recordingUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-[10px] text-primary hover:underline"
                  >
                    Open File
                  </a>
                </div>
                <audio controls className="w-full h-8" src={result.recordingUrl}>
                  Your browser does not support the audio element.
                </audio>
              </div>
            )}
            
            {/* Step Results Visualization */}
            {result.stepResults && result.stepResults.length > 0 && (
              <div className="space-y-2 mt-4">
                <h4 className="text-sm font-medium text-muted-foreground">Step Execution</h4>
                <div className="border rounded-md divide-y">
                  {result.stepResults.map((step, idx) => (
                    <div key={idx} className="p-3 text-sm">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">#{idx + 1}</span>
                          <span className="font-medium capitalize">{step.action}</span>
                        </div>
                        <Badge variant={step.status === 'pass' ? 'secondary' : 'destructive'} className="text-[10px] h-5">
                          {step.status}
                        </Badge>
                      </div>
                      
                      {step.action === 'listen' && (
                        <div className="mt-2 grid grid-cols-2 gap-4 bg-muted/30 p-2 rounded">
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">Expected Prompt</div>
                            <div className="text-xs font-mono text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-950/30 p-1 rounded">
                              {step.expected || "-"}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground mb-1">Actual Heard</div>
                            <div className={`text-xs font-mono p-1 rounded ${step.status === 'pass' ? 'text-muted-foreground' : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30'}`}>
                              {step.actual || "-"}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="bg-muted/50 rounded p-3 font-mono text-xs space-y-1 mt-4">
              <div className="font-semibold text-muted-foreground mb-2">System Logs</div>
              {result.logs.map((log, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-muted-foreground">[{i + 1}]</span>
                  <span>{log}</span>
                </div>
              ))}
            </div>
            
            <div className="text-xs text-muted-foreground flex justify-end">
              Duration: {Math.round(result.duration)}ms
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}