'use client';

import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Upload, Trash2, Loader2, CheckCircle, XCircle, Clock, Download, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { characterApi, filesApi, type CharacterDiagram } from '@/lib/api';

export default function CharacterDiagramPage() {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [diagrams, setDiagrams] = useState<CharacterDiagram[]>([]);
  const [isLoadingDiagrams, setIsLoadingDiagrams] = useState(true);

  // Fetch existing diagrams
  const fetchDiagrams = useCallback(async () => {
    try {
      const data = await characterApi.list();
      setDiagrams(data);
    } catch (error) {
      console.error('Failed to fetch character diagrams:', error);
    } finally {
      setIsLoadingDiagrams(false);
    }
  }, []);

  useEffect(() => {
    fetchDiagrams();
    // Poll for updates every 5 seconds for processing diagrams
    const interval = setInterval(fetchDiagrams, 5000);
    return () => clearInterval(interval);
  }, [fetchDiagrams]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const imageFile = acceptedFiles[0];
    if (imageFile && imageFile.type.startsWith('image/')) {
      setFile(imageFile);
      setPreview(URL.createObjectURL(imageFile));
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp'],
    },
    multiple: false,
  });

  const clearFile = () => {
    if (preview) {
      URL.revokeObjectURL(preview);
    }
    setFile(null);
    setPreview(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!file) {
      toast({ title: 'Error', description: 'Please upload an image', variant: 'destructive' });
      return;
    }

    try {
      setIsGenerating(true);
      setIsUploading(true);

      // Upload image to Supabase
      toast({ title: 'Uploading', description: 'Uploading source image...' });
      const uploadResult = await filesApi.uploadFile(file, 'character-images');
      setIsUploading(false);

      // Create character diagram generation job
      toast({ title: 'Starting', description: 'Starting character diagram generation...' });
      await characterApi.create({
        name: name.trim() || undefined,
        sourceImageUrl: uploadResult.url,
      });

      toast({
        title: 'Success',
        description: 'Character diagram generation started! This typically takes 30-60 seconds.',
      });

      // Reset form
      setName('');
      clearFile();

      // Refresh diagrams list
      fetchDiagrams();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create character diagram';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    } finally {
      setIsGenerating(false);
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await characterApi.delete(id);
      toast({ title: 'Deleted', description: 'Character diagram deleted' });
      fetchDiagrams();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete';
      toast({ title: 'Error', description: message, variant: 'destructive' });
    }
  };

  const handleDownload = (url: string, name: string) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name.replace(/\s+/g, '-').toLowerCase()}-diagram.jpg`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getStatusBadge = (status: CharacterDiagram['status']) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
      case 'processing':
        return <Badge variant="warning"><Loader2 className="w-3 h-3 mr-1 animate-spin" /> Processing</Badge>;
      case 'ready':
        return <Badge variant="success"><CheckCircle className="w-3 h-3 mr-1" /> Ready</Badge>;
      case 'failed':
        return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" /> Failed</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Character Diagram Generator</h1>
        <p className="text-muted-foreground">
          Generate reference sheets with full-body and face close-up views
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Create Form */}
        <Card>
          <CardHeader>
            <CardTitle>Generate New Diagram</CardTitle>
            <CardDescription>
              Upload a photo to generate a character reference sheet
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name (optional)</Label>
                <Input
                  id="name"
                  placeholder="e.g., Model Name - Blue Dress"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isGenerating}
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to auto-generate a name
                </p>
              </div>

              <div className="space-y-2">
                <Label>Source Image</Label>
                {!file ? (
                  <div
                    {...getRootProps()}
                    className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                      isDragActive
                        ? 'border-primary bg-primary/5'
                        : 'border-muted-foreground/25 hover:border-primary/50'
                    } ${isGenerating ? 'pointer-events-none opacity-50' : ''}`}
                  >
                    <input {...getInputProps()} />
                    <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                    {isDragActive ? (
                      <p>Drop the image here...</p>
                    ) : (
                      <p className="text-muted-foreground">
                        Drag & drop an image, or click to select
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      PNG, JPG, JPEG, or WebP
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
                      disabled={isGenerating}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={isGenerating || !file}>
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {isUploading ? 'Uploading...' : 'Generating...'}
                  </>
                ) : (
                  'Generate Diagram'
                )}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Diagrams List */}
        <Card>
          <CardHeader>
            <CardTitle>Your Character Diagrams</CardTitle>
            <CardDescription>
              Generated reference sheets ready for face swap
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingDiagrams ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin" />
              </div>
            ) : diagrams.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No character diagrams yet</p>
                <p className="text-sm">Generate your first diagram to get started</p>
              </div>
            ) : (
              <div className="space-y-3">
                {diagrams.map((diagram) => (
                  <div
                    key={diagram.id}
                    className="border rounded-lg overflow-hidden"
                  >
                    {/* Show generated image if ready */}
                    {diagram.status === 'ready' && diagram.file_url && (
                      <img
                        src={diagram.file_url}
                        alt={diagram.name}
                        className="w-full h-32 object-cover"
                      />
                    )}

                    <div className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{diagram.name}</span>
                            {getStatusBadge(diagram.status)}
                          </div>
                          {diagram.status === 'failed' && diagram.error_message && (
                            <p className="text-xs text-destructive">{diagram.error_message}</p>
                          )}
                        </div>
                        <div className="flex gap-1">
                          {diagram.status === 'ready' && diagram.file_url && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDownload(diagram.file_url!, diagram.name)}
                                title="Download"
                              >
                                <Download className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => window.location.href = '/swap'}
                                title="Use in Swapper"
                              >
                                <ArrowRight className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                          {(diagram.status === 'ready' || diagram.status === 'failed') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDelete(diagram.id)}
                              title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
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
    </div>
  );
}
