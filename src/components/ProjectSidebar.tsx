import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Activity, FileText, LayoutDashboard, Network, Play, Settings } from "lucide-react";
import { Link, useLocation, useParams } from "react-router";

export function ProjectSidebar() {
  const { projectId } = useParams();
  const location = useLocation();

  const items = [
    {
      title: "Overview",
      href: `/project/${projectId}`,
      icon: LayoutDashboard,
    },
    {
      title: "Discovery",
      href: `/project/${projectId}/discovery`,
      icon: Network,
    },
    {
      title: "Test Lab",
      href: `/project/${projectId}/test-lab`,
      icon: FileText,
    },
    {
      title: "Execution",
      href: `/project/${projectId}/execution`,
      icon: Play,
    },
    {
      title: "Settings",
      href: `/project/${projectId}/settings`,
      icon: Settings,
    },
  ];

  return (
    <div className="w-64 border-r bg-sidebar h-[calc(100vh-4rem)] flex flex-col">
      <div className="p-4">
        <h2 className="text-lg font-semibold tracking-tight px-2 mb-4">Project Menu</h2>
        <nav className="space-y-1">
          {items.map((item) => (
            <Link key={item.href} to={item.href}>
              <Button
                variant={location.pathname === item.href ? "secondary" : "ghost"}
                className={cn(
                  "w-full justify-start gap-2",
                  location.pathname === item.href && "bg-sidebar-accent text-sidebar-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.title}
              </Button>
            </Link>
          ))}
        </nav>
      </div>
      <div className="mt-auto p-4 border-t">
        <div className="flex items-center gap-2 px-2 text-sm text-muted-foreground">
          <Activity className="h-4 w-4 text-green-500" />
          <span>System Online</span>
        </div>
      </div>
    </div>
  );
}
