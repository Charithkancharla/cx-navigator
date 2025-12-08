import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery, useAction } from "convex/react";
import { Network, RefreshCw, Search, Server, ShieldCheck, Terminal, Activity, ChevronRight, ChevronDown, AlertTriangle, Play, Download, FileJson, FileText } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

export default function Discovery() {
  const { projectId } = useParams();
  const project = useQuery(api.projects.get, 
    projectId && projectId !== ":projectId" 
      ? { id: projectId as Id<"projects"> } 
      : "skip"
  );
  const nodes = useQuery(api.discovery.getNodes, 
    projectId && projectId !== ":projectId" 
      ? { projectId: projectId as Id<"projects"> } 
      : "skip"
  );
  
  const createJob = useMutation(api.discovery.createJob);
  const runDiscovery = useAction(api.discovery.runDiscovery);
  const resumeJob = useMutation(api.discovery.resumeJob);
  const continueDiscovery = useAction(api.discovery.continueDiscovery);
  
  const [currentJobId, setCurrentJobId] = useState<Id<"discovery_jobs"> | null>(null);
  const job = useQuery(api.discovery.getJob, currentJobId ? { jobId: currentJobId } : "skip");
  const logs = useQuery(api.discovery.getLogs, currentJobId ? { jobId: currentJobId } : "skip");

  const [isDiscovering, setIsDiscovering] = useState(false);
  const [inputType, setInputType] = useState("phone");
  const [manualInput, setManualInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  // Sync local discovering state with job status
  useEffect(() => {
    if (job) {
      if (job.status === "running" || job.status === "queued") {
        setIsDiscovering(true);
      } else if (job.status === "waiting_for_input") {
        setIsDiscovering(false); // Stop spinner, show input
      } else {
        setIsDiscovering(false);
      }
    }
  }, [job]);

  const handleDiscover = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsDiscovering(true);
    const formData = new FormData(e.currentTarget);
    const inputVal = formData.get("inputValue") as string;
    
    try {
      // 1. Create Job
      const jobId = await createJob({
        projectId: projectId as Id<"projects">,
        entryPoint: inputVal,
        inputType: inputType,
      });
      setCurrentJobId(jobId);

      // 2. Run Discovery Action (Async)
      runDiscovery({
        jobId,
        projectId: projectId as Id<"projects">,
        entryPoint: inputVal,
        inputType: inputType,
      });
      
      toast.success("Discovery started");
    } catch (error) {
      toast.error("Discovery failed to start");
      console.error(error);
      setIsDiscovering(false);
    }
  };

  const handleResume = async () => {
    if (!currentJobId || !manualInput) return;
    
    try {
      setIsDiscovering(true);
      await resumeJob({ jobId: currentJobId, input: manualInput });
      // Trigger the continue action
      continueDiscovery({ 
        jobId: currentJobId, 
        projectId: projectId as Id<"projects">, 
        input: manualInput 
      });
      setManualInput("");
      toast.success("Input sent to crawler");
    } catch (e) {
      toast.error("Failed to resume");
      setIsDiscovering(false);
    }
  };

  const downloadArtifact = (content: string, filename: string) => {
    const blob = new Blob([content], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>IVR Discovery</CardTitle>
              <CardDescription>Configure and run automated discovery to map your CX system.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleDiscover} className="flex gap-4 items-start">
                <div className="space-y-2 w-[140px]">
                  <Label>Input Type</Label>
                  <Select name="inputType" value={inputType} onValueChange={setInputType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="phone">Phone Number</SelectItem>
                      <SelectItem value="sip">SIP URI</SelectItem>
                      <SelectItem value="text">Text Transcript</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 flex-1">
                  <Label>Target Value</Label>
                  {inputType === "text" ? (
                    <Textarea 
                      name="inputValue" 
                      placeholder="Paste transcript here..." 
                      required 
                      className="min-h-[38px] max-h-[200px]" 
                    />
                  ) : (
                    <Input 
                      name="inputValue" 
                      placeholder={inputType === "sip" ? "sip:user@domain.com" : "+1 (555) 000-0000"} 
                      required 
                    />
                  )}
                </div>
                <Button type="submit" disabled={isDiscovering || (job?.status === 'waiting_for_input')} className="mt-8">
                  {isDiscovering ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                  {isDiscovering ? "Crawling..." : "Start Discovery"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Human Intervention Panel */}
          {job?.status === "waiting_for_input" && (
            <Card className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20 animate-in fade-in slide-in-from-top-2">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
                  <AlertTriangle className="h-5 w-5" />
                  <CardTitle className="text-base">Human Intervention Required</CardTitle>
                </div>
                <CardDescription>The crawler has paused and requires manual input to proceed.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex gap-4 items-end">
                  <div className="space-y-2 flex-1">
                    <Label>Enter {job.waitingFor || "Input"}</Label>
                    <Input 
                      value={manualInput} 
                      onChange={(e) => setManualInput(e.target.value)} 
                      placeholder={`Enter ${job.waitingFor || "value"}...`}
                      className="bg-background"
                    />
                  </div>
                  <Button onClick={handleResume} className="bg-yellow-600 hover:bg-yellow-700 text-white">
                    <Play className="mr-2 h-4 w-4" /> Resume Crawl
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Artifacts Panel */}
          {job?.status === "completed" && job.artifacts && (
            <Card className="border-green-500/20 bg-green-50/10 animate-in fade-in slide-in-from-top-2">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                  <ShieldCheck className="h-5 w-5" />
                  <CardTitle className="text-base">Discovery Complete</CardTitle>
                </div>
                <CardDescription>
                  Successfully mapped {project?.platform || "system"}. Artifacts generated.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Button variant="outline" className="h-auto py-4 flex flex-col gap-2" onClick={() => downloadArtifact(job.artifacts!.graph, "graph.json")}>
                    <Network className="h-6 w-6 text-blue-500" />
                    <span className="text-xs">Graph Model</span>
                  </Button>
                  <Button variant="outline" className="h-auto py-4 flex flex-col gap-2" onClick={() => downloadArtifact(job.artifacts!.report, "crawl_report.json")}>
                    <FileText className="h-6 w-6 text-orange-500" />
                    <span className="text-xs">Crawl Report</span>
                  </Button>
                  <Button variant="outline" className="h-auto py-4 flex flex-col gap-2" onClick={() => downloadArtifact(job.artifacts!.testCases, "test_cases.json")}>
                    <FileJson className="h-6 w-6 text-green-500" />
                    <span className="text-xs">Test Cases</span>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4">
            <h3 className="text-lg font-semibold">Discovered Flow Map ({nodes?.length || 0} Nodes)</h3>
            <div className="border rounded-lg p-4 bg-card min-h-[200px]">
               {nodes && nodes.length > 0 ? (
                 <FlowTree nodes={nodes} />
               ) : (
                 <div className="text-center py-12 text-muted-foreground">
                   <Network className="h-12 w-12 mx-auto mb-4 opacity-20" />
                   No nodes discovered yet. Run discovery to map the system.
                 </div>
               )}
            </div>
          </div>
        </div>

        {/* Live Logs Panel */}
        <div className="lg:col-span-1">
          <Card className="h-full flex flex-col bg-black text-green-400 font-mono text-xs border-zinc-800">
            <CardHeader className="pb-2 border-b border-zinc-800 bg-zinc-900/50">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4" />
                <CardTitle className="text-sm font-mono">Discovery Terminal</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="flex-1 p-0 relative min-h-[300px]">
              <div 
                ref={scrollRef}
                className="absolute inset-0 overflow-y-auto p-4 space-y-1"
              >
                {!logs || logs.length === 0 ? (
                  <div className="text-zinc-600 italic">Waiting for input...</div>
                ) : (
                  logs.map((log) => (
                    <div key={log._id} className="break-all">
                      <span className="opacity-50 mr-2">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                      <span className={log.type === 'error' ? 'text-red-500' : ''}>{log.message}</span>
                    </div>
                  ))
                )}
                {isDiscovering && (
                  <div className="animate-pulse mt-2">_</div>
                )}
                {job?.status === "waiting_for_input" && (
                   <div className="text-yellow-500 mt-2 animate-pulse">
                     {">"} WAITING FOR USER INPUT...
                   </div>
                )}
              </div>
            </CardContent>
            <div className="p-2 border-t border-zinc-800 bg-zinc-900/50 text-[10px] text-zinc-500 flex justify-between">
              <span>STATUS: {job?.status?.toUpperCase() || "IDLE"}</span>
              <span>AGENT: vly-crawler-01</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function FlowTree({ nodes, parentId = undefined, level = 0 }: { nodes: any[], parentId?: string, level?: number }) {
  // Find nodes that belong to this parent
  // If parentId is undefined, find root nodes (nodes with no parentId)
  const children = nodes.filter(n => n.parentId === parentId || (!parentId && !n.parentId));

  if (children.length === 0) return null;

  return (
    <div className={`flex flex-col gap-2 ${level > 0 ? "ml-6 border-l-2 border-muted pl-4" : ""}`}>
      {children.map((node) => (
        <div key={node._id} className="relative">
          {level > 0 && (
             <div className="absolute -left-[22px] top-3 w-4 h-0.5 bg-muted" />
          )}
          <div className="border rounded p-3 bg-background hover:bg-muted/50 transition-colors">
            <div className="flex justify-between items-start mb-1">
              <span className="font-medium text-sm">{node.label}</span>
              <span className="text-[10px] uppercase tracking-wider bg-secondary px-2 py-0.5 rounded-full text-secondary-foreground">
                {node.type}
              </span>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2 italic">"{node.content}"</p>
            <div className="flex gap-2 mt-2">
              {node.metadata?.dtmf && (
                 <div className="text-[10px] font-mono bg-muted inline-block px-1.5 py-0.5 rounded">
                   DTMF: {node.metadata.dtmf}
                 </div>
              )}
              {node.metadata?.confidence && (
                 <div className="text-[10px] font-mono bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 inline-block px-1.5 py-0.5 rounded">
                   CONF: {(node.metadata.confidence * 100).toFixed(0)}%
                 </div>
              )}
            </div>
          </div>
          <FlowTree nodes={nodes} parentId={node._id} level={level + 1} />
        </div>
      ))}
    </div>
  );
}