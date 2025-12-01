import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Network, RefreshCw, Search, Server, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";

export default function Discovery() {
  const { projectId } = useParams();
  const project = useQuery(api.projects.get, { id: projectId as Id<"projects"> });
  const nodes = useQuery(api.discovery.getNodes, { projectId: projectId as Id<"projects"> });
  const discover = useMutation(api.discovery.discover);
  const [isDiscovering, setIsDiscovering] = useState(false);

  const handleDiscover = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsDiscovering(true);
    const formData = new FormData(e.currentTarget);
    
    try {
      const result = await discover({
        projectId: projectId as Id<"projects">,
        inputType: formData.get("inputType") as "phone" | "sip" | "file" | "text",
        inputValue: formData.get("inputValue") as string,
      });
      toast.success(result.message);
    } catch (error) {
      toast.error("Discovery failed");
    } finally {
      setIsDiscovering(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>IVR Discovery</CardTitle>
          <CardDescription>Configure and run automated discovery to map your CX system.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleDiscover} className="flex gap-4 items-end">
            <div className="space-y-2 w-[200px]">
              <Label>Input Type</Label>
              <Select name="inputType" defaultValue="phone">
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
              <Input name="inputValue" placeholder="+1 (555) 000-0000" required />
            </div>
            <Button type="submit" disabled={isDiscovering}>
              {isDiscovering ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
              Start Discovery
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {nodes?.map((node) => (
            <Card key={node._id} className="relative overflow-hidden">
              <div className={`absolute top-0 left-0 w-1 h-full ${
                project?.platform === 'Amazon Connect' ? 'bg-[#FF9900]' : 
                project?.platform === 'Genesys Cloud CX' ? 'bg-[#FF4F1F]' : 
                'bg-primary'
              }`} />
              <CardHeader className="pb-2">
                <div className="flex justify-between">
                  <CardTitle className="text-base">{node.label}</CardTitle>
                  <span className="text-xs bg-secondary px-2 py-1 rounded-full text-secondary-foreground capitalize">
                    {node.type}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-3">{node.content}</p>
                <div className="flex gap-2 mt-2">
                  {node.metadata?.dtmf && (
                    <div className="text-xs font-mono bg-muted p-1 rounded inline-block">
                      DTMF: {node.metadata.dtmf}
                    </div>
                  )}
                  {node.metadata?.voice_match && (
                    <div className="text-xs font-mono bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400 p-1 rounded inline-block">
                      Voice: "{node.metadata.voice_match}"
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
  );
}