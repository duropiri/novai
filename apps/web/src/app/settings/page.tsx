'use client';

import { useState, useEffect } from 'react';
import { settingsApi, Setting, ApiKeyTestResult } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Key,
  Save,
  CheckCircle,
  XCircle,
  Loader2,
  ExternalLink,
  Eye,
  EyeOff,
  AlertCircle,
} from 'lucide-react';

interface ApiKeyConfig {
  key: string;
  label: string;
  description: string;
  signupUrl: string;
  placeholder: string;
}

const API_KEYS: ApiKeyConfig[] = [
  {
    key: 'GOOGLE_GEMINI_API_KEY',
    label: 'Google Gemini API',
    description: 'Used for generating character diagrams. Free tier available.',
    signupUrl: 'https://aistudio.google.com/apikey',
    placeholder: 'AIza...',
  },
  {
    key: 'FAL_API_KEY',
    label: 'fal.ai API',
    description: 'Used for LoRA training and face swap video generation. Pay-as-you-go pricing.',
    signupUrl: 'https://fal.ai/dashboard/keys',
    placeholder: 'fal_...',
  },
];

const COST_SETTINGS = [
  {
    key: 'DAILY_COST_LIMIT_CENTS',
    label: 'Daily Spending Limit',
    description: 'Maximum daily spend in dollars',
    type: 'currency',
  },
  {
    key: 'LORA_TRAINING_COST_CENTS',
    label: 'LoRA Training Cost',
    description: 'Cost per LoRA training job in dollars',
    type: 'currency',
  },
  {
    key: 'CHARACTER_DIAGRAM_COST_CENTS',
    label: 'Character Diagram Cost',
    description: 'Cost per character diagram in dollars',
    type: 'currency',
  },
  {
    key: 'FACE_SWAP_COST_PER_SECOND_CENTS',
    label: 'Face Swap Cost (per second)',
    description: 'Cost per second of video for face swap',
    type: 'currency',
  },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, ApiKeyTestResult>>({});
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await settingsApi.getAll();
      setSettings(data);

      // Initialize form values
      const values: Record<string, string> = {};
      data.forEach((setting) => {
        // For secrets, show empty (user must re-enter)
        // For non-secrets, show actual value
        if (setting.is_secret) {
          values[setting.key] = '';
        } else {
          values[setting.key] = setting.value || '';
        }
      });
      setFormValues(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (key: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [key]: value }));
    // Clear test result when value changes
    setTestResults((prev) => {
      const newResults = { ...prev };
      delete newResults[key];
      return newResults;
    });
  };

  const handleSave = async (key: string) => {
    const value = formValues[key];
    if (!value && API_KEYS.some((k) => k.key === key)) {
      // Don't save empty API keys
      return;
    }

    try {
      setSaving(key);
      setError(null);
      await settingsApi.update(key, value);
      setSuccessMessage(`${key} saved successfully`);
      setTimeout(() => setSuccessMessage(null), 3000);

      // For API keys, automatically test after saving
      if (API_KEYS.some((k) => k.key === key)) {
        await handleTestKey(key);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save setting');
    } finally {
      setSaving(null);
    }
  };

  const handleTestKey = async (key: string) => {
    try {
      setTesting(key);
      const result = await settingsApi.testApiKey(key);
      setTestResults((prev) => ({ ...prev, [key]: result }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [key]: { valid: false, message: err instanceof Error ? err.message : 'Test failed' },
      }));
    } finally {
      setTesting(null);
    }
  };

  const toggleShowSecret = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const getSetting = (key: string): Setting | undefined => {
    return settings.find((s) => s.key === key);
  };

  const hasExistingValue = (key: string): boolean => {
    const setting = getSetting(key);
    return setting?.value !== null && setting?.value !== '' && setting?.value !== undefined;
  };

  const centsToDisplayValue = (cents: string): string => {
    const num = parseInt(cents, 10);
    if (isNaN(num)) return '';
    return (num / 100).toFixed(2);
  };

  const displayValueToCents = (display: string): string => {
    const num = parseFloat(display);
    if (isNaN(num)) return '0';
    return Math.round(num * 100).toString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Configure API keys and application settings
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 text-destructive px-4 py-3 rounded-lg flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {successMessage && (
        <div className="bg-green-500/10 text-green-600 px-4 py-3 rounded-lg flex items-center gap-2">
          <CheckCircle className="h-4 w-4" />
          {successMessage}
        </div>
      )}

      {/* API Keys Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            API Keys
          </CardTitle>
          <CardDescription>
            Enter your API keys to enable the different features. Keys are stored securely and
            masked after saving.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {API_KEYS.map((apiKey) => {
            const hasValue = hasExistingValue(apiKey.key);
            const testResult = testResults[apiKey.key];

            return (
              <div key={apiKey.key} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor={apiKey.key} className="text-base font-medium">
                    {apiKey.label}
                  </Label>
                  <a
                    href={apiKey.signupUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline flex items-center gap-1"
                  >
                    Get API Key
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <p className="text-sm text-muted-foreground">{apiKey.description}</p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      id={apiKey.key}
                      type={showSecrets[apiKey.key] ? 'text' : 'password'}
                      placeholder={hasValue ? '••••••••••••' : apiKey.placeholder}
                      value={formValues[apiKey.key] || ''}
                      onChange={(e) => handleInputChange(apiKey.key, e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => toggleShowSecret(apiKey.key)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showSecrets[apiKey.key] ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  <Button
                    onClick={() => handleSave(apiKey.key)}
                    disabled={saving === apiKey.key || !formValues[apiKey.key]}
                    variant="outline"
                  >
                    {saving === apiKey.key ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    onClick={() => handleTestKey(apiKey.key)}
                    disabled={testing === apiKey.key || (!hasValue && !formValues[apiKey.key])}
                    variant="outline"
                  >
                    {testing === apiKey.key ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      'Test'
                    )}
                  </Button>
                </div>
                {hasValue && !formValues[apiKey.key] && (
                  <p className="text-xs text-muted-foreground">
                    A key is already saved. Enter a new value to replace it.
                  </p>
                )}
                {testResult && (
                  <div
                    className={`flex items-center gap-2 text-sm ${
                      testResult.valid ? 'text-green-600' : 'text-destructive'
                    }`}
                  >
                    {testResult.valid ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : (
                      <XCircle className="h-4 w-4" />
                    )}
                    {testResult.message}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Cost Settings Section */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Configuration</CardTitle>
          <CardDescription>
            Configure spending limits and cost tracking values
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {COST_SETTINGS.map((costSetting) => {
            const currentValue = formValues[costSetting.key] || '0';
            const displayValue = centsToDisplayValue(currentValue);

            return (
              <div key={costSetting.key} className="space-y-2">
                <Label htmlFor={costSetting.key} className="text-base font-medium">
                  {costSetting.label}
                </Label>
                <p className="text-sm text-muted-foreground">{costSetting.description}</p>
                <div className="flex gap-2 items-center">
                  <div className="relative w-40">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      $
                    </span>
                    <Input
                      id={costSetting.key}
                      type="number"
                      step="0.01"
                      min="0"
                      value={displayValue}
                      onChange={(e) =>
                        handleInputChange(costSetting.key, displayValueToCents(e.target.value))
                      }
                      className="pl-7"
                    />
                  </div>
                  <Button
                    onClick={() => handleSave(costSetting.key)}
                    disabled={saving === costSetting.key}
                    variant="outline"
                  >
                    {saving === costSetting.key ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Environment Variables Info */}
      <Card>
        <CardHeader>
          <CardTitle>Environment Variables</CardTitle>
          <CardDescription>
            API keys can also be set via environment variables. Database values take precedence.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted p-4 rounded-lg font-mono text-sm space-y-1">
            <p className="text-muted-foreground"># apps/api/.env</p>
            {API_KEYS.map((apiKey) => (
              <p key={apiKey.key}>
                {apiKey.key}=your-key-here
              </p>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
