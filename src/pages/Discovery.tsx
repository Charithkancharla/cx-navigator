import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery, useAction } from "convex/react";
import { Network, RefreshCw, Search, Server, ShieldCheck, Terminal, Activity } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

export default function Discovery() {
  const { projectId } = useParams();
  const project = useQuery(api.projects.get, { id: projectId as Id<"projects"> });
  const nodes = useQuery(api.discovery.getNodes, { projectId: projectId as Id<"projects"> });
  
  const createJob = useMutation(api.discovery.createJob);
  const runDiscovery = useAction(api.discovery.runDiscovery);
  
  const [currentJobId, setCurrentJobId] = useState<Id<"discovery_jobs"> | null>(null);
  const job = useQuery(api.discovery.getJob, currentJobId ? { jobId: currentJobId } : "skip");
  const logs = useQuery(api.discovery.getLogs, currentJobId ? { jobId: currentJobId } : "skip");

  const [isDiscovering, setIsDiscovering] = useState(false);
  const [inputType, setInputType] = useState("phone");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

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
      // We don't await this fully because we want to show logs as they happen
      // But useAction returns a promise that resolves when the action is done.
      // We can await it to know when to stop the "loading" state on the button, 
      // but the logs will update via the useQuery subscription.
      await runDiscovery({
        jobId,
        projectId: projectId as Id<"projects">,
        entryPoint: inputVal,
        inputType: inputType,
      });
      
      toast.success("Discovery completed successfully");
    } catch (error) {
      toast.error("Discovery failed");
      console.error(error);
    } finally {
      setIsDiscovering(false);
    }
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
                <Button type="submit" disabled={isDiscovering} className="mt-8">
                  {isDiscovering ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                  {isDiscovering ? "Crawling..." : "Start Discovery"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {project?.platform && (
            <div className="bg-muted/50 border rounded-lg p-4 flex items-center gap-4 animate-in fade-in slide-in-from-top-2">
              <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center text-green-600 dark:text-green-400">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h4 className="font-semibold text-sm">Platform Identified</h4>
                <p className="text-sm text-muted-foreground">
                  Successfully mapped <span className="font-medium text-foreground">{project.platform}</span> infrastructure.
                </p>
              </div>
              <div className="ml-auto text-xs text-muted-foreground font-mono bg-background px-2 py-1 rounded border">
                CONFIDENCE: 98.5%
              </div>
            </div>
          )}

          <div className="grid gap-4">
            <h3 className="text-lg font-semibold">Discovered Nodes ({nodes?.length || 0})</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {nodes?.map((node) => (
                <Card key={node._id} className="relative overflow-hidden border-l-4 animate-in fade-in zoom-in-95 duration-300" style={{ 
                  borderLeftColor: project?.platform?.includes('Amazon') ? '#FF9900' : 
                                  project?.platform?.includes('Genesys') ? '#FF4F1F' : 
                                  project?.platform?.includes('Twilio') ? '#F22F46' : '#3b82f6'
                }}>
                  <CardHeader className="pb-2">
                    <div className="flex justify-between items-start">
                      <CardTitle className="text-base">{node.label}</CardTitle>
                      <span className="text-[10px] uppercase tracking-wider bg-secondary px-2 py-0.5 rounded-full text-secondary-foreground">
                        {node.type}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-3 mb-3 italic">"{node.content}"</p>
                    <div className="flex gap-2 flex-wrap">
                      {node.metadata?.dtmf && (
                        <div className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded border">
                          DTMF: {node.metadata.dtmf}
                        </div>
                      )}
                      {node.metadata?.confidence && (
                        <div className="text-xs font-mono bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded border border-green-200 dark:border-green-900">
                          Conf: {Math.round(node.metadata.confidence * 100)}%
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
              {nodes?.length === 0 && (
                <div className="col-span-full text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
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
              </div>
            </CardContent>
            <div className="p-2 border-t border-zinc-800 bg-zinc-900/50 text-[10px] text-zinc-500 flex justify-between">
              <span>STATUS: {isDiscovering ? "ACTIVE" : "IDLE"}</span>
              <span>AGENT: vly-crawler-01</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}