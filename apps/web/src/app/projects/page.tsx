'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FolderOpen, Plus, Construction } from 'lucide-react';

export default function ProjectsPage() {
  const [projects] = useState<Array<{ id: string; name: string; createdAt: string }>>([]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">My Projects</h1>
          <p className="text-muted-foreground">
            Organize your work into projects
          </p>
        </div>
        <Button disabled>
          <Plus className="h-4 w-4 mr-2" />
          New Project
        </Button>
      </div>

      {/* Coming Soon Notice */}
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="rounded-full bg-muted p-4 mb-4">
            <Construction className="h-8 w-8 text-muted-foreground" />
          </div>
          <CardTitle className="mb-2">Coming Soon</CardTitle>
          <CardDescription className="text-center max-w-md">
            Projects will help you organize your LoRA models, character diagrams,
            and generated content into logical groups. This feature is under development.
          </CardDescription>
        </CardContent>
      </Card>

      {/* Empty State (for when projects are implemented) */}
      {projects.length === 0 && (
        <div className="hidden">
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FolderOpen className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground text-center">
                No projects yet. Create your first project to get started.
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
