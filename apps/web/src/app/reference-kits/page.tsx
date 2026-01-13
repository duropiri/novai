'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  Trash2,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  User,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { referenceKitApi, filesApi, type ReferenceKit } from '@/lib/api';

const EXPRESSION_OPTIONS = [
  { id: 'smile', label: 'Smile' },
  { id: 'serious', label: 'Serious' },
  { id: 'surprised', label: 'Surprised' },
  { id: 'angry', label: 'Angry' },
];

export default function ReferenceKitsPage() {
  const { toast } = useToast();

  // Form state
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [generateExtended, setGenerateExtended] = useState(false);
  const [selectedExpressions, setSelectedExpressions] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // Data state
  const [kits, setKits] = useState<ReferenceKit[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Detail modal state
  const [selectedKit, setSelectedKit] = useState<ReferenceKit | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  // Fetch kits
  const fetchKits = useCallback(async () => {
    try {
      const data = await referenceKitApi.list();
      setKits(data);
    } catch (error) {
      console.error('Failed to fetch reference kits:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKits();
    // Poll for updates when there are generating kits
    const interval = setInterval(fetchKits, 5000);
    return () => clearInterval(interval);
  }, [fetchKits]);

  // Dropzone
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const imageFile = acceptedFiles[0];
    if (imageFile && imageFile.type.startsWith('image/')) {
      setFile(imageFile);
      setPreview(URL.createObjectURL(imageFile));
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] },
    multiple: false,
  });

  const clearFile = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
  };

  // Submit handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) {
      toast({ title: 'Error', description: 'Please upload an image', variant: 'destructive' });
      return;
    }

    if (!name.trim()) {
      toast({ title: 'Error', description: 'Please enter a name', variant: 'destructive' });
      return;
    }

    try {
      setIsCreating(true);
      setIsUploading(true);

      toast({ title: 'Uploading', description: 'Uploading source image...' });
      const uploadResult = await filesApi.uploadFile(file, 'character-images');
      setIsUploading(false);

      toast({ title: 'Starting', description: 'Starting Reference Kit generation...' });
      await referenceKitApi.create({
        name: name.trim(),
        sourceImageUrl: uploadResult.url,
        generateExtended,
        expressions: selectedExpressions.length > 0 ? selectedExpressions : undefined,
      });

      toast({
        title: 'Success',
        description: 'Reference Kit generation started! This typically takes 1-2 minutes.',
      });

      setName('');
      clearFile();
      setGenerateExtended(false);
      setSelectedExpressions([]);
      fetchKits();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create Reference Kit';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsCreating(false);
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await referenceKitApi.delete(id);
      toast({ title: 'Deleted', description: 'Reference Kit deleted' });
      fetchKits();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const handleRegenerate = async (kitId: string, refType: string) => {
    try {
      await referenceKitApi.regenerate(kitId, refType);
      toast({ title: 'Started', description: `Regenerating ${refType}...` });
      fetchKits();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to regenerate';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const openDetailModal = (kit: ReferenceKit) => {
    setSelectedKit(kit);
    setDetailModalOpen(true);
  };

  const toggleExpression = (expr: string) => {
    setSelectedExpressions((prev) =>
      prev.includes(expr) ? prev.filter((e) => e !== expr) : [...prev, expr]
    );
  };

  const getStatusBadge = (status: ReferenceKit['status']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      case 'generating':
        return <Badge variant="warning"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Generating</Badge>;
      case 'ready':
        return <Badge variant="success"><CheckCircle className="w-3 h-3 mr-1" /> Ready</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" /> Failed</Badge>;
    }
  };

  const getProgressStatus = (progress: Record<string, string>, type: string) => {
    const status = progress[type];
    if (status === 'done') return <CheckCircle className="w-4 h-4 text-green-500" />;
    if (status === 'generating') return <Loader2 className="w-4 h-4 animate-spin text-yellow-500" />;
    if (status === 'failed') return <XCircle className="w-4 h-4 text-red-500" />;
    if (status === 'pending') return <Clock className="w-4 h-4 text-muted-foreground" />;
    return null;
  };

  const countReferences = (kit: ReferenceKit) => {
    let count = 0;
    if (kit.anchor_face_url) count++;
    if (kit.profile_url) count++;
    if (kit.half_body_url) count++;
    if (kit.full_body_url) count++;
    count += Object.keys(kit.expressions || {}).length;
    return count;
  };

  // Estimate cost based on selected options
  const estimateCost = () => {
    let refs = 2; // anchor + profile (always)
    if (generateExtended) refs += 2; // half_body + full_body
    refs += selectedExpressions.length;
    return (refs * 0.02).toFixed(2);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Reference Kits</h1>
        <p className="text-muted-foreground">
          Generate identity-preserving reference images for AI image generation
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Create Form */}
        <Card>
          <CardHeader>
            <CardTitle>Create New Reference Kit</CardTitle>
            <CardDescription>
              Generate multiple reference angles from a single photo for consistent identity
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Name field */}
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g., Sarah - Main Character"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isCreating}
                />
              </div>

              {/* Source Image */}
              <div className="space-y-2">
                <Label>Source Image *</Label>
                {!file ? (
                  <div
                    {...getRootProps()}
                    className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                      isDragActive
                        ? 'border-primary bg-primary/5'
                        : 'border-muted-foreground/25 hover:border-primary/50'
                    } ${isCreating ? 'pointer-events-none opacity-50' : ''}`}
                  >
                    <input {...getInputProps()} />
                    <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                    {isDragActive ? (
                      <p>Drop the image here...</p>
                    ) : (
                      <p className="text-muted-foreground">
                        Drag & drop a clear photo of the person
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      PNG, JPG, JPEG, or WebP - A front-facing photo works best
                    </p>
                  </div>
                ) : (
                  <div className="relative">
                    <img
                      src={preview!}
                      alt="Preview"
                      className="w-full max-h-64 object-contain rounded-lg border"
                    />
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="absolute top-2 right-2"
                      onClick={clearFile}
                      disabled={isCreating}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>

              {/* Reference Options */}
              <div className="space-y-4">
                <Label>Reference Options</Label>

                {/* Extended references */}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="extended"
                    checked={generateExtended}
                    onCheckedChange={(checked) => setGenerateExtended(checked as boolean)}
                    disabled={isCreating}
                  />
                  <Label htmlFor="extended" className="cursor-pointer">
                    Generate extended (waist-up & full-body)
                  </Label>
                </div>

                {/* Expressions */}
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Expression variants:</p>
                  <div className="flex flex-wrap gap-2">
                    {EXPRESSION_OPTIONS.map((expr) => (
                      <div key={expr.id} className="flex items-center space-x-2">
                        <Checkbox
                          id={`expr-${expr.id}`}
                          checked={selectedExpressions.includes(expr.id)}
                          onCheckedChange={() => toggleExpression(expr.id)}
                          disabled={isCreating}
                        />
                        <Label htmlFor={`expr-${expr.id}`} className="cursor-pointer text-sm">
                          {expr.label}
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Cost estimate */}
              <div className="p-3 bg-muted rounded-lg text-sm text-muted-foreground">
                <div className="flex justify-between">
                  <span>Estimated cost:</span>
                  <span className="font-medium">~${estimateCost()}</span>
                </div>
                <p className="text-xs mt-1">
                  Core refs (anchor + profile) + {generateExtended ? '2 extended + ' : ''}{selectedExpressions.length} expressions
                </p>
              </div>

              <Button type="submit" className="w-full" disabled={isCreating || !file || !name.trim()}>
                {isCreating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {isUploading ? 'Uploading...' : 'Creating...'}
                  </>
                ) : (
                  <>
                    <Users className="w-4 h-4 mr-2" />
                    Create Reference Kit
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Kits List */}
        <Card>
          <CardHeader>
            <CardTitle>Your Reference Kits</CardTitle>
            <CardDescription>
              Multi-angle reference sets for identity-preserving generation
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : kits.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No reference kits yet</p>
                <p className="text-sm">Create your first kit to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                {kits.map((kit) => (
                  <div
                    key={kit.id}
                    className="border rounded-lg overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => openDetailModal(kit)}
                  >
                    <div className="flex">
                      {/* Thumbnail */}
                      <div className="w-20 h-20 flex-shrink-0">
                        <img
                          src={kit.anchor_face_url || kit.source_image_url}
                          alt={kit.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      {/* Info */}
                      <div className="flex-1 p-3">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{kit.name}</span>
                              {getStatusBadge(kit.status)}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {countReferences(kit)} references
                            </p>
                            {kit.status === 'failed' && kit.error_message && (
                              <p className="text-xs text-destructive">{kit.error_message}</p>
                            )}
                          </div>
                          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                            {(kit.status === 'ready' || kit.status === 'failed') && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(kit.id)}
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detail Modal */}
      <Dialog open={detailModalOpen} onOpenChange={setDetailModalOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selectedKit?.name}</DialogTitle>
            <DialogDescription>
              View and manage reference images
            </DialogDescription>
          </DialogHeader>
          {selectedKit && (
            <div className="space-y-4">
              {/* Source */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Source Image</Label>
                <img
                  src={selectedKit.source_image_url}
                  alt="Source"
                  className="w-32 h-32 object-cover rounded-lg border"
                />
              </div>

              {/* Core References */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Core References</Label>
                <div className="grid grid-cols-2 gap-4">
                  {/* Anchor */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">Anchor Face</span>
                      {getProgressStatus(selectedKit.generation_progress, 'anchor')}
                    </div>
                    {selectedKit.anchor_face_url ? (
                      <div className="relative group">
                        <img
                          src={selectedKit.anchor_face_url}
                          alt="Anchor"
                          className="w-full aspect-square object-cover rounded-lg border"
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleRegenerate(selectedKit.id, 'anchor')}
                        >
                          <RefreshCw className="w-3 h-3 mr-1" />
                          Redo
                        </Button>
                      </div>
                    ) : (
                      <div className="w-full aspect-square bg-muted rounded-lg flex items-center justify-center">
                        <User className="w-8 h-8 text-muted-foreground" />
                      </div>
                    )}
                  </div>

                  {/* Profile */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">Profile (3/4)</span>
                      {getProgressStatus(selectedKit.generation_progress, 'profile')}
                    </div>
                    {selectedKit.profile_url ? (
                      <div className="relative group">
                        <img
                          src={selectedKit.profile_url}
                          alt="Profile"
                          className="w-full aspect-square object-cover rounded-lg border"
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleRegenerate(selectedKit.id, 'profile')}
                        >
                          <RefreshCw className="w-3 h-3 mr-1" />
                          Redo
                        </Button>
                      </div>
                    ) : (
                      <div className="w-full aspect-square bg-muted rounded-lg flex items-center justify-center">
                        <User className="w-8 h-8 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Extended References */}
              {(selectedKit.half_body_url || selectedKit.full_body_url ||
                selectedKit.generation_progress['half_body'] ||
                selectedKit.generation_progress['waist_up'] ||
                selectedKit.generation_progress['full_body']) && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Extended References</Label>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Waist Up */}
                    {(selectedKit.half_body_url || selectedKit.generation_progress['half_body'] || selectedKit.generation_progress['waist_up']) && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">Waist Up</span>
                          {getProgressStatus(selectedKit.generation_progress, 'waist_up') || getProgressStatus(selectedKit.generation_progress, 'half_body')}
                        </div>
                        {selectedKit.half_body_url ? (
                          <div className="relative group">
                            <img
                              src={selectedKit.half_body_url}
                              alt="Waist Up"
                              className="w-full aspect-square object-cover rounded-lg border"
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => handleRegenerate(selectedKit.id, 'waist_up')}
                            >
                              <RefreshCw className="w-3 h-3 mr-1" />
                              Redo
                            </Button>
                          </div>
                        ) : (
                          <div className="w-full aspect-square bg-muted rounded-lg flex items-center justify-center">
                            <User className="w-8 h-8 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Full Body */}
                    {(selectedKit.full_body_url || selectedKit.generation_progress['full_body']) && (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm">Full Body</span>
                          {getProgressStatus(selectedKit.generation_progress, 'full_body')}
                        </div>
                        {selectedKit.full_body_url ? (
                          <div className="relative group">
                            <img
                              src={selectedKit.full_body_url}
                              alt="Full Body"
                              className="w-full aspect-square object-cover rounded-lg border"
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => handleRegenerate(selectedKit.id, 'full_body')}
                            >
                              <RefreshCw className="w-3 h-3 mr-1" />
                              Redo
                            </Button>
                          </div>
                        ) : (
                          <div className="w-full aspect-square bg-muted rounded-lg flex items-center justify-center">
                            <User className="w-8 h-8 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Expressions */}
              {Object.keys(selectedKit.expressions || {}).length > 0 && (
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Expressions</Label>
                  <div className="grid grid-cols-4 gap-2">
                    {Object.entries(selectedKit.expressions).map(([name, url]) => (
                      <div key={name} className="space-y-1">
                        <div className="flex items-center gap-1">
                          <span className="text-xs capitalize">{name}</span>
                        </div>
                        <div className="relative group">
                          <img
                            src={url}
                            alt={name}
                            className="w-full aspect-square object-cover rounded-lg border"
                          />
                          <Button
                            variant="secondary"
                            size="icon"
                            className="absolute bottom-1 right-1 w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleRegenerate(selectedKit.id, `expression_${name}`)}
                          >
                            <RefreshCw className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
