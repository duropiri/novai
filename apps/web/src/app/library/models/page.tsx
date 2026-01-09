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
  Sparkles,
  MoreVertical,
  Trash2,
  Loader2,
  ExternalLink,
  Clock,
  AlertCircle,
  CheckCircle2,
  Dumbbell,
  Copy,
} from 'lucide-react';
import { loraApi, LoraModel } from '@/lib/api';
import Link from 'next/link';

export default function ModelsPage() {
  const [models, setModels] = useState<LoraModel[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog states
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingModel, setDeletingModel] = useState<LoraModel | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsModel, setDetailsModel] = useState<LoraModel | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loraApi.list();
      setModels(data);
    } catch (error) {
      console.error('Failed to load LoRA models:', error);
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
    if (!deletingModel) return;

    try {
      await loraApi.delete(deletingModel.id);
      setDeleteDialogOpen(false);
      setDeletingModel(null);
      await loadData();
    } catch (error) {
      console.error('Failed to delete model:', error);
      alert('Failed to delete LoRA model');
    }
  };

  const copyTriggerWord = (triggerWord: string) => {
    navigator.clipboard.writeText(triggerWord);
  };

  const getStatusBadge = (status: LoraModel['status']) => {
    switch (status) {
      case 'ready':
        return (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <CheckCircle2 className="h-3 w-3" />
            Ready
          </span>
        );
      case 'training':
        return (
          <span className="flex items-center gap-1 text-xs text-blue-600">
            <Dumbbell className="h-3 w-3 animate-pulse" />
            Training
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
          <h1 className="text-3xl font-bold tracking-tight">Models</h1>
          <p className="text-muted-foreground">
            Your LoRA models library. Create and manage models from the LoRA Creator tool.
          </p>
        </div>
        <Button asChild>
          <Link href="/lora">
            <ExternalLink className="mr-2 h-4 w-4" />
            Go to LoRA Creator
          </Link>
        </Button>
      </div>

      {/* Models grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : models.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Sparkles className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No LoRA models yet</h3>
          <p className="text-muted-foreground mt-1 mb-4">
            Create LoRA models from the LoRA Creator tool
          </p>
          <Button asChild>
            <Link href="/lora">Go to LoRA Creator</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {models.map((model) => (
            <div
              key={model.id}
              className="group relative rounded-lg border bg-card overflow-hidden hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => {
                setDetailsModel(model);
                setDetailsOpen(true);
              }}
            >
              {/* Thumbnail */}
              <div className="aspect-square bg-muted flex items-center justify-center">
                {model.thumbnail_url ? (
                  <img
                    src={model.thumbnail_url}
                    alt={model.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Sparkles className="h-12 w-12 text-muted-foreground" />
                )}

                {/* Training overlay */}
                {model.status === 'training' && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                    <div className="text-center text-white">
                      <Dumbbell className="h-8 w-8 mx-auto mb-2 animate-pulse" />
                      <p className="text-sm">Training...</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Info */}
              <div className="p-3">
                <h3 className="font-medium truncate">{model.name}</h3>
                <div className="flex items-center justify-between mt-1">
                  {getStatusBadge(model.status)}
                  <span className="text-xs text-muted-foreground">
                    {formatDate(model.created_at)}
                  </span>
                </div>

                {model.trigger_word && (
                  <div
                    className="flex items-center gap-1 mt-2 text-xs bg-muted px-2 py-1 rounded cursor-pointer hover:bg-muted/80"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyTriggerWord(model.trigger_word);
                    }}
                    title="Click to copy trigger word"
                  >
                    <Copy className="h-3 w-3" />
                    <code className="truncate">{model.trigger_word}</code>
                  </div>
                )}

                {model.error_message && (
                  <p className="text-xs text-destructive mt-2 line-clamp-2">
                    {model.error_message}
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
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeletingModel(model);
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
            <DialogTitle>Delete LoRA Model</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deletingModel?.name}&quot;? This action cannot
              be undone.
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

      {/* Model Details */}
      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{detailsModel?.name}</DialogTitle>
          </DialogHeader>
          {detailsModel && (
            <div className="space-y-4">
              {/* Thumbnail */}
              {detailsModel.thumbnail_url && (
                <div className="aspect-video bg-muted rounded-lg overflow-hidden">
                  <img
                    src={detailsModel.thumbnail_url}
                    alt={detailsModel.name}
                    className="w-full h-full object-contain"
                  />
                </div>
              )}

              {/* Details */}
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <div className="mt-1">{getStatusBadge(detailsModel.status)}</div>
                </div>
                <div>
                  <p className="text-muted-foreground">Training Steps</p>
                  <p className="mt-1 font-medium">{detailsModel.training_steps}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Trigger Word</p>
                  <div
                    className="flex items-center gap-1 mt-1 cursor-pointer"
                    onClick={() => copyTriggerWord(detailsModel.trigger_word)}
                  >
                    <code className="bg-muted px-2 py-1 rounded text-sm">
                      {detailsModel.trigger_word}
                    </code>
                    <Copy className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>
                <div>
                  <p className="text-muted-foreground">Created</p>
                  <p className="mt-1 font-medium">{formatDate(detailsModel.created_at)}</p>
                </div>
                {detailsModel.cost_cents && (
                  <div>
                    <p className="text-muted-foreground">Training Cost</p>
                    <p className="mt-1 font-medium">${(detailsModel.cost_cents / 100).toFixed(2)}</p>
                  </div>
                )}
                {detailsModel.completed_at && (
                  <div>
                    <p className="text-muted-foreground">Completed</p>
                    <p className="mt-1 font-medium">{formatDate(detailsModel.completed_at)}</p>
                  </div>
                )}
              </div>

              {detailsModel.error_message && (
                <div className="p-3 bg-destructive/10 rounded-lg">
                  <p className="text-sm text-destructive">{detailsModel.error_message}</p>
                </div>
              )}

              {detailsModel.weights_url && (
                <div>
                  <p className="text-sm text-muted-foreground mb-2">Weights URL</p>
                  <code className="text-xs bg-muted px-2 py-1 rounded block truncate">
                    {detailsModel.weights_url}
                  </code>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
