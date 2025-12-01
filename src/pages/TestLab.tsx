import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, FilePlus, Play, Sparkles } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";

export default function TestLab() {
  const { projectId } = useParams();
  const testCases = useQuery(api.testCases.list, { projectId: projectId as Id<"projects"> });
  const generate = useMutation(api.testCases.generateFromNodes);
  const runTest = useMutation(api.execution.runTest);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const result = await generate({ projectId: projectId as Id<"projects"> });
      toast.success(`Generated ${result.count} new test cases`);
    } catch (error) {
      toast.error("Failed to generate test cases");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRun = async (testCaseId: Id<"test_cases">) => {
    try {
      await runTest({ testCaseId });
      toast.success("Test execution started");
    } catch (error) {
      toast.error("Failed to start test");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Test Lab</h2>
          <p className="text-muted-foreground">Manage and execute functional test cases.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleGenerate} disabled={isGenerating}>
            {isGenerating ? <Sparkles className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Auto-Generate
          </Button>
          <Button>
            <FilePlus className="mr-2 h-4 w-4" />
            New Test Case
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Test Cases</CardTitle>
          <CardDescription>List of all defined test cases for this project.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Steps</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {testCases?.map((test) => (
                <TableRow key={test._id}>
                  <TableCell className="font-medium">
                    {test.title}
                    <div className="text-xs text-muted-foreground">{test.description}</div>
                  </TableCell>
                  <TableCell>{test.steps.length} steps</TableCell>
                  <TableCell>
                    <Badge variant={test.status === 'approved' ? 'default' : 'secondary'}>
                      {test.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {test.tags.map(tag => (
                        <span key={tag} className="text-xs bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => handleRun(test._id)}>
                      <Play className="h-4 w-4 text-green-600" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {testCases?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No test cases found. Try auto-generating from discovery data.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
