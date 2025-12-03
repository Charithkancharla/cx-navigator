import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Plus, Activity, Phone, MessageSquare, Play, ChevronLeft } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNavigate, Link } from "react-router";
import { toast } from "sonner";

export default function Dashboard() {
  const projects = useQuery(api.projects.list, { paginationOpts: { numItems: 20, cursor: null } });
  const createProject = useMutation(api.projects.create);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const navigate = useNavigate();

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    try {
      await createProject({
        name: formData.get("name") as string,
        description: formData.get("description") as string,
        type: formData.get("type") as "voice" | "chat" | "omni",
      });
      setIsCreateOpen(false);
      toast.success("Project created successfully");
    } catch (error) {
      toast.error("Failed to create project");
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <Link to="/">
            <Button variant="ghost" size="sm" className="h-6 px-0 -ml-2 text-muted-foreground hover:text-foreground mb-2">
              <ChevronLeft className="h-4 w-4 mr-1" /> Back to Home
            </Button>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-2">Manage your CX assurance projects and test suites.</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Project</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleCreate} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="name">Project Name</Label>
                <Input id="name" name="name" required placeholder="e.g. Customer Support IVR" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">Type</Label>
                <Select name="type" defaultValue="voice">
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="voice">Voice / IVR</SelectItem>
                    <SelectItem value="chat">Chatbot</SelectItem>
                    <SelectItem value="omni">Omnichannel</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input id="description" name="description" placeholder="Brief description of the system" />
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                <Button type="submit">Create Project</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Projects</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{projects?.page.length || 0}</div>
            <p className="text-xs text-muted-foreground">Active assurance environments</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Test Runs (24h)</CardTitle>
            <Play className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">--</div>
            <p className="text-xs text-muted-foreground">Executions across all projects</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">System Health</CardTitle>
            <Activity className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">98.2%</div>
            <p className="text-xs text-muted-foreground">Average pass rate</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Recent Projects</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {projects?.page.map((project) => (
            <Card key={project._id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => navigate(`/project/${project._id}`)}>
              <CardHeader>
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg">{project.name}</CardTitle>
                  {project.type === 'voice' ? <Phone className="h-4 w-4 text-muted-foreground" /> : <MessageSquare className="h-4 w-4 text-muted-foreground" />}
                </div>
                <CardDescription>{project.description || "No description provided"}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span className={`inline-block w-2 h-2 rounded-full ${project.status === 'active' ? 'bg-green-500' : 'bg-gray-300'}`} />
                  {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
                </div>
              </CardContent>
            </Card>
          ))}
          {projects?.page.length === 0 && (
            <div className="col-span-full text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
              No projects found. Create one to get started.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}