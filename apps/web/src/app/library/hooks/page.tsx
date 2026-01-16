'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  FileText,
  Plus,
  MoreVertical,
  Trash2,
  Pencil,
  Loader2,
  Upload,
  Tag,
} from 'lucide-react';
import { hooksApi, Hook } from '@/lib/api';

export default function HooksPage() {
  const [hooks, setHooks] = useState<Hook[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  // Dialog states
  const [createHookOpen, setCreateHookOpen] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [editHookOpen, setEditHookOpen] = useState(false);
  const [editingHook, setEditingHook] = useState<Hook | null>(null);
  const [deleteHookOpen, setDeleteHookOpen] = useState(false);
  const [deletingHook, setDeletingHook] = useState<Hook | null>(null);

  // Form states
  const [newHookText, setNewHookText] = useState('');
  const [newHookCategory, setNewHookCategory] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [bulkCategory, setBulkCategory] = useState('');
  const [importing, setImporting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [hooksData, categoriesData] = await Promise.all([
        selectedCategory === 'all'
          ? hooksApi.list()
          : hooksApi.list(selectedCategory),
        hooksApi.getCategories(),
      ]);
      setHooks(hooksData);
      setCategories(categoriesData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedCategory]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateHook = async () => {
    if (!newHookText.trim()) return;

    try {
      await hooksApi.create({
        text: newHookText.trim(),
        category: newHookCategory.trim() || undefined,
      });
      setNewHookText('');
      setNewHookCategory('');
      setCreateHookOpen(false);
      await loadData();
    } catch (error) {
      console.error('Failed to create hook:', error);
      alert('Failed to create hook');
    }
  };

  const handleBulkImport = async () => {
    if (!bulkText.trim()) return;

    // Parse bulk text (one hook per line)
    const lines = bulkText.split('\n').filter((line) => line.trim());
    if (lines.length === 0) {
      alert('No valid hooks found');
      return;
    }

    setImporting(true);
    try {
      const hooks = lines.map((text) => ({
        text: text.trim(),
        category: bulkCategory.trim() || undefined,
      }));

      const result = await hooksApi.createBulk(hooks);
      setBulkText('');
      setBulkCategory('');
      setBulkImportOpen(false);
      alert(`Successfully imported ${result.created} hooks`);
      await loadData();
    } catch (error) {
      console.error('Failed to import hooks:', error);
      alert('Failed to import hooks');
    } finally {
      setImporting(false);
    }
  };

  const handleUpdateHook = async () => {
    if (!editingHook || !newHookText.trim()) return;

    try {
      await hooksApi.update(editingHook.id, {
        text: newHookText.trim(),
        category: newHookCategory.trim() || undefined,
      });
      setEditHookOpen(false);
      setEditingHook(null);
      setNewHookText('');
      setNewHookCategory('');
      await loadData();
    } catch (error) {
      console.error('Failed to update hook:', error);
      alert('Failed to update hook');
    }
  };

  const handleDeleteHook = async () => {
    if (!deletingHook) return;

    try {
      await hooksApi.delete(deletingHook.id);
      setDeleteHookOpen(false);
      setDeletingHook(null);
      await loadData();
    } catch (error) {
      console.error('Failed to delete hook:', error);
      alert('Failed to delete hook');
    }
  };

  const openEditDialog = (hook: Hook) => {
    setEditingHook(hook);
    setNewHookText(hook.text);
    setNewHookCategory(hook.category || '');
    setEditHookOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Hooks</h1>
          <p className="text-muted-foreground">
            Manage text hooks for your video variants
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setBulkImportOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Bulk Import
          </Button>
          <Button onClick={() => setCreateHookOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Hook
          </Button>
        </div>
      </div>

      {/* Category filter */}
      <div className="flex items-center gap-4">
        <Select value={selectedCategory} onValueChange={setSelectedCategory}>
          <SelectTrigger className="w-[250px]">
            <SelectValue placeholder="Filter by category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Hooks</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {hooks.length} hook{hooks.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Hooks list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : hooks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileText className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No hooks yet</h3>
          <p className="text-muted-foreground mt-1">
            Add individual hooks or bulk import from a list
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {hooks.map((hook) => (
            <div
              key={hook.id}
              className="flex items-start gap-4 p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
            >
              {/* Hook content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm">{hook.text}</p>
                {hook.category && (
                  <div className="flex items-center gap-1 mt-2">
                    <Tag className="h-3 w-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{hook.category}</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="shrink-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openEditDialog(hook)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => {
                      setDeletingHook(hook);
                      setDeleteHookOpen(true);
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

      {/* Create Hook Dialog */}
      <Dialog open={createHookOpen} onOpenChange={setCreateHookOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Hook</DialogTitle>
            <DialogDescription>
              Add a new text hook to use in your video variants.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Hook Text</label>
              <Textarea
                placeholder="Enter hook text..."
                value={newHookText}
                onChange={(e) => setNewHookText(e.target.value)}
                rows={3}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Category (optional)</label>
              <Input
                placeholder="e.g., CTA, Intro, Testimonial"
                value={newHookCategory}
                onChange={(e) => setNewHookCategory(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateHookOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateHook}>Add Hook</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Import Dialog */}
      <Dialog open={bulkImportOpen} onOpenChange={setBulkImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bulk Import Hooks</DialogTitle>
            <DialogDescription>
              Paste multiple hooks, one per line. They will all be assigned the same category if
              specified.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Hooks (one per line)</label>
              <Textarea
                placeholder="Hook 1&#10;Hook 2&#10;Hook 3..."
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={10}
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {bulkText.split('\n').filter((l) => l.trim()).length} hooks detected
              </p>
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Category for all (optional)</label>
              <Input
                placeholder="e.g., CTA, Intro, Testimonial"
                value={bulkCategory}
                onChange={(e) => setBulkCategory(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkImportOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleBulkImport} disabled={importing}>
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                'Import Hooks'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Hook Dialog */}
      <Dialog open={editHookOpen} onOpenChange={setEditHookOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Hook</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Hook Text</label>
              <Textarea
                placeholder="Enter hook text..."
                value={newHookText}
                onChange={(e) => setNewHookText(e.target.value)}
                rows={3}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Category (optional)</label>
              <Input
                placeholder="e.g., CTA, Intro, Testimonial"
                value={newHookCategory}
                onChange={(e) => setNewHookCategory(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditHookOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateHook}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Hook Confirmation */}
      <Dialog open={deleteHookOpen} onOpenChange={setDeleteHookOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Hook</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this hook? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deletingHook && (
            <div className="p-3 rounded bg-muted text-sm">{deletingHook.text}</div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteHookOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteHook}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
