import { ProjectSidebar } from "@/components/ProjectSidebar";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { Outlet, useParams } from "react-router";

export default function ProjectView() {
  const { projectId } = useParams();
  const project = useQuery(api.projects.get, { 
    id: projectId as Id<"projects"> 
  });

  if (project === undefined) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (project === null) {
    return <div>Project not found</div>;
  }

  return (
    <div className="flex h-screen pt-16"> {/* pt-16 to account for fixed toolbar if needed, or adjust based on layout */}
      <ProjectSidebar />
      <main className="flex-1 overflow-y-auto bg-background p-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">{project.name}</h1>
          <p className="text-muted-foreground">{project.description}</p>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
