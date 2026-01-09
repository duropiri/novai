'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Image as ImageIcon,
  MoreVertical,
  Trash2,
  Loader2,
  ExternalLink,
  Clock,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { characterApi, CharacterDiagram } from '@/lib/api';
import Link from 'next/link';

export default function ImagesPage() {
  const [diagrams, setDiagrams] = useState<CharacterDiagram[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingDiagram, setDeletingDiagram] = useState<CharacterDiagram | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDiagram, setPreviewDiagram] = useState<CharacterDiagram | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await characterApi.list();
      setDiagrams(data);
    } catch (error) {
      console.error('Failed to load character diagrams:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Poll for status updates every 10 seconds
    const interval = setInterval(() => {
      loadData();
    }, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleDelete = async () => {
    if (!deletingDiagram) return;

    try {
      await characterApi.delete(deletingDiagram.id);
      setDeleteDialogOpen(false);
      setDeletingDiagram(null);
      await loadData();
    } catch (error) {
      console.error('Failed to delete diagram:', error);
      alert('Failed to delete character diagram');
    }
  };

  const getStatusBadge = (status: CharacterDiagram['status']) => {
    switch (status) {
      case 'ready':
        return (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <CheckCircle2 className="h-3 w-3" />
            Ready
          </span>
        );
      case 'processing':
        return (
          <span className="flex items-center gap-1 text-xs text-blue-600">
            <Loader2 className="h-3 w-3 animate-spin" />
            Processing
          </span>
        );
      case 'pending':
        return (
          <span className="flex items-center gap-1 text-xs text-yellow-600">
            <Clock className="h-3 w-3" />
            Pending
          </span>
        );
      case 'failed':
        return (
          <span className="flex items-center gap-1 text-xs text-red-600">
            <AlertCircle className="h-3 w-3" />
            Failed
          </span>
        );
      default:
        return null;
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="flex-1 space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Images</h1>
          <p className="text-muted-foreground">
            Your character diagrams library. Create new diagrams from the Character Diagrams tool.
          </p>
        </div>
        <Button asChild>
          <Link href="/characters">
            <ExternalLink className="mr-2 h-4 w-4" />
            Go to Character Diagrams
          </Link>
        </Button>
      </div>

      {/* Diagrams grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : diagrams.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <ImageIcon className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No character diagrams yet</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            Create character diagrams from the Character Diagrams tool
          </p>
          <Button asChild>
            <Link href="/characters">Go to Character Diagrams</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {diagrams.map((diagram) => (
            <div
              key={diagram.id}
              className="group relative rounded-lg border bg-card overflow-hidden hover:shadow-md transition-shadow"
            >
              {/* Image preview */}
              <div
                className="aspect-square bg-muted flex items-center justify-center cursor-pointer"
                onClick={() => {
                  if (diagram.file_url) {
                    setPreviewDiagram(diagram);
                    setPreviewOpen(true);
                  }
                }}
              >
                {diagram.file_url ? (
                  <img
                    src={diagram.file_url}
                    alt={diagram.name}
                    className="w-full h-full object-cover"
                  />
                ) : diagram.source_image_url ? (
                  <img
                    src={diagram.source_image_url}
                    alt={diagram.name}
                    className="w-full h-full object-cover opacity-50"
                  />
                ) : (
                  <ImageIcon className="h-12 w-12 text-muted-foreground" />
                )}

                {/* Processing overlay */}
                {diagram.status === 'processing' && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-white" />
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium truncate">{diagram.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      {getStatusBadge(diagram.status)}
                      <span className="text-xs text-muted-foreground">
                        {formatDate(diagram.created_at)}
                      </span>
                    </div>
                  </div>
                </div>

                {diagram.error_message && (
                  <p className="text-xs text-destructive mt-2 line-clamp-2">
                    {diagram.error_message}
                  </p>
                )}
              </div>

              {/* Actions */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-black/70 text-white"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => {
                      setDeletingDiagram(diagram);
                      setDeleteDialogOpen(true);
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      {/* Delete Confirmation */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Character Diagram</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deletingDiagram?.name}&quot;? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Image Preview */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{previewDiagram?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center justify-center bg-muted rounded-lg overflow-hidden">
            {previewDiagram?.file_url && (
              <img
                src={previewDiagram.file_url}
                alt={previewDiagram.name}
                className="max-h-[70vh] object-contain"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
