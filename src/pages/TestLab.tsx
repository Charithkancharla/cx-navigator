import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, Eye, FilePlus, Play, Sparkles } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export default function TestLab() {
  const { projectId } = useParams();
  const testCases = useQuery(api.testCases.list, { projectId: projectId as Id<"projects"> });
  const generate = useMutation(api.testCases.generateFromNodes);
  const createTestCase = useMutation(api.testCases.create);
  const runTest = useMutation(api.execution.runTest);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedTest, setSelectedTest] = useState<Doc<"test_cases"> | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

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

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    try {
      await createTestCase({
        projectId: projectId as Id<"projects">,
        title: formData.get("title") as string,
        description: formData.get("description") as string,
      });
      setIsCreateOpen(false);
      toast.success("Test case created successfully");
    } catch (error) {
      toast.error("Failed to create test case");
    }
  };

  const handleRun = async (testCaseId: Id<"test_cases">, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent opening details when clicking run
    try {
      await runTest({ testCaseId });
      toast.success("Test execution started");
    } catch (error) {
      toast.error("Failed to start test");
    }
  };

  const openDetails = (test: any) => {
    setSelectedTest(test);
    setIsDetailOpen(true);
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
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <Button onClick={() => setIsCreateOpen(true)}>
              <FilePlus className="mr-2 h-4 w-4" />
              New Test Case
            </Button>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Test Case</DialogTitle>
                <DialogDescription>Define a new manual test case.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="title">Title</Label>
                  <Input id="title" name="title" required placeholder="e.g. Verify Login Flow" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" name="description" placeholder="Describe the test scenario..." />
                </div>
                <div className="flex justify-end gap-2 mt-6">
                  <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                  <Button type="submit">Create Test Case</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
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
                <TableRow 
                  key={test._id} 
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => openDetails(test)}
                >
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
                    <Button size="sm" variant="ghost" onClick={(e) => handleRun(test._id, e)}>
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

      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedTest?.title}</DialogTitle>
            <DialogDescription>{selectedTest?.description}</DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <h4 className="text-sm font-medium mb-2">Test Steps</h4>
            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[50px]">#</TableHead>
                    <TableHead className="w-[100px]">Action</TableHead>
                    <TableHead>Value / Prompt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedTest?.steps.map((step: any, index: number) => (
                    <TableRow key={index}>
                      <TableCell className="font-mono text-xs text-muted-foreground align-top">{index + 1}</TableCell>
                      <TableCell className="font-medium capitalize align-top">{step.action}</TableCell>
                      <TableCell className="font-mono text-sm whitespace-pre-wrap break-words">{step.value}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setIsDetailOpen(false)}>Close</Button>
            <Button onClick={() => {
              if (selectedTest) {
                handleRun(selectedTest._id, { stopPropagation: () => {} } as any);
                setIsDetailOpen(false);
              }
            }}>
              <Play className="mr-2 h-4 w-4" /> Run Test
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}