import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Network, RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";

export default function Discovery() {
  const { projectId } = useParams();
  const nodes = useQuery(api.discovery.getNodes, { projectId: projectId as Id<"projects"> });
  const discover = useMutation(api.discovery.discover);
  const [isDiscovering, setIsDiscovering] = useState(false);

  const handleDiscover = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsDiscovering(true);
    const formData = new FormData(e.currentTarget);
    
    try {
      await discover({
        projectId: projectId as Id<"projects">,
        inputType: formData.get("inputType") as "phone" | "sip" | "file" | "text",
        inputValue: formData.get("inputValue") as string,
      });
      toast.success("Discovery completed successfully");
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

      <div className="grid gap-4">
        <h3 className="text-lg font-semibold">Discovered Nodes ({nodes?.length || 0})</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {nodes?.map((node) => (
            <Card key={node._id} className="relative overflow-hidden">
              <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
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
                {node.metadata?.dtmf && (
                  <div className="mt-2 text-xs font-mono bg-muted p-1 rounded inline-block">
                    DTMF: {node.metadata.dtmf}
                  </div>
                )}
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
