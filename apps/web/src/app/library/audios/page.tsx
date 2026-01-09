'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import {
  Music,
  Upload,
  FolderPlus,
  MoreVertical,
  Trash2,
  Pencil,
  Loader2,
  Play,
  Pause,
  Clock,
  HardDrive,
} from 'lucide-react';
import { audioApi, collectionsApi, filesApi, Collection, AudioFile } from '@/lib/api';

export default function AudiosPage() {
  const [audios, setAudios] = useState<AudioFile[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  // Audio player state
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Dialog states
  const [createCollectionOpen, setCreateCollectionOpen] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [editCollectionOpen, setEditCollectionOpen] = useState(false);
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null);
  const [deleteAudioOpen, setDeleteAudioOpen] = useState(false);
  const [deletingAudio, setDeletingAudio] = useState<AudioFile | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [audiosData, collectionsData] = await Promise.all([
        selectedCollection === 'all'
          ? audioApi.list()
          : audioApi.list(selectedCollection),
        collectionsApi.list('audio'),
      ]);
      setAudios(audiosData);
      setCollections(collectionsData);
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, [selectedCollection]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (selectedCollection === 'all') {
      alert('Please select a collection first');
      return;
    }

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        // Upload file to storage
        const uploaded = await filesApi.uploadFile(file, 'audio');

        // Create audio record
        await audioApi.create({
          name: file.name.replace(/\.[^/.]+$/, ''),
          collectionId: selectedCollection,
          fileUrl: uploaded.url,
          fileSizeBytes: file.size,
        });
      }
      await loadData();
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload audio');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleCreateCollection = async () => {
    if (!newCollectionName.trim()) return;

    try {
      await collectionsApi.create({
        name: newCollectionName.trim(),
        type: 'audio',
      });
      setNewCollectionName('');
      setCreateCollectionOpen(false);
      await loadData();
    } catch (error) {
      console.error('Failed to create collection:', error);
      alert('Failed to create collection');
    }
  };

  const handleUpdateCollection = async () => {
    if (!editingCollection || !newCollectionName.trim()) return;

    try {
      await collectionsApi.update(editingCollection.id, newCollectionName.trim());
      setEditCollectionOpen(false);
      setEditingCollection(null);
      setNewCollectionName('');
      await loadData();
    } catch (error) {
      console.error('Failed to update collection:', error);
      alert('Failed to update collection');
    }
  };

  const handleDeleteCollection = async (collection: Collection) => {
    if (!confirm(`Delete collection "${collection.name}"? Audio files will be preserved.`)) return;

    try {
      await collectionsApi.delete(collection.id);
      if (selectedCollection === collection.id) {
        setSelectedCollection('all');
      }
      await loadData();
    } catch (error) {
      console.error('Failed to delete collection:', error);
      alert('Failed to delete collection');
    }
  };

  const handleDeleteAudio = async () => {
    if (!deletingAudio) return;

    try {
      await audioApi.delete(deletingAudio.id);
      setDeleteAudioOpen(false);
      setDeletingAudio(null);
      await loadData();
    } catch (error) {
      console.error('Failed to delete audio:', error);
      alert('Failed to delete audio');
    }
  };

  const togglePlay = (audio: AudioFile) => {
    if (playingId === audio.id) {
      // Pause current
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingId(null);
    } else {
      // Play new
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const newAudio = new Audio(audio.file_url);
      newAudio.onended = () => setPlayingId(null);
      newAudio.play();
      audioRef.current = newAudio;
      setPlayingId(audio.id);
    }
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number | null) => {
    if (!bytes) return '--';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex-1 space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Audios</h1>
          <p className="text-muted-foreground">
            Manage your audio collections for the Variant Generator
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setCreateCollectionOpen(true)}>
            <FolderPlus className="mr-2 h-4 w-4" />
            New Collection
          </Button>
          <div className="relative">
            <input
              type="file"
              accept="audio/*"
              multiple
              onChange={handleFileUpload}
              disabled={uploading || selectedCollection === 'all'}
              className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
            />
            <Button disabled={uploading || selectedCollection === 'all'}>
              {uploading ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {uploading ? 'Uploading...' : 'Upload Audio'}
            </Button>
          </div>
        </div>
      </div>

      {/* Collection selector */}
      <div className="flex items-center gap-4">
        <Select value={selectedCollection} onValueChange={setSelectedCollection}>
          <SelectTrigger className="w-[250px]">
            <SelectValue placeholder="Select collection" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Audio Files</SelectItem>
            {collections.map((col) => (
              <SelectItem key={col.id} value={col.id}>
                {col.name} ({col.itemCount || 0})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedCollection !== 'all' && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem
                onClick={() => {
                  const col = collections.find((c) => c.id === selectedCollection);
                  if (col) {
                    setEditingCollection(col);
                    setNewCollectionName(col.name);
                    setEditCollectionOpen(true);
                  }
                }}
              >
                <Pencil className="mr-2 h-4 w-4" />
                Rename Collection
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => {
                  const col = collections.find((c) => c.id === selectedCollection);
                  if (col) handleDeleteCollection(col);
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Collection
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Audio list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : audios.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Music className="h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No audio files yet</h3>
          <p className="text-muted-foreground mt-1">
            {selectedCollection === 'all'
              ? 'Create a collection and upload audio files to get started'
              : 'Upload audio files to this collection'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {audios.map((audio) => (
            <div
              key={audio.id}
              className="flex items-center gap-4 p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
            >
              {/* Play button */}
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => togglePlay(audio)}
              >
                {playingId === audio.id ? (
                  <Pause className="h-5 w-5" />
                ) : (
                  <Play className="h-5 w-5" />
                )}
              </Button>

              {/* Audio info */}
              <div className="flex-1 min-w-0">
                <h3 className="font-medium truncate">{audio.name}</h3>
                <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDuration(audio.duration_seconds)}
                  </span>
                  <span className="flex items-center gap-1">
                    <HardDrive className="h-3 w-3" />
                    {formatFileSize(audio.file_size_bytes)}
                  </span>
                </div>
              </div>

              {/* Actions */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => {
                      setDeletingAudio(audio);
                      setDeleteAudioOpen(true);
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

      {/* Create Collection Dialog */}
      <Dialog open={createCollectionOpen} onOpenChange={setCreateCollectionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Audio Collection</DialogTitle>
            <DialogDescription>
              Create a new collection to organize your audio files.
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Collection name"
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateCollection()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateCollectionOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateCollection}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Collection Dialog */}
      <Dialog open={editCollectionOpen} onOpenChange={setEditCollectionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Collection</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Collection name"
            value={newCollectionName}
            onChange={(e) => setNewCollectionName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleUpdateCollection()}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditCollectionOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateCollection}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Audio Confirmation */}
      <Dialog open={deleteAudioOpen} onOpenChange={setDeleteAudioOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Audio File</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deletingAudio?.name}&quot;? This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteAudioOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteAudio}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
